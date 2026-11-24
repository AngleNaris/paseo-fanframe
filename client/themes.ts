export interface FanframeThemeSpec {
  readonly id: string;
  readonly name: string;
  readonly appearance: "light" | "dark";
  readonly colors: {
    readonly background: string;
    readonly foreground: string;
    readonly raised: string;
    readonly control: string;
    readonly border: string;
    readonly accent: string;
    readonly mutedForeground: string;
    readonly ring: string;
    readonly sidebar: string;
    readonly sidebarHover: string;
    readonly sidebarSelected: string;
    readonly surface3: string;
    readonly surface4: string;
    readonly foregroundExtraMuted: string;
  };
}

export const FANFRAME_DARK_THEME: FanframeThemeSpec = {
  id: "fanframe-dark",
  name: "FanFrame Dark · 繁界深色",
  appearance: "dark",
  colors: {
    background: "#1c1e23",
    foreground: "#d6ccbc",
    raised: "#24272e",
    control: "#2a2e36",
    border: "#353a44",
    accent: "#916db0",
    mutedForeground: "#9c9993",
    ring: "#916db0",
    sidebar: "#202228",
    sidebarHover: "#2c3039",
    sidebarSelected: "#333845",
    surface3: "#272b33",
    surface4: "#323742",
    foregroundExtraMuted: "#7b7974",
  },
};

export const FANFRAME_LIGHT_THEME: FanframeThemeSpec = {
  id: "fanframe-light",
  name: "FanFrame Light · 繁界浅色",
  appearance: "light",
  colors: {
    background: "#f7f8fa",
    foreground: "#1e222a",
    raised: "#ffffff",
    control: "#eef0f5",
    border: "#d8dde6",
    accent: "#6f4c91",
    mutedForeground: "#5c6472",
    ring: "#6f4c91",
    sidebar: "#eff1f5",
    sidebarHover: "#e2e6ef",
    sidebarSelected: "#d9dfe9",
    surface3: "#eaedf4",
    surface4: "#dde2ec",
    foregroundExtraMuted: "#7c8494",
  },
};
