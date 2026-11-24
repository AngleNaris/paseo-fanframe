import {
  type PluginButtonContentProps,
  type PluginButtonRegistration,
  type PluginClientContext,
  type PluginTimelineItemProps,
  useComposers,
  useRpc,
} from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { Image, Platform, Pressable, Text, View } from "react-native";
import {
  CROSS_IMAGE_TIMELINE_KIND,
  CROSS_IMAGE_TIMELINE_VERSION,
  MAX_CROSS_IMAGES_PER_MESSAGE,
  type CrossImageMeta,
  type CrossImageTimelineData,
  crossImageTimelineDataSchema,
  putCrossImageRpc,
  readCrossImageBytesRpc,
  sendCrossImageMessageRpc,
} from "../shared/cross-image";
import {
  type PreparedWebImage,
  attachWebPasteAndDrop,
  openWebImagePicker,
  packCrossImageUploadPacket,
  prepareCrossImageFile,
  readFanframePrefs,
  resolveCrossImagePreviewUri,
  revokeWebPreviewUrl,
  subscribeFanframePrefs,
} from "./web";

interface StagedCrossImage extends PreparedWebImage {
  localId: string;
  rawFile: unknown;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function computeFitSize(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) {
    return { width: Math.min(maxWidth, 260), height: Math.min(maxHeight, 180) };
  }
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: Math.max(72, Math.round(width * scale)),
    height: Math.max(54, Math.round(height * scale)),
  };
}

let localImageSeq = 0;

function CrossImagePopoverContent(props: PluginButtonContentProps) {
  if (props.context !== "agent") return null;
  return <CrossImagePopoverBody {...props} />;
}

