import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import {
  type FanframePrefs,
  readFanframePrefs,
  subscribeFanframePrefs,
  updateFanframePrefs,
} from "./web";

export function FanframeSettings({ theme, layout }: PluginSurfaceProps) {
  const [prefs, setPrefs] = useState<FanframePrefs>(readFanframePrefs);

  useEffect(() => {
    return subscribeFanframePrefs(() => {
      setPrefs(readFanframePrefs());
    });
  }, []);

  const isWeb = Platform.OS === "web";

  return (
    <View style={{ gap: layout.compact ? 12 : 16 }}>
      <SettingsSection title="主题说明 · Theme">
        <SettingsCard>
          <View style={{ padding: 12, gap: 6 }}>
            <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "600" }}>
              FanFrame Dark / FanFrame Light
            </Text>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
              请在「设置 → 外观（Settings → Appearance）」中选择 FanFrame Dark · 繁界深色 或
              FanFrame Light · 繁界浅色。
            </Text>
          </View>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="桌面与网页端视觉增强 · Web / Desktop">
        <SettingsCard>
          <SettingsSwitch
            label="全局哥特直角与实色浮层（去除玻璃模糊与焦点外框）"
            value={prefs.sharpCorners}
            disabled={!isWeb}
            onValueChange={(value) => {
              setPrefs(updateFanframePrefs({ sharpCorners: value }));
            }}
          />
          <SettingsSwitch
            label="Markdown 低饱和染色（深浅双色自适应）"
            value={prefs.markdownPalette}
            disabled={!isWeb}
            onValueChange={(value) => {
              setPrefs(updateFanframePrefs({ markdownPalette: value }));
            }}
          />
          <SettingsSwitch
            label="正文标点三档亮度分层（括号钢蓝 / 数字琥珀）"
            value={prefs.proseLayering}
            disabled={!isWeb}
            onValueChange={(value) => {
              setPrefs(updateFanframePrefs({ proseLayering: value }));
            }}
          />
          <SettingsSwitch
            label="FanFrame 克制微动效（控件色变 / 浮层淡入 / 展开过渡）"
            value={prefs.smoothMotion}
            disabled={!isWeb}
            onValueChange={(value) => {
              setPrefs(updateFanframePrefs({ smoothMotion: value }));
            }}
          />
          <SettingsSwitch
            label="对话框「传图」按钮（默认前端压缩，发送后桌面与手机端均可见）"
            value={prefs.crossImagePill}
            disabled={!isWeb}
            onValueChange={(value) => {
              setPrefs(updateFanframePrefs({ crossImagePill: value }));
            }}
          />
          <SettingsSwitch
            label="侧边栏顶部菜单三列网格（左图右文、超长省略）"
            value={prefs.sidebarNavGrid}
            disabled={!isWeb}
            onValueChange={(value) => {
              setPrefs(updateFanframePrefs({ sidebarNavGrid: value }));
            }}
          />
          <SettingsSwitch
            label="AI 文本提问自动转为点选卡片（兼容 Antigravity 选项提问）"
            value={prefs.askQuestionPanel}
            disabled={!isWeb}
            onValueChange={(value) => {
              setPrefs(updateFanframePrefs({ askQuestionPanel: value }));
            }}
          />
        </SettingsCard>
      </SettingsSection>
    </View>
  );
}
