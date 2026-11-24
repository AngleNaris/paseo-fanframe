import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const VISUALIZE_TIMELINE_KIND = "fanframe-visualize" as const;
export const VISUALIZE_TIMELINE_VERSION = 2 as const;

export const visualizeTimelineDataSchema = z.object({
  cardId: z.string(),
  title: z.string(),
  html: z.string().optional(),
});

export type VisualizeTimelineData = z.output<typeof visualizeTimelineDataSchema>;

export const getVisualizeCardRpc = defineRpc({
  name: "fanframe.visualize.get",
  input: z.object({ cardId: z.string() }),
  output: z
    .object({
      title: z.string(),
      html: z.string(),
    })
    .nullable(),
});