function CrossImagePopoverBody({
  agentId,
  theme,
  layout,
  close,
}: PluginButtonContentProps & { context: "agent" }) {
  const c = theme.colors;
  const compact = layout.compact;
  const isWeb = Platform.OS === "web";
  const toast = useToast();
  const putImage = useRpc(putCrossImageRpc);
  const sendMessage = useRpc(sendCrossImageMessageRpc);
  const composers = useComposers({ agentId });
  const composer = composers[0] ?? null;

  const [staged, setStaged] = useState<StagedCrossImage[]>([]);
  const [text, setText] = useState<string>("");
  const [keepOriginal, setKeepOriginal] = useState<boolean>(false);
  const [dragging, setDragging] = useState<boolean>(false);
  const [preparingCount, setPreparingCount] = useState<number>(0);
  const [sending, setSending] = useState<boolean>(false);
  const [pickHover, setPickHover] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const dropHostRef = useRef<unknown>(null);
  const stagedRef = useRef<StagedCrossImage[]>([]);
  const seededDraftRef = useRef<string | null>(null);
  const pickerCleanupRef = useRef<(() => void) | null>(null);
  const aliveRef = useRef<boolean>(true);
  stagedRef.current = staged;

  // Inherit existing composer draft text once when the popover opens.
  useEffect(() => {
    if (seededDraftRef.current !== null) return;
    const draft = composer?.prompt ?? "";
    seededDraftRef.current = draft;
    if (draft.trim().length > 0) {
      setText(draft);
    }
  }, [composer]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      pickerCleanupRef.current?.();
      pickerCleanupRef.current = null;
      for (const item of stagedRef.current) {
        revokeWebPreviewUrl(item.previewUrl);
      }
    };
  }, []);

  const ingestFiles = useCallback(
    async (rawFiles: unknown[], originalFlag: boolean) => {
      if (!isWeb || rawFiles.length === 0) return;
      const room = MAX_CROSS_IMAGES_PER_MESSAGE - stagedRef.current.length;
      if (room <= 0) {
        setError(`单条消息最多发送 ${MAX_CROSS_IMAGES_PER_MESSAGE} 张图片。`);
        return;
      }
      const chosen = rawFiles.slice(0, room);
      const ignored = rawFiles.length - chosen.length;
      setError(ignored > 0 ? `已达到单次 ${MAX_CROSS_IMAGES_PER_MESSAGE} 张上限，多余图片已忽略。` : null);
      setPreparingCount((n) => n + chosen.length);

      try {
        const nextItems: StagedCrossImage[] = [];
        for (const rawFile of chosen) {
          try {
            const prepared = await prepareCrossImageFile(rawFile, { keepOriginal: originalFlag });
            if (!aliveRef.current) {
              revokeWebPreviewUrl(prepared.previewUrl);
              return;
            }
            nextItems.push({
              ...prepared,
              localId: `staged-${++localImageSeq}`,
              rawFile,
            });
          } catch (itemErr) {
            if (aliveRef.current) {
              setError(itemErr instanceof Error ? itemErr.message : String(itemErr));
            }
          }
        }
        if (nextItems.length > 0 && aliveRef.current) {
          setStaged((prev) => {
            const allowed = Math.max(0, MAX_CROSS_IMAGES_PER_MESSAGE - prev.length);
            const accepted = nextItems.slice(0, allowed);
            for (const dropped of nextItems.slice(allowed)) {
              revokeWebPreviewUrl(dropped.previewUrl);
            }
            return [...prev, ...accepted];
          });
        }
      } finally {
        if (aliveRef.current) {
          setPreparingCount((n) => Math.max(0, n - chosen.length));
        }
      }
    },
    [isWeb],
  );

  useEffect(() => {
    if (!isWeb) return;
    return attachWebPasteAndDrop(dropHostRef.current, {
      onFiles: (files) => {
        void ingestFiles(files, keepOriginal);
      },
      onDragChange: setDragging,
    });
  }, [ingestFiles, isWeb, keepOriginal]);

  const handleToggleOriginal = async () => {
    if (sending || preparingCount > 0) return;
    const nextKeep = !keepOriginal;
    setKeepOriginal(nextKeep);
    const current = stagedRef.current;
    if (current.length === 0 || !isWeb) return;

    setPreparingCount(current.length);
    setError(null);
    try {
      const rebuilt: StagedCrossImage[] = [];
      for (const entry of current) {
        try {
          const prepared = await prepareCrossImageFile(entry.rawFile, { keepOriginal: nextKeep });
          if (!aliveRef.current) {
            revokeWebPreviewUrl(prepared.previewUrl);
            return;
          }
          rebuilt.push({
            ...prepared,
            localId: entry.localId,
            rawFile: entry.rawFile,
          });
        } catch {
          rebuilt.push(entry);
        }
      }
      if (aliveRef.current) {
        for (const oldEntry of current) {
          if (!rebuilt.some((item) => item.previewUrl === oldEntry.previewUrl)) {
            revokeWebPreviewUrl(oldEntry.previewUrl);
          }
        }
        setStaged(rebuilt);
      }
    } finally {
      if (aliveRef.current) setPreparingCount(0);
    }
  };

  const handlePick = () => {
    if (!isWeb || sending) return;
    pickerCleanupRef.current?.();
    pickerCleanupRef.current = openWebImagePicker((files) => {
      pickerCleanupRef.current = null;
      void ingestFiles(files, keepOriginal);
    });
  };

  const handleRemove = (localId: string) => {
    if (sending) return;
    setStaged((prev) => {
      const target = prev.find((item) => item.localId === localId);
      if (target) revokeWebPreviewUrl(target.previewUrl);
      return prev.filter((item) => item.localId !== localId);
    });
  };

  const handleSend = async () => {
    if (sending || preparingCount > 0 || staged.length === 0) return;
    setSending(true);
    setError(null);
    try {
      const uploadedIds: string[] = [];
      for (const item of staged) {
        const packet = packCrossImageUploadPacket(
          {
            agentId,
            name: item.name,
            mimeType: item.mimeType,
            width: item.width,
            height: item.height,
          },
          item.bytes,
        );
        const meta = await putImage(packet);
        uploadedIds.push(meta.imageId);
      }

      const res = await sendMessage({
        agentId,
        text,
        imageIds: uploadedIds,
      });
      if (!res.ok) {
        throw new Error(res.error ?? "发送失败");
      }

      if (
        composer &&
        seededDraftRef.current &&
        seededDraftRef.current.trim().length > 0 &&
        composer.prompt === seededDraftRef.current
      ) {
        composer.setPrompt("");
      }

      for (const item of staged) {
        revokeWebPreviewUrl(item.previewUrl);
      }
      setStaged([]);
      toast.show("已发送图片并同步到所有端", { variant: "success" });
      close();
    } catch (sendErr) {
      setError(sendErr instanceof Error ? sendErr.message : String(sendErr));
    } finally {
      if (aliveRef.current) setSending(false);
    }
  };

  const totalBytes = staged.reduce((sum, item) => sum + item.compressedSize, 0);
  const totalOrigBytes = staged.reduce((sum, item) => sum + item.originalSize, 0);
  const canSend = isWeb && staged.length > 0 && !sending && preparingCount === 0;

  return (
    <View
      ref={dropHostRef as never}
      style={{
        width: compact ? undefined : 416,
        maxWidth: "100%",
        gap: 10,
      }}
    >
      {compact ? null : (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text style={{ color: c.foreground, fontSize: 14, fontWeight: "600" }}>
            跨端传图
          </Text>
          <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
            {staged.length > 0
              ? `${staged.length} / ${MAX_CROSS_IMAGES_PER_MESSAGE}`
              : "支持桌面端与手机同步查看"}
          </Text>
        </View>
      )}

      {!isWeb ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surface2,
            padding: 12,
          }}
        >
          <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
            请在桌面端或手机浏览器使用 FanFrame 传图选图与粘贴上传。
          </Text>
        </View>
      ) : (
        <View
          style={{
            borderWidth: 1,
            borderColor: dragging ? c.accent : c.border,
            backgroundColor: c.surface2,
            padding: 10,
            gap: 10,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="选择图片"
              disabled={sending}
              onHoverIn={() => setPickHover(true)}
              onHoverOut={() => setPickHover(false)}
              onPress={handlePick}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderWidth: 1,
                borderColor: pickHover || pressed ? c.accent : c.border,
                backgroundColor: c.surface1,
                opacity: sending ? 0.6 : 1,
              })}
            >
              <Icon name="Upload" size={14} color={c.foreground} />
              <Text style={{ color: c.foreground, fontSize: 12, fontWeight: "600" }}>
                选择图片
              </Text>
            </Pressable>

            <Text style={{ color: c.foregroundMuted, fontSize: 12, flexShrink: 1 }}>
              {dragging ? "松开以添加图片" : "支持直接 Ctrl+V 粘贴或拖拽"}
            </Text>
          </View>

          {staged.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {staged.map((item) => {
                  const saved = item.originalSize > item.compressedSize;
                  return (
                    <View
                      key={item.localId}
                      style={{
                        width: 82,
                        borderWidth: 1,
                        borderColor: c.border,
                        backgroundColor: c.surface1,
                      }}
                    >
                      <View style={{ position: "relative", width: 80, height: 68 }}>
                        <Image
                          source={{ uri: item.previewUrl }}
                          style={{ width: 80, height: 68 }}
                          resizeMode="cover"
                        />
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`移除 ${item.name}`}
                          disabled={sending}
                          onPress={() => handleRemove(item.localId)}
                          style={{
                            position: "absolute",
                            top: 2,
                            right: 2,
                            width: 20,
                            height: 20,
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor: c.surface0,
                            borderWidth: 1,
                            borderColor: c.border,
                          }}
                        >
                          <Icon name="X" size={12} color={c.foreground} />
                        </Pressable>
                      </View>
                      <View
                        style={{
                          paddingHorizontal: 4,
                          paddingVertical: 3,
                          borderTopWidth: 1,
                          borderTopColor: c.border,
                        }}
                      >
                        <Text
                          numberOfLines={1}
                          style={{ color: c.foregroundMuted, fontSize: 10 }}
                        >
                          {saved
                            ? `${formatBytes(item.compressedSize)}`
                            : formatBytes(item.originalSize)}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          ) : null}
        </View>
      )}

      <TextInput
        value={text}
        onChangeText={setText}
        editable={!sending}
        multiline
        placeholder="附带消息文字（留空会自动补 [图片] 发送）"
        placeholderTextColor={c.foregroundMuted}
        style={{
          minHeight: 62,
          maxHeight: 140,
          paddingHorizontal: 10,
          paddingVertical: 8,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface0,
          color: c.foreground,
          fontSize: 13,
          textAlignVertical: "top",
        }}
      />

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: keepOriginal }}
        accessibilityLabel="发送原图"
        disabled={sending || preparingCount > 0}
        onPress={() => void handleToggleOriginal()}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingVertical: 2,
        }}
      >
        <Icon
          name={keepOriginal ? "SquareCheck" : "Square"}
          size={14}
          color={keepOriginal ? c.accent : c.foregroundMuted}
        />
        <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
          发送原图（默认自动压缩至长边 ≤1600px，弱网更稳）
        </Text>
      </Pressable>

      {error ? (
        <Text style={{ color: c.statusDanger, fontSize: 12 }}>{error}</Text>
      ) : null}

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <Text style={{ color: c.foregroundMuted, fontSize: 12, flex: 1 }}>
          {preparingCount > 0
            ? "正在处理图片…"
            : staged.length > 0
              ? totalOrigBytes > totalBytes
                ? `${staged.length} 张 · ${formatBytes(totalOrigBytes)} → ${formatBytes(totalBytes)}`
                : `${staged.length} 张 · ${formatBytes(totalBytes)}`
              : "未选择图片"}
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="发送跨端图片"
          disabled={!canSend}
          onPress={() => void handleSend()}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 12,
            paddingVertical: 7,
            borderWidth: 1,
            borderColor: canSend ? c.accent : c.border,
            backgroundColor: canSend ? c.accent : c.surface2,
            opacity: !canSend ? 0.5 : pressed ? 0.88 : 1,
          })}
        >
          <Icon
            name="Send"
            size={13}
            color={canSend ? c.accentForeground : c.foregroundMuted}
          />
          <Text
            style={{
              color: canSend ? c.accentForeground : c.foregroundMuted,
              fontSize: 12,
              fontWeight: "600",
            }}
          >
            {sending ? "发送中…" : "发送"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

interface ImageSlotProps {
  meta: CrossImageMeta;
  displayWidth: number;
  displayHeight: number;
  cropMode: "contain" | "cover";
  theme: PluginTimelineItemProps["theme"];
  onOpen(uri: string): void;
}

function SharedImageSlot({
  meta,
  displayWidth,
  displayHeight,
  cropMode,
  theme,
  onOpen,
}: ImageSlotProps) {
  const c = theme.colors;
  const readBytes = useRpc(readCrossImageBytesRpc);
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState<boolean>(false);
  const [hovered, setHovered] = useState<boolean>(false);
  const [reloadTick, setReloadTick] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    void resolveCrossImagePreviewUri(meta.imageId, meta.mimeType, (imageId) =>
      readBytes({ imageId }),
    )
      .then((resolved) => {
        if (!cancelled) setUri(resolved);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [meta.imageId, meta.mimeType, readBytes, reloadTick]);

  if (failed) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`重新加载 ${meta.name}`}
        onPress={() => setReloadTick((n) => n + 1)}
        style={{
          width: displayWidth,
          height: Math.min(displayHeight, 120),
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface2,
          padding: 10,
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}
      >
        <Icon name="RotateCw" size={14} color={c.foregroundMuted} />
        <Text style={{ color: c.foregroundMuted, fontSize: 12, textAlign: "center" }}>
          图片不可用，点击重试
        </Text>
      </Pressable>
    );
  }

  if (!uri) {
    return (
      <View
        style={{
          width: displayWidth,
          height: displayHeight,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface2,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>加载图片…</Text>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`查看大图 ${meta.name}`}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPress={() => onOpen(uri)}
      style={{
        width: displayWidth,
        height: displayHeight,
        borderWidth: 1,
        borderColor: hovered ? c.accent : c.border,
        backgroundColor: c.surface0,
        overflow: "hidden",
      }}
    >
      <Image
        source={{ uri }}
        style={{ width: displayWidth, height: displayHeight }}
        resizeMode={cropMode}
      />
    </Pressable>
  );
}

export function FanframeCrossImageCard({
  item,
  theme,
  layout,
}: PluginTimelineItemProps<CrossImageTimelineData>) {
  const c = theme.colors;
  const compact = layout.compact;
  const images = item.data.images;
  const [lightbox, setLightbox] = useState<{ meta: CrossImageMeta; uri: string } | null>(null);

  const single = images.length === 1;
  const maxCardW = compact ? 300 : 420;
  const modalBox = lightbox
    ? computeFitSize(lightbox.meta.width, lightbox.meta.height, compact ? 320 : 720, 540)
    : null;

  return (
    <View style={{ alignItems: compact ? "stretch" : "flex-end", marginVertical: 4 }}>
      <View
        style={{
          maxWidth: compact ? "100%" : 460,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface1,
          padding: 6,
          gap: 6,
        }}
      >
        {single && images[0] ? (
          (() => {
            const first = images[0];
            const fit = computeFitSize(first.width, first.height, maxCardW, 340);
            return (
              <SharedImageSlot
                meta={first}
                displayWidth={fit.width}
                displayHeight={fit.height}
                cropMode="contain"
                theme={theme}
                onOpen={(uri) => setLightbox({ meta: first, uri })}
              />
            );
          })()
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {images.map((img) => (
              <SharedImageSlot
                key={img.imageId}
                meta={img}
                displayWidth={compact ? 136 : 168}
                displayHeight={compact ? 116 : 136}
                cropMode="cover"
                theme={theme}
                onOpen={(uri) => setLightbox({ meta: img, uri })}
              />
            ))}
          </View>
        )}

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            paddingHorizontal: 2,
          }}
        >
          <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 11, flexShrink: 1 }}>
            {single && images[0]
              ? `${images[0].width > 0 ? `${images[0].width}×${images[0].height} · ` : ""}${formatBytes(images[0].size)}`
              : `${images.length} 张图片`}
          </Text>
          <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>点击查看大图</Text>
        </View>
      </View>

      <Modal
        title={lightbox?.meta.name ?? "图片预览"}
        open={lightbox !== null}
        onOpenChange={(open) => {
          if (!open) setLightbox(null);
        }}
      >
        <Modal.Content>
          {lightbox && modalBox ? (
            <View style={{ alignItems: "center", gap: 10 }}>
              <View
                style={{
                  borderWidth: 1,
                  borderColor: c.border,
                  backgroundColor: c.surface0,
                }}
              >
                <Image
                  source={{ uri: lightbox.uri }}
                  style={{ width: modalBox.width, height: modalBox.height }}
                  resizeMode="contain"
                />
              </View>
              <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
                {lightbox.meta.width > 0
                  ? `${lightbox.meta.width} × ${lightbox.meta.height} · `
                  : ""}
                {formatBytes(lightbox.meta.size)} · {lightbox.meta.mimeType}
              </Text>
            </View>
          ) : null}
        </Modal.Content>
      </Modal>
    </View>
  );
}

