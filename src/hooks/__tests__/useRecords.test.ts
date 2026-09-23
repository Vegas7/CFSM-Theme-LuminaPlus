import { describe, expect, it } from "vitest";
import { keepPreviousRangeData } from "@/hooks/useRecords";

describe("keepPreviousRangeData", () => {
  const previous = { records: [1, 2, 3] };

  it("同一台节点换时间段：接着显示上一档的数据，图表不缩成转圈、页面不跳", () => {
    expect(
      keepPreviousRangeData(previous, { queryKey: ["records", "load", "node-a", 1] }, "node-a"),
    ).toBe(previous);
  });

  it("换到另一台节点：不拿上一台的图顶着新名字", () => {
    expect(
      keepPreviousRangeData(previous, { queryKey: ["records", "load", "node-a", 1] }, "node-b"),
    ).toBeUndefined();
  });

  it("第一次打开（没有上一份）：照常显示加载中", () => {
    expect(keepPreviousRangeData(undefined, undefined, "node-a")).toBeUndefined();
  });
});
