import type { ReactNode } from "react";
import { clsx } from "clsx";
import { Spinner } from "@/components/ui/Spinner";

export function InstancePanel({
  id,
  title,
  kicker,
  titleIcon,
  titleAction,
  description,
  controls,
  aside,
  children,
  className,
}: {
  /** 可选的 DOM id：主题设置页给每个分区一个，便于定位与调试。 */
  id?: string;
  title: string;
  kicker?: ReactNode;
  /** 标题前的小图标（详情页用来放节点的国旗，和首页卡片一致）。 */
  titleIcon?: ReactNode;
  titleAction?: ReactNode;
  description?: ReactNode;
  /** 标题区正中间的控件（图表面板的时间段选择条）。 */
  controls?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={clsx("instance-panel", kicker != null && "has-kicker", className)}>
      <header className={clsx("instance-panel-header", controls != null && "has-controls")}>
        <div className="instance-panel-headings">
          {kicker != null && <span className="instance-panel-kicker">{kicker}</span>}
          <div className="instance-panel-title-row">
            {titleIcon != null && <span className="instance-panel-title-icon">{titleIcon}</span>}
            <h2 className="instance-panel-title">{title}</h2>
            {titleAction}
          </div>
          {description != null && <p className="instance-panel-description">{description}</p>}
        </div>
        {controls != null && <div className="instance-panel-controls">{controls}</div>}
        {aside != null && <div className="instance-panel-aside">{aside}</div>}
      </header>
      {children}
    </section>
  );
}

/**
 * 图表加载中的面板内容。只给内容、不自带面板外壳：图表各状态（加载、出错、有数据）都用同一个
 * `<InstancePanel>`，React 才会复用标题区 —— 否则一换时间段就进加载态、整个标题区连同时间段
 * 选择条被卸载重建，选中高亮滑不过去（见 RangeSelector）。
 */
export function InstanceChartLoadingBody() {
  return (
    <div className="instance-chart-loading" aria-busy>
      <Spinner size={26} label="" />
      <span>加载中…</span>
    </div>
  );
}
