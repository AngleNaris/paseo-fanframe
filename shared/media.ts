import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const mediaKindSchema = z.enum(["video", "audio", "image", "pdf", "text"]);
export type MediaKind = z.output<typeof mediaKindSchema>;

export const inspectMediaRpc = defineRpc({
  name: "fanframe.media.inspect",
  input: z.object({ path: z.string() }),
  output: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
    kind: mediaKindSchema.optional(),
    mime: z.string().optional(),
    name: z.string().optional(),
    size: z.number().optional(),
  }),
});

export const readMediaBytesRpc = defineRpc({
  name: "fanframe.media.read_bytes",
  input: z.object({ path: z.string() }),
  output: z.instanceof(Uint8Array),
});
