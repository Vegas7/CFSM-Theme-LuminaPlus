import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { TOUCH_BUCKET_HOLD_MS } from "./touchBucketPick";

/** 同一时刻只开一个：点了另一项，前一个先收起。 */
let closeActiveTip: (() => void) | null = null;

/**
 * 小卡 / 迷你卡指标行的详情气泡（站长 2026-09-21：这几项「点不了，看不了具体数值」）。
 *
 * 之前小卡只挂了原生 `title` —— 鼠标停一会儿才在下方弹、触屏上根本没有；迷你卡连这个都没有。
 * 鼠标悬停即弹、移开即收；触屏点一下弹，再点或过 `TOUCH_BUCKET_HOLD_MS`（和延迟柱子点选同一个时长）后收。
 * 这两种卡片的指标行不在链接里，点一下不会跳去详情页，所以不用拦点击。
 */
export function useMetricDetailTip() {
  const [open, setOpen] = useState(false);
  const pointerTypeRef = useRef("mouse");
  const timerRef = useRef<number | null>(null);

  const close = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setOpen(false);
  }, []);

  const show = useCallback(
    (autoHide: boolean) => {
      if (closeActiveTip && closeActiveTip !== close) closeActiveTip();
      closeActiveTip = close;
      setOpen(true);
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = autoHide ? window.setTimeout(close, TOUCH_BUCKET_HOLD_MS) : null;
    },
    [close],
  );

  useEffect(
    () => () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      if (closeActiveTip === close) closeActiveTip = null;
    },
    [close],
  );

  const handlers = {
    onPointerEnter: (event: ReactPointerEvent) => {
      if (event.pointerType === "mouse") show(false);
    },
    onPointerLeave: (event: ReactPointerEvent) => {
      if (event.pointerType === "mouse") close();
    },
    onPointerDown: (event: ReactPointerEvent) => {
      pointerTypeRef.current = event.pointerType;
    },
    onClick: () => {
      // 鼠标靠悬停，点击不再切换（否则悬停弹出后一点反而收起了）。
      if (pointerTypeRef.current === "mouse") return;
      if (open) close();
      else show(true);
    },
  };

  return { open, handlers };
}

export function MetricDetailTip({ text }: { text: string }) {
  return (
    <span className="node-metric-tip" role="status">
      {text}
    </span>
  );
}
