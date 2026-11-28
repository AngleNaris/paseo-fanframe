import type {
  PluginTheme,
  PluginWorkspaceSnapshot,
  WorkspaceIndicator,
} from "@getpaseo/plugin";
import {
  type PluginClientContext,
  type PluginHostSummary,
  type PluginSidebarViewProps,
  type WorkspaceRef,
  defineTranslations,
  useHosts,
  usePaseo,
  useSettings,
  useTranslation,
  useWorkspace,
  useWorkspaces,
} from "@getpaseo/plugin/client";
import {
  Icon,
  Modal,
  ScrollView,
  TextInput,
  useToast,
} from "@getpaseo/plugin/client/ui";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Platform, Pressable, Text, View } from "react-native";
import {
  DEFAULT_SIDEBAR_STATUS_VIEW_SETTINGS,
  MAX_RECENT_ACTIVE_MINUTES,
  RECENT_ACTIVE_PRESET_MINUTES,
  SIDEBAR_STATUS_PROJECTS_VIEW_ID,
  type SidebarSortMode,
  type SidebarStatusViewSettingsValues,
  makeProjectCollapseKey,
  sidebarStatusViewSettings,
} from "../shared/sidebar-view";

const sidebarMessages = defineTranslations({
  resources: {
    en: {
      view: {
        title: "Status · By Project",
        description:
          "Group conversations by status and project with a configurable recently active staging area.",
      },
      header: {
        title: "Workspaces",
        searchPlaceholder: "Filter conversations or projects...",
        searchToggle: "Filter conversations",
        clearSearch: "Clear filter",
        collapseAll: "Collapse all project groups",
        expandAll: "Expand all groups",
        options: "Display options",
        hostsBadge: "{{count}} host(s)",
      },
      pinned: {
        title: "Pinned",
        toggle: "Toggle pinned conversations",
      },
      recent: {
        runningOnly: "Active now",
        minutes: "Active · {{count}}m",
        hours: "Active · {{count}}h",
        days: "Active · {{count}}d",
        toggle: "Toggle recently active projects",
      },
      status: {
        needs_input: "Needs input",
        failed: "Failed",
        attention: "Ready to review",
        running: "Working",
        done: "Done",
      },
      project: {
        newWorkspace: "New conversation in {{project}}",
        toggle: "Toggle project {{project}}",
        moveUp: "Move project {{project}} up",
        moveDown: "Move project {{project}} down",
      },
      row: {
        open: "Open {{title}}",
        actions: "Actions for {{title}}",
        moveUp: "Move {{title}} up",
        moveDown: "Move {{title}} down",
        archiving: "Archiving...",
        justNow: "now",
      },
      empty: {
        noWorkspaces: "No active conversations yet.",
        noMatches: "No conversations match the current filter.",
        clearFilter: "Clear filter",
      },
      optionsModal: {
        title: "Sidebar Display",
        recentWindow: "Recently active staging window",
        presetRunningOnly: "Running only",
        presetMinutes: "{{count}}m",
        presetHours: "{{count}}h",
        customMinutesPlaceholder: "Custom minutes (e.g. 90)",
        applyCustom: "Apply",
        sortMode: "Sort mode",
        sortRecent: "Time (most recent)",
        sortName: "Workspace name (A-Z)",
        sortManual: "Manual order",
        resetManualOrder: "Reset manual order",
        visibility: "Visibility",
        showMeta: "Show branch, labels & diff details",
        showBackground: "Show background conversations",
        hosts: "Hosts",
        allHosts: "All hosts",
      },
      actionsModal: {
        title: "Conversation Actions",
        renameLabel: "Title",
        renamePlaceholder: "Conversation title",
        saveRename: "Save",
        moveUp: "Move up",
        moveDown: "Move down",
        pin: "Pin to top",
        unpin: "Unpin",
        newInProject: "New conversation in {{project}}",
        archive: "Archive conversation",
        confirmArchive: "Confirm archive",
        cancel: "Cancel",
        actionFailed: "Action failed: {{error}}",
      },
    },
    "zh-CN": {
      view: {
        title: "状态 · 按项目分组",
        description: "顶部暂存近期活跃项目，下方按状态与项目左对齐分组，支持自定义时间区间与排序模式。",
      },
      header: {
        title: "Workspaces",
        searchPlaceholder: "筛选对话、项目、分支或标签…",
        searchToggle: "筛选对话",
        clearSearch: "清空筛选",
        collapseAll: "全部折叠项目小组",
        expandAll: "全部展开",
        options: "显示选项",
        hostsBadge: "{{count}} 台主机",
      },
      pinned: {
        title: "置顶",
        toggle: "折叠或展开置顶对话",
      },
      recent: {
        runningOnly: "当前运行中",
        minutes: "近 {{count}} 分钟活跃",
        hours: "近 {{count}} 小时活跃",
        days: "近 {{count}} 天活跃",
        toggle: "折叠或展开近期活跃项目",
      },
      status: {
        needs_input: "等待输入",
        failed: "失败",
        attention: "待查看",
        running: "运行中",
        done: "已完成",
      },
      project: {
        newWorkspace: "在 {{project}} 中新建对话",
        toggle: "折叠或展开项目 {{project}}",
        moveUp: "上移项目 {{project}}",
        moveDown: "下移项目 {{project}}",
      },
      row: {
        open: "打开 {{title}}",
        actions: "{{title}} 的更多操作",
        moveUp: "上移 {{title}}",
        moveDown: "下移 {{title}}",
        archiving: "归档中…",
        justNow: "刚刚",
      },
      empty: {
        noWorkspaces: "当前还没有活跃对话。",
        noMatches: "没有符合当前筛选条件的对话。",
        clearFilter: "清空筛选",
      },
      optionsModal: {
        title: "侧栏显示选项",
        recentWindow: "近期活跃暂存时间区间",
        presetRunningOnly: "仅运行中",
        presetMinutes: "{{count}} 分钟",
        presetHours: "{{count}} 小时",
        customMinutesPlaceholder: "自定义分钟数（如 90）",
        applyCustom: "应用",
        sortMode: "排序模式",
        sortRecent: "时间（最近活跃）",
        sortName: "工作区首字",
        sortManual: "手动排序",
        resetManualOrder: "重置手动顺序",
        visibility: "显示内容",
        showMeta: "显示分支、标签与变更摘要",
        showBackground: "显示后台对话",
        hosts: "主机筛选",
        allHosts: "全部主机",
      },
      actionsModal: {
        title: "对话操作",
        renameLabel: "标题",
        renamePlaceholder: "输入对话标题",
        saveRename: "保存",
        moveUp: "上移一位",
        moveDown: "下移一位",
        pin: "置顶对话",
        unpin: "取消置顶",
        newInProject: "在 {{project}} 中新建对话",
        archive: "归档对话",
        confirmArchive: "确认归档",
        cancel: "取消",
        actionFailed: "操作失败：{{error}}",
      },
    },
  },
});

// "running" is intentionally omitted: running conversations live in the top Recently Active staging section.
const STATUS_BUCKET_ORDER: readonly WorkspaceIndicator[] = [
  "needs_input",
  "failed",
  "attention",
  "done",
];

const PINNED_GROUP_KEY = "__fanframe_pinned__";
const RECENT_SECTION = "__fanframe_recent__";
const BUCKET_PROJECT_SEP = "\u0000";
const STATUS_RING_PERIOD_MS = 900;

// Shared flush-left alignment geometry matching Paseo's native sidebar.
// All hover controls are strictly 20px tall (= TITLE_LINE_HEIGHT) so hovering causes 0px height shift.
const ROW_PADDING_X = 8;
const LEADING_SLOT_WIDTH = 16;
const TITLE_LINE_HEIGHT = 20;
const ROW_GAP = 8;
const META_INDENT = LEADING_SLOT_WIDTH + ROW_GAP;
const INLINE_ACTION_SIZE = 20;

// Exact Paseo deterministic project identity palette.
const IDENTITY_COLOR_NAMES = [
  "violet",
  "sky",
  "emerald",
  "orange",
  "pink",
  "indigo",
  "teal",
  "red",
  "amber",
  "blue",
] as const;

type IdentityColorName = (typeof IDENTITY_COLOR_NAMES)[number];

const IDENTITY_BG_COLORS: Record<IdentityColorName, string> = {
  violet: "#7a6aa8",
  sky: "#3d7ea6",
  emerald: "#388068",
  orange: "#a4673a",
  pink: "#b05c80",
  indigo: "#6a70b8",
  teal: "#368080",
  red: "#b06260",
  amber: "#8f7838",
  blue: "#5179b0",
};

const IDENTITY_FG_LIGHT: Record<IdentityColorName, string> = {
  violet: "#6d49b5",
  sky: "#3d6985",
  emerald: "#3e6e5d",
  orange: "#845838",
  pink: "#974168",
  indigo: "#5251c2",
  teal: "#3e6d6c",
  red: "#9c4243",
  amber: "#716239",
  blue: "#39649e",
};

const IDENTITY_FG_DARK: Record<IdentityColorName, string> = {
  violet: "#a392d5",
  sky: "#6aa6ce",
  emerald: "#6cae96",
  orange: "#cc8f64",
  pink: "#d87da3",
  indigo: "#9299d5",
  teal: "#6cacab",
  red: "#d88381",
  amber: "#b29d64",
  blue: "#7ba1d5",
};

function deriveIdentityColorName(key: string): IdentityColorName {
  let hash = 0;
  for (const ch of key) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return IDENTITY_COLOR_NAMES[hash % IDENTITY_COLOR_NAMES.length] ?? "blue";
}

function isDarkSurface(color: string): boolean {
  const trimmed = color.trim();
  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    let r = 0;
    let g = 0;
    let b = 0;
    if (hex.length === 3) {
      r = parseInt(hex[0]! + hex[0]!, 16);
      g = parseInt(hex[1]! + hex[1]!, 16);
      b = parseInt(hex[2]! + hex[2]!, 16);
    } else if (hex.length >= 6) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    } else {
      return true;
    }
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
  }
  const rgbMatch = trimmed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    const r = Number(rgbMatch[1]);
    const g = Number(rgbMatch[2]);
    const b = Number(rgbMatch[3]);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
  }
  return true;
}

function getProjectInitial(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return "?";
  const segments = trimmed.split(/[\\/]/).filter(Boolean);
  const tail = segments[segments.length - 1] ?? trimmed;
  const first = Array.from(tail)[0];
  return first ? first.toUpperCase() : "?";
}

function parseIsoMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function getWorkspaceLatestActivityMs(ws: PluginWorkspaceSnapshot): number | null {
  const a = parseIsoMs(ws.lastPromptAt);
  const b = parseIsoMs(ws.statusEnteredAt);
  const c = parseIsoMs(ws.createdAt);
  let best: number | null = null;
  if (a !== null && (best === null || a > best)) best = a;
  if (b !== null && (best === null || b > best)) best = b;
  if (c !== null && (best === null || c > best)) best = c;
  return best;
}

