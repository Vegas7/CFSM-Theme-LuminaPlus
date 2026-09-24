import type { ReactNode } from "react";
import { useNodeDetailClick } from "./useNodeDetailClick";

/**
 * 小卡、迷你卡的顶部：标题行 + 标签行包在一起，点标题行（含空白处）进详情页，标签行不算（见 useNodeDetailClick）。
 * 大卡的标签行本来就在 `<header>` 里，直接挂在 header 上，不走这个外壳。
 * 外壳沿用卡片的 gap（`gap: inherit`），两行之间的间距和原来一样，也一样能点。
 */
export function NodeCardHead({ uuid, children }: { uuid: string; children: ReactNode }) {
  const detailClick = useNodeDetailClick(uuid);
  return (
    <div className="node-card-head node-card-head-stack" {...detailClick}>
      {children}
    </div>
  );
}
