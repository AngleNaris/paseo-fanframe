import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const SIDEBAR_STATUS_PROJECTS_VIEW_ID = "status-by-project";

export const sidebarSortModeSchema = z.enum(["recent", "name", "manual"]);
export type SidebarSortMode = z.output<typeof sidebarSortModeSchema>;

export const RECENT_ACTIVE_PRESET_MINUTES = [0, 15, 30, 60, 180, 360, 1440] as const;
export const MAX_RECENT_ACTIVE_MINUTES = 43200; // 30 days

export const sidebarStatusViewSettings = defineSettings({
  id: "sidebar-status-projects",
  scope: "device",
  version: 1,
  schema: z.object({
    collapsedBuckets: z.array(z.string()).default([]),
    collapsedProjects: z.array(z.string()).default([]),
    collapsedPinned: z.boolean().default(false),
    collapsedRecent1h: z.boolean().default(false),
    /** Minutes for the recently active staging area; 0 means running conversations only. */
    recentActiveMinutes: z.number().int().min(0).max(MAX_RECENT_ACTIVE_MINUTES).default(60),
    showRecentActive: z.boolean().default(true),
    projectSort: sidebarSortModeSchema.default("recent"),
    manualProjectOrder: z.array(z.string()).default([]),
    manualWorkspaceOrder: z.record(z.string(), z.array(z.string())).default({}),
    manualPinnedOrder: z.array(z.string()).default([]),
    showMeta: z.boolean().default(true),
    showBackground: z.boolean().default(false),
    hostFilters: z.array(z.string()).default([]),
  }),
});

export type SidebarStatusViewSettingsValues = z.output<typeof sidebarStatusViewSettings.schema>;

export const DEFAULT_SIDEBAR_STATUS_VIEW_SETTINGS: SidebarStatusViewSettingsValues = {
  collapsedBuckets: [],
  collapsedProjects: [],
  collapsedPinned: false,
  collapsedRecent1h: false,
  recentActiveMinutes: 60,
  showRecentActive: true,
  projectSort: "recent",
  manualProjectOrder: [],
  manualWorkspaceOrder: {},
  manualPinnedOrder: [],
  showMeta: true,
  showBackground: false,
  hostFilters: [],
};

export function makeProjectCollapseKey(section: string, projectKey: string): string {
  return `${section}::${projectKey}`;
}
