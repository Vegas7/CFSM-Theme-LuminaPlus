import { useEffect, useMemo, useRef, useState } from "react";
import UplotReact from "uplot-react";
import type uPlot from "uplot";
import { Eye, RefreshCw } from "lucide-react";
import { usePingRecords } from "@/hooks/useRecords";
import { useCarrierNames } from "@/hooks/usePublicConfig";
import { carrierTaskName } from "@/services/cfsm/mappers";
import { InstancePanel, InstanceChartLoading } from "./InstancePanel";
import {
  buildChartTooltipHooks,
  colorForSeries,
  createTimeAxisFormatter,
  getAxisColors,
  toChartSeconds,
  useResponsiveChartSize,
  type ChartTooltipState,
} from "./chartShared";
import { ChartTooltip, SwitchToggle } from "./ChartParts";
import {
  cutPeakValues,
  detectTypicalIntervalSeconds,
  downsampleAligned,
  insertMetricGapSentinels,
  smoothByCount,
} from "./chartData";
import { latencyHeatColor, lossHeatColor } from "@/utils/metricTone";
import { trimFixed } from "@/utils/format";
import { historyChartRangeSeconds, historyCoverageLabel } from "@/utils/historyRange";
import {
  bucketPingLoss,
  formatPingTooltipValue,
  resolvePingChartInterval,
  resolvePingSampleCounts,
  type PingLossSample,
} from "@/utils/pingMetrics";
import { usePreferences } from "@/hooks/usePreferences";
import type { PingRecord, PingTaskStats } from "@/types/cfsm";
import type { TimedMetricPoint } from "./chartData";

interface WeightedLatency {
  value: number;
  weight: number;
}

function valueAtWeightedIndex(sorted: WeightedLatency[], index: number) {
  let offset = 0;
  for (const sample of sorted) {
    offset += sample.weight;
    if (index < offset) return sample.value;
  }
  return sorted[sorted.length - 1]?.value ?? null;
}

function percentileFromWeighted(sorted: WeightedLatency[], ratio: number) {
  const total = sorted.reduce((sum, sample) => sum + sample.weight, 0);
  if (total <= 0) return null;
  const index = (total - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const lowerValue = valueAtWeightedIndex(sorted, lower);
  const upperValue = valueAtWeightedIndex(sorted, upper);
  if (lowerValue == null || upperValue == null) return null;
  if (lower === upper) return lowerValue;
  const weight = index - lower;
  return lowerValue + (upperValue - lowerValue) * weight;
}

export function summarizePingRecords(records: PingRecord[]) {
  const samples = records.map((record) => ({
    record,
    ...resolvePingSampleCounts(record),
  }));
  const valid = samples
    .filter(({ record, valid: count }) => record.value >= 0 && count > 0)
    .map(({ record, valid: count }) => ({ value: record.value, weight: count }))
    .sort((a, b) => a.value - b.value);
  const total = samples.reduce((sum, sample) => sum + sample.total, 0);
  const lost = samples.reduce((sum, sample) => sum + sample.lost, 0);
  const validCount = valid.reduce((sum, sample) => sum + sample.weight, 0);

  let latest: number | null = null;
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const { record, valid: count } = samples[index];
    if (record.value >= 0 && count > 0) {
      latest = record.value;
      break;
    }
  }

  return {
    latest,
    avg:
      validCount > 0
        ? valid.reduce((sum, sample) => sum + sample.value * sample.weight, 0) / validCount
        : null,
    min: valid[0]?.value ?? null,
    max: valid[valid.length - 1]?.value ?? null,
    p50: percentileFromWeighted(valid, 0.5),
    p99: percentileFromWeighted(valid, 0.99),
    total,
    lost,
    loss: total > 0 ? (lost / total) * 100 : 0,
  };
}

const EMPTY_PING_STATS: PingTaskStats[] = [];
const EMPTY_TASK_IDS: ReadonlySet<number> = new Set();
const MAX_RENDER_POINTS = 160;
const Y_AXIS_SIZE = 64;
const CHART_PADDING_LEFT = 2;
const CHART_PADDING_RIGHT = 14;
/**
 * 丢包叠加（和哪吒探针一个画法）：每条线路的丢包率画成同色半透明面积，挂在右侧的百分比纵轴上，
 * 和延迟折线在同一张图里。原来图上方还有一条按线路分行的丢包色带，有了叠加之后重复，已去掉。
 */
