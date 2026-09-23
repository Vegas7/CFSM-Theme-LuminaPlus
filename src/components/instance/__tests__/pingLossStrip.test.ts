import { describe, expect, it } from "vitest";
import { lossAtPosition } from "../PingLossStrip";

// 四格，每格 60 秒；横轴区间正好是首末两个点。
const TIMES = [0, 60, 120, 180];
const LOSS = [0, 16, null, 2.5];

describe("lossAtPosition", () => {
  it("落在哪一格就取哪一格：按与前后邻点的中点分界，和色带画法一致", () => {
    // 60 秒那格覆盖 [30, 90]。
    expect(lossAtPosition(TIMES, LOSS, [0, 180], 35 / 180)).toEqual({ index: 1, value: 16 });
    expect(lossAtPosition(TIMES, LOSS, [0, 180], 85 / 180)).toEqual({ index: 1, value: 16 });
    expect(lossAtPosition(TIMES, LOSS, [0, 180], 95 / 180)).toEqual({ index: 2, value: null });
    expect(lossAtPosition(TIMES, LOSS, [0, 180], 1)).toEqual({ index: 3, value: 2.5 });
  });

  it("没采到的那格返回 value: null，而不是找不到", () => {
    expect(lossAtPosition(TIMES, LOSS, [0, 180], 120 / 180)).toEqual({ index: 2, value: null });
  });

  it("横轴比数据宽时，两端没有采样的空白处返回 null", () => {
    // 区间 [-300, 480]：数据只在 [-30, 210] 之间（首末各外延半格）。
    const range: [number, number] = [-300, 480];
    const at = (time: number) => lossAtPosition(TIMES, LOSS, range, (time + 300) / 780);
    expect(at(-200)).toBeNull();
    expect(at(-20)).toEqual({ index: 0, value: 0 });
    expect(at(200)).toEqual({ index: 3, value: 2.5 });
    expect(at(400)).toBeNull();
  });

  it("只有一个点时整条都是它", () => {
    expect(lossAtPosition([100], [3], null, 0.7)).toEqual({ index: 0, value: 3 });
  });

  it("没有数据时返回 null", () => {
    expect(lossAtPosition([], [], null, 0.5)).toBeNull();
  });
});
