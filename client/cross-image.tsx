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
import { Animated, Easing, Image, Platform, Pressable, Text, View } from "react-native";
import {
  CROSS_FILE_READ_CHUNK_BYTES,
  CROSS_FILE_TIMELINE_KIND,
  CROSS_FILE_TIMELINE_VERSION,
  CROSS_FILE_UPLOAD_CHUNK_BYTES,
  MAX_CROSS_FILES_PER_MESSAGE,
  type CrossFileKind,
  type CrossFileMeta,
  type CrossFileTimelineData,
  abortCrossFileUploadRpc,
  beginCrossFileUploadRpc,
  crossFileTimelineDataSchema,
  finishCrossFileUploadRpc,
  putCrossFileChunkRpc,
  readCrossFileBytesRpc,
  sendCrossFileMessageRpc,
} from "../shared/cross-file";
import {
  CROSS_IMAGE_TIMELINE_KIND,
  CROSS_IMAGE_TIMELINE_VERSION,
  type CrossImageMeta,
  type CrossImageTimelineData,
  crossImageTimelineDataSchema,
  readCrossImageBytesRpc,
} from "../shared/cross-image";
import {
  type PreparedWebFile,
  attachWebPasteAndDrop,
  copyWebText,
  decodeUtf8Bytes,
  downloadWebFileBytes,
  openWebFilePicker,
  packCrossFileChunkPacket,
  prepareCrossFile,
  readFanframePrefs,
  resolveCrossImagePreviewUri,
  revokeWebPreviewUrl,
  subscribeFanframePrefs,
} from "./web";

