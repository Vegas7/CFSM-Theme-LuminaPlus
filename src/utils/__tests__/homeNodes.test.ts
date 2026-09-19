import { describe, expect, it } from "vitest";
import type { HomeNodeSummary } from "@/services/wsStore";
import {
  getHomeGroupOptions,
  getHomeRegionOptions,
  mergeHomeRegionOrder,
  normalizeHomeGroupOrder,
  normalizeHomeRegionOrder,
  sortHomeGroupOptions,
} from "@/utils/homeNodes";

function node(partial: Partial<HomeNodeSummary> & Pick<HomeNodeSummary, "uuid">): HomeNodeSummary {
  return {
    group: "",
    hidden: false,
    region: "",
    online: true,
    trafficDown: 0,
    trafficUp: 0,
    netDown: 0,
    netUp: 0,
    weight: 0,
    ...partial,
  };
}

describe("home node helpers", () => {
  it("builds group tabs from non-empty backend groups and keeps first-seen order", () => {
    expect(
      getHomeGroupOptions([
        node({ uuid: "a", group: "US 美国" }),
        node({ uuid: "b", group: "HK 香港" }),
        node({ uuid: "c", group: "US 美国" }),
        node({ uuid: "d", group: "" }),
      ]),
    ).toEqual(["US 美国", "HK 香港"]);
  });

});

describe("home group ordering", () => {
  it("normalizeHomeGroupOrder trims, drops empties, dedupes, and rejects non-arrays", () => {
    expect(normalizeHomeGroupOrder([" A ", "B", "A", "", null, "B"])).toEqual(["A", "B"]);
    expect(normalizeHomeGroupOrder("nope")).toEqual([]);
    expect(normalizeHomeGroupOrder(undefined)).toEqual([]);
  });

  it("returns the original order when no custom order is set", () => {
    const groups = ["US", "HK", "JP"];
    expect(sortHomeGroupOptions(groups, [])).toBe(groups);
  });

  it("places configured groups first, then appends the rest in original order", () => {
    expect(sortHomeGroupOptions(["US", "HK", "JP", "SG"], ["JP", "US"])).toEqual([
      "JP",
      "US",
      "HK",
      "SG",
    ]);
  });

  it("ignores configured groups that no longer exist and never duplicates", () => {
    expect(sortHomeGroupOptions(["US", "HK"], ["GONE", "HK", "HK"])).toEqual(["HK", "US"]);
  });
});

describe("home region ordering", () => {
  const nodes = [
    node({ uuid: "a", region: "HK" }),
    node({ uuid: "b", region: "TW" }),
    node({ uuid: "c", region: "TW" }),
    node({ uuid: "d", region: "US" }),
    node({ uuid: "e", region: "US" }),
  ];
  const codes = (order?: string[]) => getHomeRegionOptions(nodes, order).map((o) => o.code);

  it("没拖过时按固定地理优先级排", () => {
    expect(codes()).toEqual(["HK", "TW", "US"]);
  });

  it("拖出来的顺序排最前，没列进去的按默认规则接在后面", () => {
    expect(codes(["US", "TW", "HK"])).toEqual(["US", "TW", "HK"]);
    expect(codes(["US"])).toEqual(["US", "HK", "TW"]);
    // 存过、但当前节点里已经没有的地区不占位置。
    expect(codes(["JP", "TW"])).toEqual(["TW", "HK", "US"]);
  });

  it("normalizeHomeRegionOrder 只收地区代码，大写、去重", () => {
    expect(normalizeHomeRegionOrder([" us ", "HK", "US", "", 3, null, "香港", "TW"])).toEqual([
      "US",
      "HK",
      "TW",
    ]);
    expect(normalizeHomeRegionOrder("US,HK")).toEqual([]);
  });

  it("第一次拖动：这次显示的地区全部记下来", () => {
    expect(mergeHomeRegionOrder([], ["HK", "TW", "US"], ["US", "HK", "TW"])).toEqual([
      "US",
      "HK",
      "TW",
    ]);
  });

  it("只显示一部分地区时，别的分组里排好的地区留在原位", () => {
    // 完整顺序 JP → HK → DE → US；当前分组只有 HK、US，把 US 拖到 HK 前面。
    expect(mergeHomeRegionOrder(["JP", "HK", "DE", "US"], ["HK", "US"], ["US", "HK"])).toEqual([
      "JP",
      "US",
      "DE",
      "HK",
    ]);
  });

  it("这次显示、以前没存过的地区接在已存顺序后面再参与排序", () => {
    expect(mergeHomeRegionOrder(["US"], ["US", "HK", "TW"], ["HK", "US", "TW"])).toEqual([
      "HK",
      "US",
      "TW",
    ]);
  });
});
