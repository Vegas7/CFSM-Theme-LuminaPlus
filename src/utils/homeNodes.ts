import type { HomeNodeSummary } from "@/services/wsStore";
import { getDisplayRegionCode } from "@/utils/geo";

export const HOME_ALL_GROUP = "__all__";
export const HOME_ALL_REGION = "__all__";

export interface HomeRegionOption {
  /** 展示地区代码(如 "US"),同时用作国旗输入与筛选键;无法识别的地区归入 "UN"。 */
  code: string;
  count: number;
}

// 默认地区排序优先级:中国大陆(CN)最前,港澳台紧随,再新加坡/日本/美国,然后欧洲诸国整体一档,
// 其余垫底。列表内每个代码有唯一名次,所以无论数量多少都固定这个顺序。
const REGION_PRIORITY: string[] = ["CN", "HK", "MO", "TW", "SG", "JP", "US"];

// 欧洲诸国(含跨洲但通常并入欧洲的 TR/RU/外高加索),统一排在优先列表之后、其余地区之前。
const EUROPE_CODES = new Set<string>([
  // "EU":geo.ts 会把 Europe/欧洲 解析成 EU,归入本档而非"其余"。
  "EU",
  "GB", "IE", "FR", "DE", "NL", "BE", "LU", "CH", "AT", "IT", "ES", "PT",
  "SE", "NO", "FI", "DK", "IS", "PL", "CZ", "SK", "HU", "RO", "BG", "GR",
  "HR", "SI", "RS", "BA", "ME", "MK", "AL", "LT", "LV", "EE", "UA", "MD",
  "BY", "RU", "TR", "CY", "MT", "LI", "MC", "AD", "SM", "VA", "GE", "AM", "AZ",
]);

function regionRank(code: string): number {
  const index = REGION_PRIORITY.indexOf(code);
  if (index !== -1) return index;
  if (EUROPE_CODES.has(code)) return REGION_PRIORITY.length;
  return REGION_PRIORITY.length + 1;
}

/**
 * 按展示地区代码聚合节点数。`order` 是在首页拖出来的顺序(见 {@link mergeHomeRegionOrder}),
 * 列在里面的地区按它排在最前;其余按固定地理优先级(见 REGION_PRIORITY):中国(大陆优先,含港澳台)
 * → 新加坡 → 日本 → 美国 → 欧洲诸国 → 其余。同一档内(欧洲/其余)再按数量降序、代码升序。
 */
export function getHomeRegionOptions(
  nodes: HomeNodeSummary[],
  order: readonly string[] = [],
): HomeRegionOption[] {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const code = getDisplayRegionCode(node.region);
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  const orderIndex = new Map(order.map((code, index) => [code, index]));
  return Array.from(counts, ([code, count]) => ({ code, count })).sort((a, b) => {
    const left = orderIndex.get(a.code);
    const right = orderIndex.get(b.code);
    if (left != null || right != null) {
      if (left == null) return 1;
      if (right == null) return -1;
      return left - right;
    }
    return (
      regionRank(a.code) - regionRank(b.code) ||
      b.count - a.count ||
      a.code.localeCompare(b.code)
    );
  });
}

/** 存下来的地区顺序:只收地区代码(大写字母/数字),去重,首次出现的优先。 */
export function normalizeHomeRegionOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const code = raw.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,8}$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    result.push(code);
    if (result.length >= 300) break;
  }
  return result;
}

/**
 * 把一次拖动的结果并回完整的地区顺序。
 *
 * 地区栏只显示当前分组里有的地区,拖动也只拖得到这几个;直接拿「这次显示的顺序」当新顺序存,
 * 别的分组里排好的地区就丢了。这里先还原出「所有已知地区」的实际显示顺序(存过的在前,这次显示、
 * 没存过的按显示顺序接在后面),再把这次显示的那几个按拖完的顺序填回它们原来占的位置。
 */
export function mergeHomeRegionOrder(
  previousOrder: readonly string[],
  visibleBefore: readonly string[],
  visibleAfter: readonly string[],
): string[] {
  const known = new Set(previousOrder);
  const full = [...previousOrder, ...visibleBefore.filter((code) => !known.has(code))];
  const visible = new Set(visibleBefore);
  let cursor = 0;
  return full.map((code) => (visible.has(code) ? (visibleAfter[cursor++] ?? code) : code));
}

export function getHomeGroupLabel(group: string) {
  return group.trim();
}

/** 对一组原始 group 值做 trim、去空、去重,保留首次出现的顺序。 */
export function dedupeGroupLabels(groups: Iterable<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of groups) {
    const label = getHomeGroupLabel(String(raw ?? ""));
    if (!label || seen.has(label)) continue;
    seen.add(label);
    result.push(label);
  }

  return result;
}

export function getHomeGroupOptions(nodes: HomeNodeSummary[]) {
  return dedupeGroupLabels(nodes.map((node) => node.group));
}

/** 规范化存下来的 group 排序:trim、去空、去重(首次出现的优先)。 */
export function normalizeHomeGroupOrder(value: unknown): string[] {
  return Array.isArray(value) ? dedupeGroupLabels(value as Array<string | null | undefined>) : [];
}

/**
 * 按用户配置的 `order` 给 `groups` 排序:仍存在的已配置 group 排在前面(按配置顺序),其余 group
 * 保持原本首次出现的顺序。没设排序时原样返回 `groups`。
 */
export function sortHomeGroupOptions(groups: string[], order: string[]): string[] {
  if (order.length === 0) return groups;

  const available = new Set(groups);
  const seen = new Set<string>();
  const result: string[] = [];

  for (const group of order) {
    if (available.has(group) && !seen.has(group)) {
      seen.add(group);
      result.push(group);
    }
  }
  for (const group of groups) {
    if (!seen.has(group)) {
      seen.add(group);
      result.push(group);
    }
  }

  return result;
}
