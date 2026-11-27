import {
  type PluginClientContext,
  type PluginTimelineItemProps,
  useRpc,
  useSettings,
} from "@getpaseo/plugin/client";
import { Icon, Markdown, Modal, ScrollView, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, Platform, Pressable, Text, View } from "react-native";
import {
  inspectMediaRpc,
  mediaAccessSettings,
  readMediaBytesRpc,
  type MediaKind,
} from "../shared/media";
import {
  RICH_MESSAGE_TIMELINE_KIND,
  RICH_MESSAGE_TIMELINE_VERSION,
  type RichMessageTimelineData,
  parseRichMessageSegments,
  richMessageTimelineDataSchema,
} from "../shared/rich-message";
import { getVisualizeCardRpc } from "../shared/visualize";
import {
  type CachedMediaMeta,
  type WebMediaPlayerHandle,
  type WebMediaPlayerState,
  bindWebScrubber,
  buildMediaCacheKey,
  createWebBlobUrl,
  createWebMediaPlayer,
  decodeUtf8Bytes,
  encodeBytesToDataUri,
  getMemoryCachedMedia,
  invalidateMediaCacheEntry,
  mountVisualizeCard,
  mountWebMediaElement,
  putMemoryCachedMedia,
  readPersistentCachedMedia,
  writePersistentCachedMedia,
} from "./web";

function formatMediaTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

function inferKindFromPath(rawPath: string): MediaKind | null {
  const clean = rawPath.trim().split(/[?#]/)[0] ?? "";
  const dot = clean.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = clean.slice(dot).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) return "image";
  if ([".mp3", ".wav", ".ogg", ".m4a", ".flac"].includes(ext)) return "audio";
  if ([".mp4", ".webm", ".mov", ".m4v"].includes(ext)) return "video";
  if (ext === ".pdf") return "pdf";
  if ([".txt", ".md", ".csv", ".tsv", ".json"].includes(ext)) return "text";
  return null;
}

function FanframeProgressBar({
  color,
  trackColor,
  height = 2,
  progress = null,
}: {
  color: string;
  trackColor: string;
  height?: number;
  /** Determinate ratio in [0, 1]; omit or pass null for indeterminate loading sweep. */
  progress?: number | null;
}) {
  const sweep = useRef(new Animated.Value(0)).current;
  const determinate = useRef(new Animated.Value(progress ?? 0)).current;
  const isDeterminate = typeof progress === "number" && Number.isFinite(progress);

  useEffect(() => {
    if (isDeterminate) return;
    sweep.setValue(0);
    const anim = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 1150,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false,
      }),
    );
    anim.start();
    return () => {
      anim.stop();
    };
  }, [sweep, isDeterminate]);

  useEffect(() => {
    if (!isDeterminate) return;
    const clamped = Math.max(0, Math.min(1, progress));
    const anim = Animated.timing(determinate, {
      toValue: clamped,
      duration: 110,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    anim.start();
    return () => {
      anim.stop();
    };
  }, [determinate, isDeterminate, progress]);

  const left = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: ["-38%", "100%"],
  });

  const width = determinate.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  return (
    <View
      testID="fanframe-loading-progress-bar"
      style={{
        width: "100%",
        height,
        backgroundColor: trackColor,
        overflow: "hidden",
        position: "relative",
      }}
    >
      {isDeterminate ? (
        <Animated.View
          testID="fanframe-loading-progress-fill"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width,
            backgroundColor: color,
          }}
        />
      ) : (
        <Animated.View
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            width: "38%",
            left,
            backgroundColor: color,
          }}
        />
      )}
    </View>
  );
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isDarkHex(hex: string): boolean {
  const clean = hex.replace("#", "").trim();
  if (clean.length !== 6) return true;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return true;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}

interface MediaMeta extends CachedMediaMeta {
  supportsChunks?: boolean;
}

interface MediaDownloadProgress {
  loaded: number;
  total: number;
  ratio: number;
}

interface InflightMediaDownload {
  promise: Promise<Uint8Array>;
  latestProgress: MediaDownloadProgress | null;
  listeners: Set<(progress: MediaDownloadProgress) => void>;
}

const inflightMediaDownloads = new Map<string, InflightMediaDownload>();
const MEDIA_CACHE_REVALIDATE_MS = 60 * 1000;

function chooseMediaChunkSize(totalSize: number): number {
  if (totalSize <= 512 * 1024) return Math.max(1, totalSize);
  if (totalSize <= 4 * 1024 * 1024) return 256 * 1024;
  if (totalSize <= 20 * 1024 * 1024) return 512 * 1024;
  return 1024 * 1024;
}

function cacheMatchesInspect(
  cachedMeta: CachedMediaMeta,
  inspected: { size: number; mtimeMs?: number; mime: string; kind: MediaKind },
): boolean {
  if (cachedMeta.kind !== inspected.kind || cachedMeta.mime !== inspected.mime) return false;
  if (cachedMeta.size !== inspected.size) return false;
  if (
    typeof inspected.mtimeMs === "number" &&
    typeof cachedMeta.mtimeMs === "number" &&
    cachedMeta.mtimeMs !== inspected.mtimeMs
  ) {
    return false;
  }
  return true;
}

