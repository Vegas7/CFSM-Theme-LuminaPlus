import { useQuery, type Query } from "@tanstack/react-query";
import { getLoadRecords, getPingRecords } from "@/services/api";

const RECORD_QUERY_OPTIONS = {
  staleTime: 300_000,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  // 每次进详情页都重取一次：`staleTime` 5 分钟本来会让「刚点进来」直接用上次那份，
  // 刚发生的事（站长 2026-09-21 跑的测速）要刷新页面才看得到，而内置主题是一进去就取。
  // 不怕点来点去多发请求：`fetchHistoryRows` 自己还有 20 秒缓存，在途的同一请求也会复用。
  refetchOnMount: "always",
} as const;

/**
 * 换时间段时，新档位的数据回来之前先接着显示上一个档位的图（调用方据 `isPlaceholderData` 压暗）。
 *
 * 不这么做的话一换档就进「加载中」，整块图表缩成一个转圈，页面一下子矮了好几百像素，浏览器只能把
 * 滚动位置往回拽 —— 看着就是「一点时间段按钮页面就跳回顶上」。负载图和 Ping 图上下摞在同一页之后，
 * 这个跳动格外明显。
 *
 * 只在**同一台节点**之间沿用：从切换器换到另一台时，拿上一台的图顶着新名字只会误导，照旧显示加载中。
 * queryKey 的第 3 位是节点 uuid（见下面两个 hook）。
 */
export function keepPreviousRangeData<T>(
  previousData: T | undefined,
  previousQuery: Pick<Query, "queryKey"> | undefined,
  uuid: string,
): T | undefined {
  return previousQuery?.queryKey[2] === uuid ? previousData : undefined;
}

export function useLoadRecords(uuid: string, hours = 6, enabled = true) {
  return useQuery({
    queryKey: ["records", "load", uuid, hours],
    queryFn: ({ signal }) => getLoadRecords(uuid, hours, { signal }),
    ...RECORD_QUERY_OPTIONS,
    placeholderData: (previousData, previousQuery) =>
      keepPreviousRangeData(previousData, previousQuery, uuid),
    enabled: Boolean(uuid) && enabled,
  });
}

// stats 已并入 getPingRecords 的同一次请求(response.stats),不再单独发起查询。
export function usePingRecords(uuid: string, hours = 6, enabled = true) {
  return useQuery({
    queryKey: ["records", "ping", uuid, hours],
    queryFn: ({ signal }) => getPingRecords(uuid, hours, { signal }),
    ...RECORD_QUERY_OPTIONS,
    placeholderData: (previousData, previousQuery) =>
      keepPreviousRangeData(previousData, previousQuery, uuid),
    enabled: Boolean(uuid) && enabled,
  });
}
