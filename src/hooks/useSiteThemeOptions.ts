import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { pickPaletteSettings } from "@/hooks/useMetricColors";
import { useAllPingLineOverrides } from "@/hooks/usePingOverview";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { useLocalThemeSettings } from "@/hooks/useThemeSettings";
import { saveThemeOptions } from "@/services/api";
import { clearPingLineOverrides } from "@/services/pingLineOverrideStore";
import { resetLocalThemeSettings } from "@/services/themeSettingsStore";
import type { PublicConfig, ThemeSettings } from "@/types/cfsm";
import {
  mergePingLineOverridesByNode,
  type PingLineOverridesByNode,
} from "@/utils/pingLineOverrides";
import {
  normalizeThemeSettings,
  withPreferredAppearance,
  type Appearance,
} from "@/utils/themeSettings";

export interface SiteThemeOptionsSources {
  /** 后端当前的 theme_options（站点预设）。 */
  siteSettings: Record<string, unknown> | undefined;
  /** 后台「默认外观」，主题设置里没写默认外观时垫底。 */
  preferredAppearance: Appearance | undefined;
  /** 本机覆盖（localStorage）。 */
  localSettings: Record<string, unknown>;
  /** 设置页还没保存的表单草稿；取色器没有。 */
  draftSettings?: ThemeSettings;
  /** 首页卡片上换过的线路（本机那份）。 */
  localLineOverrides: PingLineOverridesByNode;
}

/**
 * 「复制配置 JSON」与「保存到后端」发出去的站点快照。设置页和取色器共用这一份，口径只在这里定：
 *
 * 1. 主题设置白名单（normalizeThemeSettings）：站点 → 本机 → 草稿逐层盖，默认外观先垫后台的设置；
 * 2. 卡片上换过的线路按行并进 `homepagePingLineOverrides`；
 * 3. 配色逐个颜色叠（pickPaletteSettings），不能跟着第 1 条整键盖。
 *
 * 取色器的「保存到后端」早先自己拼了一份：没垫后台默认外观 —— 主题设置里没写默认外观时写成了
 * 「跟随系统」，把后台设的深色 / 浅色对所有访客盖掉；也没带卡片上换的线路。
 */
export function buildSiteThemeOptions({
  siteSettings,
  preferredAppearance,
  localSettings,
  draftSettings,
  localLineOverrides,
}: SiteThemeOptionsSources): Record<string, unknown> {
  const normalized = normalizeThemeSettings(
    withPreferredAppearance(preferredAppearance, {
      ...(siteSettings ?? {}),
      ...localSettings,
      ...draftSettings,
    }) as ThemeSettings & Record<string, unknown>,
  );
  return {
    ...normalized,
    // 本机换过的行压过站点已存的那份（见 mergePingLineOverridesByNode）。
    homepagePingLineOverrides: mergePingLineOverridesByNode(
      normalized.homepageMultiPingTaskIds,
      normalized.homepagePingLineOverrides,
      localLineOverrides,
    ),
    ...pickPaletteSettings(siteSettings, localSettings),
  };
}

/**
 * 当前设备的站点快照，以及把它发布到后端（仅登录站长可用，失败时原样抛出，由调用方按状态码提示）。
 *
 * 发布成功后当前设备立刻以刚存下的配置为准：写进 config 缓存，再丢掉本机覆盖与卡片上换过的线路
 * （它们已经并进快照，不丢的话会一直压着站点那份）。**顺序不能反**：先丢本机的话，中间那次渲染是
 * 「旧站点配置 + 空的本机」，设置页会判成有未保存的改动、顺手把「已保存」提示清掉。不再另拉一次
 * `/api/config`：刚保存完的那两分钟里很可能拿回旧的一份（原因见 api 的 THEME_OPTIONS_WRITE_TRUST_MS）。
 */
export function useSiteThemeOptions(draftSettings?: ThemeSettings) {
  const { data: config } = usePublicConfig();
  const localSettings = useLocalThemeSettings();
  const localLineOverrides = useAllPingLineOverrides();
  const queryClient = useQueryClient();

  const snapshot = useMemo(
    () =>
      buildSiteThemeOptions({
        siteSettings: config?.theme_settings,
        preferredAppearance: config?.preferredAppearance,
        localSettings,
        draftSettings,
        localLineOverrides,
      }),
    [
      config?.preferredAppearance,
      config?.theme_settings,
      draftSettings,
      localLineOverrides,
      localSettings,
    ],
  );

  const publish = useCallback(async () => {
    const { theme_options: saved } = await saveThemeOptions(snapshot);
    queryClient.setQueryData<PublicConfig>(["public"], (current) =>
      current ? { ...current, theme_settings: saved } : current,
    );
    resetLocalThemeSettings();
    clearPingLineOverrides();
  }, [queryClient, snapshot]);

  return { snapshot, publish };
}
