// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { getStaticSiteTitle } from "@/services/cfsm/config";

afterEach(() => {
  document.head.innerHTML = "";
});

describe("getStaticSiteTitle", () => {
  it("reads the TITLE that build-static.mjs writes into <meta name=\"siteTitle\">", () => {
    // 脚本和这里靠这个 meta 名对上：改一边忘了另一边，静态部署设的 TITLE 挂载后又会被后台标题盖掉。
    const meta = document.createElement("meta");
    meta.name = "siteTitle";
    meta.content = "  我的监控  ";
    document.head.append(meta);

    expect(getStaticSiteTitle()).toBe("我的监控");
  });

  it("is empty for Worker-hosted pages, so the backend site title applies", () => {
    expect(getStaticSiteTitle()).toBe("");
  });
});