export function contributeCrossImage(client: PluginClientContext): () => void {
  const removeRenderer = client.addTimelineRenderer({
    kind: CROSS_IMAGE_TIMELINE_KIND,
    version: CROSS_IMAGE_TIMELINE_VERSION,
    schema: crossImageTimelineDataSchema,
    Component: FanframeCrossImageCard,
  });

  const pills = new Map<string, PluginButtonRegistration>();
  const knownAgents = new Map<string, string>();
  const lifetime = new AbortController();
  let pillEnabled = readFanframePrefs().crossImagePill;

  const syncPill = (agentId: string, workspaceId: string) => {
    if (lifetime.signal.aborted || !pillEnabled) return;
    if (pills.has(agentId)) return;
    pills.set(
      agentId,
      client.addComposerPill({
        id: "fanframe-cross-image",
        workspaceId,
        agentId,
        button: {
          title: "跨端传图",
          label: "传图",
          icon: "ImagePlus",
          behavior: {
            kind: "popover",
            Content: CrossImagePopoverContent,
          },
        },
      }),
    );
  };

  const removeAllPills = () => {
    for (const reg of pills.values()) reg.remove();
    pills.clear();
  };

  const syncAllPills = () => {
    if (!pillEnabled) {
      removeAllPills();
      return;
    }
    for (const [agentId, workspaceId] of knownAgents) {
      syncPill(agentId, workspaceId);
    }
  };

  const unsubPrefs = subscribeFanframePrefs(() => {
    const next = readFanframePrefs().crossImagePill;
    if (next !== pillEnabled) {
      pillEnabled = next;
      syncAllPills();
    }
  });

  let releaseSubscription: (() => void) | null = null;
  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      if (lifetime.signal.aborted) {
        void subscription.release();
        return;
      }
      const unsub = subscription.subscribe({
        snapshot: ({ entries }) => {
          knownAgents.clear();
          removeAllPills();
          for (const { agent } of entries) {
            if (agent.workspaceId) {
              knownAgents.set(agent.id, agent.workspaceId);
              syncPill(agent.id, agent.workspaceId);
            }
          }
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const payload = message.payload;
          if (payload.kind === "upsert") {
            const { agent } = payload;
            if (agent.workspaceId) {
              knownAgents.set(agent.id, agent.workspaceId);
              syncPill(agent.id, agent.workspaceId);
            }
            return;
          }
          knownAgents.delete(payload.agentId);
          pills.get(payload.agentId)?.remove();
          pills.delete(payload.agentId);
        },
      });
      releaseSubscription = () => {
        unsub();
        void subscription.release();
      };
    })
    .catch((err) => {
      if (!lifetime.signal.aborted) {
        console.error("[fanframe] Cross-image agent observer failed:", err);
      }
    });

  return () => {
    lifetime.abort();
    unsubPrefs();
    releaseSubscription?.();
    removeAllPills();
    removeRenderer();
  };
}
