import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Flag } from "@/components/ui/Flag";
import { HOME_ALL_REGION, type HomeRegionOption } from "@/utils/homeNodes";

/** 鼠标按下后移动超过这个距离才算拖动；没到就是普通点击（筛选地区）。 */
const MOUSE_DRAG_THRESHOLD_PX = 5;
/**
 * 触屏要先长按才进入拖动：地区栏在页面中间，手指按上去一划多半是想滚动页面，
 * 一碰就拖的话页面就滚不动了。长按期间手指挪动超过容差就当滚动、放弃拖动。
 */
const TOUCH_LONG_PRESS_MS = 320;
const TOUCH_MOVE_TOLERANCE_PX = 8;
const REORDER_ANIMATION_MS = 160;
/** 离别的位置比离自己的位置近这么多才换位：标签宽窄不一，没有这点余量会在交界处来回跳。 */
const SWAP_HYSTERESIS_PX = 6;
/** 拖完抬手后浏览器还会补一次 click，这段时间内的 click 不当筛选。 */
const CLICK_SUPPRESS_MS = 400;

interface PendingPress {
  code: string;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  /** 按下的位置相对标签左上角的偏移：拖动时标签跟着指针走，抓哪儿就一直是哪儿。 */
  grabX: number;
  grabY: number;
  timer: number | null;
}

interface ActiveDrag {
  code: string;
  pointerId: number;
  grabX: number;
  grabY: number;
  x: number;
  y: number;
}

type Point = { left: number; top: number };

function moveItem(list: readonly string[], from: number, to: number): string[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((code, index) => code === right[index]);
}

/** 拖动途中地区变了（全量同步增删了节点）：还在的保持拖动中的顺序，新出现的接在后面。 */
function reconcileOrder(order: readonly string[], codes: readonly string[]): string[] {
  const available = new Set(codes);
  const kept = order.filter((code) => available.has(code));
  const keptSet = new Set(kept);
  return [...kept, ...codes.filter((code) => !keptSet.has(code))];
}

/**
 * 地区筛选栏：按国旗聚合节点，点击某地区只看该地区，再点一次（或点已选中项）回到全部。
 * 与分组栏是两条独立筛选，可叠加（先分组、后地区）。
 *
 * 传了 `onReorder` 就能直接拖动标签调整顺序（鼠标按住拖，触屏长按再拖）。拖动中只改本组件里的
 * 预览顺序，抬手才交给上层存；Esc 或浏览器中断拖动（pointercancel）就退回原顺序。
 */