function downloadMediaWithProgress(
  cacheKey: string,
  meta: MediaMeta,
  readChunk: (input: {
    agentId: string;
    path: string;
    offset?: number;
    length?: number;
  }) => Promise<Uint8Array>,
  agentId: string,
  path: string,
  onProgress?: (progress: MediaDownloadProgress) => void,
): Promise<Uint8Array> {
  const existing = inflightMediaDownloads.get(cacheKey);
  if (existing) {
    if (onProgress) {
      if (existing.latestProgress) onProgress(existing.latestProgress);
      existing.listeners.add(onProgress);
      void existing.promise.finally(() => {
        existing.listeners.delete(onProgress);
      });
    }
    return existing.promise;
  }

  const listeners = new Set<(progress: MediaDownloadProgress) => void>();
  if (onProgress) listeners.add(onProgress);

  const entry: InflightMediaDownload = {
    promise: Promise.resolve(new Uint8Array(0)),
    latestProgress: null,
    listeners,
  };

  const emitProgress = (loaded: number, total: number) => {
    const safeTotal = Math.max(1, total);
    const ratio = Math.max(0, Math.min(1, loaded / safeTotal));
    const snapshot: MediaDownloadProgress = { loaded, total: safeTotal, ratio };
    entry.latestProgress = snapshot;
    for (const listener of entry.listeners) {
      listener(snapshot);
    }
  };

  const task = (async (): Promise<Uint8Array> => {
    const total = meta.size;
    const useChunks = Boolean(meta.supportsChunks) && total > 256 * 1024;
    if (!useChunks) {
      const data = await readChunk({ agentId, path });
      if (total > 0) emitProgress(data.byteLength, Math.max(total, data.byteLength));
      return data;
    }

    const chunkSize = chooseMediaChunkSize(total);
    emitProgress(0, total);
    const out = new Uint8Array(total);
    let offset = 0;
    while (offset < total) {
      const length = Math.min(chunkSize, total - offset);
      const part = await readChunk({ agentId, path, offset, length });
      if (part.byteLength === 0) break;
      const copyLen = Math.min(part.byteLength, total - offset);
      out.set(part.subarray(0, copyLen), offset);
      offset += copyLen;
      emitProgress(offset, total);
    }
    return offset === total ? out : out.subarray(0, offset);
  })().finally(() => {
    inflightMediaDownloads.delete(cacheKey);
    entry.listeners.clear();
  });

  entry.promise = task;
  inflightMediaDownloads.set(cacheKey, entry);
  return task;
}

function resolveImageDimensions(uri: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    Image.getSize(
      uri,
      (w, h) => resolve(w > 0 && h > 0 ? { w, h } : null),
      () => resolve(null),
    );
  });
}

