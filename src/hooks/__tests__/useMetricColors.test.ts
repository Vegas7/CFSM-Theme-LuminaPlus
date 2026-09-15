import { describe, expect, it } from "vitest";
import {
  DEFAULT_DARK_DEPTH,
  normalizeDarkDepth,
  pickPaletteOverrides,
  pickPaletteSettings,
  readDarkDepthFromSettings,
} from "@/hooks/useMetricColors";

describe("dark depth settings", () => {
  it("keeps the existing gray-black palette as the default", () => {
    expect(readDarkDepthFromSettings(undefined)).toBe(DEFAULT_DARK_DEPTH);
    expect(readDarkDepthFromSettings({})).toBe(0);
  });

  it("rounds and clamps the persisted depth to the safe 0-100 range", () => {
    expect(normalizeDarkDepth(42.6)).toBe(43);
    expect(normalizeDarkDepth(-20)).toBe(0);
    expect(normalizeDarkDepth(180)).toBe(100);
  });

  it("falls back for invalid values and accepts a numeric stored string", () => {
    expect(readDarkDepthFromSettings({ darkDepth: "75" })).toBe(75);
    expect(readDarkDepthFromSettings({ darkDepth: "black" })).toBe(0);
  });
});

describe("pickPaletteSettings", () => {
  // 设置页「复制配置 JSON」靠它把取色器调的配色带进快照，漏了站长同步过去就是默认色。
  it("exports the picked colors and a non-default dark depth", () => {
    expect(
      pickPaletteSettings({
        defaultAppearance: "dark",
        metricColors: { cpu: "#3B82F6", disk: "#EF7C22" },
        darkDepth: 60,
      }),
    ).toEqual({ metricColors: { cpu: "#3b82f6", disk: "#ef7c22" }, darkDepth: 60 });
  });

  it("omits both keys when nothing was customised", () => {
    expect(pickPaletteSettings(undefined)).toEqual({});
    expect(pickPaletteSettings({ metricColors: {}, darkDepth: DEFAULT_DARK_DEPTH })).toEqual({});
    // 非法 hex 和未知指标都不进快照，避免把脏值同步成站点预设。
    expect(pickPaletteSettings({ metricColors: { cpu: "red", bogus: "#ffffff" } })).toEqual({});
  });

  it("layers local colours over the site preset one colour at a time", () => {
    // 本机只改了 CPU：站点设的磁盘色不能跟着没了（整键覆盖时就是这样丢的）。
    expect(
      pickPaletteSettings(
        { metricColors: { cpu: "#111111", disk: "#222222" }, darkDepth: 60 },
        { metricColors: { cpu: "#333333" } },
      ),
    ).toEqual({ metricColors: { cpu: "#333333", disk: "#222222" }, darkDepth: 60 });
    // 暗色深度本机设过就用本机的，包括设回默认值。
    expect(pickPaletteSettings({ darkDepth: 60 }, { darkDepth: 0 })).toEqual({});
  });
});

describe("pickPaletteOverrides", () => {
  const site = { colors: { cpu: "#111111", disk: "#222222" }, darkDepth: 60 };

  it("stores only what differs from the site preset", () => {
    expect(
      pickPaletteOverrides({ colors: { cpu: "#999999", disk: "#222222" }, darkDepth: 60 }, site),
    ).toEqual({ metricColors: { cpu: "#999999" } });
  });

  it("stores nothing once every colour is back to the site preset", () => {
    // 「恢复」把颜色设回站点色：本机键删掉、跟随站点，站长以后改站点色这台设备才跟得上。
    expect(pickPaletteOverrides({ ...site, colors: { ...site.colors } }, site)).toEqual({});
  });

  it("marks a site colour the editor removed, so the site colour does not come back", () => {
    // 登录站长点「恢复」回到主题默认色：本机记空串，逐色叠加和导出时都把站点色去掉。
    const overrides = pickPaletteOverrides({ colors: { disk: "#222222" }, darkDepth: 60 }, site);
    expect(overrides).toEqual({ metricColors: { cpu: "" } });
    expect(pickPaletteSettings({ metricColors: site.colors, darkDepth: 60 }, overrides)).toEqual({
      metricColors: { disk: "#222222" },
      darkDepth: 60,
    });
  });

  it("keeps a dark depth that only differs from the site, even if it equals the default", () => {
    // 站点是 60（深黑）时选「灰黑」(= 默认 0)：必须记下来，否则值会弹回 60。
    expect(pickPaletteOverrides({ ...site, darkDepth: 0 }, site)).toEqual({ darkDepth: 0 });
  });
});