const LOSS_AXIS_SIZE = 44;
const LOSS_AREA_ALPHA = 0.3;
// 1 即关闭平滑(smoothByCount 对 <=1 原样返回);保留常量便于调参,非削峰模式当前不平滑。
const SMOOTH_WINDOW_POINTS = 1;
const SMOOTH_WINDOW_POINTS_PEAK = 13;

export function PingChart({
  uuid,
  hours,
  active = true,
}: {
  uuid: string;
  hours: number;
  active?: boolean;
}) {
  const {
    data,
    isError,
    isFetching,
    isLoading,
    refetch: refetchRecords,
  } = usePingRecords(uuid, hours, active);
  // stats 随 records 同一次请求返回(getPingRecords includeStats),不再单独发起查询。
  const pingStats = data?.stats ?? EMPTY_PING_STATS;
  const { resolvedAppearance } = usePreferences();
  const { w, h, ref: chartSizeRef } = useResponsiveChartSize("wide");
  /**
   * 选中的线路（和哪吒探针一个用法）：空 = 全部显示；点某条线路 = 只看它，再点别的线路是叠加上去，
   * 再点已选中的是去掉，全去掉又回到全部显示。「清除」一键回到全部。
   */
  const [selectedTasks, setSelectedTasks] = useState<ReadonlySet<number>>(EMPTY_TASK_IDS);
  const [connectNulls, setConnectNulls] = useState(false);
  const [cutPeak, setCutPeak] = useState(false);
  const [showLossArea, setShowLossArea] = useState(true);
  const chartRef = useRef<uPlot.AlignedData>([[]]);
  // tooltip 的 buildRows 只拿得到点位下标，丢包值走 ref 与图表数据同步。
  const lossRef = useRef<Array<Array<number | null>>>([]);
  const [tooltip, setTooltip] = useState<ChartTooltipState>({
    show: false,
    left: 0,
    top: 0,
    rows: [],
    time: "",
  });
  const isDark = resolvedAppearance === "dark";
  // 线路名以 `/api/config` 的自定义名为准：历史查询是按 uuid+hours 缓存的，站长改名
  // （或 config 晚于历史返回）不会让那份缓存重算，所以在这里按当前名字重新贴一遍。
  const carrierNames = useCarrierNames();
  // API 顺序与后台任务权重一致，响应本身不一定包含可重排的权重。
  const tasks = useMemo(
    () =>
      (data?.tasks ?? []).map((task) => ({
        ...task,
        name: carrierTaskName(task.id, carrierNames),
      })),
    [carrierNames, data],
  );
  const taskLabels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      const label = task.name || `任务 #${task.id}`;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return new Map(
      tasks.map((task) => {
        const baseLabel = task.name || `任务 #${task.id}`;
        const label = (counts.get(baseLabel) ?? 0) > 1 ? `${baseLabel} #${task.id}` : baseLabel;
        return [task.id, label] as const;
      }),
    );
  }, [tasks]);
  const taskColors = useMemo(
    () => new Map(tasks.map((task, index) => [task.id, colorForSeries(index, tasks.length)] as const)),
    [tasks],
  );
  const taskKeySet = useMemo(() => new Set(tasks.map((task) => String(task.id))), [tasks]);
  const taskKeys = useMemo(() => tasks.map((task) => String(task.id)), [tasks]);
  const taskIndexById = useMemo(
    () => new Map(tasks.map((task, index) => [task.id, index] as const)),
    [tasks],
  );
  const hiddenTasks = useMemo<ReadonlySet<number>>(
    () =>
      selectedTasks.size === 0
        ? EMPTY_TASK_IDS
        : new Set(tasks.filter((task) => !selectedTasks.has(task.id)).map((task) => task.id)),
    [selectedTasks, tasks],
  );
  const visibleTasks = useMemo(
    () => tasks.filter((task) => !hiddenTasks.has(task.id)),
    [hiddenTasks, tasks],
  );
  const visibleTaskIds = useMemo(
    () => new Set(visibleTasks.map((task) => task.id)),
    [visibleTasks],
  );

  useEffect(() => {
    setSelectedTasks(EMPTY_TASK_IDS);
  }, [uuid]);

  // 线路表变了（站长删了某条线路）：丢掉已不存在的选中项，全丢光就回到全部显示。
  useEffect(() => {
    setSelectedTasks((prev) => {
      if (prev.size === 0) return prev;
      const validTaskIds = new Set(tasks.map((task) => task.id));
      const next = new Set([...prev].filter((taskId) => validTaskIds.has(taskId)));
      if (next.size === prev.size) return prev;
      return next.size === 0 ? EMPTY_TASK_IDS : next;
    });
  }, [tasks]);

  // 只依赖 data:切换削峰等开关时不重跑解析/排序。
  const sortedRecords = useMemo(
    () =>
      (data?.records ?? [])
        .map((record) => ({
          record,
          time: toChartSeconds(record.time),
        }))
        .filter(({ time }) => time > 0)
        .sort((left, right) => left.time - right.time),
    [data],
  );

  const chartBundle = useMemo(() => {
    if (!data?.records.length || !tasks.length) return null;
    const pointMap = new Map<number, TimedMetricPoint>();
    // 丢包与延迟走各自的聚合口径：延迟保峰、丢包按样本数加权平均，所以在这里单独攒原始样本。
    const lossSamples = new Map<string, PingLossSample[]>(taskKeys.map((key) => [key, []]));
    const taskIntervals = tasks
      .map((task) => task.interval)
      .filter((value): value is number => typeof value === "number" && value > 0);
    const detectedInterval = detectTypicalIntervalSeconds(
      sortedRecords.map(({ time }) => time),
      60,
    );
    const fallbackInterval = resolvePingChartInterval(
      data.intervalSeconds,
      taskIntervals.length > 0 ? Math.min(...taskIntervals) : null,
      detectedInterval,
    );
    const tolerance = Math.min(6, Math.max(0.8, fallbackInterval * 0.25));

    // 升序游标把邻近任务采样合并到同一时间锚点，保持 O(n)。
    let lastAnchor = Number.NEGATIVE_INFINITY;
    for (const { record, time } of sortedRecords) {
      const taskKey = String(record.task_id);
      if (!taskKeySet.has(taskKey)) continue;
      const anchor = time - lastAnchor <= tolerance ? lastAnchor : time;
      if (anchor === time) lastAnchor = time;
      const current = pointMap.get(anchor) ?? { time: anchor };
      // 0 是亚毫秒成功，负值才表示丢包。
      current[taskKey] = record.value >= 0 ? record.value : null;
      pointMap.set(anchor, current);
      // 整点超时(value < 0)与部分丢包(loss 百分比)都由 resolvePingSampleCounts 归一。
      const counts = resolvePingSampleCounts(record);
      lossSamples.get(taskKey)?.push({ time: anchor, lost: counts.lost, total: counts.total });
    }

    let chartPoints = [...pointMap.values()].sort((a, b) => a.time - b.time);
    if (cutPeak && taskKeys.length > 0) {
      chartPoints = cutPeakValues(chartPoints, taskKeys);
    }
    chartPoints = insertMetricGapSentinels(chartPoints, {
      intervals: new Map(
        tasks.map((task) => [
          String(task.id),
          resolvePingChartInterval(data.intervalSeconds, task.interval, fallbackInterval),
        ] as const),
      ),
      defaultInterval: fallbackInterval,
      matchToleranceRatio: 0.25,
    });
    const times = chartPoints.map((point) => point.time);
    // undefined 表示错相采样，null 表示真实断点。
    const perTask = taskKeys.map((taskKey) =>
      chartPoints.map((point) => point[taskKey]),
    );

    const reduced = downsampleAligned(times, perTask, MAX_RENDER_POINTS, !cutPeak);
    const smoothed = smoothByCount(
      reduced.perTask,
      cutPeak ? SMOOTH_WINDOW_POINTS_PEAK : SMOOTH_WINDOW_POINTS,
    );

    return {
      data: [reduced.times, ...smoothed] as uPlot.AlignedData,
      // 归到与折线同一套时间格上，丢包面积才能和曲线逐点对齐。削峰/平滑只作用于延迟，
      // 丢包始终是真实值。
      loss: taskKeys.map((key) =>
        bucketPingLoss(lossSamples.get(key) ?? [], reduced.times),
      ),
    };
  }, [cutPeak, data, sortedRecords, taskKeySet, taskKeys, tasks]);

  const chart = chartBundle?.data ?? null;
  // 交给 uPlot 的数据：延迟在前（下标 1..n，提示框按这个取值），开了丢包叠加时各线路的丢包接在后面。
  const plotData = useMemo<uPlot.AlignedData | null>(() => {
    if (!chartBundle) return null;
    if (!showLossArea) return chartBundle.data;
    return [...chartBundle.data, ...chartBundle.loss] as uPlot.AlignedData;
  }, [chartBundle, showLossArea]);

  useEffect(() => {
    if (chartBundle && plotData) {
      chartRef.current = plotData;
      lossRef.current = chartBundle.loss;
    }
  }, [chartBundle, plotData]);

  const requestedXRange = useMemo(() => historyChartRangeSeconds(data), [data]);
  const coverageMeta = useMemo(() => {
    if (!data) return null;
    const taskIntervals = tasks
      .map((task) => task.interval)
      .filter((value) => Number.isFinite(value) && value > 0);
    return {
      rangeStartMs: data.rangeStartMs,
      rangeEndMs: data.rangeEndMs,
      intervalSeconds:
        data.intervalSeconds ??
        (taskIntervals.length > 0 ? Math.min(...taskIntervals) : undefined),
    };
  }, [data, tasks]);
  const coverageLabel = useMemo(() => {
    const times = chart?.[0];
    if (!times?.length) return null;
    return historyCoverageLabel(coverageMeta, times[0], times[times.length - 1]);
  }, [chart, coverageMeta]);
  // 查询超过 1 小时时，后端按后台设置的采样点数返回（「查询超过 1 小时时返回的采样点数」，
  // 可选 60/120/180/240）。点数固定而区间不固定，于是区间越长采样越粗 —— 240 点时 12 小时
  // 约 3 分钟一个、1 天约 6 分钟一个。把实际分辨率写出来，读者才明白为什么同一段短促丢包
  // 在短区间看得到、长区间就没了。
  const samplingLabel = useMemo(() => {
    if (sortedRecords.length < 2) return null;
    const seconds = detectTypicalIntervalSeconds(
      sortedRecords.map(({ time }) => time),
      0,
    );
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    const text =
      seconds >= 60
        ? `${Number((seconds / 60).toFixed(seconds % 60 === 0 ? 0 : 1))} 分钟`
        : `${Math.round(seconds)} 秒`;
    return `每 ${text}一个采样点`;
  }, [sortedRecords]);
  const panelDescription =
    [coverageLabel, samplingLabel].filter(Boolean).join(" · ") || undefined;

  // 纵轴恒定从 0 起：截取中间一段会把 210ms 和 240ms 画成天差地别，看不出真实量级。
  const yRange = useMemo<[number | null, number | null]>(() => {
    if (!chart) return [null, null];
    let max = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < tasks.length; index += 1) {
      if (!visibleTaskIds.has(tasks[index].id)) continue;
      const series = chart[index + 1] as Array<number | null | undefined> | undefined;
      if (!series) continue;
      for (const value of series) {
        if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
          if (value > max) max = value;
        }
      }
    }
    if (max === Number.NEGATIVE_INFINITY || max <= 0) return [0, 100];
    return [0, max + Math.max(5, max * 0.12)];
  }, [chart, tasks, visibleTaskIds]);

  // 右侧丢包轴：按当前显示的线路里最高的丢包率留一点头，最低也给到 5%，免得 0.3% 的小抖动顶满整张图。
  const lossRange = useMemo<[number, number]>(() => {
    let max = 0;
    if (chartBundle) {
      for (const task of visibleTasks) {
        for (const value of chartBundle.loss[taskIndexById.get(task.id) ?? -1] ?? []) {
          if (typeof value === "number" && value > max) max = value;
        }
      }
    }
    return [0, Math.min(100, Math.max(5, Math.ceil(max * 1.15)))];
  }, [chartBundle, taskIndexById, visibleTasks]);

  const baseOptions = useMemo<Omit<uPlot.Options, "width" | "height"> | null>(() => {
    if (!chart) return null;
    const { grid, text } = getAxisColors(isDark);
    const tooltipHooks = buildChartTooltipHooks({
      dataRef: chartRef,
      rangeHours: hours,
      estimatedWidth: 196,
      setTooltip,
      buildRows: (idx) =>
        visibleTasks
          .map((task) => {
            const taskIndex = taskIndexById.get(task.id) ?? 0;
            const raw = chartRef.current[taskIndex + 1]?.[idx] as number | null | undefined;
            const loss = lossRef.current[taskIndex]?.[idx] ?? null;
            return {
              label: taskLabels.get(task.id) ?? `任务 #${task.id}`,
              raw: typeof raw === "number" && Number.isFinite(raw) ? raw : null,
              loss,
              color: taskColors.get(task.id) ?? colorForSeries(taskIndex, tasks.length),
            };
          })
          .sort((a, b) => {
            if (a.raw == null) return b.raw == null ? 0 : 1;
            if (b.raw == null) return -1;
            return b.raw - a.raw;
          })
          .map(({ label, raw, loss, color }) => ({
            label,
            value: formatPingTooltipValue(raw, loss),
            color,
          })),
    });
    return {
      padding: [10, CHART_PADDING_RIGHT, 12, CHART_PADDING_LEFT],
      cursor: { drag: { x: true, y: false } },
      legend: { show: false },
      scales: {
        x: requestedXRange
          ? { time: true, auto: false, range: () => requestedXRange }
          : { time: true },
        y: { auto: false, range: yRange },
        loss: { auto: false, range: lossRange },
      },
      axes: [
        {
          stroke: text,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid },
          size: 36,
          values: createTimeAxisFormatter(hours),
        },
        {
          stroke: text,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid },
          // 64 而非 54：延迟冲到四位数时 "1400 ms" 放不下，uPlot 会从左边把「1」裁掉。
          size: Y_AXIS_SIZE,
          values: (_self, splits) => splits.map((value) => (value === 0 ? "" : `${Math.round(value)} ms`)),
        },
        ...(showLossArea
          ? [
              {
                scale: "loss",
                side: 1,
                stroke: text,
                grid: { show: false },
                ticks: { stroke: grid },
                size: LOSS_AXIS_SIZE,
                values: (_self: uPlot, splits: number[]) =>
                  splits.map((value) => `${trimFixed(value, 1)}%`),
              } satisfies uPlot.Axis,
            ]
          : []),
      ],
      series: [
        { label: "time" },
        ...tasks.map((task, index) => ({
          label: taskLabels.get(task.id) ?? `任务 #${task.id}`,
          stroke: taskColors.get(task.id) ?? colorForSeries(index, tasks.length),
          width: 1.7,
          spanGaps: connectNulls,
          show: !hiddenTasks.has(task.id),
          points: { show: false },
        })),
        // 丢包面积：同色半透明，画在延迟线后面加进来的那几列上；悬停圆点用 class 在 CSS 里藏掉，
        // 否则每条线路都会在底边多一个点。
        ...(showLossArea
          ? tasks.map((task, index) => {
              const color = taskColors.get(task.id) ?? colorForSeries(index, tasks.length);
              return {
                label: `${taskLabels.get(task.id) ?? `任务 #${task.id}`} 丢包`,
                scale: "loss",
                class: "ping-loss-area",
                stroke: color,
                fill: color,
                alpha: LOSS_AREA_ALPHA,
                width: 1,
                spanGaps: false,
                show: !hiddenTasks.has(task.id),
                points: { show: false },
              } satisfies uPlot.Series;
            })
          : []),
      ],
      hooks: {
        init: [
          (u) => {
            u.root.setAttribute("role", "img");
            u.root.setAttribute("aria-label", `Ping 延迟历史图表，共 ${tasks.length} 条线路`);
          },
          tooltipHooks.onInit,
        ],
        destroy: [tooltipHooks.onDestroy],
        setCursor: [tooltipHooks.onSetCursor],
      },
    };
  }, [chart, connectNulls, hiddenTasks, hours, isDark, lossRange, requestedXRange, showLossArea, taskColors, taskIndexById, taskLabels, tasks, visibleTasks, yRange]);

  const options = useMemo<uPlot.Options | null>(
    () => (baseOptions ? { ...baseOptions, width: w, height: h } : null),
    [baseOptions, w, h],
  );

  const taskStats = useMemo(() => {
    const grouped = new Map<number, PingRecord[]>();
    // 复用已按时间升序的 sortedRecords,分组后桶内天然有序,免去逐桶重排序和重复 Date.parse。
    for (const { record } of sortedRecords) {
      const bucket = grouped.get(record.task_id);
      if (bucket) bucket.push(record);
      else grouped.set(record.task_id, [record]);
    }

    const serverStats = new Map(
      pingStats
        .filter((stat) => !stat.client || stat.client === uuid)
        .map((stat) => [stat.taskId, stat] as const),
    );

    return tasks.map((task, index) => {
      const records = grouped.get(task.id) ?? [];
      const server = serverStats.get(task.id);
      // server stats 命中时跳过本地全量统计(排序/分位数不便宜)。
      const fallback = server ? null : summarizePingRecords(records);
      const latest = server ? server.latest : fallback?.latest ?? null;
      const avg = server ? server.avg : fallback?.avg ?? null;
      const min = server ? server.min : fallback?.min ?? null;
      const max = server ? server.max : fallback?.max ?? null;
      const p50 = server ? server.p50 : fallback?.p50 ?? null;
      const p99 = server ? server.p99 : fallback?.p99 ?? null;
      const fallbackVolatility =
        p50 != null && p99 != null
          ? Math.max(0, p99 - p50) / Math.min(50, Math.max(10, p50))
          : null;
      const volatility =
        server && Number.isFinite(server.p99P50Ratio)
          ? server.p99P50Ratio
          : fallbackVolatility;
      const total = server?.total ?? fallback?.total ?? 0;
      const lost = server
        ? Math.max(0, server.total - server.valid)
        : fallback?.lost ?? 0;
      const loss = server?.loss ?? (total > 0 ? fallback?.loss ?? 0 : task.loss);
      return {
        ...task,
        latest,
        avg,
        min,
        max,
        p50,
        p99,
        volatility,
        total,
        lost,
        loss,
        color: taskColors.get(task.id) ?? colorForSeries(index, tasks.length),
      };
    });
  }, [pingStats, sortedRecords, taskColors, tasks, uuid]);

  const refetchAll = () => {
    void refetchRecords();
  };

  // 全部显示时点一条 = 只看这一条；之后点别的是叠加、点已选的是去掉（见 selectedTasks）。
  const toggleTask = (taskId: number) => {
    setSelectedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next.size === 0 ? EMPTY_TASK_IDS : next;
    });
  };

  const clearSelection = () => setSelectedTasks(EMPTY_TASK_IDS);

  if (isLoading) {
    return <InstanceChartLoading title="Ping 图表" />;
  }

  if (isError && !data?.records.length) {
    return (
      <InstancePanel title="Ping 图表">
        <div className="instance-empty">
          <span>延迟历史加载失败</span>
          <button
            type="button"
            className="instance-toggle-button"
            onClick={refetchAll}
            disabled={isFetching}
            aria-busy={isFetching}
          >
            {isFetching ? "重试中" : "重试"}
          </button>
        </div>
      </InstancePanel>
    );
  }

  if (!data?.records.length) {
    return (
      <InstancePanel title="Ping 图表">
        <div className="instance-empty">暂无延迟记录</div>
      </InstancePanel>
    );
  }

  return (
    <InstancePanel title="Ping 图表" description={panelDescription}>
      <div className="instance-ping-toolbar">
        {/* 放在最前、靠左（CSS 里 margin-right: auto）：它是点了线路才冒出来的，放在右边那组开关中间
            会把整排往左挤一下。 */}
        {selectedTasks.size > 0 && (
          <button
            type="button"
            className="instance-toggle-button instance-ping-clear"
            onClick={clearSelection}
            title="取消选择，恢复显示全部线路"
          >
            <Eye size={14} aria-hidden />
            清除 ({selectedTasks.size})
          </button>
        )}
        <SwitchToggle
          label="丢包叠加"
          active={showLossArea}
          onToggle={() => setShowLossArea((value) => !value)}
          title="把各线路的丢包率画成同色半透明面积，叠在延迟图里，对应右侧的百分比纵轴（和哪吒探针一个画法）。不受削峰平滑影响。注意：查询超过 1 小时时，后端按后台设置的采样点数返回（可选 60/120/180/240），点数固定而区间不固定，所以区间越长采样越粗；持续一两分钟的短促丢包可能整段没被采到 —— 同一次丢包在 1 小时图里看得见、在 1 天图里消失就是这个原因，调大后台的采样点数可缓解。"
        />
        <SwitchToggle
          label="削峰平滑"
          active={cutPeak}
          onToggle={() => setCutPeak((value) => !value)}
          title="对尖峰值做轻度平滑，仅影响图线显示"
        />
        <SwitchToggle
          label="断点连线"
          active={connectNulls}
          onToggle={() => setConnectNulls((value) => !value)}
          title="关闭：如实显示中断/丢包断点；开启：跨过所有空缺连成完整曲线（更好看，但看不出掉线）。注：偶尔漏一两次采样的小空缺始终自动桥接，不受此开关影响。"
        />
        <button
          type="button"
          className="instance-toggle-button"
          onClick={refetchAll}
          disabled={isFetching}
          aria-busy={isFetching}
        >
          <RefreshCw size={14} aria-hidden />
          {isFetching ? "刷新中" : isError ? "刷新失败，重试" : "刷新"}
        </button>
      </div>

      <div className="instance-ping-tasks">
        {taskStats.map((task) => {
          const visible = !hiddenTasks.has(task.id);
          return (
            <button
              key={task.id}
              type="button"
              className="instance-ping-task"
              data-visible={visible ? "true" : "false"}
              aria-pressed={selectedTasks.has(task.id)}
              onClick={() => toggleTask(task.id)}
              style={{ borderColor: visible ? task.color : "var(--border-subtle)" }}
              title={[
                taskLabels.get(task.id) ?? `任务 #${task.id}`,
                `当前 ${task.latest != null ? `${task.latest.toFixed(1)} ms` : "—"} | 均值 ${task.avg != null ? `${task.avg.toFixed(1)} ms` : "—"} | 丢包 ${task.loss.toFixed(1)}%`,
                `p99 ${task.p99 != null ? `${task.p99.toFixed(0)} ms` : "—"} | 抖动 ${task.volatility != null ? task.volatility.toFixed(2) : "—"}`,
                `min ${task.min != null ? `${task.min.toFixed(0)} ms` : "—"} | max ${task.max != null ? `${task.max.toFixed(0)} ms` : "—"} | 样本 ${task.total ?? 0} | 间隔 ${task.interval}s`,
                selectedTasks.size === 0
                  ? "点击只看这条线路，再点其他线路可叠加"
                  : selectedTasks.has(task.id)
                    ? "点击取消选择"
                    : "点击叠加显示这条线路",
              ].join("\n")}
            >
              <span className="instance-ping-task-dot" style={{ background: task.color }} aria-hidden />
              <span className="instance-ping-task-name">{taskLabels.get(task.id) ?? `任务 #${task.id}`}</span>
              <span
                className="instance-ping-task-primary"
                style={{
                  color:
                    task.latest != null
                      ? latencyHeatColor(task.latest)
                      : "var(--text-tertiary)",
                }}
              >
                {task.latest != null ? `${task.latest.toFixed(1)} ms` : "—"}
              </span>
              <span
                className="instance-ping-task-loss"
                style={{ color: lossHeatColor(task.loss) }}
              >
                {task.loss.toFixed(1)}%
              </span>
            </button>
          );
        })}
      </div>

      <div ref={chartSizeRef} className="instance-uplot-wrap is-large">
        {plotData && options && visibleTasks.length > 0 ? (
          <>
            <UplotReact
              key={`${uuid}-${hours}-${cutPeak ? "smooth" : "raw"}-${connectNulls ? "span" : "gap"}-${showLossArea ? "loss" : "noloss"}`}
              options={options}
              data={plotData}
            />
            <ChartTooltip tooltip={tooltip} />
          </>
        ) : (
          <div className="instance-empty">当前已隐藏全部线路，点击上方按钮可恢复显示</div>
        )}
      </div>
    </InstancePanel>
  );
}
