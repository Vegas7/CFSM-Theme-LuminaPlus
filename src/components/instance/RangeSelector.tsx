import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { clsx } from "clsx";

export interface TimeRangeOption {
  value: number;
  label: string;
}

interface IndicatorBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 详情页图表的时间段选择条。
 *
 * 选中高亮是一块单独的底色，量出选中按钮的位置后用 transform 挪过去：从「1 小时」点到「6 小时」时，
 * 高亮是滑过去的，不是原地一灭一亮。首次出现时直接落位，不从最左边滑进来（等落位那一帧之后才开过渡）。
 * 按钮宽度会随字体加载、窗口宽度变化，用 ResizeObserver 跟着重量；选择条可以横向滚动，高亮放在
 * 滚动容器里面，跟着内容一起滚。
 */
export function RangeSelector({
  ranges,
  value,
  onChange,
  label,
}: {
  ranges: TimeRangeOption[];
  value: number;
  onChange: (value: number) => void;
  /** 读屏用的分组名，比如「负载图表时间段」。 */
  label: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<IndicatorBox | null>(null);
  const [animated, setAnimated] = useState(false);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const active = root?.querySelector<HTMLElement>('button[data-active="true"]');
    if (!root || !active) {
      setBox(null);
      return;
    }
    const measure = () => {
      const next = {
        left: active.offsetLeft,
        top: active.offsetTop,
        width: active.offsetWidth,
        height: active.offsetHeight,
      };
      setBox((prev) =>
        prev &&
        prev.left === next.left &&
        prev.top === next.top &&
        prev.width === next.width &&
        prev.height === next.height
          ? prev
          : next,
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(active);
    return () => observer.disconnect();
  }, [ranges, value]);

  // 第一次落位之后再打开过渡。
  useEffect(() => {
    if (!box || animated) return;
    const frame = window.requestAnimationFrame(() => setAnimated(true));
    return () => window.cancelAnimationFrame(frame);
  }, [animated, box]);

  return (
    <div
      ref={rootRef}
      className="instance-segmented is-scrollable has-indicator"
      role="group"
      aria-label={label}
    >
      {box && (
        <span
          className={clsx("instance-segmented-indicator", animated && "is-animated")}
          style={{
            width: box.width,
            height: box.height,
            transform: `translate(${box.left}px, ${box.top}px)`,
          }}
          aria-hidden
        />
      )}
      {ranges.map((range) => (
        <button
          key={range.value}
          type="button"
          data-active={value === range.value ? "true" : "false"}
          aria-pressed={value === range.value}
          onClick={() => onChange(range.value)}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}
