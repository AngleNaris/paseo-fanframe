import { defineAgentTool, type PluginServerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import { registerCrossImageHandlers } from "./server/cross-image";
import { inspectMediaRpc, readMediaBytesRpc, type MediaKind } from "./shared/media";
import {
  getVisualizeCardRpc,
  VISUALIZE_TIMELINE_KIND,
  VISUALIZE_TIMELINE_VERSION,
} from "./shared/visualize";

// Minimal Node fs/path bridge via dynamic import so tsconfig stays DOM/Node-free.
type FsModule = {
  stat(path: string): Promise<{ isFile(): boolean; size: number }>;
  readFile(path: string): Promise<Uint8Array>;
};
type PathModule = {
  extname(p: string): string;
  basename(p: string): string;
  isAbsolute(p: string): boolean;
};

let fsPromise: Promise<FsModule> | null = null;
let pathPromise: Promise<PathModule> | null = null;
const loadFs = (): Promise<FsModule> => (fsPromise ??= import("node:fs/promises" as string) as Promise<FsModule>);
const loadPath = (): Promise<PathModule> => (pathPromise ??= import("node:path" as string) as Promise<PathModule>);

const MEDIA_EXT_MAP: Record<string, { kind: MediaKind; mime: string; maxBytes: number }> = {
  ".mp4": { kind: "video", mime: "video/mp4", maxBytes: 128 * 1024 * 1024 },
  ".webm": { kind: "video", mime: "video/webm", maxBytes: 128 * 1024 * 1024 },
  ".mov": { kind: "video", mime: "video/quicktime", maxBytes: 128 * 1024 * 1024 },
  ".m4v": { kind: "video", mime: "video/mp4", maxBytes: 128 * 1024 * 1024 },
  ".mp3": { kind: "audio", mime: "audio/mpeg", maxBytes: 32 * 1024 * 1024 },
  ".wav": { kind: "audio", mime: "audio/wav", maxBytes: 32 * 1024 * 1024 },
  ".ogg": { kind: "audio", mime: "audio/ogg", maxBytes: 32 * 1024 * 1024 },
  ".m4a": { kind: "audio", mime: "audio/mp4", maxBytes: 32 * 1024 * 1024 },
  ".flac": { kind: "audio", mime: "audio/flac", maxBytes: 48 * 1024 * 1024 },
  ".png": { kind: "image", mime: "image/png", maxBytes: 24 * 1024 * 1024 },
  ".jpg": { kind: "image", mime: "image/jpeg", maxBytes: 24 * 1024 * 1024 },
  ".jpeg": { kind: "image", mime: "image/jpeg", maxBytes: 24 * 1024 * 1024 },
  ".webp": { kind: "image", mime: "image/webp", maxBytes: 24 * 1024 * 1024 },
  ".gif": { kind: "image", mime: "image/gif", maxBytes: 24 * 1024 * 1024 },
  ".pdf": { kind: "pdf", mime: "application/pdf", maxBytes: 32 * 1024 * 1024 },
  ".txt": { kind: "text", mime: "text/plain; charset=utf-8", maxBytes: 2 * 1024 * 1024 },
  ".md": { kind: "text", mime: "text/markdown; charset=utf-8", maxBytes: 2 * 1024 * 1024 },
  ".csv": { kind: "text", mime: "text/csv; charset=utf-8", maxBytes: 2 * 1024 * 1024 },
  ".tsv": { kind: "text", mime: "text/tab-separated-values; charset=utf-8", maxBytes: 2 * 1024 * 1024 },
  ".json": { kind: "text", mime: "application/json; charset=utf-8", maxBytes: 2 * 1024 * 1024 },
};

function normalizeLocalFilePath(raw: string): string {
  let trimmed = raw.trim();
  if (/^file:\/\//i.test(trimmed)) {
    try {
      trimmed = decodeURIComponent(trimmed.replace(/^file:\/\//i, ""));
      if (/^\/[a-zA-Z]:/.test(trimmed)) trimmed = trimmed.slice(1);
    } catch {
      // Keep raw fallback.
    }
  }
  return trimmed;
}

const MAX_HTML_BYTES = 256 * 1024;
const INLINE_HTML_LIMIT = 48 * 1024;
const MAX_CACHED_CARDS = 100;
let cardSeq = 0;

function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

const VISUALIZE_WHEN =
  "When fanframe_visualize is available, call it once before the final answer if reliable data shows a multi-point trend, distribution, composition, or meaningful differences across groups. Do this without waiting for a request to draw. Use the simplest useful chart and keep the takeaway in text.";
const VISUALIZE_SKIP =
  "Skip the card if the user asks for text only or a conflicting format, if the answer is a short lookup, if the data is missing or unreliable, or if the chart would just repeat the answer without helping. Never invent values, units, or sources.";
const GRAPHICS_FIRST =
  "If a graphic can express it, use the graphic instead of words. Encode trends and relationships with position, shape and color; keep only necessary labels, units, legends and accessible equivalents.";
const VISUALIZE_GUIDANCE = `${VISUALIZE_WHEN}\n${VISUALIZE_SKIP}\n${GRAPHICS_FIRST}\nTo preview a local video, audio, PDF, or text file inline in your reply, emit a fenced \`\`\`fanframe-media (or \`\`\`dsh-media) block containing JSON {"path":"<absolute-path>","title":"<label>"}.`;

const TOOL_DESCRIPTION =
  "Display a lightweight, self-contained interactive HTML card in the reply. Default to one card for a reliable multi-point trend, distribution, composition, or comparison across groups; no explicit drawing request is needed. Skip short lookups, conflicting formats, unreliable data and redundant charts. Inline CSS/JavaScript, SVG and canvas are supported; external resources, requests and host APIs are not provided. The card renders only after this call succeeds.";

const HTML_PARAM_DESCRIPTION =
  `Self-contained HTML fragment with inline CSS/JS, up to 256 KiB UTF-8. No Markdown fences or document wrapper. ${GRAPHICS_FIRST} ` +
  "Use --fanframe-viz-series-1 (soft amber) and --fanframe-viz-series-2 (mist blue) for comparable series, --fanframe-viz-highlight (teal) for the active mark, and --fanframe-viz-muted / --fanframe-viz-border for axes and guides. " +
  'Built-in stroke icons: <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><use href="#fanframe-icon-sun"/></svg>. ' +
  "Names: sun, cloud, cloud-sun, rain, storm, snow, wind, thermometer, trend-up, trend-down, calendar, clock, info, check, chevron-right. " +
  'Use labeled native <button type="button">, <input type="range">, single-choice <select> with <option>, and <input type="checkbox">; FanFrame styles them. ' +
  "The card supplies the surface, border and title: no duplicate title, wrapper, gradient, fixed viewport height, focus outline or ring.";

interface PendingCard {
  cardId: string;
  title: string;
  html: string;
  inline: boolean;
}

const cardCache = new Map<string, { title: string; html: string }>();
const pendingByAgent = new Map<string, PendingCard[]>();

function cacheCard(cardId: string, title: string, html: string): void {
  cardCache.set(cardId, { title, html });
  if (cardCache.size > MAX_CACHED_CARDS) {
    const oldest = cardCache.keys().next().value;
    if (oldest) cardCache.delete(oldest);
  }
}

const visualizeTool = defineAgentTool({
  name: "fanframe_visualize",
  title: "FanFrame Visualize",
  description: TOOL_DESCRIPTION,
  input: z.object({
    title: z.string().describe("Short card title, at most 160 characters after trimming."),
    html: z.string().describe(HTML_PARAM_DESCRIPTION),
  }),
  async execute(args, { agent, paseo, signal }) {
    if (signal.aborted) {
      return { text: "Visualization aborted.", isError: true };
    }
    const title = args.title.trim();
    if (!title || title.length > 160) {
      return { text: "title must contain 1-160 characters.", isError: true };
    }
    if (!args.html.trim()) {
      return { text: "html must not be blank.", isError: true };
    }
    const htmlBytes = utf8ByteLength(args.html);
    if (htmlBytes > MAX_HTML_BYTES) {
      return { text: "html exceeds 256 KiB UTF-8.", isError: true };
    }

    const cardId = `${Date.now().toString(36)}-${(++cardSeq).toString(36)}`;
    cacheCard(cardId, title, args.html);

    // Queue card until agent.turn_ended: if the assistant embeds [[fanframe-viz:<cardId>]]
    // inline in its prose reply, the client renders it in-place; otherwise we append it at the end.
    const queue = pendingByAgent.get(agent.id) ?? [];
    queue.push({
      cardId,
      title,
      html: args.html,
      inline: htmlBytes <= INLINE_HTML_LIMIT,
    });
    pendingByAgent.set(agent.id, queue);

    return {
      text: `Visualization ready: ${title}. To place it at a specific spot inside your reply, put [[fanframe-viz:${cardId}]] on its own line there; if omitted, it will appear at the end of your reply.`,
    };
  },
});

export default function contribute(server: PluginServerContext) {
  const removeHook = server.before("agent.session_open", ({ request }) => {
    const existing = request.tools ?? [];
    const hasTool = existing.some((t) => t.name === visualizeTool.name);
    const existingPrompts = request.appendSystemPrompt ?? [];
    const hasGuidance = existingPrompts.includes(VISUALIZE_GUIDANCE);
    return {
      ...request,
      tools: hasTool ? existing : [...existing, visualizeTool],
      appendSystemPrompt: hasGuidance
        ? existingPrompts
        : [...existingPrompts, VISUALIZE_GUIDANCE],
    };
  });

  const removeTurnEnded = server.on("agent.turn_ended", async ({ agent }, { paseo }) => {
    const queue = pendingByAgent.get(agent.id);
    if (!queue || queue.length === 0) return;
    pendingByAgent.delete(agent.id);

    let recentText = "";
    try {
      const tail = await paseo.agents.ref(agent.id).timeline.refetch({
        direction: "tail",
        limit: 6,
      });
      for (const entry of tail.entries) {
        if (entry.item.type === "assistant_message" && typeof entry.item.text === "string") {
          recentText += "\n" + entry.item.text;
        }
      }
    } catch {
      // Fall back to appending if timeline refetch fails.
    }

    for (const card of queue) {
      if (recentText.includes(`[[fanframe-viz:${card.cardId}]]`)) {
        continue;
      }
      await paseo.agents.ref(agent.id).timeline.append({
        type: "plugin",
        id: `fanframe-viz-${card.cardId}`,
        kind: VISUALIZE_TIMELINE_KIND,
        version: VISUALIZE_TIMELINE_VERSION,
        data: card.inline
          ? { cardId: card.cardId, title: card.title, html: card.html }
          : { cardId: card.cardId, title: card.title },
      });
    }
  });

  const cleanupCrossImage = registerCrossImageHandlers(server);

  server.handle(getVisualizeCardRpc, async ({ cardId }) => {
    return cardCache.get(cardId) ?? null;
  });

  server.handle(inspectMediaRpc, async ({ path: rawPath }) => {
    const filePath = normalizeLocalFilePath(rawPath);
    const pathMod = await loadPath();
    if (!pathMod.isAbsolute(filePath)) {
      return { ok: false, error: "Path must be absolute." };
    }
    const ext = pathMod.extname(filePath).toLowerCase();
    const spec = MEDIA_EXT_MAP[ext];
    if (!spec) {
      return { ok: false, error: `Unsupported media extension: ${ext || "(none)"}` };
    }
    try {
      const fsMod = await loadFs();
      const stat = await fsMod.stat(filePath);
      if (!stat.isFile()) return { ok: false, error: "Not a regular file." };
      if (stat.size > spec.maxBytes) {
        return { ok: false, error: `File exceeds preview limit (${Math.round(spec.maxBytes / 1024 / 1024)} MiB).` };
      }
      return {
        ok: true,
        kind: spec.kind,
        mime: spec.mime,
        name: pathMod.basename(filePath),
        size: stat.size,
      };
    } catch {
      return { ok: false, error: "File not found or unreadable." };
    }
  });

  server.handle(readMediaBytesRpc, async ({ path: rawPath }) => {
    const filePath = normalizeLocalFilePath(rawPath);
    const pathMod = await loadPath();
    if (!pathMod.isAbsolute(filePath)) {
      throw new Error("Path must be absolute.");
    }
    const ext = pathMod.extname(filePath).toLowerCase();
    const spec = MEDIA_EXT_MAP[ext];
    if (!spec) {
      throw new Error(`Unsupported media extension: ${ext}`);
    }
    const fsMod = await loadFs();
    const stat = await fsMod.stat(filePath);
    if (!stat.isFile() || stat.size > spec.maxBytes) {
      throw new Error("File is unavailable or exceeds preview size limit.");
    }
    const data = await fsMod.readFile(filePath);
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  });

  return () => {
    cleanupCrossImage();
    removeTurnEnded();
    removeHook();
    pendingByAgent.clear();
    cardCache.clear();
  };
}
