import { useEffect, useRef, useState, type PointerEvent } from "react";
import { clsx } from "clsx";
import { lossHeatColor } from "@/utils/metricTone";
import { trimFixed } from "@/utils/format";
import { TOUCH_BUCKET_HOLD_MS } from "@/components/node/touchBucketPick";

/**
 * Ping 图下方的丢包色带。
 *
 * 放在折线图上方，每条线路一行，横轴与主图严格对齐：整条色带的宽度直接取主图 canvas 的宽度（而不是
 * 自己量容器 —— 图表宽度会被量化到 8px 网格，量容器会差几像素），左边留出与 Y 轴刻度
 * 同宽的槽位放线路名，右边留出与主图相同的内边距，时间→像素用主图同一个 x 区间换算。
 *
 * 色阶与首页卡片、迷你卡共用 lossHeatColor（0% 绿 → 20%+ 红）。
 * 没有采样的时段不画，露出底色轨道 —— 掉线和「丢包 0%」必须看得出区别。
 *
 * 鼠标放在某一行上：左边的线路名用该线路的颜色亮起、其余线路名变淡，指针旁边弹一个小框写这一格的
 * 丢包率。行与行之间那 1px 的缝算上一行，免得在两行之间划过时框一闪一闪。触屏点一下同样弹出，
 * 松手后留 2.5 秒（和首页柱子一个手感）。
 */

const ROW_HEIGHT = 6;
/** 气泡离指针的距离，和估计宽度（用来判断右边放不放得下，放不下就翻到指针左边）。 */
const TIP_OFFSET = 12;
const TIP_ESTIMATED_WIDTH = 116;

/**
 * 横向位置 `fraction`（0~1，相对色带轨道）落在哪一格、那一格的丢包率。
 *
 * 命中范围和画法一致：每格覆盖到与前后邻点的中点，首末两格各向外延半个间隔。
 * 落在所有格子之外（轨道两端没有采样的空白）返回 null；落在格子里但那格没采到返回 `{ value: null }`。
 */
export function lossAtPosition(
  times: readonly number[],
  loss: ReadonlyArray<number | null>,
  xRange: [number, number] | null,
  fraction: number,
): { index: number; value: number | null } | null {
  if (times.length === 0 || !Number.isFinite(fraction)) return null;
  const [t0, t1] = xRange ?? [times[0]!, times[times.length - 1]!];
  const span = t1 - t0;
  if (!(span > 0)) {
    return { index: 0, value: loss.find((value) => value != null) ?? null };
  }
  const time = t0 + fraction * span;

  let low = 0;
  let high = times.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (times[mid]! < time) low = mid + 1;
    else high = mid;
  }
  // low 是第一个 >= time 的点（或最后一个点）；和它前一个点比谁更近。
  const index = low > 0 && time - times[low - 1]! <= times[low]! - time ? low - 1 : low;

  const current = times[index]!;
  const prev = times[index - 1] ?? current - ((times[index + 1] ?? current) - current);
  const next = times[index + 1] ?? current + (current - (times[index - 1] ?? current));
  if (time < (prev + current) / 2 || time > (current + next) / 2) return null;
  return { index, value: loss[index] ?? null };
}

interface LossHover {
  row: number;
  /** 指针在色带里的坐标。 */
  x: number;
  y: number;
  /** undefined：指针在线路名上或轨道两端的空白处，只亮线路名、不弹框；null：这一格没采到。 */
  value: number | null | undefined;
}

export interface PingLossRow {
  id: number;
  label: string;
  /** 线路在主图里的颜色；悬停时线路名用它亮起。 */
  color?: string;
  /** 与 times 等长；null = 该时段没有采样。 */
  loss: Array<number | null>;
}

