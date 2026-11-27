import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const mediaKindSchema = z.enum(["video", "audio", "image", "pdf", "text"]);
export type MediaKind = z.output<typeof mediaKindSchema>;

export const mediaAccessSettings = defineSettings({
  id: "media-access",
  scope: "host",
  version: 1,
  schema: z.object({
    /** Opt-in host toggle to bypass workspace/directory containment (default: false). */
    allowAllPaths: z.boolean().default(false),
    /** Additional absolute directories explicitly allowed by the user on this host. */
    extraAllowedDirs: z.array(z.string().min(1)).default([]),
  }),
});

export type MediaAccessSettingsValues = z.output<typeof mediaAccessSettings.schema>;

export const inspectMediaRpc = defineRpc({
  name: "fanframe.media.inspect",
  input: z.object({
    agentId: z.string().min(1).max(128),
    path: z.string().min(1),
  }),
  output: z.object({
    ok: z.boolean(),
    blocked: z.boolean().optional(),
    error: z.string().optional(),
    kind: mediaKindSchema.optional(),
    mime: z.string().optional(),
    name: z.string().optional(),
    size: z.number().optional(),
    mtimeMs: z.number().optional(),
    supportsChunks: z.boolean().optional(),
  }),
});

export const readMediaBytesRpc = defineRpc({
  name: "fanframe.media.read_bytes",
  input: z.object({
    agentId: z.string().min(1).max(128),
    path: z.string().min(1),
    offset: z.number().int().nonnegative().optional(),
    length: z.number().int().positive().max(16 * 1024 * 1024).optional(),
  }),
  output: z.instanceof(Uint8Array),
});
