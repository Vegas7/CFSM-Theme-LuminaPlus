import type { ReactNode } from "react";
import { useNodeDetailClick } from "./useNodeDetailClick";

/**
 * 小卡、迷你卡的顶部整块：标题行 + 标签行包成一个可点区域，点哪儿都进详情页（见 useNodeDetailClick）。
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
