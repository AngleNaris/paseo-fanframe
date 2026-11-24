import { z } from "zod";

export const RICH_MESSAGE_TIMELINE_KIND = "fanframe-rich-message";
export const RICH_MESSAGE_TIMELINE_VERSION = 1;

export const richMessageSegmentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("markdown"),
    text: z.string(),
  }),
  z.object({
    kind: z.literal("media"),
    path: z.string().min(1),
    title: z.string().optional(),
  }),
  z.object({
    kind: z.literal("viz"),
    cardId: z.string().min(1),
  }),
]);

export const richMessageTimelineDataSchema = z.object({
  segments: z.array(richMessageSegmentSchema).min(1),
});

export type RichMessageSegment = z.infer<typeof richMessageSegmentSchema>;
export type RichMessageTimelineData = z.infer<typeof richMessageTimelineDataSchema>;

// Match fenced ```fanframe-media / ```dsh-media JSON blocks or standalone [[fanframe-viz:<id>]] lines.
const RICH_TOKEN_RE =
  /```(?:fanframe|dsh)-media[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*|^[ \t]*\[\[fanframe-viz:([a-z0-9-]+)\]\][ \t]*$/gim;

function tryParseMediaJson(raw: string): { path: string; title?: string } | null {
  try {
    const parsed = JSON.parse(raw.trim()) as { path?: unknown; title?: unknown };
    if (typeof parsed.path !== "string" || !parsed.path.trim()) return null;
    const title = typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : undefined;
    return title ? { path: parsed.path.trim(), title } : { path: parsed.path.trim() };
  } catch {
    return null;
  }
}

export function parseRichMessageSegments(text: string): RichMessageTimelineData | null {
  if (
    !text ||
    (!text.includes("fanframe-media") &&
      !text.includes("dsh-media") &&
      !text.includes("[[fanframe-viz:"))
  ) {
    return null;
  }

  RICH_TOKEN_RE.lastIndex = 0;
  const segments: RichMessageSegment[] = [];
  let cursor = 0;
  let hasRich = false;

  let match: RegExpExecArray | null;
  while ((match = RICH_TOKEN_RE.exec(text)) !== null) {
    const full = match[0]!;
    const mediaBody = match[1];
    const vizId = match[2];

    let richSegment: RichMessageSegment | null = null;
    if (typeof mediaBody === "string") {
      const parsed = tryParseMediaJson(mediaBody);
      if (parsed) {
        richSegment = {
          kind: "media",
          path: parsed.path,
          ...(parsed.title ? { title: parsed.title } : {}),
        };
      }
    } else if (typeof vizId === "string" && vizId.trim()) {
      richSegment = { kind: "viz", cardId: vizId.trim() };
    }

    if (!richSegment) continue;

    const before = text.slice(cursor, match.index).trim();
    if (before) {
      segments.push({ kind: "markdown", text: before });
    }
    segments.push(richSegment);
    hasRich = true;
    cursor = match.index + full.length;
  }

  if (!hasRich) return null;

  const tail = text.slice(cursor).trim();
  if (tail) {
    segments.push({ kind: "markdown", text: tail });
  }

  return { segments };
}