export function PingLossStrip({
  times,
  xRange,
  rows,
  chartWidth,
  gutter,
  rightPad,
  isDark,
  cursorLeft,
}: {
  times: number[];
  xRange: [number, number] | null;
  rows: PingLossRow[];
  chartWidth: number;
  gutter: number;
  rightPad: number;
  isDark: boolean;
  /** 主图游标距绘图区左边的像素；null 表示鼠标不在图上。 */
  cursorLeft: number | null;
}) {
  const trackWidth = Math.max(0, chartWidth - gutter - rightPad);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hover, setHover] = useState<LossHover | null>(null);

  useEffect(
    () => () => {
      if (holdTimerRef.current != null) clearTimeout(holdTimerRef.current);
    },
    [],
  );

  // 线路被隐藏、换了档位、数据刷新时，行号和格子可能都对不上了，直接收起。
  useEffect(() => {
    setHover(null);
  }, [rows, times]);

  if (rows.length === 0 || times.length === 0 || trackWidth <= 0) return null;

  const cancelHold = () => {
    if (holdTimerRef.current != null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const updateHover = (event: PointerEvent<HTMLDivElement>) => {
    const strip = stripRef.current;
    if (!strip) return;
    cancelHold();
    const rowEls = strip.querySelectorAll<HTMLElement>(".ping-loss-row");
    let row = -1;
    for (let index = 0; index < rowEls.length; index += 1) {
      // 行下方那 1px 的缝归上一行。
      if (event.clientY < rowEls[index]!.getBoundingClientRect().bottom + 1) {
        row = index;
        break;
      }
    }
    const target = rows[row];
    if (!target) {
      setHover(null);
      return;
    }
    const rect = strip.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const trackX = x - gutter;
    const hit =
      trackX >= 0 && trackX <= trackWidth
        ? lossAtPosition(times, target.loss, xRange, trackX / trackWidth)
        : null;
    setHover({ row, x, y, value: hit ? hit.value : undefined });
  };

  const endHover = (event: PointerEvent<HTMLDivElement>) => {
    cancelHold();
    if (event.pointerType !== "touch") {
      setHover(null);
      return;
    }
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      setHover(null);
    }, TOUCH_BUCKET_HOLD_MS);
  };

  const tipLeft =
    hover == null
      ? 0
      : hover.x + TIP_OFFSET + TIP_ESTIMATED_WIDTH > chartWidth
        ? Math.max(0, hover.x - TIP_OFFSET - TIP_ESTIMATED_WIDTH)
        : hover.x + TIP_OFFSET;

  return (
    <div
      ref={stripRef}
      className={clsx("ping-loss-strip", hover != null && "has-hover")}
      style={{ width: chartWidth }}
      onPointerDown={updateHover}
      onPointerMove={updateHover}
      onPointerUp={(event) => {
        if (event.pointerType === "touch") endHover(event);
      }}
      onPointerCancel={endHover}
      onPointerLeave={endHover}
    >
      {/* 游标竖线：色带与绘图区左边界、宽度都一致，所以直接用主图的 cursor.left */}
      {cursorLeft != null && cursorLeft <= trackWidth && (
        <div className="ping-loss-cursor" style={{ left: gutter + cursorLeft }} aria-hidden />
      )}
      {rows.map((row, index) => (
        <div className="ping-loss-row" key={row.id}>
          <span
            className={clsx("ping-loss-label", hover?.row === index && "is-active")}
            style={{
              width: gutter,
              ...(hover?.row === index && row.color ? { color: row.color } : null),
            }}
          >
            {row.label}
          </span>
          <LossRowCanvas
            times={times}
            loss={row.loss}
            xRange={xRange}
            width={trackWidth}
            isDark={isDark}
            label={row.label}
          />
        </div>
      ))}
      {hover != null && hover.value !== undefined && (
        <div
          className="instance-chart-tooltip ping-loss-tooltip"
          style={{ left: tipLeft, top: hover.y + TIP_OFFSET }}
          aria-hidden
        >
          <div className="instance-chart-tooltip-row">
            <span
              className="instance-chart-tooltip-dot"
              style={{
                background:
                  hover.value == null ? "var(--text-tertiary)" : lossHeatColor(hover.value),
              }}
            />
            <span>丢包率</span>
            <strong>{hover.value == null ? "无采样" : `${trimFixed(hover.value, 1)}%`}</strong>
          </div>
        </div>
      )}
    </div>
  );
}

function LossRowCanvas({
  times,
  loss,
  xRange,
  width,
  isDark,
  label,
}: {
  times: number[];
  loss: Array<number | null>;
  xRange: [number, number] | null;
  width: number;
  isDark: boolean;
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.round(ROW_HEIGHT * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, ROW_HEIGHT);

    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(0, 0, width, ROW_HEIGHT, ROW_HEIGHT / 2);
    } else {
      ctx.rect(0, 0, width, ROW_HEIGHT);
    }
    ctx.clip();

    // 轨道底色：没有采样的时段就露出它，和「丢包 0%」的绿块区分开。
    ctx.fillStyle = isDark ? "rgba(255, 255, 255, 0.07)" : "rgba(24, 24, 27, 0.07)";
    ctx.fillRect(0, 0, width, ROW_HEIGHT);

    const [t0, t1] = xRange ?? [times[0], times[times.length - 1]];
    const span = t1 - t0;
    if (!(span > 0)) {
      const only = loss.find((value) => value != null);
      if (only != null) {
        ctx.fillStyle = lossHeatColor(only);
        ctx.fillRect(0, 0, width, ROW_HEIGHT);
      }
      return;
    }
    const toX = (time: number) => ((time - t0) / span) * width;

    for (let index = 0; index < times.length; index += 1) {
      const value = loss[index];
      if (value == null) continue;
      // 每格覆盖到与前后邻点的中点，相邻格之间不留缝。
      const prev = times[index - 1] ?? times[index] - (times[index + 1] - times[index] || 0);
      const next = times[index + 1] ?? times[index] + (times[index] - times[index - 1] || 0);
      const left = Math.max(0, toX((prev + times[index]) / 2));
      const right = Math.min(width, toX((times[index] + next) / 2));
      const barWidth = Math.max(1, right - left);
      if (right <= 0 || left >= width) continue;
      ctx.fillStyle = lossHeatColor(value);
      ctx.fillRect(left, 0, barWidth, ROW_HEIGHT);
    }
  }, [isDark, loss, times, width, xRange]);

  const measured = loss.filter((value): value is number => value != null);
  const average =
    measured.length > 0
      ? measured.reduce((sum, value) => sum + value, 0) / measured.length
      : null;

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={`${label} 丢包${average == null ? "无数据" : ` 平均 ${average.toFixed(1)}%`}`}
      style={{ width, height: ROW_HEIGHT }}
    />
  );
}
