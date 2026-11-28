import { type PluginSurfaceProps, useSettings } from "@getpaseo/plugin/client";
import {
  Icon,
  SettingsCard,
  SettingsSection,
  SettingsSwitch,
  TextInput,
} from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { mediaAccessSettings } from "../shared/media";
import {
  type FanframePrefs,
  readFanframePrefs,
  subscribeFanframePrefs,
  updateFanframePrefs,
} from "./web";

function isAbsoluteDirInput(value: string): boolean {
  const trimmed = value.trim();
  return /^\/.+/.test(trimmed) || /^[a-zA-Z]:[\\/]/.test(trimmed);
}

export function FanframeSettings({ theme, layout }: PluginSurfaceProps) {
  const c = theme.colors;
  const [prefs, setPrefs] = useState<FanframePrefs>(readFanframePrefs);
  const mediaSettings = useSettings(mediaAccessSettings);
  const [dirDraft, setDirDraft] = useState("");
  const [dirError, setDirError] = useState<string | null>(null);

  useEffect(() => {
    return subscribeFanframePrefs(() => {
      setPrefs(readFanframePrefs());
    });
  }, []);

  const isWeb = Platform.OS === "web";

  const handleAddAllowedDir = async () => {
    if (mediaSettings.status !== "ready" || mediaSettings.saving) return;
    const candidate = dirDraft.trim().replace(/[\\/]+$/, "");
    if (!candidate) return;
    if (!isAbsoluteDirInput(candidate)) {
      setDirError("请输入完整绝对路径（例如 C:\\Users\\... 或 /home/...）。");
      return;
    }
    const normalized = /^[a-zA-Z]:$/.test(candidate) ? `${candidate}/` : candidate;
    const existing = mediaSettings.values.extraAllowedDirs;
    if (existing.some((entry) => entry.trim().toLowerCase() === normalized.toLowerCase())) {
      setDirError("该目录已在允许列表中。");
      return;
    }
    setDirError(null);
    const saved = await mediaSettings.save(
      { ...mediaSettings.values, extraAllowedDirs: [...existing, normalized] },
      mediaSettings.revision,
    );
    if (saved) {
      setDirDraft("");
    }
  };

  const handleRemoveAllowedDir = async (target: string) => {
    if (mediaSettings.status !== "ready" || mediaSettings.saving) return;
    const nextDirs = mediaSettings.values.extraAllowedDirs.filter((entry) => entry !== target);
    await mediaSettings.save(
      { ...mediaSettings.values, extraAllowedDirs: nextDirs },
      mediaSettings.revision,
    );
  };

  const handleToggleAllowAllPaths = async (value: boolean) => {
    if (mediaSettings.status !== "ready" || mediaSettings.saving) return;
    await mediaSettings.save(
      { ...mediaSettings.values, allowAllPaths: value },
      mediaSettings.revision,
    );
  };

  return (
    <View style={{ gap: layout.compact ? 12 : 16 }}>
      <SettingsSection title="主题说明 · Theme">
        <SettingsCard>
          <View style={{ padding: 12, gap: 6 }}>
            <Text style={{ color: c.foreground, fontSize: 14, fontWeight: "600" }}>
              FanFrame Dark / FanFrame Light
            </Text>
            <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>
              请在「设置 → 外观（Settings → Appearance）」中选择 FanFrame Dark · 繁界深色 或
              FanFrame Light · 繁界浅色。
            </Text>
          </View>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="自定义侧栏视图 · Sidebar View">
        <SettingsCard>
          <View style={{ padding: 12, gap: 6 }}>
            <Text style={{ color: c.foreground, fontSize: 14, fontWeight: "600" }}>
              状态 · 按项目分组（Status · By Project）
            </Text>
            <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>
              可在「设置 → 侧边栏 → 侧边栏视图（Settings → Sidebar → Sidebar view）」切换，顶部暂存近期活跃项目（可自定义时间区间），下方按状态与项目左对齐分组，支持时间 / 工作区首字 / 手动三种排序（支持桌面、网页与手机端）。
            </Text>
          </View>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="媒体预览访问范围 · Media Preview Scope"
        info="默认仅允许服务端自动读取当前对话工作区（workspace）内的媒体/文档文件。如需预览工作区外的目录，请在此显式添加绝对路径（按当前主机独立生效）。"
      >
        <SettingsCard>
          {mediaSettings.status === "ready" ? (
            <SettingsSwitch
              label="允许预览本机所有路径（跳过工作区目录限制，仍校验文件类型与体积上限）"
              value={mediaSettings.values.allowAllPaths}
              disabled={mediaSettings.saving}
              onValueChange={(value) => {
                void handleToggleAllowAllPaths(value);
              }}
            />
          ) : null}
          <View style={{ padding: 12, gap: 10 }}>
            {mediaSettings.status === "loading" ? (
              <Text style={{ color: c.foregroundMuted, fontSize: 12.5 }}>正在读取当前主机目录配置...</Text>
            ) : mediaSettings.status === "error" || mediaSettings.status === "invalid" ? (
              <Text style={{ color: c.statusDanger, fontSize: 12.5 }}>
                读取配置失败：{mediaSettings.error}
              </Text>
            ) : (
              <>
                {mediaSettings.values.allowAllPaths ? (
                  <Text style={{ color: c.foregroundMuted, fontSize: 12.5 }}>
                    已开启全路径预览，当前主机可自动预览任意绝对路径下受支持格式的媒体文件；关闭后将恢复仅限工作区与下方白名单目录。
                  </Text>
                ) : mediaSettings.values.extraAllowedDirs.length === 0 ? (
                  <Text style={{ color: c.foregroundMuted, fontSize: 12.5 }}>
                    当前未添加额外目录（仅限当前对话工作区内文件）。
                  </Text>
                ) : (
                  <View style={{ gap: 6 }}>
                    {mediaSettings.values.extraAllowedDirs.map((dir) => (
                      <View
                        key={dir}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          paddingHorizontal: 10,
                          paddingVertical: 7,
                          borderWidth: 1,
                          borderColor: c.border,
                          backgroundColor: c.surface0,
                        }}
                      >
                        <Text
                          style={{ color: c.foreground, fontSize: 12.5, flex: 1 }}
                          numberOfLines={2}
                        >
                          {dir}
                        </Text>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`移除允许目录 ${dir}`}
                          disabled={mediaSettings.saving}
                          onPress={() => {
                            void handleRemoveAllowedDir(dir);
                          }}
                          style={{
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            borderWidth: 1,
                            borderColor: c.border,
                            backgroundColor: c.surface1,
                          }}
                        >
                          <Text style={{ color: c.foregroundMuted, fontSize: 11.5 }}>移除</Text>
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}

                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <TextInput
                    value={dirDraft}
                    onChangeText={(text) => {
                      setDirDraft(text);
                      if (dirError) setDirError(null);
                    }}
                    placeholder="添加允许目录的绝对路径（如 C:\Users\...\brain）"
                    placeholderTextColor={c.foregroundMuted}
                    editable={!mediaSettings.saving}
                    onSubmitEditing={() => {
                      void handleAddAllowedDir();
                    }}
                    style={{
                      flex: 1,
                      borderWidth: 1,
                      borderColor: c.border,
                      backgroundColor: c.surface0,
                      color: c.foreground,
                      fontSize: 12.5,
                      paddingHorizontal: 10,
                      paddingVertical: 7,
                    }}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="添加允许目录"
                    disabled={mediaSettings.saving || !dirDraft.trim()}
                    onPress={() => {
                      void handleAddAllowedDir();
                    }}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 5,
                      paddingHorizontal: 12,
                      paddingVertical: 7,
                      borderWidth: 1,
                      borderColor: dirDraft.trim() ? c.accent : c.border,
                      backgroundColor: dirDraft.trim() ? c.accent : c.surface2,
                      opacity: mediaSettings.saving ? 0.6 : 1,
                    }}
                  >
                    <Icon
                      name="Plus"
                      size={13}
                      color={dirDraft.trim() ? c.accentForeground : c.foregroundMuted}
                    />
                    <Text
                      style={{
                        color: dirDraft.trim() ? c.accentForeground : c.foregroundMuted,
                        fontSize: 12,
                        fontWeight: "600",
                      }}
                    >
                      添加
                    </Text>
                  </Pressable>
                </View>

                {dirError || mediaSettings.saveError ? (
                  <Text style={{ color: c.statusDanger, fontSize: 12 }}>
                    {dirError ?? mediaSettings.saveError}
                  </Text>
                ) : null}
              </>
            )}
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
            label="对话框「传文件」按钮（支持图片压缩与任意文件，发送后桌面与手机端均可见）"
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