export function RegionTabs({
  regions,
  selectedRegion,
  onSelectRegion,
  onReorder,
}: {
  regions: HomeRegionOption[];
  selectedRegion: string;
  onSelectRegion: (region: string) => void;
  /** 拖完、且顺序真的变了才调，参数是当前显示的全部地区代码。 */
  onReorder?: (codes: string[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());
  const [previewOrder, setPreviewOrder] = useState<string[] | null>(null);
  const [draggingCode, setDraggingCode] = useState<string | null>(null);
  const suppressClickUntilRef = useRef(0);
  /** 换位前各标签在屏幕上的位置；换位渲染完据此把它们从旧位置滑过去（FLIP）。 */
  const flipFromRef = useRef<Map<string, Point> | null>(null);

  const codes = useMemo(() => regions.map((region) => region.code), [regions]);
  const byCode = useMemo(
    () => new Map(regions.map((region) => [region.code, region])),
    [regions],
  );
  const order = useMemo(
    () => (previewOrder ? reconcileOrder(previewOrder, codes) : codes),
    [previewOrder, codes],
  );

  // 指针事件挂在 window 上、只在按下时装一次，读到的必须是最新值，所以经 ref 转一道。
  const latestRef = useRef({ order, codes, onReorder });
  useLayoutEffect(() => {
    latestRef.current = { order, codes, onReorder };
  });

  const controller = useMemo(() => {
    let pending: PendingPress | null = null;
    let drag: ActiveDrag | null = null;

    const visualPositions = () => {
      const positions = new Map<string, Point>();
      for (const [code, el] of chipRefs.current) {
        const rect = el.getBoundingClientRect();
        positions.set(code, { left: rect.left, top: rect.top });
      }
      return positions;
    };

    /** 拖动中的标签贴着指针：布局位置（offsetLeft，不受 transform 影响）和指针之间差多少就平移多少。 */
    const positionDragged = () => {
      const container = containerRef.current;
      const el = drag ? chipRefs.current.get(drag.code) : undefined;
      if (!drag || !container || !el) return;
      const box = container.getBoundingClientRect();
      const dx = drag.x - drag.grabX - (box.left + container.clientLeft + el.offsetLeft);
      const dy = drag.y - drag.grabY - (box.top + container.clientTop + el.offsetTop);
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    };

    /** 拖动中的标签中心离哪个标签的位置最近，就挪到那个位置（地区栏会换行，所以按二维距离算）。 */
    const updateTarget = () => {
      const container = containerRef.current;
      const el = drag ? chipRefs.current.get(drag.code) : undefined;
      if (!drag || !container || !el) return;
      const current = latestRef.current.order;
      const from = current.indexOf(drag.code);
      if (from === -1) return;

      const box = container.getBoundingClientRect();
      const originX = box.left + container.clientLeft;
      const originY = box.top + container.clientTop;
      const centerX = drag.x - drag.grabX + el.offsetWidth / 2;
      const centerY = drag.y - drag.grabY + el.offsetHeight / 2;
      const distanceTo = (chip: HTMLElement) =>
        Math.hypot(
          centerX - (originX + chip.offsetLeft + chip.offsetWidth / 2),
          centerY - (originY + chip.offsetTop + chip.offsetHeight / 2),
        );

      const ownDistance = distanceTo(el);
      let target = from;
      let best = ownDistance;
      current.forEach((code, index) => {
        if (index === from) return;
        const chip = chipRefs.current.get(code);
        if (!chip) return;
        const distance = distanceTo(chip);
        if (distance + SWAP_HYSTERESIS_PX < ownDistance && distance < best) {
          target = index;
          best = distance;
        }
      });
      if (target === from) return;
      flipFromRef.current = visualPositions();
      setPreviewOrder(moveItem(current, from, target));
    };

    const beginDrag = (press: PendingPress, x: number, y: number) => {
      if (press.timer != null) window.clearTimeout(press.timer);
      pending = null;
      drag = {
        code: press.code,
        pointerId: press.pointerId,
        grabX: press.grabX,
        grabY: press.grabY,
        x,
        y,
      };
      const el = chipRefs.current.get(press.code);
      // 拖动中位置每帧都在变，不能带过渡；松手时再加回来让它滑回格子里。
      if (el) el.style.transition = "none";
      window.getSelection()?.removeAllRanges();
      setDraggingCode(press.code);
      setPreviewOrder(latestRef.current.order);
      positionDragged();
    };

    const detach = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
      window.removeEventListener("keydown", handleKeyDown);
    };

    const finishDrag = (commit: boolean) => {
      const active = drag;
      drag = null;
      detach();
      if (!active) return;

      const el = chipRefs.current.get(active.code);
      if (el) {
        el.style.transition = `transform ${REORDER_ANIMATION_MS}ms ease`;
        el.style.transform = "";
        window.setTimeout(() => {
          if (drag?.code !== active.code) el.style.transition = "";
        }, REORDER_ANIMATION_MS);
      }
      suppressClickUntilRef.current = performance.now() + CLICK_SUPPRESS_MS;
      setDraggingCode(null);

      const { order: finalOrder, codes: savedOrder, onReorder: save } = latestRef.current;
      if (commit && !sameOrder(finalOrder, savedOrder)) {
        // 上层同步写进设置，这一拍 regions 就是新顺序，和清掉预览一起渲染，不会闪回旧顺序。
        save?.(finalOrder);
      } else if (!sameOrder(finalOrder, savedOrder)) {
        flipFromRef.current = visualPositions();
      }
      setPreviewOrder(null);
    };

    const cancelPending = () => {
      if (pending?.timer != null) window.clearTimeout(pending.timer);
      pending = null;
    };

    function handleMove(event: PointerEvent) {
      if (drag) {
        if (event.pointerId !== drag.pointerId) return;
        drag.x = event.clientX;
        drag.y = event.clientY;
        positionDragged();
        updateTarget();
        return;
      }
      if (!pending || event.pointerId !== pending.pointerId) return;
      const moved = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY);
      if (pending.pointerType === "mouse") {
        if (moved > MOUSE_DRAG_THRESHOLD_PX) beginDrag(pending, event.clientX, event.clientY);
      } else if (moved > TOUCH_MOVE_TOLERANCE_PX) {
        // 长按还没到就挪了：这是在滚页面，放手让浏览器处理。
        cancelPending();
        detach();
      }
    }

    function handleUp(event: PointerEvent) {
      if (drag) {
        if (event.pointerId === drag.pointerId) finishDrag(true);
        return;
      }
      if (pending && event.pointerId === pending.pointerId) {
        cancelPending();
        detach();
      }
    }

    function handleCancel(event: PointerEvent) {
      if (drag) {
        if (event.pointerId === drag.pointerId) finishDrag(false);
        return;
      }
      if (pending && event.pointerId === pending.pointerId) {
        cancelPending();
        detach();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && drag) finishDrag(false);
    }

    return {
      isDragging: () => drag != null,
      isPressing: () => drag != null || pending != null,
      pointerDown(event: ReactPointerEvent<HTMLButtonElement>, code: string) {
        if (!latestRef.current.onReorder || latestRef.current.codes.length < 2) return;
        if (drag) return;
        if (event.pointerType === "mouse" && event.button !== 0) return;
        cancelPending();
        detach();
        const rect = event.currentTarget.getBoundingClientRect();
        const press: PendingPress = {
          code,
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          startX: event.clientX,
          startY: event.clientY,
          grabX: event.clientX - rect.left,
          grabY: event.clientY - rect.top,
          timer: null,
        };
        if (event.pointerType !== "mouse") {
          press.timer = window.setTimeout(
            () => beginDrag(press, press.startX, press.startY),
            TOUCH_LONG_PRESS_MS,
          );
        }
        pending = press;
        window.addEventListener("pointermove", handleMove);
        window.addEventListener("pointerup", handleUp);
        window.addEventListener("pointercancel", handleCancel);
        window.addEventListener("keydown", handleKeyDown);
      },
      positionDragged,
      dispose() {
        cancelPending();
        drag = null;
        detach();
      },
    };
  }, []);

  useEffect(() => () => controller.dispose(), [controller]);

  // 触屏拖动时拦住页面滚动。必须是非被动监听、而且一直挂着：等长按到了再挂，这一次触摸
  // 的滚动已经由浏览器接管了。只拦「正在拖」的那段，长按还没到时照常滚动。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const blockScroll = (event: TouchEvent) => {
      if (controller.isDragging()) event.preventDefault();
    };
    container.addEventListener("touchmove", blockScroll, { passive: false });
    return () => container.removeEventListener("touchmove", blockScroll);
  }, [controller]);

  // 换位之后：别的标签从旧位置滑到新位置，拖动中的标签重新贴回指针。
  useLayoutEffect(() => {
    const from = flipFromRef.current;
    flipFromRef.current = null;
    if (from) {
      for (const [code, el] of chipRefs.current) {
        if (code === draggingCode) continue;
        const before = from.get(code);
        if (!before) continue;
        el.style.transition = "none";
        el.style.transform = "";
        const after = el.getBoundingClientRect();
        const dx = before.left - after.left;
        const dy = before.top - after.top;
        if (dx === 0 && dy === 0) {
          el.style.transition = "";
          continue;
        }
        el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
        // 先让浏览器按旧位置排一次，下面清掉 transform 才会有过渡。
        void el.offsetWidth;
        el.style.transition = `transform ${REORDER_ANIMATION_MS}ms ease`;
        el.style.transform = "";
        window.setTimeout(() => {
          if (el.style.transform === "") el.style.transition = "";
        }, REORDER_ANIMATION_MS);
      }
    }
    controller.positionDragged();
  }, [order, draggingCode, controller]);

  return (
    <section className="home-region-bar" aria-label="地区筛选">
      <div
        ref={containerRef}
        className="home-region-chips"
        role="group"
        data-reordering={draggingCode ? "true" : undefined}
      >
        {order.map((code) => {
          const region = byCode.get(code);
          if (!region) return null;
          const active = selectedRegion === code;
          return (
            <button
              key={code}
              ref={(el) => {
                if (el) chipRefs.current.set(code, el);
                else chipRefs.current.delete(code);
              }}
              type="button"
              className="home-region-chip"
              data-active={active ? "true" : "false"}
              data-dragging={draggingCode === code ? "true" : undefined}
              aria-pressed={active}
              onPointerDown={(event) => controller.pointerDown(event, code)}
              // 国旗是 <img>：不拦的话鼠标一拖就变成浏览器原生的拖图片。
              onDragStart={(event) => event.preventDefault()}
              // 安卓长按按钮可能弹菜单，正在按着 / 拖着时不要它。
              onContextMenu={(event) => {
                if (controller.isPressing()) event.preventDefault();
              }}
              onClick={() => {
                if (performance.now() < suppressClickUntilRef.current) return;
                onSelectRegion(active ? HOME_ALL_REGION : code);
              }}
              title={code}
            >
              <Flag region={code} size={14} />
              <span className="home-region-chip-code">{code}</span>
              <span className="home-region-chip-count">{region.count}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
