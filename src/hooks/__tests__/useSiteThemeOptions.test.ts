// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildSiteThemeOptions } from "@/hooks/useSiteThemeOptions";
import { EMPTY_PING_LINE_OVERRIDES_BY_NODE } from "@/utils/pingLineOverrides";

const base = {
  siteSettings: undefined,
  preferredAppearance: undefined,
  localSettings: {},
  localLineOverrides: EMPTY_PING_LINE_OVERRIDES_BY_NODE,
};

describe("buildSiteThemeOptions", () => {
  it("keeps the backend's default appearance when no theme setting names one", () => {
    // 取色器的「保存到后端」曾把「跟随系统」写进站点配置，后台设的深色对所有访客失效。
    expect(buildSiteThemeOptions({ ...base, preferredAppearance: "dark" }).defaultAppearance).toBe(
      "dark",
    );
    expect(
      buildSiteThemeOptions({
        ...base,
        preferredAppearance: "dark",
        localSettings: { defaultAppearance: "light" },
      }).defaultAppearance,
    ).toBe("light");
  });

  it("carries the line switches made on cards", () => {
    const snapshot = buildSiteThemeOptions({
      ...base,
      localLineOverrides: { "node-a": { "0": 5 } },
    });

    expect(snapshot.homepagePingLineOverrides).toEqual({ "node-a": { "0": 5 } });
  });

  it("keeps site keys this theme does not own, such as the built-in theme's mikus switch", () => {
    // 后端保存是整份替换 theme_options：不带上的话，这次保存会把别的主题的设置清掉。
    const snapshot = buildSiteThemeOptions({
      ...base,
      siteSettings: { mikus: true, futureBackendFlag: { on: 1 }, desktopNodeViewMode: "list" },
    });

    expect(snapshot.mikus).toBe(true);
    expect(snapshot.futureBackendFlag).toEqual({ on: 1 });
    expect(snapshot.desktopNodeViewMode).toBe("list");
  });

  it("does not bring back an owned key the snapshot leaves out on purpose", () => {
    // 本机把暗色深度调回默认 0：快照省掉 darkDepth，站点那份 60 不能借「保留陌生键」复活。
    const snapshot = buildSiteThemeOptions({
      ...base,
      siteSettings: { darkDepth: 60 },
      localSettings: { darkDepth: 0 },
    });

    expect("darkDepth" in snapshot).toBe(false);
  });

  it("only keeps unknown keys from the site, not from this browser", () => {
    const snapshot = buildSiteThemeOptions({ ...base, localSettings: { someLocalOnlyKey: 1 } });

    expect("someLocalOnlyKey" in snapshot).toBe(false);
  });

  it("layers site, local and draft settings, with colours merged one by one", () => {
    const snapshot = buildSiteThemeOptions({
      ...base,
      siteSettings: { desktopNodeViewMode: "list", metricColors: { cpu: "#111111", disk: "#222222" } },
      localSettings: { desktopNodeViewMode: "compact", metricColors: { cpu: "#333333" } },
      draftSettings: { desktopNodeViewMode: "large" },
    });

    expect(snapshot.desktopNodeViewMode).toBe("large");
    expect(snapshot.metricColors).toEqual({ cpu: "#333333", disk: "#222222" });
  });
});