function FanframeMediaPlayer({
  kind,
  bytes,
  mime,
  filename,
  theme,
  compact,
}: {
  kind: "audio" | "video";
  bytes: Uint8Array;
  mime: string;
  filename: string;
  theme: PluginTimelineItemProps["theme"];
  compact: boolean;
}) {
  const c = theme.colors;
  const mediaHostRef = useRef<unknown>(null);
  const scrubRef = useRef<unknown>(null);
  const playerRef = useRef<WebMediaPlayerHandle | null>(null);

  const [state, setState] = useState<WebMediaPlayerState>({
    playing: false,
    currentTime: 0,
    duration: 0,
    muted: false,
    ready: false,
    ended: false,
  });
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);
  const [scrubActive, setScrubActive] = useState(false);
  const [scrubPreviewRatio, setScrubPreviewRatio] = useState<number | null>(null);

  useEffect(() => {
    if (Platform.OS !== "web" || !mediaHostRef.current) return;
    const handle = createWebMediaPlayer(mediaHostRef.current, {
      kind,
      bytes,
      mime,
      filename,
      onState: setState,
    });
    playerRef.current = handle;
    return () => {
      playerRef.current = null;
      handle?.destroy();
    };
  }, [kind, bytes, mime, filename]);

  useEffect(() => {
    if (Platform.OS !== "web" || !scrubRef.current) return;
    return bindWebScrubber(
      scrubRef.current,
      (ratio) => {
        setScrubPreviewRatio(ratio);
        playerRef.current?.seekRatio(ratio);
      },
      (scrubbing) => {
        setScrubActive(scrubbing);
        if (!scrubbing) setScrubPreviewRatio(null);
      },
    );
  }, []);

  const liveProgress =
    state.duration > 0 ? Math.max(0, Math.min(1, state.currentTime / state.duration)) : 0;
  const displayProgress = scrubActive && scrubPreviewRatio !== null ? scrubPreviewRatio : liveProgress;
  const displayTime =
    scrubActive && scrubPreviewRatio !== null && state.duration > 0
      ? scrubPreviewRatio * state.duration
      : state.currentTime;
  const pct = `${(displayProgress * 100).toFixed(2)}%` as `${number}%`;
  const playSize = compact ? 32 : 28;
  const utilSize = compact ? 30 : 26;
  const thumbSize = scrubActive ? 12 : compact ? 10 : state.playing ? 8 : 7;

  return (
    <View testID={`fanframe-custom-${kind}-player`}>
      {/* Video frame (or hidden audio host) */}
      <View
        style={
          kind === "video"
            ? { width: "100%", backgroundColor: "#000", overflow: "hidden", position: "relative" }
            : { height: 0, width: 0, overflow: "hidden" }
        }
      >
        <View ref={mediaHostRef as never} style={{ width: "100%" }} />
        {kind === "video" && !state.playing ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="播放视频"
            onPress={() => playerRef.current?.togglePlay()}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(16, 18, 22, 0.24)",
            }}
          >
            <View
              style={{
                width: 44,
                height: 44,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: c.accent,
                backgroundColor: "rgba(28, 30, 35, 0.86)",
              }}
            >
              <Icon name="Play" size={18} color={c.foreground} />
            </View>
          </Pressable>
        ) : null}
      </View>

      {/* FanFrame sharp minimal transport bar */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: compact ? 8 : 10,
          paddingHorizontal: compact ? 8 : 10,
          paddingVertical: compact ? 6 : 8,
          backgroundColor: c.surface0,
          ...(kind === "video" ? { borderTopWidth: 1, borderTopColor: c.border } : {}),
        }}
      >
        {/* Play / Pause */}
        <Pressable
          testID="fanframe-player-play"
          accessibilityRole="button"
          accessibilityLabel={state.playing ? "暂停" : "播放"}
          onPress={() => playerRef.current?.togglePlay()}
          onHoverIn={() => setHoveredBtn("play")}
          onHoverOut={() => setHoveredBtn(null)}
          style={{
            width: playSize,
            height: playSize,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: state.playing || hoveredBtn === "play" ? c.accent : c.border,
            backgroundColor: state.playing ? c.accent : hoveredBtn === "play" ? c.surface2 : c.surface1,
          }}
        >
          <Icon
            name={state.playing ? "Pause" : "Play"}
            size={compact ? 14 : 13}
            color={state.playing ? c.accentForeground : c.foreground}
          />
        </Pressable>

        {/* Time readout */}
        <Text
          style={{
            color: scrubActive ? c.foreground : c.foregroundMuted,
            fontSize: 11.5,
            fontVariant: ["tabular-nums"],
            minWidth: compact ? 64 : 70,
          }}
        >
          {formatMediaTime(displayTime)} / {state.duration > 0 ? formatMediaTime(state.duration) : "--:--"}
        </Text>

        {/* Touch-friendly scrubber track (plain View so RNW Pressable never swallows mobile touch drags) */}
        <View
          ref={scrubRef as never}
          testID="fanframe-player-scrubber"
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="播放进度"
          style={{
            flex: 1,
            minWidth: 64,
            height: compact ? 36 : 28,
            justifyContent: "center",
            paddingHorizontal: 2,
          }}
        >
          <View
            pointerEvents="none"
            style={{
              width: "100%",
              height: scrubActive ? 4 : compact ? 3 : 2,
              backgroundColor: c.surface2,
              position: "relative",
              justifyContent: "center",
            }}
          >
            <View
              style={{
                width: pct,
                height: "100%",
                backgroundColor: c.accent,
              }}
            />
            <View
              style={{
                position: "absolute",
                left: pct,
                width: thumbSize,
                height: thumbSize,
                marginLeft: -(thumbSize / 2),
                backgroundColor: scrubActive ? c.foreground : c.accent,
                borderWidth: 1,
                borderColor: c.surface0,
              }}
            />
          </View>
        </View>

        {/* Mute toggle */}
        <Pressable
          testID="fanframe-player-mute"
          accessibilityRole="button"
          accessibilityLabel={state.muted ? "取消静音" : "静音"}
          onPress={() => playerRef.current?.toggleMute()}
          onHoverIn={() => setHoveredBtn("mute")}
          onHoverOut={() => setHoveredBtn(null)}
          style={{
            width: utilSize,
            height: utilSize,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: hoveredBtn === "mute" ? c.accent : "transparent",
            backgroundColor: hoveredBtn === "mute" ? c.surface2 : "transparent",
          }}
        >
          <Icon
            name={state.muted ? "VolumeX" : "Volume2"}
            size={compact ? 14 : 13}
            color={state.muted ? c.foregroundMuted : c.foreground}
          />
        </Pressable>

        {/* Fullscreen (video only) */}
        {kind === "video" ? (
          <Pressable
            testID="fanframe-player-fullscreen"
            accessibilityRole="button"
            accessibilityLabel="全屏播放"
            onPress={() => playerRef.current?.toggleFullscreen()}
            onHoverIn={() => setHoveredBtn("fs")}
            onHoverOut={() => setHoveredBtn(null)}
            style={{
              width: utilSize,
              height: utilSize,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: hoveredBtn === "fs" ? c.accent : "transparent",
              backgroundColor: hoveredBtn === "fs" ? c.surface2 : "transparent",
            }}
          >
            <Icon name="Maximize2" size={compact ? 14 : 13} color={c.foregroundMuted} />
          </Pressable>
        ) : null}

        {/* Download */}
        <Pressable
          testID="fanframe-player-download"
          accessibilityRole="button"
          accessibilityLabel="下载文件"
          onPress={() => playerRef.current?.download()}
          onHoverIn={() => setHoveredBtn("dl")}
          onHoverOut={() => setHoveredBtn(null)}
          style={{
            width: utilSize,
            height: utilSize,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: hoveredBtn === "dl" ? c.accent : "transparent",
            backgroundColor: hoveredBtn === "dl" ? c.surface2 : "transparent",
          }}
        >
          <Icon name="Download" size={compact ? 14 : 13} color={c.foregroundMuted} />
        </Pressable>
      </View>
    </View>
  );
}

function WebMediaElementSlot({
  kind,
  bytes,
  mime,
  title,
  height,
}: {
  kind: "video" | "audio" | "pdf";
  bytes: Uint8Array;
  mime: string;
  title: string;
  height?: number;
}) {
  const hostRef = useRef<unknown>(null);

  useEffect(() => {
    if (Platform.OS !== "web" || !hostRef.current) return;
    return mountWebMediaElement(hostRef.current, { kind, bytes, mime, title });
  }, [kind, bytes, mime, title]);

  return (
    <View
      ref={hostRef as never}
      style={{
        width: "100%",
        ...(height ? { height } : {}),
        overflow: "hidden",
      }}
    />
  );
}