interface StagedCrossFile extends PreparedWebFile {
  localId: string;
  rawFile: unknown;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function fileExtensionLabel(name: string, kind: CrossFileKind): string {
  const clean = name.trim();
  const dot = clean.lastIndexOf(".");
  if (dot > 0 && dot < clean.length - 1) {
    const ext = clean.slice(dot + 1).toUpperCase();
    if (ext.length <= 6) return ext;
  }
  return kind.toUpperCase();
}

function iconForFileKind(kind: CrossFileKind): "Image" | "Volume2" | "Film" | "FileText" | "Archive" | "File" {
  switch (kind) {
    case "image":
      return "Image";
    case "audio":
      return "Volume2";
    case "video":
      return "Film";
    case "pdf":
    case "text":
    case "document":
      return "FileText";
    case "archive":
      return "Archive";
    default:
      return "File";
  }
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

async function readCrossFileCompleteBytes(
  meta: CrossFileMeta,
  readChunk: (input: { fileId: string; offset?: number; length?: number }) => Promise<Uint8Array>,
  onProgress?: (ratio: number) => void,
): Promise<Uint8Array> {
  if (meta.size <= CROSS_FILE_READ_CHUNK_BYTES) {
    const data = await readChunk({ fileId: meta.fileId });
    onProgress?.(1);
    return data;
  }
  const out = new Uint8Array(meta.size);
  let offset = 0;
  while (offset < meta.size) {
    const length = Math.min(CROSS_FILE_READ_CHUNK_BYTES, meta.size - offset);
    const part = await readChunk({ fileId: meta.fileId, offset, length });
    if (part.byteLength === 0) break;
    out.set(part, offset);
    offset += part.byteLength;
    onProgress?.(Math.min(1, offset / meta.size));
  }
  return offset === meta.size ? out : out.subarray(0, offset);
}

let localFileSeq = 0;

function CrossFilePopoverContent(props: PluginButtonContentProps) {
  if (props.context !== "agent") return null;
  return <CrossFilePopoverBody {...props} />;
}

function CrossFilePopoverBody({
  agentId,
  theme,
  layout,
  close,
}: PluginButtonContentProps & { context: "agent" }) {
  const c = theme.colors;
  const compact = layout.compact;
  const isWeb = Platform.OS === "web";
  const toast = useToast();
  const beginUpload = useRpc(beginCrossFileUploadRpc);
  const putChunk = useRpc(putCrossFileChunkRpc);
  const finishUpload = useRpc(finishCrossFileUploadRpc);
  const abortUpload = useRpc(abortCrossFileUploadRpc);
  const sendMessage = useRpc(sendCrossFileMessageRpc);
  const composers = useComposers({ agentId });
  const composer = composers[0] ?? null;

  const [staged, setStaged] = useState<StagedCrossFile[]>([]);
  const [text, setText] = useState<string>("");
  const [keepOriginal, setKeepOriginal] = useState<boolean>(false);
  const [dragging, setDragging] = useState<boolean>(false);
  const [preparingCount, setPreparingCount] = useState<number>(0);
  const [sending, setSending] = useState<boolean>(false);
  const [uploadStatus, setUploadStatus] = useState<{ label: string; ratio: number } | null>(null);
  const [pickHover, setPickHover] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const dropHostRef = useRef<unknown>(null);
  const stagedRef = useRef<StagedCrossFile[]>([]);
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
      const room = MAX_CROSS_FILES_PER_MESSAGE - stagedRef.current.length;
      if (room <= 0) {
        setError(`单条消息最多发送 ${MAX_CROSS_FILES_PER_MESSAGE} 个文件。`);
        return;
      }
      const chosen = rawFiles.slice(0, room);
      const ignored = rawFiles.length - chosen.length;
      setError(
        ignored > 0 ? `已达到单次 ${MAX_CROSS_FILES_PER_MESSAGE} 个上限，多余文件已忽略。` : null,
      );
      setPreparingCount((n) => n + chosen.length);

      try {
        const nextItems: StagedCrossFile[] = [];
        for (const rawFile of chosen) {
          try {
            const prepared = await prepareCrossFile(rawFile, { keepOriginal: originalFlag });
            if (!aliveRef.current) {
              revokeWebPreviewUrl(prepared.previewUrl);
              return;
            }
            nextItems.push({
              ...prepared,
              localId: `staged-${++localFileSeq}`,
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
            const allowed = Math.max(0, MAX_CROSS_FILES_PER_MESSAGE - prev.length);
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
    const hasImages = current.some((entry) => entry.kind === "image");
    if (!hasImages || !isWeb) return;

    const imageCount = current.filter((entry) => entry.kind === "image").length;
    setPreparingCount(imageCount);
    setError(null);
    try {
      const rebuilt: StagedCrossFile[] = [];
      for (const entry of current) {
        if (entry.kind !== "image") {
          rebuilt.push(entry);
          continue;
        }
        try {
          const prepared = await prepareCrossFile(entry.rawFile, { keepOriginal: nextKeep });
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
          if (
            oldEntry.previewUrl &&
            !rebuilt.some((item) => item.previewUrl === oldEntry.previewUrl)
          ) {
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
    pickerCleanupRef.current = openWebFilePicker((files) => {
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
    const totalUploadBytes = Math.max(
      1,
      staged.reduce((sum, item) => sum + item.bytes.byteLength, 0),
    );
    let uploadedBytesSoFar = 0;

    try {
      const uploadedIds: string[] = [];
      for (let i = 0; i < staged.length; i++) {
        const item = staged[i]!;
        const totalChunks = Math.max(
          1,
          Math.ceil(item.bytes.byteLength / CROSS_FILE_UPLOAD_CHUNK_BYTES),
        );
        const { uploadId } = await beginUpload({
          agentId,
          name: item.name,
          mimeType: item.mimeType,
          size: item.bytes.byteLength,
          width: item.width,
          height: item.height,
          totalChunks,
        });

        try {
          for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
            const start = chunkIndex * CROSS_FILE_UPLOAD_CHUNK_BYTES;
            const end = Math.min(item.bytes.byteLength, start + CROSS_FILE_UPLOAD_CHUNK_BYTES);
            const slice = item.bytes.subarray(start, end);
            const packet = packCrossFileChunkPacket({ uploadId, chunkIndex }, slice);
            await putChunk(packet);
            uploadedBytesSoFar += slice.byteLength;
            if (aliveRef.current) {
              const ratio = Math.min(1, uploadedBytesSoFar / totalUploadBytes);
              setUploadStatus({
                label: `正在上传 ${i + 1}/${staged.length} · ${Math.round(ratio * 100)}%`,
                ratio,
              });
            }
          }
          const meta = await finishUpload({ uploadId });
          uploadedIds.push(meta.fileId);
        } catch (chunkErr) {
          await abortUpload({ uploadId }).catch(() => undefined);
          throw chunkErr;
        }
      }

      if (aliveRef.current) {
        setUploadStatus({ label: "正在发送给 AI…", ratio: 1 });
      }

      const res = await sendMessage({
        agentId,
        text,
        fileIds: uploadedIds,
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
      toast.show("已发送文件并同步到所有端", { variant: "success" });
      close();
    } catch (sendErr) {
      setError(sendErr instanceof Error ? sendErr.message : String(sendErr));
    } finally {
      if (aliveRef.current) {
        setSending(false);
        setUploadStatus(null);
      }
    }
  };

  const stagedImages = staged.filter((item) => item.kind === "image" && item.previewUrl);
  const stagedNonImages = staged.filter((item) => !(item.kind === "image" && item.previewUrl));
  const totalBytes = staged.reduce((sum, item) => sum + item.compressedSize, 0);
  const totalOrigBytes = staged.reduce((sum, item) => sum + item.originalSize, 0);
  const canSend = isWeb && staged.length > 0 && !sending && preparingCount === 0;

  return (
    <View
      ref={dropHostRef as never}
      style={{
        width: compact ? undefined : 424,
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
            跨端传文件
          </Text>
          <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
            {staged.length > 0
              ? `${staged.length} / ${MAX_CROSS_FILES_PER_MESSAGE}`
              : "支持图片与任意文件（单文件 ≤50 MB）"}
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
            请在桌面端或手机浏览器使用 FanFrame 传文件选择、拖拽或粘贴上传。
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
              testID="fanframe-file-pick-button"
              accessibilityRole="button"
              accessibilityLabel="选择文件"
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
                选择文件
              </Text>
            </Pressable>

            <Text style={{ color: c.foregroundMuted, fontSize: 12, flexShrink: 1 }}>
              {dragging ? "松开以添加文件" : "支持拖拽、多选或 Ctrl+V 粘贴"}
            </Text>
          </View>

          {stagedImages.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {stagedImages.map((item) => {
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
                          source={{ uri: item.previewUrl! }}
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

          {stagedNonImages.length > 0 ? (
            <ScrollView style={{ maxHeight: 168 }}>
              <View style={{ gap: 6 }}>
                {stagedNonImages.map((item) => (
                  <View
                    key={item.localId}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      paddingHorizontal: 8,
                      paddingVertical: 6,
                      borderWidth: 1,
                      borderColor: c.border,
                      backgroundColor: c.surface1,
                    }}
                  >
                    <View
                      style={{
                        width: 24,
                        height: 24,
                        alignItems: "center",
                        justifyContent: "center",
                        borderWidth: 1,
                        borderColor: c.border,
                        backgroundColor: c.surface0,
                      }}
                    >
                      <Icon name={iconForFileKind(item.kind)} size={13} color={c.accent} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                      <Text
                        numberOfLines={1}
                        style={{ color: c.foreground, fontSize: 12, fontWeight: "500" }}
                      >
                        {item.name}
                      </Text>
                      <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 10.5 }}>
                        {fileExtensionLabel(item.name, item.kind)} · {formatBytes(item.originalSize)}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`移除 ${item.name}`}
                      disabled={sending}
                      onPress={() => handleRemove(item.localId)}
                      style={{
                        width: 22,
                        height: 22,
                        alignItems: "center",
                        justifyContent: "center",
                        borderWidth: 1,
                        borderColor: c.border,
                        backgroundColor: c.surface0,
                      }}
                    >
                      <Icon name="X" size={12} color={c.foregroundMuted} />
                    </Pressable>
                  </View>
                ))}
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
        placeholder="附带消息文字（留空会自动补占位提示发送）"
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
        accessibilityLabel="图片发送原图"
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
          图片发送原图（图片默认压缩至长边 ≤1600px，其他文件原样发送）
        </Text>
      </Pressable>

      {uploadStatus ? (
        <View style={{ gap: 4 }}>
          <View style={{ width: "100%", height: 2, backgroundColor: c.surface2, overflow: "hidden" }}>
            <View
              style={{
                width: `${Math.round(uploadStatus.ratio * 100)}%` as `${number}%`,
                height: "100%",
                backgroundColor: c.accent,
              }}
            />
          </View>
          <Text style={{ color: c.foregroundMuted, fontSize: 11.5 }}>{uploadStatus.label}</Text>
        </View>
      ) : null}

      {error ? <Text style={{ color: c.statusDanger, fontSize: 12 }}>{error}</Text> : null}

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
            ? "正在处理文件…"
            : staged.length > 0
              ? totalOrigBytes > totalBytes
                ? `${staged.length} 个文件 · ${formatBytes(totalOrigBytes)} → ${formatBytes(totalBytes)}`
                : `${staged.length} 个文件 · ${formatBytes(totalBytes)}`
              : "未选择文件"}
        </Text>

        <Pressable
          testID="fanframe-file-send-button"
          accessibilityRole="button"
          accessibilityLabel="发送跨端文件"
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
  cacheKey: string;
  name: string;
  mimeType: string;
  size: number;
  displayWidth: number;
  displayHeight: number;
  cropMode: "contain" | "cover";
  theme: PluginTimelineItemProps["theme"];
  readBytes: () => Promise<Uint8Array>;
  onOpen(uri: string): void;
}

function CrossImageLoadingBox({
  width,
  height,
  sizeBytes,
  theme,
}: {
  width: number;
  height: number;
  sizeBytes: number;
  theme: PluginTimelineItemProps["theme"];
}) {
  const c = theme.colors;
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1150,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false,
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [progress]);

  const left = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ["-38%", "100%"],
  });

  return (
    <View
      style={{
        width,
        height,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface1,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          width: "100%",
          height: 2,
          backgroundColor: c.surface2,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <Animated.View
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            width: "38%",
            left,
            backgroundColor: c.accent,
          }}
        />
      </View>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 6, padding: 8 }}>
        <Icon name="Image" size={18} color={c.foregroundMuted} />
        <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
          载入图片{sizeBytes > 0 ? ` · ${formatBytes(sizeBytes)}` : "..."}
        </Text>
      </View>
    </View>
  );
}

function SharedImageSlot({
  cacheKey,
  name,
  mimeType,
  size,
  displayWidth,
  displayHeight,
  cropMode,
  theme,
  readBytes,
  onOpen,
}: ImageSlotProps) {
  const c = theme.colors;
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState<boolean>(false);
  const [hovered, setHovered] = useState<boolean>(false);
  const [reloadTick, setReloadTick] = useState<number>(0);

  const readBytesRef = useRef(readBytes);
  readBytesRef.current = readBytes;

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    const normalizedMime = (
      mimeType === "image/png" ||
      mimeType === "image/webp" ||
      mimeType === "image/gif"
        ? mimeType
        : "image/jpeg"
    ) as "image/jpeg" | "image/png" | "image/webp" | "image/gif";
    void resolveCrossImagePreviewUri(cacheKey, normalizedMime, () => readBytesRef.current())
      .then((resolved) => {
        if (!cancelled) setUri(resolved);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey, mimeType, reloadTick]);

  if (failed) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`重新加载 ${name}`}
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
      <CrossImageLoadingBox
        width={displayWidth}
        height={displayHeight}
        sizeBytes={size}
        theme={theme}
      />
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`查看大图 ${name}`}
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

function SharedFileAttachmentRow({
  meta,
  theme,
}: {
  meta: CrossFileMeta;
  theme: PluginTimelineItemProps["theme"];
}) {
  const c = theme.colors;
  const isWeb = Platform.OS === "web";
  const toast = useToast();
  const readChunk = useRpc(readCrossFileBytesRpc);

  const [downloading, setDownloading] = useState(false);
  const [downloadPct, setDownloadPct] = useState<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);

  const canPreviewText = meta.kind === "text" && meta.size <= 2 * 1024 * 1024;

  const handleDownload = async () => {
    if (!isWeb || downloading) return;
    setDownloading(true);
    setDownloadPct(null);
    try {
      const bytes = await readCrossFileCompleteBytes(meta, readChunk, (ratio) => {
        if (meta.size > CROSS_FILE_READ_CHUNK_BYTES) {
          setDownloadPct(Math.round(ratio * 100));
        }
      });
      downloadWebFileBytes(bytes, meta.mimeType, meta.name);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "下载文件失败");
    } finally {
      setDownloading(false);
      setDownloadPct(null);
    }
  };

  const handleCopyPath = async () => {
    if (!meta.path) return;
    const ok = await copyWebText(meta.path);
    if (ok) {
      toast.show("已复制主机文件路径", { variant: "success" });
    } else {
      toast.error("复制失败");
    }
  };

  const handleTogglePreview = async () => {
    const next = !previewOpen;
    setPreviewOpen(next);
    if (!next || previewText !== null || previewLoading) return;
    setPreviewLoading(true);
    try {
      const bytes = await readCrossFileCompleteBytes(meta, readChunk);
      setPreviewText(decodeUtf8Bytes(bytes, 32768));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "读取文件内容失败");
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <View
      testID="fanframe-cross-file-row"
      style={{
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface0,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          paddingHorizontal: 9,
          paddingVertical: 7,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
          <View
            style={{
              width: 26,
              height: 26,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: c.border,
              backgroundColor: c.surface1,
            }}
          >
            <Icon name={iconForFileKind(meta.kind)} size={13} color={c.accent} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            <Text
              numberOfLines={1}
              style={{ color: c.foreground, fontSize: 12.5, fontWeight: "600" }}
            >
              {meta.name}
            </Text>
            <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 11 }}>
              {fileExtensionLabel(meta.name, meta.kind)} · {formatBytes(meta.size)}
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          {canPreviewText ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${previewOpen ? "收起" : "预览"} ${meta.name}`}
              onHoverIn={() => setHoveredBtn("preview")}
              onHoverOut={() => setHoveredBtn(null)}
              onPress={() => void handleTogglePreview()}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                paddingHorizontal: 7,
                paddingVertical: 4,
                borderWidth: 1,
                borderColor: hoveredBtn === "preview" ? c.accent : c.border,
                backgroundColor: c.surface1,
              }}
            >
              <Icon
                name={previewOpen ? "ChevronUp" : "Eye"}
                size={12}
                color={hoveredBtn === "preview" ? c.foreground : c.foregroundMuted}
              />
              <Text
                style={{
                  color: hoveredBtn === "preview" ? c.foreground : c.foregroundMuted,
                  fontSize: 11,
                }}
              >
                {previewOpen ? "收起" : "预览"}
              </Text>
            </Pressable>
          ) : null}

          {isWeb && meta.path ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`复制路径 ${meta.name}`}
              onHoverIn={() => setHoveredBtn("copy")}
              onHoverOut={() => setHoveredBtn(null)}
              onPress={() => void handleCopyPath()}
              style={{
                width: 26,
                height: 24,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: hoveredBtn === "copy" ? c.accent : c.border,
                backgroundColor: c.surface1,
              }}
            >
              <Icon
                name="Copy"
                size={12}
                color={hoveredBtn === "copy" ? c.foreground : c.foregroundMuted}
              />
            </Pressable>
          ) : null}

          {isWeb ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`下载 ${meta.name}`}
              disabled={downloading}
              onHoverIn={() => setHoveredBtn("download")}
              onHoverOut={() => setHoveredBtn(null)}
              onPress={() => void handleDownload()}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                paddingHorizontal: 7,
                paddingVertical: 4,
                borderWidth: 1,
                borderColor: hoveredBtn === "download" ? c.accent : c.border,
                backgroundColor: c.surface1,
                opacity: downloading ? 0.65 : 1,
              }}
            >
              <Icon
                name="Download"
                size={12}
                color={hoveredBtn === "download" ? c.foreground : c.foregroundMuted}
              />
              <Text
                style={{
                  color: hoveredBtn === "download" ? c.foreground : c.foregroundMuted,
                  fontSize: 11,
                }}
              >
                {downloading ? (downloadPct !== null ? `${downloadPct}%` : "…") : "下载"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {previewOpen ? (
        <View style={{ borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.surface1 }}>
          {previewLoading ? (
            <Text style={{ color: c.foregroundMuted, fontSize: 11.5, padding: 9 }}>
              正在读取文件内容…
            </Text>
          ) : (
            <ScrollView style={{ maxHeight: 260, padding: 9 }}>
              <Text selectable style={{ color: c.foreground, fontSize: 11.5, lineHeight: 17 }}>
                {previewText ?? ""}
              </Text>
            </ScrollView>
          )}
        </View>
      ) : null}
    </View>
  );
}

export function FanframeCrossFileCard({
  item,
  theme,
  layout,
}: PluginTimelineItemProps<CrossFileTimelineData>) {
  const c = theme.colors;
  const compact = layout.compact;
  const readChunk = useRpc(readCrossFileBytesRpc);
  const files = item.data.files;
  const imageFiles = files.filter((f) => f.kind === "image");
  const otherFiles = files.filter((f) => f.kind !== "image");
  const [lightbox, setLightbox] = useState<{ meta: CrossFileMeta; uri: string } | null>(null);

  const singleImageOnly = imageFiles.length === 1 && otherFiles.length === 0;
  const maxCardW = compact ? 300 : 420;
  const modalBox = lightbox
    ? computeFitSize(lightbox.meta.width, lightbox.meta.height, compact ? 320 : 720, 540)
    : null;
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <View
      testID="fanframe-cross-file-card"
      style={{ alignItems: compact ? "stretch" : "flex-end", marginVertical: 4 }}
    >
      <View
        style={{
          width: otherFiles.length > 0 ? (compact ? "100%" : 420) : undefined,
          maxWidth: compact ? "100%" : 460,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface1,
          padding: 6,
          gap: 6,
        }}
      >
        {imageFiles.length > 0 ? (
          singleImageOnly && imageFiles[0] ? (
            (() => {
              const first = imageFiles[0];
              const fit = computeFitSize(first.width, first.height, maxCardW, 340);
              return (
                <SharedImageSlot
                  cacheKey={first.fileId}
                  name={first.name}
                  mimeType={first.mimeType}
                  size={first.size}
                  displayWidth={fit.width}
                  displayHeight={fit.height}
                  cropMode="contain"
                  theme={theme}
                  readBytes={() => readCrossFileCompleteBytes(first, readChunk)}
                  onOpen={(uri) => setLightbox({ meta: first, uri })}
                />
              );
            })()
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {imageFiles.map((img) => (
                <SharedImageSlot
                  key={img.fileId}
                  cacheKey={img.fileId}
                  name={img.name}
                  mimeType={img.mimeType}
                  size={img.size}
                  displayWidth={compact ? 136 : 168}
                  displayHeight={compact ? 116 : 136}
                  cropMode="cover"
                  theme={theme}
                  readBytes={() => readCrossFileCompleteBytes(img, readChunk)}
                  onOpen={(uri) => setLightbox({ meta: img, uri })}
                />
              ))}
            </View>
          )
        ) : null}

        {otherFiles.length > 0 ? (
          <View style={{ gap: 6 }}>
            {otherFiles.map((file) => (
              <SharedFileAttachmentRow key={file.fileId} meta={file} theme={theme} />
            ))}
          </View>
        ) : null}

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
            {singleImageOnly && imageFiles[0]
              ? `${imageFiles[0].width > 0 ? `${imageFiles[0].width}×${imageFiles[0].height} · ` : ""}${formatBytes(imageFiles[0].size)}`
              : `${files.length} 个文件 · ${formatBytes(totalSize)}`}
          </Text>
          {imageFiles.length > 0 ? (
            <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>点击图片查看大图</Text>
          ) : (
            <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>已同步至主机</Text>
          )}
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

/** Legacy v1 image-only card renderer kept for backward compatibility with older timeline entries. */
export function FanframeCrossImageCard({
  item,
  theme,
  layout,
}: PluginTimelineItemProps<CrossImageTimelineData>) {
  const c = theme.colors;
  const compact = layout.compact;
  const readBytes = useRpc(readCrossImageBytesRpc);
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
                cacheKey={first.imageId}
                name={first.name}
                mimeType={first.mimeType}
                size={first.size}
                displayWidth={fit.width}
                displayHeight={fit.height}
                cropMode="contain"
                theme={theme}
                readBytes={() => readBytes({ imageId: first.imageId })}
                onOpen={(uri) => setLightbox({ meta: first, uri })}
              />
            );
          })()
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {images.map((img) => (
              <SharedImageSlot
                key={img.imageId}
                cacheKey={img.imageId}
                name={img.name}
                mimeType={img.mimeType}
                size={img.size}
                displayWidth={compact ? 136 : 168}
                displayHeight={compact ? 116 : 136}
                cropMode="cover"
                theme={theme}
                readBytes={() => readBytes({ imageId: img.imageId })}
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
  const removeLegacyRenderer = client.addTimelineRenderer({
    kind: CROSS_IMAGE_TIMELINE_KIND,
    version: CROSS_IMAGE_TIMELINE_VERSION,
    schema: crossImageTimelineDataSchema,
    Component: FanframeCrossImageCard,
  });

  const removeFileRenderer = client.addTimelineRenderer({
    kind: CROSS_FILE_TIMELINE_KIND,
    version: CROSS_FILE_TIMELINE_VERSION,
    schema: crossFileTimelineDataSchema,
    Component: FanframeCrossFileCard,
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
          title: "跨端传文件",
          label: "传文件",
          icon: "Paperclip",
          behavior: {
            kind: "popover",
            Content: CrossFilePopoverContent,
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
        console.error("[fanframe] Cross-file agent observer failed:", err);
      }
    });

  return () => {
    lifetime.abort();
    unsubPrefs();
    releaseSubscription?.();
    removeAllPills();
    removeFileRenderer();
    removeLegacyRenderer();
  };
}