function isWorkspaceInRecentStaging(
  ws: PluginWorkspaceSnapshot,
  nowMs: number,
  recentActiveMinutes: number,
): boolean {
  if (ws.indicator === "running") return true;
  if (recentActiveMinutes <= 0) return false;
  const latest = getWorkspaceLatestActivityMs(ws);
  if (latest === null) return false;
  return nowMs - latest <= recentActiveMinutes * 60_000;
}

function formatRelativeTime(
  ms: number | null,
  nowMs: number,
  justNow: string,
): string | null {
  if (ms === null) return null;
  const diffSec = Math.max(0, Math.floor((nowMs - ms) / 1000));
  if (diffSec < 60) return justNow;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d`;
  const diffMo = Math.floor(diffDay / 30);
  return `${diffMo}mo`;
}

function isWorkspaceIndicator(value: string): value is WorkspaceIndicator {
  return (
    value === "needs_input" ||
    value === "failed" ||
    value === "attention" ||
    value === "running" ||
    value === "done"
  );
}

function getStatusPresentation(
  bucket: WorkspaceIndicator,
  theme: PluginTheme,
  dark: boolean,
): { icon: string; color: string } {
  const c = theme.colors;
  switch (bucket) {
    case "needs_input":
      return { icon: "CircleAlert", color: c.statusWarning };
    case "failed":
      return { icon: "CircleX", color: c.statusDanger };
    case "attention":
      return { icon: "CircleCheck", color: c.statusSuccess };
    case "running":
      return { icon: "CircleDot", color: dark ? "#5caaf6" : "#2563eb" };
    case "done":
      return { icon: "CircleCheck", color: c.foregroundMuted };
  }
}

function getWorkspaceLabel(ws: Pick<PluginWorkspaceSnapshot, "title" | "name">): string {
  const t = ws.title?.trim();
  return t || ws.name;
}

function compareTextNatural(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function compareRecencyDesc(a: PluginWorkspaceSnapshot, b: PluginWorkspaceSnapshot): number {
  const aTime = getWorkspaceLatestActivityMs(a);
  const bTime = getWorkspaceLatestActivityMs(b);
  if (aTime !== null && bTime !== null && aTime !== bTime) return bTime - aTime;
  if (aTime !== null && bTime === null) return -1;
  if (aTime === null && bTime !== null) return 1;
  const projCmp = compareTextNatural(a.projectDisplayName, b.projectDisplayName);
  if (projCmp !== 0) return projCmp;
  const nameCmp = compareTextNatural(getWorkspaceLabel(a), getWorkspaceLabel(b));
  if (nameCmp !== 0) return nameCmp;
  return a.ref.key.localeCompare(b.ref.key);
}

function compareByNameInitial(a: PluginWorkspaceSnapshot, b: PluginWorkspaceSnapshot): number {
  const projCmp = compareTextNatural(a.projectDisplayName, b.projectDisplayName);
  if (projCmp !== 0) return projCmp;
  if (a.project.key !== b.project.key) return a.project.key.localeCompare(b.project.key);
  const labelCmp = compareTextNatural(getWorkspaceLabel(a), getWorkspaceLabel(b));
  if (labelCmp !== 0) return labelCmp;
  return a.ref.key.localeCompare(b.ref.key);
}

function buildOrderIndex(order: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < order.length; i++) {
    map.set(order[i]!, i);
  }
  return map;
}

function applyManualOrder<T>(
  items: readonly T[],
  getKey: (item: T) => string,
  order: readonly string[],
): T[] {
  if (order.length === 0 || items.length <= 1) return items.slice();
  const idxMap = buildOrderIndex(order);
  return items
    .map((item, originalIdx) => ({
      item,
      rank: idxMap.get(getKey(item)) ?? Number.MAX_SAFE_INTEGER,
      originalIdx,
    }))
    .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.originalIdx - b.originalIdx))
    .map((entry) => entry.item);
}

function moveKeyInOrder(
  existingOrder: readonly string[],
  visibleKeys: readonly string[],
  targetKey: string,
  direction: "up" | "down",
): string[] {
  const pos = visibleKeys.indexOf(targetKey);
  if (pos === -1) return existingOrder.slice();
  const swapPos = direction === "up" ? pos - 1 : pos + 1;
  if (swapPos < 0 || swapPos >= visibleKeys.length) return existingOrder.slice();

  // Merge existing hidden keys + current visible keys while swapping the two neighbors.
  const visibleSet = new Set(visibleKeys);
  const reorderedVisible = visibleKeys.slice();
  const tmp = reorderedVisible[pos]!;
  reorderedVisible[pos] = reorderedVisible[swapPos]!;
  reorderedVisible[swapPos] = tmp;

  const result: string[] = [];
  let visCursor = 0;
  for (const key of existingOrder) {
    if (visibleSet.has(key)) {
      if (visCursor < reorderedVisible.length) {
        result.push(reorderedVisible[visCursor++]!);
      }
    } else {
      result.push(key);
    }
  }
  while (visCursor < reorderedVisible.length) {
    result.push(reorderedVisible[visCursor++]!);
  }
  return Array.from(new Set(result));
}

interface ProjectSubGroupData {
  readonly projectKey: string;
  readonly projectDisplayName: string;
  readonly collapseKey: string;
  readonly items: readonly WorkspaceRef[];
}

interface StatusBucketData {
  readonly bucket: WorkspaceIndicator;
  readonly projects: readonly ProjectSubGroupData[];
}

interface ActionModalTarget {
  readonly ref: WorkspaceRef;
  readonly reorderScope: "pinned" | string; // "pinned" or projectKey
  readonly visibleKeys: readonly string[];
}

function useDevicePrefs() {
  const settings = useSettings(sidebarStatusViewSettings);
  const [localPrefs, setLocalPrefs] = useState<SidebarStatusViewSettingsValues>(
    DEFAULT_SIDEBAR_STATUS_VIEW_SETTINGS,
  );
  const latestSettingsRef = useRef(settings);
  latestSettingsRef.current = settings;
  const inFlightRef = useRef(false);
  const pendingNextRef = useRef<SidebarStatusViewSettingsValues | null>(null);

  useEffect(() => {
    if (settings.status === "ready" && !inFlightRef.current && pendingNextRef.current === null) {
      setLocalPrefs(settings.values);
    }
  }, [settings]);

  const flush = useCallback(async () => {
    if (inFlightRef.current) return;
    const target = pendingNextRef.current;
    if (!target) return;
    const current = latestSettingsRef.current;
    if (current.status !== "ready") return;

    pendingNextRef.current = null;
    inFlightRef.current = true;
    try {
      const ok = await current.save(target, current.revision);
      if (!ok) {
        await current.reload();
      }
    } finally {
      inFlightRef.current = false;
      if (pendingNextRef.current !== null) {
        void flush();
      }
    }
  }, []);

  const updatePrefs = useCallback(
    (updater: (prev: SidebarStatusViewSettingsValues) => SidebarStatusViewSettingsValues) => {
      setLocalPrefs((prev) => {
        const next = updater(prev);
        pendingNextRef.current = next;
        void flush();
        return next;
      });
    },
    [flush],
  );

  useEffect(() => {
    if (settings.status === "ready" && pendingNextRef.current !== null && !inFlightRef.current) {
      void flush();
    }
  }, [settings.status, flush]);

  return { prefs: localPrefs, updatePrefs };
}

/**
 * Exact Paseo running indicator geometry (14px frame, 12px track + 90deg rotating arc + 6px center dot).
 * - Preserves Paseo's circular 900ms phase-synced spinner when sharpCorners is off or on native mobile.
 * - Automatically picked up by FanFrame's mountSquareSpinners() on web/desktop when sharpCorners is on.
 */
const RunningStatusRing = memo(function RunningStatusRing({
  color,
  backdropColor,
}: {
  color: string;
  backdropColor?: string;
}) {
  const spin = useRef(
    new Animated.Value((Date.now() % STATUS_RING_PERIOD_MS) / STATUS_RING_PERIOD_MS),
  ).current;

  useEffect(() => {
    const useNative = Platform.OS !== "web";
    const startPhase = (Date.now() % STATUS_RING_PERIOD_MS) / STATUS_RING_PERIOD_MS;
    spin.setValue(startPhase);
    let stopped = false;
    const firstDuration = Math.max(16, Math.round((1 - startPhase) * STATUS_RING_PERIOD_MS));
    let loopAnim: Animated.CompositeAnimation | null = null;

    const firstAnim = Animated.timing(spin, {
      toValue: 1,
      duration: firstDuration,
      easing: Easing.linear,
      useNativeDriver: useNative,
    });
    firstAnim.start(({ finished }) => {
      if (!finished || stopped) return;
      spin.setValue(0);
      loopAnim = Animated.loop(
        Animated.timing(spin, {
          toValue: 1,
          duration: STATUS_RING_PERIOD_MS,
          easing: Easing.linear,
          useNativeDriver: useNative,
        }),
      );
      loopAnim.start();
    });

    return () => {
      stopped = true;
      firstAnim.stop();
      loopAnim?.stop();
    };
  }, [spin]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <View
      style={{
        width: 14,
        height: 14,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: backdropColor,
      }}
    >
      <View
        style={{
          position: "absolute",
          width: 12,
          height: 12,
          borderRadius: 999,
          borderWidth: 1.5,
          borderColor: color,
          opacity: 0.3,
        }}
      />
      <Animated.View
        style={{
          position: "absolute",
          width: 12,
          height: 12,
          transform: [{ rotate }],
        }}
      >
        <View
          style={{
            width: 12,
            height: 12,
            borderRadius: 999,
            borderWidth: 1.5,
            borderColor: "transparent",
            borderTopColor: color,
            opacity: 0.9,
          }}
        />
      </Animated.View>
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          backgroundColor: color,
        }}
      />
    </View>
  );
});

function WorkspaceStatusVisual({
  bucket,
  loading,
  theme,
  dark,
}: {
  bucket: WorkspaceIndicator;
  loading: boolean;
  theme: PluginTheme;
  dark: boolean;
}) {
  const { color } = getStatusPresentation(bucket, theme, dark);
  const runningColor = getStatusPresentation("running", theme, dark).color;

  if (loading || bucket === "running") {
    return (
      <View
        style={{
          width: LEADING_SLOT_WIDTH,
          height: TITLE_LINE_HEIGHT,
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <RunningStatusRing color={runningColor} />
      </View>
    );
  }
  if (bucket === "needs_input") {
    return (
      <View
        style={{
          width: LEADING_SLOT_WIDTH,
          height: TITLE_LINE_HEIGHT,
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon name="CircleAlert" size={12} color={color} />
      </View>
    );
  }
  if (bucket === "failed") {
    return (
      <View
        style={{
          width: LEADING_SLOT_WIDTH,
          height: TITLE_LINE_HEIGHT,
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon name="CircleX" size={12} color={color} />
      </View>
    );
  }
  if (bucket === "attention") {
    return (
      <View
        style={{
          width: LEADING_SLOT_WIDTH,
          height: TITLE_LINE_HEIGHT,
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            backgroundColor: color,
          }}
        />
      </View>
    );
  }
  return (
    <View
      style={{
        width: LEADING_SLOT_WIDTH,
        height: TITLE_LINE_HEIGHT,
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          backgroundColor: theme.colors.foregroundMuted,
          opacity: 0.3,
        }}
      />
    </View>
  );
}

function InlineActionButton({
  icon,
  label,
  disabled = false,
  theme,
  onPress,
}: {
  icon: string;
  label: string;
  disabled?: boolean;
  theme: PluginTheme;
  onPress: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const c = theme.colors;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={({ pressed }) => ({
        width: INLINE_ACTION_SIZE,
        height: INLINE_ACTION_SIZE,
        borderRadius: 4,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.3 : 1,
        backgroundColor: !disabled && (pressed || hovered) ? c.surface2 : "transparent",
      })}
    >
      <Icon
        name={icon}
        size={13}
        color={!disabled && hovered ? c.foreground : c.foregroundMuted}
      />
    </Pressable>
  );
}

const WorkspaceItemRow = memo(function WorkspaceItemRow({
  reference,
  view,
  dark,
  showMeta,
  showProjectTag,
  hostLabel,
  nowMs,
  manualMode,
  canMoveUp,
  canMoveDown,
  onMove,
  onOpenActions,
}: {
  reference: WorkspaceRef;
  view: PluginSidebarViewProps;
  dark: boolean;
  showMeta: boolean;
  showProjectTag: boolean;
  hostLabel: string | null;
  nowMs: number;
  manualMode: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove?: (direction: "up" | "down") => void;
  onOpenActions: (ref: WorkspaceRef) => void;
}) {
  const { t } = useTranslation(sidebarMessages);
  const [hovered, setHovered] = useState(false);

  const ws = useWorkspace(reference, (item) => ({
    title: item.title,
    name: item.name,
    indicator: item.indicator,
    projectId: item.projectId,
    projectDisplayName: item.projectDisplayName,
    branch: item.branch,
    labels: item.labels,
    lastPromptAt: item.lastPromptAt,
    statusEnteredAt: item.statusEnteredAt,
    createdAt: item.createdAt,
    archivingAt: item.archivingAt,
    diffStat: item.diffStat,
  }));

  const handleOpen = useCallback(() => {
    view.navigation.openWorkspace(reference);
  }, [view.navigation, reference]);

  const handleLongPress = useCallback(() => {
    onOpenActions(reference);
  }, [onOpenActions, reference]);

  const handlePressActions = useCallback(() => {
    onOpenActions(reference);
  }, [onOpenActions, reference]);

  if (!ws) return null;

  const c = view.theme.colors;
  const selected = view.active.workspace?.key === reference.key;
  const label = getWorkspaceLabel(ws);
  const isArchiving = ws.archivingAt !== null;
  const latestMs = getWorkspaceLatestActivityMs(ws as PluginWorkspaceSnapshot);
  const relTime = isArchiving
    ? t("row.archiving")
    : formatRelativeTime(latestMs, nowMs, t("row.justNow"));

  const projectColorName = deriveIdentityColorName(ws.projectId);
  const projectBg = IDENTITY_BG_COLORS[projectColorName];
  const projectFg = dark ? IDENTITY_FG_DARK[projectColorName] : IDENTITY_FG_LIGHT[projectColorName];

  const metaParts: Array<{ key: string; icon?: string; text: string; color?: string }> = [];
  if (showMeta) {
    if (showProjectTag) {
      metaParts.push({ key: "project", text: ws.projectDisplayName, color: projectFg });
    }
    if (hostLabel) {
      metaParts.push({ key: "host", icon: "Server", text: hostLabel });
    }
    if (ws.branch && ws.branch !== label) {
      metaParts.push({ key: "branch", icon: "GitBranch", text: ws.branch });
    }
    if (ws.diffStat && (ws.diffStat.additions > 0 || ws.diffStat.deletions > 0)) {
      const add = ws.diffStat.additions > 0 ? `+${ws.diffStat.additions}` : "";
      const del = ws.diffStat.deletions > 0 ? `-${ws.diffStat.deletions}` : "";
      metaParts.push({
        key: "diff",
        text: [add, del].filter(Boolean).join(" "),
        color:
          ws.diffStat.additions > 0 && ws.diffStat.deletions === 0
            ? c.statusSuccess
            : c.foregroundMuted,
      });
    }
  }
  const hasLabels = showMeta && ws.labels.length > 0;
  const hasMetaLine = metaParts.length > 0 || hasLabels;

  const showActionControls = view.layout.compact || hovered;
  const rowBg = selected ? c.surface2 : hovered ? c.surface1 : "transparent";
  const badgeBackdrop = selected ? c.surface2 : hovered ? c.surface1 : c.surface0;

  return (
    <View
      testID={`sidebar-workspace-row-${reference.key}`}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={{
        minHeight: 28,
        paddingLeft: ROW_PADDING_X,
        paddingRight: ROW_PADDING_X,
        paddingVertical: 4,
        marginBottom: 2,
        borderRadius: 6,
        backgroundColor: rowBg,
        opacity: isArchiving ? 0.55 : 1,
      }}
    >
      {/* Fixed 20px-tall primary row so mounting inline 20x20 hover controls causes 0px height shift */}
      <View style={{ flexDirection: "row", alignItems: "center", minHeight: TITLE_LINE_HEIGHT }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("row.open", { title: label })}
          accessibilityState={{ selected }}
          onPress={handleOpen}
          onLongPress={handleLongPress}
          style={{
            flex: 1,
            minWidth: 0,
            flexDirection: "row",
            alignItems: "center",
            gap: ROW_GAP,
          }}
        >
          {showProjectTag ? (
            <View
              style={{
                width: LEADING_SLOT_WIDTH,
                height: TITLE_LINE_HEIGHT,
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <View style={{ position: "relative", width: 16, height: 16 }}>
                <View
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 4,
                    backgroundColor: projectBg,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: "#ffffff", fontSize: 9, fontWeight: "700", lineHeight: 11 }}>
                    {getProjectInitial(ws.projectDisplayName)}
                  </Text>
                </View>
                {ws.indicator === "running" || isArchiving ? (
                  <View style={{ position: "absolute", right: -5, bottom: -5 }}>
                    <RunningStatusRing
                      color={getStatusPresentation("running", view.theme, dark).color}
                      backdropColor={badgeBackdrop}
                    />
                  </View>
                ) : ws.indicator !== "done" ? (
                  <View
                    style={{
                      position: "absolute",
                      right: -3,
                      bottom: -3,
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      backgroundColor: getStatusPresentation(ws.indicator, view.theme, dark).color,
                      borderWidth: 1.5,
                      borderColor: badgeBackdrop,
                    }}
                  />
                ) : null}
              </View>
            </View>
          ) : (
            <WorkspaceStatusVisual
              bucket={ws.indicator}
              loading={isArchiving}
              theme={view.theme}
              dark={dark}
            />
          )}

          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 13.5,
              lineHeight: TITLE_LINE_HEIGHT,
              color: c.foreground,
              fontWeight: "400",
              opacity: selected || hovered ? 1 : 0.76,
            }}
          >
            {label}
          </Text>

          {relTime && (!showActionControls || view.layout.compact) ? (
            <Text
              numberOfLines={1}
              style={{
                fontSize: 12,
                lineHeight: TITLE_LINE_HEIGHT,
                color: c.foregroundMuted,
                opacity: 0.78,
                marginLeft: 4,
              }}
            >
              {relTime}
            </Text>
          ) : null}
        </Pressable>

        {showActionControls ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              height: INLINE_ACTION_SIZE,
              marginLeft: 2,
              gap: 1,
              flexShrink: 0,
            }}
          >
            {manualMode && !view.layout.compact && onMove && (canMoveUp || canMoveDown) ? (
              <>
                <InlineActionButton
                  icon="ArrowUp"
                  label={t("row.moveUp", { title: label })}
                  disabled={!canMoveUp}
                  theme={view.theme}
                  onPress={() => onMove("up")}
                />
                <InlineActionButton
                  icon="ArrowDown"
                  label={t("row.moveDown", { title: label })}
                  disabled={!canMoveDown}
                  theme={view.theme}
                  onPress={() => onMove("down")}
                />
              </>
            ) : null}
            <InlineActionButton
              icon="MoreHorizontal"
              label={t("row.actions", { title: label })}
              theme={view.theme}
              onPress={handlePressActions}
            />
          </View>
        ) : null}
      </View>

      {hasMetaLine ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("row.open", { title: label })}
          onPress={handleOpen}
          onLongPress={handleLongPress}
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 5,
            marginLeft: META_INDENT,
            marginTop: 1,
          }}
        >
          {metaParts.map((part, idx) => (
            <View
              key={part.key}
              style={{ flexDirection: "row", alignItems: "center", gap: 3, maxWidth: "100%" }}
            >
              {idx > 0 ? (
                <Text style={{ color: c.foregroundMuted, fontSize: 11, opacity: 0.55 }}>·</Text>
              ) : null}
              {part.icon ? <Icon name={part.icon} size={11} color={c.foregroundMuted} /> : null}
              <Text
                numberOfLines={1}
                style={{
                  fontSize: 12,
                  lineHeight: 16,
                  color: part.color ?? c.foregroundMuted,
                  flexShrink: 1,
                }}
              >
                {part.text}
              </Text>
            </View>
          ))}
          {hasLabels
            ? ws.labels.slice(0, 3).map((tag) => (
                <View
                  key={tag}
                  style={{
                    paddingHorizontal: 5,
                    paddingVertical: 1,
                    borderRadius: 4,
                    borderWidth: 1,
                    borderColor: c.border,
                    backgroundColor: c.surface0,
                  }}
                >
                  <Text
                    numberOfLines={1}
                    style={{ fontSize: 11, lineHeight: 14, color: c.foregroundMuted }}
                  >
                    {tag}
                  </Text>
                </View>
              ))
            : null}
        </Pressable>
      ) : null}
    </View>
  );
});

const ProjectSubGroupSection = memo(function ProjectSubGroupSection({
  group,
  view,
  dark,
  collapsed,
  showMeta,
  multiHost,
  hostLabelById,
  nowMs,
  manualMode,
  canMoveProjectUp,
  canMoveProjectDown,
  onMoveProject,
  onMoveWorkspace,
  onToggleCollapse,
  onOpenActions,
}: {
  group: ProjectSubGroupData;
  view: PluginSidebarViewProps;
  dark: boolean;
  collapsed: boolean;
  showMeta: boolean;
  multiHost: boolean;
  hostLabelById: ReadonlyMap<string, string>;
  nowMs: number;
  manualMode: boolean;
  canMoveProjectUp: boolean;
  canMoveProjectDown: boolean;
  onMoveProject?: (projectKey: string, direction: "up" | "down") => void;
  onMoveWorkspace: (
    projectKey: string,
    visibleKeys: readonly string[],
    workspaceKey: string,
    direction: "up" | "down",
  ) => void;
  onToggleCollapse: (collapseKey: string) => void;
  onOpenActions: (target: ActionModalTarget) => void;
}) {
  const { t } = useTranslation(sidebarMessages);
  const [hovered, setHovered] = useState(false);

  const firstRef = group.items[0];
  const projectMeta = useWorkspace(firstRef ?? "", (item) => ({
    project: item.project,
    projectId: item.projectId,
    projectDisplayName: item.projectDisplayName,
    hostId: item.hostId,
  }));

  const visibleWorkspaceKeys = useMemo(
    () => group.items.map((ref) => ref.key),
    [group.items],
  );

  const handleToggle = useCallback(() => {
    onToggleCollapse(group.collapseKey);
  }, [onToggleCollapse, group.collapseKey]);

  const handleNewWorkspace = useCallback(() => {
    if (!projectMeta) return;
    view.navigation.openProject(projectMeta.project);
  }, [projectMeta, view.navigation]);

  if (!firstRef) return null;

  const c = view.theme.colors;
  const displayName = projectMeta?.projectDisplayName ?? group.projectDisplayName;
  const colorSeed = projectMeta?.projectId ?? group.projectKey;
  const colorName = deriveIdentityColorName(colorSeed);
  const badgeBg = IDENTITY_BG_COLORS[colorName];
  const titleColor = dark ? IDENTITY_FG_DARK[colorName] : IDENTITY_FG_LIGHT[colorName];
  const hostLabel =
    multiHost && projectMeta ? hostLabelById.get(projectMeta.hostId) ?? null : null;

  const containsActive =
    view.active.workspace !== null &&
    group.items.some((ref) => ref.key === view.active.workspace?.key);

  const headerBg =
    collapsed && containsActive ? c.surface2 : hovered ? c.surface1 : "transparent";
  const showControls = (view.layout.compact || hovered) && projectMeta !== null;

  return (
    <View style={{ marginBottom: collapsed ? 2 : 6 }}>
      <View
        testID={`sidebar-project-row-${group.collapseKey}`}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          minHeight: 28,
          paddingLeft: ROW_PADDING_X,
          paddingRight: ROW_PADDING_X,
          paddingVertical: 4,
          marginBottom: 2,
          borderRadius: 6,
          backgroundColor: headerBg,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("project.toggle", { project: displayName })}
          accessibilityState={{ expanded: !collapsed }}
          onPress={handleToggle}
          style={{
            flex: 1,
            minWidth: 0,
            flexDirection: "row",
            alignItems: "center",
            gap: ROW_GAP,
          }}
        >
          {/* Paseo native behavior: leading project icon swaps to chevron on hover */}
          <View
            style={{
              width: LEADING_SLOT_WIDTH,
              height: TITLE_LINE_HEIGHT,
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {hovered ? (
              <Icon
                name={collapsed ? "ChevronRight" : "ChevronDown"}
                size={14}
                color={c.foregroundMuted}
              />
            ) : (
              <View
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  backgroundColor: badgeBg,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: "#ffffff", fontSize: 9, fontWeight: "700", lineHeight: 11 }}>
                  {getProjectInitial(displayName)}
                </Text>
              </View>
            )}
          </View>

          <Text
            numberOfLines={1}
            style={{
              flexShrink: 1,
              minWidth: 0,
              fontSize: 13.5,
              lineHeight: TITLE_LINE_HEIGHT,
              fontWeight: "500",
              color: titleColor,
              opacity: collapsed ? 0.78 : 1,
            }}
          >
            {displayName}
          </Text>

          {hostLabel ? (
            <Text
              numberOfLines={1}
              style={{
                fontSize: 11.5,
                lineHeight: 16,
                color: c.foregroundMuted,
                opacity: 0.72,
                flexShrink: 1,
              }}
            >
              · {hostLabel}
            </Text>
          ) : null}
        </Pressable>

        {showControls ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              height: INLINE_ACTION_SIZE,
              marginLeft: 2,
              gap: 1,
              flexShrink: 0,
            }}
          >
            {manualMode && onMoveProject && (canMoveProjectUp || canMoveProjectDown) ? (
              <>
                <InlineActionButton
                  icon="ArrowUp"
                  label={t("project.moveUp", { project: displayName })}
                  disabled={!canMoveProjectUp}
                  theme={view.theme}
                  onPress={() => onMoveProject(group.projectKey, "up")}
                />
                <InlineActionButton
                  icon="ArrowDown"
                  label={t("project.moveDown", { project: displayName })}
                  disabled={!canMoveProjectDown}
                  theme={view.theme}
                  onPress={() => onMoveProject(group.projectKey, "down")}
                />
              </>
            ) : null}
            <InlineActionButton
              icon="Plus"
              label={t("project.newWorkspace", { project: displayName })}
              theme={view.theme}
              onPress={handleNewWorkspace}
            />
          </View>
        ) : null}
      </View>

      {!collapsed ? (
        <View>
          {group.items.map((wsRef, idx) => (
            <WorkspaceItemRow
              key={wsRef.key}
              reference={wsRef}
              view={view}
              dark={dark}
              showMeta={showMeta}
              showProjectTag={false}
              hostLabel={null}
              nowMs={nowMs}
              manualMode={manualMode}
              canMoveUp={idx > 0}
              canMoveDown={idx < group.items.length - 1}
              onMove={(dir) =>
                onMoveWorkspace(group.projectKey, visibleWorkspaceKeys, wsRef.key, dir)
              }
              onOpenActions={(ref) =>
                onOpenActions({
                  ref,
                  reorderScope: group.projectKey,
                  visibleKeys: visibleWorkspaceKeys,
                })
              }
            />
          ))}
        </View>
      ) : null}
    </View>
  );
});

const StatusBucketSection = memo(function StatusBucketSection({
  data,
  isFirst,
  view,
  dark,
  collapsed,
  collapsedProjectsSet,
  showMeta,
  multiHost,
  hostLabelById,
  nowMs,
  manualMode,
  onMoveProject,
  onMoveWorkspace,
  onToggleBucket,
  onToggleProject,
  onOpenActions,
}: {
  data: StatusBucketData;
  isFirst: boolean;
  view: PluginSidebarViewProps;
  dark: boolean;
  collapsed: boolean;
  collapsedProjectsSet: ReadonlySet<string>;
  showMeta: boolean;
  multiHost: boolean;
  hostLabelById: ReadonlyMap<string, string>;
  nowMs: number;
  manualMode: boolean;
  onMoveProject: (visibleProjectKeys: readonly string[], projectKey: string, dir: "up" | "down") => void;
  onMoveWorkspace: (
    projectKey: string,
    visibleKeys: readonly string[],
    workspaceKey: string,
    direction: "up" | "down",
  ) => void;
  onToggleBucket: (bucket: WorkspaceIndicator) => void;
  onToggleProject: (collapseKey: string) => void;
  onOpenActions: (target: ActionModalTarget) => void;
}) {
  const { t } = useTranslation(sidebarMessages);
  const [hovered, setHovered] = useState(false);

  const visibleProjectKeys = useMemo(
    () => data.projects.map((p) => p.projectKey),
    [data.projects],
  );

  const handleToggle = useCallback(() => {
    onToggleBucket(data.bucket);
  }, [onToggleBucket, data.bucket]);

  const handleMoveProject = useCallback(
    (projectKey: string, dir: "up" | "down") => {
      onMoveProject(visibleProjectKeys, projectKey, dir);
    },
    [onMoveProject, visibleProjectKeys],
  );

  const c = view.theme.colors;
  const { icon, color } = getStatusPresentation(data.bucket, view.theme, dark);
  const statusLabel = t(`status.${data.bucket}`);

  const containsActive =
    view.active.workspace !== null &&
    data.projects.some((p) => p.items.some((ref) => ref.key === view.active.workspace?.key));

  return (
    <View
      style={{
        marginTop: isFirst ? 2 : 10,
        paddingTop: isFirst ? 0 : 6,
        borderTopWidth: isFirst ? 0 : 1,
        borderTopColor: isFirst ? "transparent" : c.border,
      }}
    >
      <View
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={statusLabel}
          accessibilityState={{ expanded: !collapsed }}
          onPress={handleToggle}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            minHeight: 28,
            paddingHorizontal: ROW_PADDING_X,
            paddingVertical: 4,
            marginBottom: collapsed ? 2 : 4,
            gap: ROW_GAP,
            borderRadius: 6,
            backgroundColor: pressed
              ? c.surface2
              : collapsed && containsActive
                ? c.surface2
                : hovered
                  ? c.surface1
                  : "transparent",
          })}
        >
          <View
            style={{
              width: LEADING_SLOT_WIDTH,
              height: TITLE_LINE_HEIGHT,
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {hovered ? (
              <Icon
                name={collapsed ? "ChevronRight" : "ChevronDown"}
                size={14}
                color={c.foregroundMuted}
              />
            ) : (
              <Icon name={icon} size={14} color={color} />
            )}
          </View>
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              fontSize: 13,
              lineHeight: TITLE_LINE_HEIGHT,
              fontWeight: "400",
              color: c.foregroundMuted,
              opacity: collapsed ? 0.72 : 1,
            }}
          >
            {statusLabel}
          </Text>
        </Pressable>
      </View>

      {!collapsed ? (
        <View>
          {data.projects.map((proj, idx) => (
            <ProjectSubGroupSection
              key={proj.collapseKey}
              group={proj}
              view={view}
              dark={dark}
              collapsed={collapsedProjectsSet.has(proj.collapseKey)}
              showMeta={showMeta}
              multiHost={multiHost}
              hostLabelById={hostLabelById}
              nowMs={nowMs}
              manualMode={manualMode}
              canMoveProjectUp={idx > 0}
              canMoveProjectDown={idx < data.projects.length - 1}
              onMoveProject={handleMoveProject}
              onMoveWorkspace={onMoveWorkspace}
              onToggleCollapse={onToggleProject}
              onOpenActions={onOpenActions}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
});

function formatRecentSectionTitle(
  minutes: number,
  t: ReturnType<typeof useTranslation<typeof sidebarMessages.resources.en>>["t"],
): string {
  if (minutes <= 0) return t("recent.runningOnly");
  if (minutes % 1440 === 0) return t("recent.days", { count: minutes / 1440 });
  if (minutes % 60 === 0) return t("recent.hours", { count: minutes / 60 });
  return t("recent.minutes", { count: minutes });
}

const RecentActiveSection = memo(function RecentActiveSection({
  projects,
  recentActiveMinutes,
  isFirst,
  view,
  dark,
  collapsed,
  collapsedProjectsSet,
  showMeta,
  multiHost,
  hostLabelById,
  nowMs,
  manualMode,
  onMoveProject,
  onMoveWorkspace,
  onToggleSection,
  onToggleProject,
  onOpenActions,
}: {
  projects: readonly ProjectSubGroupData[];
  recentActiveMinutes: number;
  isFirst: boolean;
  view: PluginSidebarViewProps;
  dark: boolean;
  collapsed: boolean;
  collapsedProjectsSet: ReadonlySet<string>;
  showMeta: boolean;
  multiHost: boolean;
  hostLabelById: ReadonlyMap<string, string>;
  nowMs: number;
  manualMode: boolean;
  onMoveProject: (visibleProjectKeys: readonly string[], projectKey: string, dir: "up" | "down") => void;
  onMoveWorkspace: (
    projectKey: string,
    visibleKeys: readonly string[],
    workspaceKey: string,
    direction: "up" | "down",
  ) => void;
  onToggleSection: () => void;
  onToggleProject: (collapseKey: string) => void;
  onOpenActions: (target: ActionModalTarget) => void;
}) {
  const { t } = useTranslation(sidebarMessages);
  const [hovered, setHovered] = useState(false);

  const visibleProjectKeys = useMemo(
    () => projects.map((p) => p.projectKey),
    [projects],
  );

  const handleMoveProject = useCallback(
    (projectKey: string, dir: "up" | "down") => {
      onMoveProject(visibleProjectKeys, projectKey, dir);
    },
    [onMoveProject, visibleProjectKeys],
  );

  if (projects.length === 0) return null;

  const c = view.theme.colors;
  const title = formatRecentSectionTitle(recentActiveMinutes, t);
  const containsActive =
    view.active.workspace !== null &&
    projects.some((p) => p.items.some((ref) => ref.key === view.active.workspace?.key));

  return (
    <View
      style={{
        marginTop: isFirst ? 2 : 10,
        paddingTop: isFirst ? 0 : 6,
        borderTopWidth: isFirst ? 0 : 1,
        borderTopColor: isFirst ? "transparent" : c.border,
      }}
    >
      <View
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("recent.toggle")}
          accessibilityState={{ expanded: !collapsed }}
          onPress={onToggleSection}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            minHeight: 28,
            paddingHorizontal: ROW_PADDING_X,
            paddingVertical: 4,
            marginBottom: collapsed ? 2 : 4,
            gap: ROW_GAP,
            borderRadius: 6,
            backgroundColor: pressed
              ? c.surface2
              : collapsed && containsActive
                ? c.surface2
                : hovered
                  ? c.surface1
                  : "transparent",
          })}
        >
          <View
            style={{
              width: LEADING_SLOT_WIDTH,
              height: TITLE_LINE_HEIGHT,
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {hovered ? (
              <Icon
                name={collapsed ? "ChevronRight" : "ChevronDown"}
                size={14}
                color={c.foregroundMuted}
              />
            ) : (
              <Icon name="Clock" size={14} color={c.accent} />
            )}
          </View>
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              fontSize: 13,
              lineHeight: TITLE_LINE_HEIGHT,
              fontWeight: "400",
              color: c.foregroundMuted,
              opacity: collapsed ? 0.72 : 1,
            }}
          >
            {title}
          </Text>
        </Pressable>
      </View>

      {!collapsed ? (
        <View>
          {projects.map((proj, idx) => (
            <ProjectSubGroupSection
              key={proj.collapseKey}
              group={proj}
              view={view}
              dark={dark}
              collapsed={collapsedProjectsSet.has(proj.collapseKey)}
              showMeta={showMeta}
              multiHost={multiHost}
              hostLabelById={hostLabelById}
              nowMs={nowMs}
              manualMode={manualMode}
              canMoveProjectUp={idx > 0}
              canMoveProjectDown={idx < projects.length - 1}
              onMoveProject={handleMoveProject}
              onMoveWorkspace={onMoveWorkspace}
              onToggleCollapse={onToggleProject}
              onOpenActions={onOpenActions}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
});

function WorkspaceActionsModal({
  target,
  open,
  onOpenChange,
  view,
  hostLabelById,
  manualMode,
  onMoveWorkspace,
  onMovePinned,
}: {
  target: ActionModalTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: PluginSidebarViewProps;
  hostLabelById: ReadonlyMap<string, string>;
  manualMode: boolean;
  onMoveWorkspace: (
    projectKey: string,
    visibleKeys: readonly string[],
    workspaceKey: string,
    direction: "up" | "down",
  ) => void;
  onMovePinned: (
    visibleKeys: readonly string[],
    workspaceKey: string,
    direction: "up" | "down",
  ) => void;
}) {
  const { t } = useTranslation(sidebarMessages);
  const paseo = usePaseo();
  const toast = useToast();
  const targetRef = target?.ref ?? null;
  const ws = useWorkspace(targetRef ?? "");

  const [titleDraft, setTitleDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  useEffect(() => {
    if (open && ws) {
      setTitleDraft(ws.title ?? ws.name);
      setConfirmingArchive(false);
      setBusy(false);
    }
  }, [open, ws?.ref.key]);

  if (!target || !targetRef || !ws) {
    return null;
  }

  const c = view.theme.colors;
  const currentTitle = ws.title ?? ws.name;
  const trimmedDraft = titleDraft.trim();
  const canSaveRename = !busy && trimmedDraft.length > 0 && trimmedDraft !== currentTitle;
  const isPinned = ws.pinnedAt !== null;
  const hostLabel = hostLabelById.get(ws.hostId);
  const statusText = ws.indicatorLabel ?? t(`status.${ws.indicator}`);

  const posInList = target.visibleKeys.indexOf(targetRef.key);
  const canMoveUp = manualMode && posInList > 0;
  const canMoveDown = manualMode && posInList !== -1 && posInList < target.visibleKeys.length - 1;

  const handleMove = (dir: "up" | "down") => {
    if (target.reorderScope === "pinned") {
      onMovePinned(target.visibleKeys, targetRef.key, dir);
    } else {
      onMoveWorkspace(target.reorderScope, target.visibleKeys, targetRef.key, dir);
    }
    onOpenChange(false);
  };

  const runAction = async (fn: () => Promise<void>, closeOnSuccess = true) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      if (closeOnSuccess) onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(t("actionsModal.actionFailed", { error: msg }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t("actionsModal.title")} open={open} onOpenChange={onOpenChange}>
      <Modal.Content contentContainerStyle={{ padding: 16, gap: 14 }}>
        <View style={{ gap: 2 }}>
          <Text numberOfLines={2} style={{ color: c.foreground, fontSize: 14, fontWeight: "600" }}>
            {currentTitle}
          </Text>
          <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 12 }}>
            {[ws.projectDisplayName, statusText, hostLabel].filter(Boolean).join(" · ")}
          </Text>
        </View>

        <View style={{ gap: 6 }}>
          <Text style={{ color: c.foregroundMuted, fontSize: 12, fontWeight: "500" }}>
            {t("actionsModal.renameLabel")}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <TextInput
              value={titleDraft}
              onChangeText={setTitleDraft}
              placeholder={t("actionsModal.renamePlaceholder")}
              placeholderTextColor={c.foregroundMuted}
              editable={!busy}
              onSubmitEditing={() => {
                if (canSaveRename) {
                  void runAction(async () => {
                    await paseo.workspaces.ref(targetRef).setTitle(trimmedDraft);
                  });
                }
              }}
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: c.border,
                borderRadius: 6,
                backgroundColor: c.surface0,
                color: c.foreground,
                fontSize: 13,
                paddingHorizontal: 10,
                paddingVertical: 7,
              }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("actionsModal.saveRename")}
              disabled={!canSaveRename}
              onPress={() => {
                void runAction(async () => {
                  await paseo.workspaces.ref(targetRef).setTitle(trimmedDraft);
                });
              }}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: canSaveRename ? c.accent : c.border,
                backgroundColor: canSaveRename ? c.accent : c.surface1,
                opacity: canSaveRename ? 1 : 0.55,
              }}
            >
              <Text
                style={{
                  color: canSaveRename ? c.accentForeground : c.foregroundMuted,
                  fontSize: 12.5,
                  fontWeight: "600",
                }}
              >
                {t("actionsModal.saveRename")}
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={{ gap: 6 }}>
          {manualMode && (canMoveUp || canMoveDown) ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("actionsModal.moveUp")}
                disabled={!canMoveUp || busy}
                onPress={() => handleMove("up")}
                style={({ pressed }) => ({
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  paddingHorizontal: 10,
                  paddingVertical: 9,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: c.border,
                  backgroundColor: pressed ? c.surface2 : c.surface1,
                  opacity: !canMoveUp || busy ? 0.4 : 1,
                })}
              >
                <Icon name="ArrowUp" size={14} color={c.foreground} />
                <Text style={{ color: c.foreground, fontSize: 13 }}>{t("actionsModal.moveUp")}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("actionsModal.moveDown")}
                disabled={!canMoveDown || busy}
                onPress={() => handleMove("down")}
                style={({ pressed }) => ({
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  paddingHorizontal: 10,
                  paddingVertical: 9,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: c.border,
                  backgroundColor: pressed ? c.surface2 : c.surface1,
                  opacity: !canMoveDown || busy ? 0.4 : 1,
                })}
              >
                <Icon name="ArrowDown" size={14} color={c.foreground} />
                <Text style={{ color: c.foreground, fontSize: 13 }}>
                  {t("actionsModal.moveDown")}
                </Text>
              </Pressable>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isPinned ? t("actionsModal.unpin") : t("actionsModal.pin")}
            disabled={busy}
            onPress={() => {
              void runAction(async () => {
                await paseo.workspaces.ref(targetRef).setPinned(!isPinned);
              });
            }}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingHorizontal: 12,
              paddingVertical: 9,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: c.border,
              backgroundColor: pressed ? c.surface2 : c.surface1,
              opacity: busy ? 0.6 : 1,
            })}
          >
            <Icon name={isPinned ? "PinOff" : "Pin"} size={14} color={c.foreground} />
            <Text style={{ color: c.foreground, fontSize: 13 }}>
              {isPinned ? t("actionsModal.unpin") : t("actionsModal.pin")}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("actionsModal.newInProject", { project: ws.projectDisplayName })}
            disabled={busy}
            onPress={() => {
              onOpenChange(false);
              view.navigation.openProject(ws.project);
            }}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingHorizontal: 12,
              paddingVertical: 9,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: c.border,
              backgroundColor: pressed ? c.surface2 : c.surface1,
              opacity: busy ? 0.6 : 1,
            })}
          >
            <Icon name="FolderPlus" size={14} color={c.foreground} />
            <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 13, flex: 1 }}>
              {t("actionsModal.newInProject", { project: ws.projectDisplayName })}
            </Text>
          </Pressable>

          {!confirmingArchive ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("actionsModal.archive")}
              disabled={busy || ws.archivingAt !== null}
              onPress={() => setConfirmingArchive(true)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingHorizontal: 12,
                paddingVertical: 9,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: c.border,
                backgroundColor: pressed ? c.surface2 : c.surface1,
                opacity: busy || ws.archivingAt !== null ? 0.55 : 1,
              })}
            >
              <Icon name="Archive" size={14} color={c.statusDanger} />
              <Text style={{ color: c.statusDanger, fontSize: 13 }}>
                {t("actionsModal.archive")}
              </Text>
            </Pressable>
          ) : (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("actionsModal.confirmArchive")}
                disabled={busy}
                onPress={() => {
                  void runAction(async () => {
                    const result = await paseo.workspaces.ref(targetRef).archive();
                    if (result.error) {
                      throw new Error(result.error);
                    }
                  });
                }}
                style={({ pressed }) => ({
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  paddingHorizontal: 12,
                  paddingVertical: 9,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: c.statusDanger,
                  backgroundColor: pressed ? c.surface2 : c.surface1,
                  opacity: busy ? 0.6 : 1,
                })}
              >
                <Icon name="Archive" size={14} color={c.statusDanger} />
                <Text style={{ color: c.statusDanger, fontSize: 13, fontWeight: "600" }}>
                  {t("actionsModal.confirmArchive")}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("actionsModal.cancel")}
                disabled={busy}
                onPress={() => setConfirmingArchive(false)}
                style={({ pressed }) => ({
                  paddingHorizontal: 14,
                  paddingVertical: 9,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: c.border,
                  backgroundColor: pressed ? c.surface2 : c.surface1,
                })}
              >
                <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>
                  {t("actionsModal.cancel")}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </Modal.Content>
    </Modal>
  );
}

function DisplayOptionsModal({
  open,
  onOpenChange,
  theme,
  prefs,
  hosts,
  activeHostFilters,
  onUpdatePrefs,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: PluginTheme;
  prefs: SidebarStatusViewSettingsValues;
  hosts: readonly PluginHostSummary[];
  activeHostFilters: readonly string[];
  onUpdatePrefs: (
    updater: (prev: SidebarStatusViewSettingsValues) => SidebarStatusViewSettingsValues,
  ) => void;
}) {
  const { t } = useTranslation(sidebarMessages);
  const c = theme.colors;
  const [customDraft, setCustomDraft] = useState("");

  useEffect(() => {
    if (open) {
      const isPreset = (RECENT_ACTIVE_PRESET_MINUTES as readonly number[]).includes(
        prefs.recentActiveMinutes,
      );
      setCustomDraft(isPreset ? "" : String(prefs.recentActiveMinutes));
    }
  }, [open, prefs.recentActiveMinutes]);

  const setRecentMinutes = (minutes: number) => {
    const clamped = Math.max(0, Math.min(MAX_RECENT_ACTIVE_MINUTES, Math.round(minutes)));
    onUpdatePrefs((prev) => ({ ...prev, recentActiveMinutes: clamped }));
  };

  const applyCustomMinutes = () => {
    const parsed = Number.parseInt(customDraft.trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    setRecentMinutes(parsed);
  };

  const setSort = (projectSort: SidebarSortMode) => {
    onUpdatePrefs((prev) => ({ ...prev, projectSort }));
  };

  const resetManualOrder = () => {
    onUpdatePrefs((prev) => ({
      ...prev,
      manualProjectOrder: [],
      manualWorkspaceOrder: {},
      manualPinnedOrder: [],
    }));
  };

  const toggleShowMeta = () => {
    onUpdatePrefs((prev) => ({ ...prev, showMeta: !prev.showMeta }));
  };

  const toggleShowBackground = () => {
    onUpdatePrefs((prev) => ({ ...prev, showBackground: !prev.showBackground }));
  };

  const toggleHost = (serverId: string) => {
    onUpdatePrefs((prev) => {
      const exists = prev.hostFilters.includes(serverId);
      const nextHosts = exists
        ? prev.hostFilters.filter((id) => id !== serverId)
        : [...prev.hostFilters, serverId];
      return { ...prev, hostFilters: nextHosts };
    });
  };

  const clearHosts = () => {
    onUpdatePrefs((prev) => ({ ...prev, hostFilters: [] }));
  };

  const hasCustomManualOrder =
    prefs.manualProjectOrder.length > 0 ||
    prefs.manualPinnedOrder.length > 0 ||
    Object.keys(prefs.manualWorkspaceOrder).length > 0;

  const formatPresetLabel = (mins: number) => {
    if (mins === 0) return t("optionsModal.presetRunningOnly");
    if (mins % 60 === 0) return t("optionsModal.presetHours", { count: mins / 60 });
    return t("optionsModal.presetMinutes", { count: mins });
  };

  const parsedCustom = Number.parseInt(customDraft.trim(), 10);
  const canApplyCustom =
    customDraft.trim().length > 0 &&
    Number.isFinite(parsedCustom) &&
    parsedCustom >= 0 &&
    parsedCustom <= MAX_RECENT_ACTIVE_MINUTES &&
    parsedCustom !== prefs.recentActiveMinutes;

  return (
    <Modal title={t("optionsModal.title")} open={open} onOpenChange={onOpenChange}>
      <Modal.Content contentContainerStyle={{ padding: 16, gap: 16 }}>
        <View style={{ gap: 8 }}>
          <Text style={{ color: c.foregroundMuted, fontSize: 12, fontWeight: "600" }}>
            {t("optionsModal.recentWindow")}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {RECENT_ACTIVE_PRESET_MINUTES.map((mins) => {
              const active = prefs.recentActiveMinutes === mins;
              const label = formatPresetLabel(mins);
              return (
                <Pressable
                  key={mins}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    setRecentMinutes(mins);
                    setCustomDraft("");
                  }}
                  style={({ pressed }) => ({
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 6,
                    borderWidth: 1,
                    borderColor: active ? c.accent : c.border,
                    backgroundColor: pressed || active ? c.surface2 : c.surface1,
                  })}
                >
                  <Text
                    style={{
                      color: active ? c.foreground : c.foregroundMuted,
                      fontSize: 12.5,
                      fontWeight: active ? "600" : "400",
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <TextInput
              value={customDraft}
              onChangeText={(val) => setCustomDraft(val.replace(/[^\d]/g, ""))}
              placeholder={t("optionsModal.customMinutesPlaceholder")}
              placeholderTextColor={c.foregroundMuted}
              keyboardType="number-pad"
              onSubmitEditing={applyCustomMinutes}
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: c.border,
                borderRadius: 6,
                backgroundColor: c.surface0,
                color: c.foreground,
                fontSize: 12.5,
                paddingHorizontal: 10,
                paddingVertical: 6,
              }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("optionsModal.applyCustom")}
              disabled={!canApplyCustom}
              onPress={applyCustomMinutes}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: canApplyCustom ? c.accent : c.border,
                backgroundColor: canApplyCustom ? c.accent : c.surface1,
                opacity: canApplyCustom ? 1 : 0.5,
              }}
            >
              <Text
                style={{
                  color: canApplyCustom ? c.accentForeground : c.foregroundMuted,
                  fontSize: 12.5,
                  fontWeight: "600",
                }}
              >
                {t("optionsModal.applyCustom")}
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={{ gap: 6 }}>
          <Text style={{ color: c.foregroundMuted, fontSize: 12, fontWeight: "600" }}>
            {t("optionsModal.sortMode")}
          </Text>
          <View style={{ gap: 4 }}>
            {(
              [
                { value: "recent", label: t("optionsModal.sortRecent") },
                { value: "name", label: t("optionsModal.sortName") },
                { value: "manual", label: t("optionsModal.sortManual") },
              ] as const
            ).map((opt) => {
              const active = prefs.projectSort === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  accessibilityRole="button"
                  accessibilityLabel={opt.label}
                  accessibilityState={{ selected: active }}
                  onPress={() => setSort(opt.value)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingHorizontal: 12,
                    paddingVertical: 9,
                    borderRadius: 6,
                    borderWidth: 1,
                    borderColor: active ? c.accent : c.border,
                    backgroundColor: pressed || active ? c.surface2 : c.surface1,
                  })}
                >
                  <Text
                    style={{
                      color: c.foreground,
                      fontSize: 13,
                      fontWeight: active ? "600" : "400",
                    }}
                  >
                    {opt.label}
                  </Text>
                  {active ? <Icon name="Check" size={14} color={c.accent} /> : null}
                </Pressable>
              );
            })}
          </View>
          {prefs.projectSort === "manual" && hasCustomManualOrder ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("optionsModal.resetManualOrder")}
              onPress={resetManualOrder}
              style={({ pressed }) => ({
                alignSelf: "flex-start",
                marginTop: 2,
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: c.border,
                backgroundColor: pressed ? c.surface2 : c.surface1,
              })}
            >
              <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
                {t("optionsModal.resetManualOrder")}
              </Text>
            </Pressable>
          ) : null}
        </View>

        <View style={{ gap: 6 }}>
          <Text style={{ color: c.foregroundMuted, fontSize: 12, fontWeight: "600" }}>
            {t("optionsModal.visibility")}
          </Text>
          <View style={{ gap: 4 }}>
            <Pressable
              accessibilityRole="switch"
              accessibilityLabel={t("optionsModal.showMeta")}
              accessibilityState={{ checked: prefs.showMeta }}
              onPress={toggleShowMeta}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 12,
                paddingVertical: 9,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: c.border,
                backgroundColor: pressed ? c.surface2 : c.surface1,
              })}
            >
              <Text style={{ color: c.foreground, fontSize: 13, flex: 1 }}>
                {t("optionsModal.showMeta")}
              </Text>
              <Icon name="Check" size={14} color={prefs.showMeta ? c.accent : "transparent"} />
            </Pressable>

            <Pressable
              accessibilityRole="switch"
              accessibilityLabel={t("optionsModal.showBackground")}
              accessibilityState={{ checked: prefs.showBackground }}
              onPress={toggleShowBackground}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 12,
                paddingVertical: 9,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: c.border,
                backgroundColor: pressed ? c.surface2 : c.surface1,
              })}
            >
              <Text style={{ color: c.foreground, fontSize: 13, flex: 1 }}>
                {t("optionsModal.showBackground")}
              </Text>
              <Icon
                name="Check"
                size={14}
                color={prefs.showBackground ? c.accent : "transparent"}
              />
            </Pressable>
          </View>
        </View>

        {hosts.length > 1 ? (
          <View style={{ gap: 6 }}>
            <Text style={{ color: c.foregroundMuted, fontSize: 12, fontWeight: "600" }}>
              {t("optionsModal.hosts")}
            </Text>
            <View style={{ gap: 4 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("optionsModal.allHosts")}
                accessibilityState={{ selected: activeHostFilters.length === 0 }}
                onPress={clearHosts}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingHorizontal: 12,
                  paddingVertical: 9,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: activeHostFilters.length === 0 ? c.accent : c.border,
                  backgroundColor:
                    pressed || activeHostFilters.length === 0 ? c.surface2 : c.surface1,
                })}
              >
                <Text style={{ color: c.foreground, fontSize: 13 }}>
                  {t("optionsModal.allHosts")}
                </Text>
                {activeHostFilters.length === 0 ? (
                  <Icon name="Check" size={14} color={c.accent} />
                ) : null}
              </Pressable>

              {hosts.map((host) => {
                const selected = activeHostFilters.includes(host.serverId);
                return (
                  <Pressable
                    key={host.serverId}
                    accessibilityRole="button"
                    accessibilityLabel={host.label}
                    accessibilityState={{ selected }}
                    onPress={() => toggleHost(host.serverId)}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      paddingHorizontal: 12,
                      paddingVertical: 9,
                      borderRadius: 6,
                      borderWidth: 1,
                      borderColor: selected ? c.accent : c.border,
                      backgroundColor: pressed || selected ? c.surface2 : c.surface1,
                    })}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      <View
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 999,
                          backgroundColor:
                            host.status === "online" ? c.statusSuccess : c.foregroundMuted,
                        }}
                      />
                      <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 13, flex: 1 }}>
                        {host.label}
                      </Text>
                    </View>
                    {selected ? <Icon name="Check" size={14} color={c.accent} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
      </Modal.Content>
    </Modal>
  );
}

function HeaderIconButton({
  icon,
  label,
  active = false,
  theme,
  onPress,
}: {
  icon: string;
  label: string;
  active?: boolean;
  theme: PluginTheme;
  onPress: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const c = theme.colors;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={({ pressed }) => ({
        width: 24,
        height: 24,
        borderRadius: 4,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed || hovered || active ? c.surface2 : "transparent",
      })}
    >
      <Icon
        name={icon}
        size={14}
        color={active ? c.accent : hovered ? c.foreground : c.foregroundMuted}
      />
    </Pressable>
  );
}

export function StatusByProjectSidebarView(view: PluginSidebarViewProps) {
  const { t } = useTranslation(sidebarMessages);
  const hosts = useHosts();
  const { prefs, updatePrefs } = useDevicePrefs();

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [actionTarget, setActionTarget] = useState<ActionModalTarget | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pinnedHovered, setPinnedHovered] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const dark = useMemo(
    () => isDarkSurface(view.theme.colors.surface0),
    [view.theme.colors.surface0],
  );

  const hostLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of hosts) {
      map.set(h.serverId, h.label);
    }
    return map;
  }, [hosts]);

  const activeHostFilters = useMemo(() => {
    if (prefs.hostFilters.length === 0) return [];
    const validIds = new Set(hosts.map((h) => h.serverId));
    return prefs.hostFilters.filter((id) => validIds.has(id));
  }, [prefs.hostFilters, hosts]);

  const hostFilterParam = activeHostFilters.length > 0 ? activeHostFilters : undefined;
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const multiHost = hosts.length > 1;
  const manualMode = prefs.projectSort === "manual";

  const baseComparator =
    prefs.projectSort === "name" ? compareByNameInitial : compareRecencyDesc;

  const rawGroups = useWorkspaces({
    hosts: hostFilterParam,
    where: (ws) => {
      if (!prefs.showBackground && ws.background) return false;
      if (!normalizedQuery) return true;
      const hostName = hostLabelById.get(ws.hostId) ?? "";
      return (
        getWorkspaceLabel(ws).toLowerCase().includes(normalizedQuery) ||
        ws.name.toLowerCase().includes(normalizedQuery) ||
        ws.projectDisplayName.toLowerCase().includes(normalizedQuery) ||
        (ws.branch?.toLowerCase().includes(normalizedQuery) ?? false) ||
        ws.labels.some((tag) => tag.toLowerCase().includes(normalizedQuery)) ||
        hostName.toLowerCase().includes(normalizedQuery)
      );
    },
    orderBy: baseComparator,
    groupBy: (ws) => {
      const keys: Array<{ key: string; title: string }> = [];
      const bucket: WorkspaceIndicator = isWorkspaceIndicator(ws.indicator)
        ? ws.indicator
        : "done";

      if (ws.pinnedAt !== null) {
        keys.push({ key: PINNED_GROUP_KEY, title: PINNED_GROUP_KEY });
      } else if (bucket !== "running") {
        // Running conversations live in the top Recently Active staging section (no separate Working group).
        keys.push({
          key: `${bucket}${BUCKET_PROJECT_SEP}${ws.project.key}`,
          title: ws.projectDisplayName,
        });
      }

      if (isWorkspaceInRecentStaging(ws, nowMs, prefs.recentActiveMinutes)) {
        keys.push({
          key: `${RECENT_SECTION}${BUCKET_PROJECT_SEP}${ws.project.key}`,
          title: ws.projectDisplayName,
        });
      }
      return keys;
    },
  });

  const { pinnedItems, recentProjects, statusBuckets, allVisibleProjectKeys, hasAnyWorkspace } =
    useMemo(() => {
      let pinned: readonly WorkspaceRef[] = [];
      const recentList: ProjectSubGroupData[] = [];
      const byBucket = new Map<WorkspaceIndicator, ProjectSubGroupData[]>();
      const projectKeys: string[] = [];
      let anyWs = false;

      for (const group of rawGroups) {
        if (group.items.length === 0) continue;
        anyWs = true;

        if (group.key === PINNED_GROUP_KEY) {
          pinned = manualMode
            ? applyManualOrder(group.items, (ref) => ref.key, prefs.manualPinnedOrder)
            : group.items;
          continue;
        }

        const sepIdx = group.key.indexOf(BUCKET_PROJECT_SEP);
        if (sepIdx <= 0) continue;
        const section = group.key.slice(0, sepIdx);
        const projectKey = group.key.slice(sepIdx + 1);
        const collapseKey = makeProjectCollapseKey(section, projectKey);
        projectKeys.push(collapseKey);

        const wsOrder = manualMode ? prefs.manualWorkspaceOrder[projectKey] ?? [] : [];
        const orderedItems =
          manualMode && wsOrder.length > 0
            ? applyManualOrder(group.items, (ref) => ref.key, wsOrder)
            : group.items;

        const subGroup: ProjectSubGroupData = {
          projectKey,
          projectDisplayName: group.title ?? projectKey,
          collapseKey,
          items: orderedItems,
        };

        if (section === RECENT_SECTION) {
          recentList.push(subGroup);
          continue;
        }

        const bucket: WorkspaceIndicator = isWorkspaceIndicator(section) ? section : "done";
        const list = byBucket.get(bucket) ?? [];
        list.push(subGroup);
        byBucket.set(bucket, list);
      }

      const orderedRecent = manualMode
        ? applyManualOrder(recentList, (p) => p.projectKey, prefs.manualProjectOrder)
        : recentList;

      const buckets: StatusBucketData[] = [];
      for (const bucket of STATUS_BUCKET_ORDER) {
        const projects = byBucket.get(bucket);
        if (!projects || projects.length === 0) continue;
        const orderedProjects = manualMode
          ? applyManualOrder(projects, (p) => p.projectKey, prefs.manualProjectOrder)
          : projects;
        buckets.push({ bucket, projects: orderedProjects });
      }

      return {
        pinnedItems: pinned,
        recentProjects: orderedRecent,
        statusBuckets: buckets,
        allVisibleProjectKeys: projectKeys,
        hasAnyWorkspace: anyWs,
      };
    }, [
      rawGroups,
      manualMode,
      prefs.manualPinnedOrder,
      prefs.manualProjectOrder,
      prefs.manualWorkspaceOrder,
    ]);

  const pinnedKeys = useMemo(() => pinnedItems.map((ref) => ref.key), [pinnedItems]);

  const collapsedBucketsSet = useMemo(
    () => new Set(prefs.collapsedBuckets),
    [prefs.collapsedBuckets],
  );
  const collapsedProjectsSet = useMemo(
    () => new Set(prefs.collapsedProjects),
    [prefs.collapsedProjects],
  );

  const hasAnyExpandedProject = useMemo(() => {
    if (!prefs.collapsedRecent1h) {
      for (const proj of recentProjects) {
        if (!collapsedProjectsSet.has(proj.collapseKey)) return true;
      }
    }
    for (const bucketData of statusBuckets) {
      if (collapsedBucketsSet.has(bucketData.bucket)) continue;
      for (const proj of bucketData.projects) {
        if (!collapsedProjectsSet.has(proj.collapseKey)) return true;
      }
    }
    return false;
  }, [
    prefs.collapsedRecent1h,
    recentProjects,
    statusBuckets,
    collapsedBucketsSet,
    collapsedProjectsSet,
  ]);

  const togglePinnedCollapsed = useCallback(() => {
    updatePrefs((prev) => ({ ...prev, collapsedPinned: !prev.collapsedPinned }));
  }, [updatePrefs]);

  const toggleRecentCollapsed = useCallback(() => {
    updatePrefs((prev) => ({ ...prev, collapsedRecent1h: !prev.collapsedRecent1h }));
  }, [updatePrefs]);

  const toggleBucketCollapsed = useCallback(
    (bucket: WorkspaceIndicator) => {
      updatePrefs((prev) => {
        const exists = prev.collapsedBuckets.includes(bucket);
        return {
          ...prev,
          collapsedBuckets: exists
            ? prev.collapsedBuckets.filter((item) => item !== bucket)
            : [...prev.collapsedBuckets, bucket],
        };
      });
    },
    [updatePrefs],
  );

  const toggleProjectCollapsed = useCallback(
    (collapseKey: string) => {
      updatePrefs((prev) => {
        const exists = prev.collapsedProjects.includes(collapseKey);
        return {
          ...prev,
          collapsedProjects: exists
            ? prev.collapsedProjects.filter((item) => item !== collapseKey)
            : [...prev.collapsedProjects, collapseKey],
        };
      });
    },
    [updatePrefs],
  );

  const handleMoveProject = useCallback(
    (visibleProjectKeys: readonly string[], projectKey: string, direction: "up" | "down") => {
      updatePrefs((prev) => ({
        ...prev,
        manualProjectOrder: moveKeyInOrder(
          prev.manualProjectOrder,
          visibleProjectKeys,
          projectKey,
          direction,
        ),
      }));
    },
    [updatePrefs],
  );

  const handleMoveWorkspace = useCallback(
    (
      projectKey: string,
      visibleKeys: readonly string[],
      workspaceKey: string,
      direction: "up" | "down",
    ) => {
      updatePrefs((prev) => {
        const currentOrder = prev.manualWorkspaceOrder[projectKey] ?? [];
        const nextOrder = moveKeyInOrder(currentOrder, visibleKeys, workspaceKey, direction);
        return {
          ...prev,
          manualWorkspaceOrder: {
            ...prev.manualWorkspaceOrder,
            [projectKey]: nextOrder,
          },
        };
      });
    },
    [updatePrefs],
  );

  const handleMovePinned = useCallback(
    (visibleKeys: readonly string[], workspaceKey: string, direction: "up" | "down") => {
      updatePrefs((prev) => ({
        ...prev,
        manualPinnedOrder: moveKeyInOrder(
          prev.manualPinnedOrder,
          visibleKeys,
          workspaceKey,
          direction,
        ),
      }));
    },
    [updatePrefs],
  );

  const toggleCollapseExpandAll = useCallback(() => {
    if (hasAnyExpandedProject) {
      updatePrefs((prev) => ({
        ...prev,
        collapsedProjects: Array.from(
          new Set([...prev.collapsedProjects, ...allVisibleProjectKeys]),
        ),
      }));
    } else {
      updatePrefs((prev) => ({
        ...prev,
        collapsedBuckets: [],
        collapsedProjects: [],
        collapsedPinned: false,
        collapsedRecent1h: false,
      }));
    }
  }, [hasAnyExpandedProject, allVisibleProjectKeys, updatePrefs]);

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setSearchOpen(false);
    if (activeHostFilters.length > 0) {
      updatePrefs((prev) => ({ ...prev, hostFilters: [] }));
    }
  }, [activeHostFilters.length, updatePrefs]);

  const handleOpenActions = useCallback((target: ActionModalTarget) => {
    setActionTarget(target);
  }, []);

  const handleCloseActions = useCallback((nextOpen: boolean) => {
    if (!nextOpen) setActionTarget(null);
  }, []);

  const c = view.theme.colors;
  const hasActiveFilter = normalizedQuery.length > 0 || activeHostFilters.length > 0;
  const showRecentSection = recentProjects.length > 0;

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 16,
          paddingTop: 6,
          paddingBottom: 4,
          gap: 6,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{
              fontSize: 12,
              lineHeight: 16,
              fontWeight: "500",
              color: c.foregroundMuted,
            }}
          >
            {t("header.title")}
          </Text>
          {activeHostFilters.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("header.options")}
              onPress={() => setOptionsOpen(true)}
              style={{
                paddingHorizontal: 5,
                paddingVertical: 1,
                borderRadius: 4,
                borderWidth: 1,
                borderColor: c.border,
                backgroundColor: c.surface1,
              }}
            >
              <Text style={{ fontSize: 10.5, lineHeight: 13, color: c.accent }}>
                {t("header.hostsBadge", { count: activeHostFilters.length })}
              </Text>
            </Pressable>
          ) : null}
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          <HeaderIconButton
            icon="Search"
            label={t("header.searchToggle")}
            active={searchOpen || normalizedQuery.length > 0}
            theme={view.theme}
            onPress={() => {
              setSearchOpen((prev) => {
                if (prev && searchQuery) setSearchQuery("");
                return !prev;
              });
            }}
          />
          {allVisibleProjectKeys.length > 0 ? (
            <HeaderIconButton
              icon={hasAnyExpandedProject ? "ChevronsDownUp" : "ChevronsUpDown"}
              label={hasAnyExpandedProject ? t("header.collapseAll") : t("header.expandAll")}
              theme={view.theme}
              onPress={toggleCollapseExpandAll}
            />
          ) : null}
          <HeaderIconButton
            icon="SlidersHorizontal"
            label={t("header.options")}
            active={optionsOpen || activeHostFilters.length > 0}
            theme={view.theme}
            onPress={() => setOptionsOpen(true)}
          />
        </View>
      </View>

      {searchOpen ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginHorizontal: 12,
            marginBottom: 6,
            paddingHorizontal: 8,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surface0,
            gap: 6,
          }}
        >
          <Icon name="Search" size={12} color={c.foregroundMuted} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t("header.searchPlaceholder")}
            placeholderTextColor={c.foregroundMuted}
            autoFocus
            style={{
              flex: 1,
              minWidth: 0,
              color: c.foreground,
              fontSize: 12.5,
              paddingVertical: 5,
            }}
          />
          {searchQuery.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("header.clearSearch")}
              onPress={() => setSearchQuery("")}
              style={{ width: 20, height: 20, alignItems: "center", justifyContent: "center" }}
            >
              <Icon name="X" size={12} color={c.foregroundMuted} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 8, paddingTop: 2, paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
      >
        {pinnedItems.length > 0 ? (
          <View style={{ marginBottom: 4 }}>
            <View
              onPointerEnter={() => setPinnedHovered(true)}
              onPointerLeave={() => setPinnedHovered(false)}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("pinned.toggle")}
                accessibilityState={{ expanded: !prefs.collapsedPinned }}
                onPress={togglePinnedCollapsed}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  minHeight: 28,
                  paddingHorizontal: ROW_PADDING_X,
                  paddingVertical: 4,
                  marginBottom: prefs.collapsedPinned ? 2 : 4,
                  gap: ROW_GAP,
                  borderRadius: 6,
                  backgroundColor: pressed
                    ? c.surface2
                    : pinnedHovered
                      ? c.surface1
                      : "transparent",
                })}
              >
                <View
                  style={{
                    width: LEADING_SLOT_WIDTH,
                    height: TITLE_LINE_HEIGHT,
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {pinnedHovered ? (
                    <Icon
                      name={prefs.collapsedPinned ? "ChevronRight" : "ChevronDown"}
                      size={14}
                      color={c.foregroundMuted}
                    />
                  ) : (
                    <Icon name="Pin" size={13} color={c.foregroundMuted} />
                  )}
                </View>
                <Text
                  numberOfLines={1}
                  style={{
                    flex: 1,
                    fontSize: 13,
                    lineHeight: TITLE_LINE_HEIGHT,
                    fontWeight: "400",
                    color: c.foregroundMuted,
                    opacity: prefs.collapsedPinned ? 0.72 : 1,
                  }}
                >
                  {t("pinned.title")}
                </Text>
              </Pressable>
            </View>

            {!prefs.collapsedPinned ? (
              <View>
                {pinnedItems.map((wsRef, idx) => (
                  <WorkspaceItemRow
                    key={wsRef.key}
                    reference={wsRef}
                    view={view}
                    dark={dark}
                    showMeta={prefs.showMeta}
                    showProjectTag
                    hostLabel={multiHost ? hostLabelById.get(wsRef.hostId) ?? null : null}
                    nowMs={nowMs}
                    manualMode={manualMode}
                    canMoveUp={idx > 0}
                    canMoveDown={idx < pinnedItems.length - 1}
                    onMove={(dir) => handleMovePinned(pinnedKeys, wsRef.key, dir)}
                    onOpenActions={(ref) =>
                      handleOpenActions({
                        ref,
                        reorderScope: "pinned",
                        visibleKeys: pinnedKeys,
                      })
                    }
                  />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {showRecentSection ? (
          <RecentActiveSection
            projects={recentProjects}
            recentActiveMinutes={prefs.recentActiveMinutes}
            isFirst={pinnedItems.length === 0}
            view={view}
            dark={dark}
            collapsed={prefs.collapsedRecent1h}
            collapsedProjectsSet={collapsedProjectsSet}
            showMeta={prefs.showMeta}
            multiHost={multiHost}
            hostLabelById={hostLabelById}
            nowMs={nowMs}
            manualMode={manualMode}
            onMoveProject={handleMoveProject}
            onMoveWorkspace={handleMoveWorkspace}
            onToggleSection={toggleRecentCollapsed}
            onToggleProject={toggleProjectCollapsed}
            onOpenActions={handleOpenActions}
          />
        ) : null}

        {!hasAnyWorkspace ? (
          <View style={{ paddingHorizontal: 10, paddingVertical: 20, gap: 10 }}>
            <Text style={{ color: c.foregroundMuted, fontSize: 13, lineHeight: 18 }}>
              {hasActiveFilter ? t("empty.noMatches") : t("empty.noWorkspaces")}
            </Text>
            {hasActiveFilter ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("empty.clearFilter")}
                onPress={handleClearFilters}
                style={({ pressed }) => ({
                  alignSelf: "flex-start",
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: c.border,
                  backgroundColor: pressed ? c.surface2 : c.surface1,
                })}
              >
                <Text style={{ color: c.foreground, fontSize: 12.5 }}>
                  {t("empty.clearFilter")}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          statusBuckets.map((bucketData, idx) => (
            <StatusBucketSection
              key={bucketData.bucket}
              data={bucketData}
              isFirst={idx === 0 && pinnedItems.length === 0 && !showRecentSection}
              view={view}
              dark={dark}
              collapsed={collapsedBucketsSet.has(bucketData.bucket)}
              collapsedProjectsSet={collapsedProjectsSet}
              showMeta={prefs.showMeta}
              multiHost={multiHost}
              hostLabelById={hostLabelById}
              nowMs={nowMs}
              manualMode={manualMode}
              onMoveProject={handleMoveProject}
              onMoveWorkspace={handleMoveWorkspace}
              onToggleBucket={toggleBucketCollapsed}
              onToggleProject={toggleProjectCollapsed}
              onOpenActions={handleOpenActions}
            />
          ))
        )}
      </ScrollView>

      <DisplayOptionsModal
        open={optionsOpen}
        onOpenChange={setOptionsOpen}
        theme={view.theme}
        prefs={prefs}
        hosts={hosts}
        activeHostFilters={activeHostFilters}
        onUpdatePrefs={updatePrefs}
      />

      <WorkspaceActionsModal
        target={actionTarget}
        open={actionTarget !== null}
        onOpenChange={handleCloseActions}
        view={view}
        hostLabelById={hostLabelById}
        manualMode={manualMode}
        onMoveWorkspace={handleMoveWorkspace}
        onMovePinned={handleMovePinned}
      />
    </View>
  );
}

export function contributeStatusByProjectSidebarView(client: PluginClientContext) {
  return client.addSidebarView({
    id: SIDEBAR_STATUS_PROJECTS_VIEW_ID,
    title: sidebarMessages.message("view.title"),
    description: sidebarMessages.message("view.description"),
    Component: StatusByProjectSidebarView,
  });
}