function extractParentDirectory(rawPath: string): string | null {
  let clean = rawPath.trim();
  if (/^file:\/\//i.test(clean)) {
    try {
      clean = decodeURIComponent(clean.replace(/^file:\/\//i, ""));
      if (/^\/[a-zA-Z]:/.test(clean)) clean = clean.slice(1);
    } catch {
      // Keep raw fallback.
    }
  }
  const normalized = clean.replace(/[\\/]+$/, "");
  const lastSlash = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (lastSlash <= 0) return null;
  const dir = normalized.slice(0, lastSlash);
  if (/^[a-zA-Z]:$/.test(dir)) return `${dir}/`;
  return dir || null;
}

function MediaSegmentCard({
  agentId,
  path,
  title,
  theme,
  layout,
}: {
  agentId: string;
  path: string;
  title?: string;
  theme: PluginTimelineItemProps["theme"];
  layout: PluginTimelineItemProps["layout"];
}) {
  const c = theme.colors;
  const compact = layout.compact;
  const isWeb = Platform.OS === "web";
  const toast = useToast();
  const inspectMedia = useRpc(inspectMediaRpc);
  const readMediaBytes = useRpc(readMediaBytesRpc);
  const mediaSettings = useSettings(mediaAccessSettings);

  const cacheKey = buildMediaCacheKey(agentId, path);
  const initialCached = getMemoryCachedMedia(cacheKey);

  const [meta, setMeta] = useState<MediaMeta | null>(() => initialCached?.meta ?? null);
  const [bytes, setBytes] = useState<Uint8Array | null>(() => initialCached?.bytes ?? null);
  const [imageUri, setImageUri] = useState<string | null>(() => initialCached?.imageUri ?? null);
  const [imageDims, setImageDims] = useState<{ w: number; h: number } | null>(
    () => initialCached?.imageDims ?? null,
  );
  const [loading, setLoading] = useState<boolean>(() => !initialCached);
  const [loadPhase, setLoadPhase] = useState<"inspecting" | "downloading">("inspecting");
  const [downloadProgress, setDownloadProgress] = useState<MediaDownloadProgress | null>(null);
  const [loadingBody, setLoadingBody] = useState(false);
  const [bodyProgress, setBodyProgress] = useState<MediaDownloadProgress | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [approvingDir, setApprovingDir] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const forceReload = reloadTick > 0;
    const memHit = forceReload ? null : getMemoryCachedMedia(cacheKey);

    const hydrateFromBytes = async (
      nextMeta: MediaMeta,
      data: Uint8Array,
      knownDims?: { w: number; h: number } | null,
      persistToDisk = false,
    ) => {
      let uri: string | undefined;
      let dims: { w: number; h: number } | null = knownDims ?? null;
      if (nextMeta.kind === "image") {
        uri = isWeb
          ? createWebBlobUrl(data, nextMeta.mime)
          : encodeBytesToDataUri(data, nextMeta.mime);
        if (!dims) {
          dims = await resolveImageDimensions(uri);
        }
        if (cancelled) return;
      }

      const cachedMeta: CachedMediaMeta = {
        kind: nextMeta.kind,
        mime: nextMeta.mime,
        name: nextMeta.name,
        size: nextMeta.size,
        ...(typeof nextMeta.mtimeMs === "number" ? { mtimeMs: nextMeta.mtimeMs } : {}),
      };
      putMemoryCachedMedia({
        key: cacheKey,
        meta: cachedMeta,
        bytes: data,
        imageUri: uri,
        imageDims: dims,
        checkedAt: Date.now(),
      });
      if (persistToDisk) {
        void writePersistentCachedMedia(cacheKey, cachedMeta, data, dims);
      }

      if (cancelled) return;
      setMeta(nextMeta);
      setBytes(data);
      setImageDims(dims);
      setImageUri(uri ?? null);
      setDownloadProgress(null);
      setError(null);
      setBlocked(false);
      setLoading(false);
    };

    if (memHit) {
      setMeta(memHit.meta);
      setBytes(memHit.bytes);
      setImageUri(memHit.imageUri ?? null);
      setImageDims(memHit.imageDims ?? null);
      setError(null);
      setBlocked(false);
      setLoading(false);

      // Revalidate silently in background if the memory cache entry is older than 60s.
      if (Date.now() - memHit.checkedAt < MEDIA_CACHE_REVALIDATE_MS) {
        return () => {
          cancelled = true;
        };
      }

      void (async () => {
        try {
          const res = await inspectMedia({ agentId, path });
          if (cancelled || !res.ok || !res.kind || !res.mime) return;
          const nextMeta: MediaMeta = {
            kind: res.kind,
            mime: res.mime,
            name: res.name ?? path,
            size: res.size ?? 0,
            ...(typeof res.mtimeMs === "number" ? { mtimeMs: res.mtimeMs } : {}),
            ...(res.supportsChunks ? { supportsChunks: true } : {}),
          };
          if (cacheMatchesInspect(memHit.meta, nextMeta)) {
            memHit.checkedAt = Date.now();
            return;
          }
          // File changed on disk: refresh smoothly.
          invalidateMediaCacheEntry(cacheKey);
          if (nextMeta.kind === "image" || nextMeta.kind === "audio" || nextMeta.kind === "video") {
            setMeta(nextMeta);
            setLoadPhase("downloading");
            setDownloadProgress(null);
            setLoading(true);
            const data = await downloadMediaWithProgress(
              cacheKey,
              nextMeta,
              readMediaBytes,
              agentId,
              path,
              (p) => {
                if (!cancelled) setDownloadProgress(p);
              },
            );
            if (cancelled) return;
            await hydrateFromBytes(nextMeta, data, null, true);
          } else {
            setMeta(nextMeta);
            setBytes(null);
          }
        } catch {
          // Keep serving valid RAM cache on transient background check errors.
        }
      })();

      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    setLoadPhase("inspecting");
    setDownloadProgress(null);
    setError(null);
    setBlocked(false);
    setMeta(null);
    setBytes(null);
    setImageUri(null);
    setImageDims(null);

    void (async () => {
      try {
        const [res, diskHit] = await Promise.all([
          inspectMedia({ agentId, path }),
          forceReload ? Promise.resolve(null) : readPersistentCachedMedia(cacheKey),
        ]);
        if (cancelled) return;
        if (!res.ok || !res.kind || !res.mime) {
          setBlocked(Boolean(res.blocked));
          setError(res.error ?? "无法读取媒体文件");
          setLoading(false);
          return;
        }
        const nextMeta: MediaMeta = {
          kind: res.kind,
          mime: res.mime,
          name: res.name ?? path,
          size: res.size ?? 0,
          ...(typeof res.mtimeMs === "number" ? { mtimeMs: res.mtimeMs } : {}),
          ...(res.supportsChunks ? { supportsChunks: true } : {}),
        };
        setMeta(nextMeta);

        if (nextMeta.kind === "image" || nextMeta.kind === "audio" || nextMeta.kind === "video") {
          if (diskHit && cacheMatchesInspect(diskHit.meta, nextMeta)) {
            await hydrateFromBytes(nextMeta, diskHit.bytes, diskHit.imageDims, false);
            return;
          }

          setLoadPhase("downloading");
          const data = await downloadMediaWithProgress(
            cacheKey,
            nextMeta,
            readMediaBytes,
            agentId,
            path,
            (p) => {
              if (!cancelled) setDownloadProgress(p);
            },
          );
          if (cancelled) return;
          await hydrateFromBytes(nextMeta, data, null, true);
          return;
        }

        // PDF / text documents hydrate cached body if already downloaded previously, else stay lazy.
        if (diskHit && cacheMatchesInspect(diskHit.meta, nextMeta)) {
          putMemoryCachedMedia({
            key: cacheKey,
            meta: diskHit.meta,
            bytes: diskHit.bytes,
            checkedAt: Date.now(),
          });
          setBytes(diskHit.bytes);
        }
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "媒体加载失败");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agentId, path, cacheKey, inspectMedia, readMediaBytes, isWeb, reloadTick]);

  const displayTitle = title?.trim() || meta?.name || path;
  const sizeLabel = meta && meta.size > 0 ? formatByteSize(meta.size) : "";
  const maxWidth = compact ? 340 : 640;
  const pendingKind = meta?.kind ?? inferKindFromPath(path);
  const parentDir = extractParentDirectory(path);

  const handleApproveParentDir = async () => {
    if (!parentDir || approvingDir || mediaSettings.status !== "ready") return;
    setApprovingDir(true);
    try {
      const existing = mediaSettings.values.extraAllowedDirs;
      const alreadyPresent = existing.some(
        (entry) => entry.trim().toLowerCase() === parentDir.toLowerCase(),
      );
      const nextDirs = alreadyPresent ? existing : [...existing, parentDir];
      const saved = await mediaSettings.save(
        { ...mediaSettings.values, extraAllowedDirs: nextDirs },
        mediaSettings.revision,
      );
      if (saved) {
        setReloadTick((n) => n + 1);
      } else {
        toast.error(mediaSettings.saveError ?? "保存允许目录失败，请重试。");
      }
    } finally {
      setApprovingDir(false);
    }
  };

  const handleToggleDocument = async () => {
    const nextOpen = !expanded;
    setExpanded(nextOpen);
    if (!nextOpen || bytes || loadingBody || !meta) return;
    const memHit = getMemoryCachedMedia(cacheKey);
    if (memHit && cacheMatchesInspect(memHit.meta, meta)) {
      setBytes(memHit.bytes);
      return;
    }
    setLoadingBody(true);
    setBodyProgress(null);
    try {
      const diskHit = await readPersistentCachedMedia(cacheKey);
      if (diskHit && cacheMatchesInspect(diskHit.meta, meta)) {
        putMemoryCachedMedia({
          key: cacheKey,
          meta: diskHit.meta,
          bytes: diskHit.bytes,
          checkedAt: Date.now(),
        });
        setBytes(diskHit.bytes);
        return;
      }
      const data = await downloadMediaWithProgress(
        cacheKey,
        meta,
        readMediaBytes,
        agentId,
        path,
        (p) => setBodyProgress(p),
      );
      const cachedMeta: CachedMediaMeta = {
        kind: meta.kind,
        mime: meta.mime,
        name: meta.name,
        size: meta.size,
        ...(typeof meta.mtimeMs === "number" ? { mtimeMs: meta.mtimeMs } : {}),
      };
      putMemoryCachedMedia({
        key: cacheKey,
        meta: cachedMeta,
        bytes: data,
        checkedAt: Date.now(),
      });
      void writePersistentCachedMedia(cacheKey, cachedMeta, data);
      setBytes(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取文件内容失败");
    } finally {
      setLoadingBody(false);
      setBodyProgress(null);
    }
  };

  if (loading) {
    const pctLabel =
      downloadProgress !== null ? `${Math.round(downloadProgress.ratio * 100)}%` : null;
    const progressRatio = loadPhase === "downloading" ? (downloadProgress?.ratio ?? null) : null;
    const phaseLabel =
      loadPhase === "downloading"
        ? downloadProgress
          ? `正在下载 · ${formatByteSize(downloadProgress.loaded)} / ${formatByteSize(downloadProgress.total)} (${pctLabel})`
          : sizeLabel
            ? `正在下载 · ${sizeLabel}`
            : "正在下载资源..."
        : "正在检查资源...";
    const kindIcon =
      pendingKind === "image"
        ? "Image"
        : pendingKind === "audio"
          ? "Volume2"
          : pendingKind === "video"
            ? "Film"
            : "File";

    if (pendingKind === "audio") {
      return (
        <View
          testID="fanframe-media-loading"
          style={{
            width: "100%",
            maxWidth,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surface1,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              paddingHorizontal: 10,
              paddingVertical: 6,
              backgroundColor: c.surface2,
              borderBottomWidth: 1,
              borderBottomColor: c.border,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
              <Icon name="Volume2" size={13} color={c.foregroundMuted} />
              <Text
                style={{ color: c.foreground, fontSize: 12, fontWeight: "600", flexShrink: 1 }}
                numberOfLines={1}
              >
                {displayTitle}
              </Text>
            </View>
            <Text
              numberOfLines={1}
              style={{
                color: c.foregroundMuted,
                fontSize: 11.5,
                fontVariant: ["tabular-nums"],
                flexShrink: 0,
              }}
            >
              {sizeLabel || "载入中"}
            </Text>
          </View>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: compact ? 8 : 10,
              paddingHorizontal: compact ? 8 : 10,
              paddingVertical: compact ? 7 : 8,
              backgroundColor: c.surface0,
            }}
          >
            <View
              style={{
                width: 28,
                height: 28,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: c.border,
                backgroundColor: c.surface1,
                opacity: 0.55,
              }}
            >
              <Icon name="Play" size={13} color={c.foregroundMuted} />
            </View>
            <Text
              numberOfLines={1}
              style={{
                color: c.foregroundMuted,
                fontSize: 11.5,
                fontVariant: ["tabular-nums"],
                minWidth: compact ? 42 : 48,
                flexShrink: 0,
              }}
            >
              {pctLabel ?? "0:00"}
            </Text>
            <View style={{ flex: 1, minWidth: 60, height: 24, justifyContent: "center" }}>
              <FanframeProgressBar
                color={c.accent}
                trackColor={c.surface2}
                height={3}
                progress={progressRatio}
              />
            </View>
          </View>
        </View>
      );
    }

    if (pendingKind === "image" || pendingKind === "video") {
      const stageW = pendingKind === "image" ? (compact ? 320 : 420) : undefined;
      const stageH = pendingKind === "video" ? 240 : 220;
      return (
        <View
          testID="fanframe-media-loading"
          style={{
            alignSelf: pendingKind === "image" ? "flex-start" : "stretch",
            width: pendingKind === "video" ? "100%" : stageW,
            maxWidth,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surface1,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              paddingHorizontal: 10,
              paddingVertical: 6,
              backgroundColor: c.surface2,
              borderBottomWidth: 1,
              borderBottomColor: c.border,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
              <Icon name={kindIcon} size={13} color={c.foregroundMuted} />
              <Text
                style={{ color: c.foreground, fontSize: 12, fontWeight: "600", flexShrink: 1 }}
                numberOfLines={1}
              >
                {displayTitle}
              </Text>
            </View>
            {sizeLabel ? (
              <Text
                numberOfLines={1}
                style={{
                  color: c.foregroundMuted,
                  fontSize: 11.5,
                  fontVariant: ["tabular-nums"],
                  flexShrink: 0,
                }}
              >
                {sizeLabel}
              </Text>
            ) : null}
          </View>
          <View
            style={{
              height: stageH,
              backgroundColor: c.surface0,
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              padding: 16,
            }}
          >
            <Icon name={kindIcon} size={20} color={c.foregroundMuted} />
            <Text
              style={{
                color: c.foregroundMuted,
                fontSize: 12,
                fontVariant: ["tabular-nums"],
              }}
            >
              {phaseLabel}
            </Text>
            <View style={{ width: compact ? 190 : 240 }}>
              <FanframeProgressBar
                color={c.accent}
                trackColor={c.surface2}
                height={3}
                progress={progressRatio}
              />
            </View>
          </View>
          {pendingKind === "video" ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: compact ? 8 : 10,
                paddingHorizontal: compact ? 8 : 10,
                paddingVertical: compact ? 7 : 8,
                backgroundColor: c.surface0,
                borderTopWidth: 1,
                borderTopColor: c.border,
              }}
            >
              <View
                style={{
                  width: 28,
                  height: 28,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1,
                  borderColor: c.border,
                  backgroundColor: c.surface1,
                  opacity: 0.55,
                }}
              >
                <Icon name="Play" size={13} color={c.foregroundMuted} />
              </View>
              <Text
                numberOfLines={1}
                style={{
                  color: c.foregroundMuted,
                  fontSize: 11.5,
                  fontVariant: ["tabular-nums"],
                  minWidth: compact ? 64 : 70,
                  flexShrink: 0,
                }}
              >
                0:00 / --:--
              </Text>
              <View style={{ flex: 1, minWidth: 60, height: 24, justifyContent: "center" }}>
                <View style={{ width: "100%", height: 2, backgroundColor: c.surface2, opacity: 0.6 }} />
              </View>
            </View>
          ) : null}
        </View>
      );
    }

    return (
      <View
        testID="fanframe-media-loading"
        style={{
          width: "100%",
          maxWidth,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface1,
        }}
      >
        <View
          style={{
            paddingHorizontal: 10,
            paddingVertical: 7,
            backgroundColor: c.surface2,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
            <Icon name={kindIcon} size={13} color={c.foregroundMuted} />
            <Text
              style={{ color: c.foreground, fontSize: 12, fontWeight: "600", flexShrink: 1 }}
              numberOfLines={1}
            >
              {displayTitle}
            </Text>
          </View>
          <Text
            style={{
              color: c.foregroundMuted,
              fontSize: 11.5,
              fontVariant: ["tabular-nums"],
            }}
          >
            {phaseLabel}
          </Text>
        </View>
        <FanframeProgressBar
          color={c.accent}
          trackColor={c.surface2}
          height={3}
          progress={progressRatio}
        />
      </View>
    );
  }

  if (error || !meta) {
    if (blocked) {
      return (
        <View
          testID="fanframe-media-blocked"
          style={{
            width: "100%",
            maxWidth,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surface1,
            paddingHorizontal: 12,
            paddingVertical: 10,
            gap: 6,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name="ShieldAlert" size={14} color={c.accent} />
            <Text style={{ color: c.foreground, fontSize: 12.5, fontWeight: "600", flexShrink: 1 }} numberOfLines={1}>
              {displayTitle}
            </Text>
          </View>
          <Text style={{ color: c.foregroundMuted, fontSize: 12, lineHeight: 17 }}>
            该文件位于当前工作区外，出于安全限制已阻止自动预览。
          </Text>
          {parentDir ? (
            <Text style={{ color: c.foregroundMuted, fontSize: 11.5 }} numberOfLines={2}>
              所在目录：{parentDir}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 2, flexWrap: "wrap" }}>
            {parentDir && mediaSettings.status === "ready" ? (
              <Pressable
                testID="fanframe-media-approve-dir"
                accessibilityRole="button"
                accessibilityLabel={`允许目录 ${parentDir} 并预览`}
                disabled={approvingDir || mediaSettings.saving}
                onPress={() => {
                  void handleApproveParentDir();
                }}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderWidth: 1,
                  borderColor: c.accent,
                  backgroundColor: c.surface0,
                  opacity: approvingDir ? 0.6 : 1,
                }}
              >
                <Text style={{ color: c.foreground, fontSize: 12, fontWeight: "500" }}>
                  {approvingDir ? "正在授权..." : "允许该目录并预览"}
                </Text>
              </Pressable>
            ) : null}
            <Text style={{ color: c.foregroundMuted, fontSize: 11.5 }}>
              可随时在「设置 → 插件 → FanFrame」中管理允许目录
            </Text>
          </View>
        </View>
      );
    }

    return (
      <View
        testID="fanframe-media-error"
        style={{
          maxWidth,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface1,
          paddingHorizontal: 10,
          paddingVertical: 8,
          gap: 3,
        }}
      >
        <Text style={{ color: c.foreground, fontSize: 12.5, fontWeight: "600" }} numberOfLines={1}>
          {displayTitle}
        </Text>
        <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
          媒体预览不可用：{error ?? "文件不可访问"}
        </Text>
      </View>
    );
  }

  if (meta.kind === "image" && imageUri) {
    const maxW = compact ? 320 : 620;
    const maxH = 420;
    let displayW = Math.min(maxW, 320);
    let displayH = 220;
    if (imageDims && imageDims.w > 0 && imageDims.h > 0) {
      const scale = Math.min(1, maxW / imageDims.w, maxH / imageDims.h);
      displayW = Math.max(80, Math.round(imageDims.w * scale));
      displayH = Math.max(60, Math.round(imageDims.h * scale));
    }
    return (
      <>
        <View
          testID="fanframe-media-image"
          style={{
            alignSelf: "flex-start",
            maxWidth,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surface1,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              paddingHorizontal: 10,
              paddingVertical: 6,
              backgroundColor: c.surface2,
              borderBottomWidth: 1,
              borderBottomColor: c.border,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
              <Icon name="Image" size={13} color={c.foregroundMuted} />
              <Text
                style={{ color: c.foreground, fontSize: 12, fontWeight: "600", flexShrink: 1 }}
                numberOfLines={1}
              >
                {displayTitle}
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {imageDims ? (
                <Text style={{ color: c.foregroundMuted, fontSize: 11, fontVariant: ["tabular-nums"] }}>
                  {imageDims.w}×{imageDims.h}
                </Text>
              ) : null}
              {sizeLabel ? (
                <Text style={{ color: c.foregroundMuted, fontSize: 11.5 }}>{sizeLabel}</Text>
              ) : null}
              <Icon name="Maximize2" size={11} color={c.foregroundMuted} />
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`放大查看 ${displayTitle}`}
            onPress={() => setLightboxOpen(true)}
          >
            <Image
              source={{ uri: imageUri }}
              resizeMode="contain"
              style={{ width: displayW, height: displayH, backgroundColor: c.surface0 }}
            />
          </Pressable>
        </View>

        <Modal title={displayTitle} open={lightboxOpen} onOpenChange={setLightboxOpen}>
          <Modal.Content scrollable={false} style={{ padding: 12 }}>
            <View style={{ alignItems: "center", justifyContent: "center" }}>
              <Image
                source={{ uri: imageUri }}
                resizeMode="contain"
                style={{
                  width: compact ? 320 : 860,
                  height: compact ? 360 : 580,
                  maxWidth: "100%",
                }}
              />
            </View>
          </Modal.Content>
        </Modal>
      </>
    );
  }

  if ((meta.kind === "audio" || meta.kind === "video") && bytes) {
    return (
      <View
        testID={`fanframe-media-${meta.kind}`}
        style={{
          width: "100%",
          maxWidth,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface1,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            paddingHorizontal: 10,
            paddingVertical: 6,
            backgroundColor: c.surface2,
            borderBottomWidth: 1,
            borderBottomColor: c.border,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
            <Icon
              name={meta.kind === "audio" ? "Volume2" : "Film"}
              size={13}
              color={c.foregroundMuted}
            />
            <Text
              style={{ color: c.foreground, fontSize: 12, fontWeight: "600", flexShrink: 1 }}
              numberOfLines={1}
            >
              {displayTitle}
            </Text>
          </View>
          {sizeLabel ? (
            <Text style={{ color: c.foregroundMuted, fontSize: 11.5 }}>{sizeLabel}</Text>
          ) : null}
        </View>
        {isWeb ? (
          <FanframeMediaPlayer
            kind={meta.kind}
            bytes={bytes}
            mime={meta.mime}
            filename={meta.name}
            theme={theme}
            compact={compact}
          />
        ) : (
          <View style={{ padding: 10 }}>
            <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
              当前客户端暂不支持内嵌播放此{meta.kind === "audio" ? "音频" : "视频"}，请在桌面或网页端查看。
            </Text>
          </View>
        )}
      </View>
    );
  }

  // PDF or text expandable preview.
  return (
    <View
      testID={`fanframe-media-${meta.kind}`}
      style={{
        width: "100%",
        maxWidth,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface1,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? "收起" : "展开"} ${displayTitle}`}
        onPress={() => {
          void handleToggleDocument();
        }}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          paddingHorizontal: 10,
          paddingVertical: 7,
          backgroundColor: c.surface2,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
          <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={13} color={c.foregroundMuted} />
          <Text
            style={{ color: c.foreground, fontSize: 12, fontWeight: "600", flexShrink: 1 }}
            numberOfLines={1}
          >
            {displayTitle}
          </Text>
        </View>
        <Text style={{ color: c.foregroundMuted, fontSize: 11.5 }}>
          {meta.kind.toUpperCase()}
          {sizeLabel ? ` · ${sizeLabel}` : ""}
        </Text>
      </Pressable>

      {expanded ? (
        <View style={{ borderTopWidth: 1, borderTopColor: c.border }}>
          {loadingBody ? (
            <View>
              <FanframeProgressBar
                color={c.accent}
                trackColor={c.surface2}
                height={3}
                progress={bodyProgress?.ratio ?? null}
              />
              <Text
                style={{
                  color: c.foregroundMuted,
                  fontSize: 12,
                  padding: 10,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {bodyProgress
                  ? `正在下载文件内容 · ${formatByteSize(bodyProgress.loaded)} / ${formatByteSize(bodyProgress.total)} (${Math.round(bodyProgress.ratio * 100)}%)`
                  : "正在读取文件内容..."}
              </Text>
            </View>
          ) : bytes ? (
            meta.kind === "pdf" && isWeb ? (
              <WebMediaElementSlot
                kind="pdf"
                bytes={bytes}
                mime={meta.mime}
                title={displayTitle}
                height={420}
              />
            ) : (
              <ScrollView style={{ maxHeight: 360, padding: 10 }}>
                <Text
                  selectable
                  style={{
                    color: c.foreground,
                    fontSize: 12,
                    lineHeight: 18,
                  }}
                >
                  {decodeUtf8Bytes(bytes, 65536)}
                </Text>
              </ScrollView>
            )
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function InlineVizSegmentCard({
  cardId,
  theme,
}: {
  cardId: string;
  theme: PluginTimelineItemProps["theme"];
}) {
  const c = theme.colors;
  const fetchCard = useRpc(getVisualizeCardRpc);
  const hostRef = useRef<unknown>(null);
  const [card, setCard] = useState<{ title: string; html: string } | null>(null);
  const [height, setHeight] = useState(180);

  useEffect(() => {
    let cancelled = false;
    void fetchCard({ cardId }).then((res) => {
      if (!cancelled && res) setCard(res);
    });
    return () => {
      cancelled = true;
    };
  }, [cardId, fetchCard]);

  useEffect(() => {
    if (Platform.OS !== "web" || !card || !hostRef.current) return;
    return mountVisualizeCard({
      host: hostRef.current,
      channel: `${cardId}-rich`,
      html: card.html,
      isDark: isDarkHex(c.surface0),
      colors: {
        background: c.surface0,
        foreground: c.foreground,
        muted: c.foregroundMuted,
        border: c.border,
        accent: c.accent,
      },
      onHeight: (nextH) => {
        if (nextH > 24 && nextH < 2400) setHeight(Math.ceil(nextH));
      },
    });
  }, [card, cardId, c.accent, c.border, c.foreground, c.foregroundMuted, c.surface0]);

  if (!card) {
    return (
      <View
        testID="fanframe-rich-viz-loading"
        style={{
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface1,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            paddingHorizontal: 12,
            paddingVertical: 7,
            backgroundColor: c.surface2,
            borderBottomWidth: 1,
            borderBottomColor: c.border,
          }}
        >
          <Text style={{ color: c.foregroundMuted, fontSize: 12.5, fontWeight: "600" }}>
            正在载入可视化卡片...
          </Text>
        </View>
        <FanframeProgressBar color={c.accent} trackColor={c.surface2} height={2} />
        <View
          style={{
            width: "100%",
            height: 180,
            backgroundColor: c.surface0,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>载入中...</Text>
        </View>
      </View>
    );
  }

  return (
    <View
      testID="fanframe-rich-viz"
      style={{
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface1,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          paddingHorizontal: 12,
          paddingVertical: 7,
          backgroundColor: c.surface2,
          borderBottomWidth: 1,
          borderBottomColor: c.border,
        }}
      >
        <Text style={{ color: c.foreground, fontSize: 12.5, fontWeight: "600" }} numberOfLines={1}>
          {card.title}
        </Text>
      </View>
      <View ref={hostRef as never} style={{ width: "100%", height, overflow: "hidden" }} />
    </View>
  );
}

function FanframeRichMessageCard({
  agentId,
  item,
  theme,
  layout,
}: PluginTimelineItemProps<RichMessageTimelineData>) {
  return (
    <View testID="fanframe-rich-message" style={{ gap: 10 }}>
      {item.data.segments.map((seg, idx) => {
        if (seg.kind === "markdown") {
          return <Markdown key={`md-${idx}`}>{seg.text}</Markdown>;
        }
        if (seg.kind === "media") {
          return (
            <MediaSegmentCard
              key={`media-${idx}-${seg.path}`}
              agentId={agentId}
              path={seg.path}
              title={seg.title}
              theme={theme}
              layout={layout}
            />
          );
        }
        return <InlineVizSegmentCard key={`viz-${idx}-${seg.cardId}`} cardId={seg.cardId} theme={theme} />;
      })}
    </View>
  );
}

export function contributeRichMessage(client: PluginClientContext): () => void {
  const removeTransformer = client.addTimelineTransformer({
    id: "fanframe-rich-message",
    query: { itemType: "assistant_message" },
    transform: ({ item }) => {
      const parsed = parseRichMessageSegments(item.text);
      if (!parsed) return undefined;
      return {
        items: [
          {
            type: "plugin",
            kind: RICH_MESSAGE_TIMELINE_KIND,
            version: RICH_MESSAGE_TIMELINE_VERSION,
            data: parsed,
          },
        ],
      };
    },
  });

  const removeRenderer = client.addTimelineRenderer({
    kind: RICH_MESSAGE_TIMELINE_KIND,
    version: RICH_MESSAGE_TIMELINE_VERSION,
    schema: richMessageTimelineDataSchema,
    Component: FanframeRichMessageCard,
  });

  return () => {
    removeRenderer();
    removeTransformer();
  };
}
