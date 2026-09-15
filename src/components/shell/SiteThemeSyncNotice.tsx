import { useEffect, useId, useState } from "react";
import { CloudAlert } from "lucide-react";
import {
  retrySiteThemeSync,
  startSiteThemeAutoSync,
  useSiteThemeSyncStatus,
} from "@/hooks/useSiteThemeOptions";
import { ApiRequestError } from "@/services/cfsm/http";

function describeSyncError(error: unknown): string {
  const status = error instanceof ApiRequestError ? error.status : 0;
  if (status === 401) return "登录态已失效：到 /admin 重新登录后点「重试」，改动先留在本机。";
  // http 层清掉失效的人机验证凭证后，全局验证弹窗会自己重新出来（见 TurnstileGate）。
  if (status === 403) return "本站需要人机验证：完成弹出的验证后点「重试」。";
  if (status === 400) return "配置格式被后端拒绝（invalidThemeOptionsFormat），请把这条信息反馈给作者。";
  return error instanceof Error && error.message ? error.message : "网络错误，改动先留在本机。";
}

/**
 * 登录站长的改动自动同步到后端（设置页、卡片配色、卡片上换线路都走这一条，见 startSiteThemeAutoSync）。
 * 这里负责启动监听，并在同步失败时提示 —— 改动是在首页取色器、卡片上做的，失败原因只能在全局说。
 * 成功不提示：设置页工具栏有状态，别处改完颜色本来就立刻看得见。
 */
export function SiteThemeSyncNotice() {
  const titleId = useId();
  const status = useSiteThemeSyncStatus();
  const [dismissedError, setDismissedError] = useState<unknown>(null);

  useEffect(() => startSiteThemeAutoSync(), []);

  if (status.phase !== "error" || status.error === dismissedError) return null;

  return (
    <section
      className="realtime-session-prompt site-theme-sync-notice"
      aria-labelledby={titleId}
      aria-live="polite"
    >
      <CloudAlert size={16} strokeWidth={2} className="realtime-session-prompt-icon" aria-hidden />
      <div className="realtime-session-prompt-body">
        <strong id={titleId}>设置没能同步到后端</strong>
        <p>{describeSyncError(status.error)}</p>
      </div>
      <div className="realtime-session-prompt-actions">
        <button
          type="button"
          className="control-button realtime-session-prompt-button"
          onClick={() => setDismissedError(status.error)}
        >
          关闭
        </button>
        <button
          type="button"
          className="control-button realtime-session-prompt-button is-primary"
          onClick={retrySiteThemeSync}
        >
          重试
        </button>
      </div>
    </section>
  );
}
