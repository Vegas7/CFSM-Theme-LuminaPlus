import { useEffect } from "react";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { getStaticSiteTitle } from "@/services/cfsm/config";
import { THEME_FALLBACK_TITLE } from "@/utils/themeMeta";

// 站点标题由后台外观设置提供（纯静态部署可用 TITLE 指定）；这里只是它还没到达时的占位。
const FALLBACK_TITLE = THEME_FALLBACK_TITLE;
const FALLBACK_DESCRIPTION = "";

function updateMeta(selector: string, attr: "content", value: string) {
  const element = document.querySelector<HTMLMetaElement>(selector);
  if (element) {
    element[attr] = value;
  }
}

export function useSiteMetadata() {
  const { data: config } = usePublicConfig();

  useEffect(() => {
    // 纯静态部署指定过 TITLE 就用它，否则挂载后会被后台站点标题盖掉、只在首屏闪一下。
    const siteName = getStaticSiteTitle() || config?.sitename?.trim() || FALLBACK_TITLE;
    const description = config?.description?.trim() || FALLBACK_DESCRIPTION;

    document.title = siteName;
    updateMeta('meta[name="apple-mobile-web-app-title"]', "content", siteName);
    updateMeta('meta[property="og:title"]', "content", siteName);
    updateMeta('meta[name="twitter:title"]', "content", siteName);
    updateMeta('meta[name="description"]', "content", description);
    updateMeta('meta[property="og:description"]', "content", description);
    updateMeta('meta[name="twitter:description"]', "content", description);
  }, [config?.sitename, config?.description]);
}
