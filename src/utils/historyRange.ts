interface HistoryRangeMeta {
  rangeStartMs?: number;
  rangeEndMs?: number;
  intervalSeconds?: number;
}

type HistoryTimeValue = string | number;

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function historyTimeMs(value: HistoryTimeValue) {
  if (typeof value === "number") {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  return Date.parse(value);
}

/** 从旧记录接口的时间戳推导典型采样周期，供断点判断补齐边缘区间。 */
export function inferHistoryIntervalSeconds(
  records: Array<{ time: HistoryTimeValue }>,
) {
  const times = Array.from(
    new Set(
      records
        .map((record) => historyTimeMs(record.time))
        .filter((time) => Number.isFinite(time) && time > 0),
    ),
  ).sort((left, right) => left - right);
  const intervals: number[] = [];
  for (let index = 1; index < times.length; index += 1) {
    const seconds = (times[index] - times[index - 1]) / 1000;
    if (seconds > 0) intervals.push(seconds);
  }
  if (intervals.length === 0) return undefined;
  intervals.sort((left, right) => left - right);
  return intervals[Math.floor(intervals.length / 2)];
}

export function historyChartRangeSeconds(
  meta: HistoryRangeMeta | null | undefined,
): [number, number] | null {
  if (!finitePositive(meta?.rangeStartMs) || !finitePositive(meta?.rangeEndMs)) return null;
  const start = (meta?.rangeStartMs ?? 0) / 1000;
  const end = (meta?.rangeEndMs ?? 0) / 1000;
  return end > start ? [start, end] : null;
}
