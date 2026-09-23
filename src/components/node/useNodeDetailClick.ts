import { useCallback, type MouseEvent } from "react";
import { useHref, useNavigate } from "react-router-dom";

/** 节点详情页的路由地址（几种卡片共用）。 */
export function nodeDetailPath(uuid: string) {
  return `/server/${encodeURIComponent(uuid)}`;
}

/**
 * 卡片顶部整块（旗帜、名字、系统图标、标签行，连同中间的空白）点了都进详情页。
 *
 * 不用「把名字链接 ::after 撑满整块」的做法：那层透明遮罩会盖住标签行，标签的完整列表 tooltip
 * 就再也悬停不出来了。这里挂在容器的 click 上，名字和系统图标本身仍是 `<Link>`（键盘、读屏、
 * 右键「在新标签页打开」照旧），点在它们身上交给链接自己处理，不重复导航。
 *
 * - 按住 Ctrl / ⌘ / Shift 或中键点：新标签页打开，和点链接一个习惯；
 * - 刚拖选了一段文字（比如复制节点名）：不跳走。
 */
export function useNodeDetailClick(uuid: string) {
  const navigate = useNavigate();
  const path = nodeDetailPath(uuid);
  const href = useHref(path);

  const open = useCallback(
    (event: MouseEvent<HTMLElement>, newTab: boolean) => {
      if (event.defaultPrevented) return;
      const target = event.target as Element | null;
      if (target?.closest("a, button, input, select, textarea, [role='button']")) return;
      if (window.getSelection()?.toString()) return;
      if (newTab) {
        window.open(href, "_blank", "noopener");
        return;
      }
      navigate(path);
    },
    [href, navigate, path],
  );

  const onClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      open(event, event.ctrlKey || event.metaKey || event.shiftKey);
    },
    [open],
  );

  const onAuxClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (event.button === 1) open(event, true);
    },
    [open],
  );

  return { onClick, onAuxClick };
}
