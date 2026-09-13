import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Gauge,
  Database,
  Zap,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  CloudUpload,
} from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { usePreferences } from "@/hooks/usePreferences";
import {
  METRIC_COLOR_GROUPS,
  METRIC_COLOR_META,
  readEffectiveColors,
  useMetricColorsEditor,
  type MetricColorKey,
} from "@/hooks/useMetricColors";
import { useSiteThemeOptions } from "@/hooks/useSiteThemeOptions";
import { ApiRequestError } from "@/services/api";
import { getJwtToken } from "@/services/cfsm/config";

const DARK_DEPTH_PRESETS = [
  { value: 0, label: "灰黑", title: "当前默认色" },
  { value: 60, label: "深黑", title: "保留少量蓝灰层次" },
  { value: 100, label: "纯黑", title: "纯黑画布，卡片保留层级" },
] as const;

const ICONS: Record<MetricColorKey, typeof Cpu> = {
  cpu: Cpu,
  memory: MemoryStick,
  disk: HardDrive,
  load: Gauge,
  swap: Database,
  speedIdle: Zap,
  speedLow: Zap,
  speedHigh: Zap,
  speedMax: Zap,
  trafficUp: ArrowUp,
  trafficDown: ArrowDown,
};

export function MetricColorPicker({ hidden = false }: { hidden?: boolean }) {
  const {
    colors,
    darkDepth,
    overriddenColors,
    setColor,
    resetColor,
    setDarkDepth,
    resetAll,
    hasLocalOverrides,
    saveError,
  } = useMetricColorsEditor();
  const { resolvedAppearance } = usePreferences();

  // 登录站长可把当前配色（连同其它本机设置）一并写到后端，成为所有设备的默认值。
  // 发的是和设置页同一份站点快照（useSiteThemeOptions），不是只有配色。
  const { publish } = useSiteThemeOptions();
  const canSaveToBackend = useMemo(() => Boolean(getJwtToken()), []);
  const [savingToBackend, setSavingToBackend] = useState(false);
  const [backendSaveState, setBackendSaveState] = useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);
  const saveToBackend = async () => {
    setBackendSaveState(null);
    setSavingToBackend(true);
    try {
      await publish();
      setBackendSaveState({ kind: "ok", text: "已保存到后端" });
    } catch (error) {
      const status = error instanceof ApiRequestError ? error.status : 0;
      // 403：http 层清掉失效的人机验证凭证后，全局验证弹窗会自己重新出来（见 TurnstileGate）。
      const text =
        status === 401
          ? "登录态已失效，请到 /admin 重新登录"
          : status === 403
            ? "需要先完成人机验证，完成后再点一次"
            : error instanceof Error
              ? error.message
              : "保存到后端失败";
      setBackendSaveState({ kind: "error", text });
    } finally {
      setSavingToBackend(false);
    }
  };

  // 默认色（无覆盖时生效的 token）。只在明暗模式切换/重置时重读 ——
  // 不能放进拖动热路径：getComputedStyle 会强制同步重排，每帧多次=掉帧。
  const [base, setBase] = useState(readEffectiveColors);
  useEffect(() => setBase(readEffectiveColors()), [resolvedAppearance]);
  const refreshBase = useCallback(() => setBase(readEffectiveColors()), []);

  // 拖动时取色框的值直接来自草稿（无 getComputedStyle），其余指标用稳定的默认色。
  const valueOf = useCallback(
    (key: MetricColorKey) => colors[key] ?? base[key],
    [colors, base],
  );
  return (
    <div
      className="metric-color-picker"
      role="group"
      aria-label="卡片配色"
      hidden={hidden}
    >
      <div className="metric-color-picker-head">
        {/* 登录站长那行会挤（多个「保存到后端」按钮），省掉标题腾地方；访客那行照旧显示。 */}
        {!canSaveToBackend && <span>配色自定义</span>}
        <div className="metric-color-head-actions">
          {canSaveToBackend && (
            <button
              type="button"
              className="metric-color-save-backend"
              onClick={() => void saveToBackend()}
              disabled={savingToBackend}
              title="把当前配色（连同其它本机设置）写到后端，成为所有设备与访客的默认值"
            >
              {savingToBackend ? <Spinner size={12} /> : <CloudUpload size={12} />}
              <span>{savingToBackend ? "保存中" : "保存到后端"}</span>
            </button>
          )}
          <button
            type="button"
            className="metric-color-reset-all"
            onClick={() => {
              resetAll();
              refreshBase();
            }}
            disabled={!hasLocalOverrides}
          >
            全部重置
          </button>
        </div>
      </div>
      {backendSaveState && (
        <div
          className={
            backendSaveState.kind === "ok" ? "metric-color-notice" : "metric-color-error"
          }
        >
          {backendSaveState.text}
        </div>
      )}
      {saveError && <div className="metric-color-error">保存失败（请确认已登录管理员）</div>}
      <div className="metric-color-group">
        <div className="metric-color-group-title">暗色背景</div>
        <div className="dark-depth-control">
          <div className="dark-depth-presets" role="group" aria-label="暗色深度预设">
            {DARK_DEPTH_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                className="dark-depth-preset"
                data-active={darkDepth === preset.value ? "true" : "false"}
                data-depth={preset.value}
                aria-pressed={darkDepth === preset.value}
                title={preset.title}
                onClick={() => setDarkDepth(preset.value)}
              >
                <span className="dark-depth-preset-swatch" aria-hidden />
                <span>{preset.label}</span>
              </button>
            ))}
          </div>
          <label className="dark-depth-range">
            <span className="dark-depth-range-head">
              <span>黑色程度</span>
              <output>{darkDepth}%</output>
            </span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={darkDepth}
              aria-label="黑色程度"
              onChange={(event) => setDarkDepth(Number(event.target.value))}
            />
          </label>
          {resolvedAppearance !== "dark" && (
            <p className="dark-depth-hint">切换到深色模式后查看实际效果</p>
          )}
        </div>
      </div>
      {METRIC_COLOR_GROUPS.map((group) => (
        <div className="metric-color-group" key={group.id}>
          <div className="metric-color-group-title">{group.label}</div>
          <div className="metric-color-list">
            {METRIC_COLOR_META.filter((item) => item.group === group.id).map(({ key, label }) => {
              const Icon = ICONS[key];
              // 只有本机改过的颜色能「恢复」（回到站点预设色，站点没设才是主题默认色）。
              const overridden = overriddenColors[key] != null;
              return (
                <div className="metric-color-row" key={key}>
                  <Icon size={14} className="metric-color-icon" />
                  <span className="metric-color-name">{label}</span>
                  <label className="metric-color-swatch" style={{ background: valueOf(key) }}>
                    <input
                      type="color"
                      value={valueOf(key)}
                      onChange={(event) => setColor(key, event.target.value)}
                      aria-label={`${label} 颜色`}
                    />
                  </label>
                  <button
                    type="button"
                    className="metric-color-reset"
                    onClick={() => {
                      resetColor(key);
                      refreshBase();
                    }}
                    disabled={!overridden}
                    aria-label={`恢复 ${label} 默认色`}
                    title="恢复默认"
                  >
                    <RotateCcw size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
