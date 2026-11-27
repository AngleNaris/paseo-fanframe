import { defineAgentTool, type PluginServerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import { registerCrossFileHandlers } from "./server/cross-file";
import { registerCrossImageHandlers } from "./server/cross-image";
import {
  inspectMediaRpc,
  mediaAccessSettings,
  readMediaBytesRpc,
  type MediaKind,
} from "./shared/media";
import {
  getVisualizeCardRpc,
  VISUALIZE_TIMELINE_KIND,
  VISUALIZE_TIMELINE_VERSION,
} from "./shared/visualize";

// Minimal Node fs/path/process bridge via dynamic import so tsconfig stays DOM/Node-free.
type FsFileHandle = {
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
};
type FsModule = {
  stat(path: string): Promise<{ isFile(): boolean; size: number; mtimeMs: number }>;
  realpath(path: string): Promise<string>;
  readFile(path: string): Promise<Uint8Array>;
  open(path: string, flags: string): Promise<FsFileHandle>;
};
type PathModule = {
  extname(p: string): string;
  basename(p: string): string;
  isAbsolute(p: string): boolean;
  relative(from: string, to: string): string;
};
type ProcessModule = {
  platform: string;
};

let fsPromise: Promise<FsModule> | null = null;
let pathPromise: Promise<PathModule> | null = null;
let processPromise: Promise<ProcessModule> | null = null;
const loadFs = (): Promise<FsModule> => (fsPromise ??= import("node:fs/promises" as string) as Promise<FsModule>);
const loadPath = (): Promise<PathModule> => (pathPromise ??= import("node:path" as string) as Promise<PathModule>);
const loadProcess = (): Promise<ProcessModule> =>
  (processPromise ??= import("node:process" as string) as Promise<ProcessModule>);

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
  const cleanupCrossFile = registerCrossFileHandlers(server);
  const mediaSettings = server.registerSettings(mediaAccessSettings);

  const isWithinCanonicalRoot = (
    pathMod: PathModule,
    resolvedFile: string,
    resolvedRoot: string,
    caseInsensitive: boolean,
  ): boolean => {
    const fileCmp = caseInsensitive ? resolvedFile.toLowerCase() : resolvedFile;
    const rootCmp = caseInsensitive ? resolvedRoot.toLowerCase() : resolvedRoot;
    const rel = pathMod.relative(rootCmp, fileCmp);
    if (!rel) return false;
    return rel !== ".." && !rel.startsWith("..\\") && !rel.startsWith("../") && !pathMod.isAbsolute(rel);
  };

  type AuthorizedMediaResult =
    | {
        ok: true;
        resolvedPath: string;
        spec: { kind: MediaKind; mime: string; maxBytes: number };
        name: string;
        size: number;
        mtimeMs: number;
      }
    | {
        ok: false;
        blocked?: boolean;
        error: string;
      };

  const resolveAuthorizedMediaFile = async (
    agentId: string,
    rawPath: string,
    paseo: Parameters<Parameters<PluginServerContext["handle"]>[1]>[1]["paseo"],
  ): Promise<AuthorizedMediaResult> => {
    const filePath = normalizeLocalFilePath(rawPath);
    const [fsMod, pathMod, procMod] = await Promise.all([loadFs(), loadPath(), loadProcess()]);
    if (!pathMod.isAbsolute(filePath)) {
      return { ok: false, error: "Path must be absolute." };
    }
    const ext = pathMod.extname(filePath).toLowerCase();
    const spec = MEDIA_EXT_MAP[ext];
    if (!spec) {
      return { ok: false, error: `Unsupported media extension: ${ext || "(none)"}` };
    }

    // Read host-scoped media access settings (defaults to strict workspace-only containment).
    let allowAllPaths = false;
    const configuredExtraDirs: string[] = [];
    try {
      const settingsState = await mediaSettings.read();
      if (settingsState.status === "ready") {
        allowAllPaths = settingsState.values.allowAllPaths === true;
        for (const dir of settingsState.values.extraAllowedDirs) {
          const normalized = normalizeLocalFilePath(dir);
          if (normalized && pathMod.isAbsolute(normalized)) {
            configuredExtraDirs.push(normalized);
          }
        }
      }
    } catch {
      // Fall back to strict workspace-only containment if settings cannot be read.
    }

    let resolvedFile: string;
    if (allowAllPaths) {
      try {
        resolvedFile = await fsMod.realpath(filePath);
      } catch {
        return { ok: false, error: "File not found or unreadable." };
      }
    } else {
      // Resolve the active conversation's workspace root from the daemon.
      const agentRef = paseo.agents.ref(agentId);
      let workspaceCwd = agentRef.cwd;
      if (!workspaceCwd) {
        try {
          const refreshed = await agentRef.refresh();
          workspaceCwd = refreshed?.agent.cwd ?? agentRef.cwd;
        } catch {
          workspaceCwd = agentRef.cwd;
        }
      }
      if (!workspaceCwd) {
        return {
          ok: false,
          blocked: true,
          error: "Unable to verify the active workspace directory for this agent.",
        };
      }

      const candidateRoots: string[] = [workspaceCwd, ...configuredExtraDirs];
      const canonicalRoots: string[] = [];
      for (const root of candidateRoots) {
        try {
          canonicalRoots.push(await fsMod.realpath(root));
        } catch {
          // Ignore missing or inaccessible root entries.
        }
      }
      if (canonicalRoots.length === 0) {
        return {
          ok: false,
          blocked: true,
          error: "No accessible workspace root could be resolved.",
        };
      }

      // Resolve symlinks and relative segments on the target file before checking containment.
      const caseInsensitive = procMod.platform === "win32";
      try {
        resolvedFile = await fsMod.realpath(filePath);
      } catch {
        // Avoid revealing whether files outside allowed roots exist.
        const lexicallyAllowed = candidateRoots.some((root) =>
          isWithinCanonicalRoot(pathMod, filePath, root, caseInsensitive),
        );
        if (!lexicallyAllowed) {
          return {
            ok: false,
            blocked: true,
            error:
              "File is outside the active workspace. Add its directory in Settings -> Plugins -> FanFrame to allow preview.",
          };
        }
        return { ok: false, error: "File not found or unreadable." };
      }

      const allowed = canonicalRoots.some((root) =>
        isWithinCanonicalRoot(pathMod, resolvedFile, root, caseInsensitive),
      );
      if (!allowed) {
        return {
          ok: false,
          blocked: true,
          error:
            "File is outside the active workspace. Add its directory in Settings -> Plugins -> FanFrame to allow preview.",
        };
      }
    }

    try {
      const stat = await fsMod.stat(resolvedFile);
      if (!stat.isFile()) return { ok: false, error: "Not a regular file." };
      if (stat.size > spec.maxBytes) {
        return {
          ok: false,
          error: `File exceeds preview limit (${Math.round(spec.maxBytes / 1024 / 1024)} MiB).`,
        };
      }
      return {
        ok: true,
        resolvedPath: resolvedFile,
        spec,
        name: pathMod.basename(resolvedFile),
        size: stat.size,
        mtimeMs: Math.round(stat.mtimeMs),
      };
    } catch {
      return { ok: false, error: "File not found or unreadable." };
    }
  };

  server.handle(getVisualizeCardRpc, async ({ cardId }) => {
    return cardCache.get(cardId) ?? null;
  });

  server.handle(inspectMediaRpc, async ({ agentId, path: rawPath }, { paseo }) => {
    const auth = await resolveAuthorizedMediaFile(agentId, rawPath, paseo);
    if (!auth.ok) {
      return {
        ok: false,
        ...(auth.blocked ? { blocked: true } : {}),
        error: auth.error,
      };
    }
    return {
      ok: true,
      kind: auth.spec.kind,
      mime: auth.spec.mime,
      name: auth.name,
      size: auth.size,
      mtimeMs: auth.mtimeMs,
      supportsChunks: true,
    };
  });

  server.handle(readMediaBytesRpc, async ({ agentId, path: rawPath, offset, length }, { paseo }) => {
    const auth = await resolveAuthorizedMediaFile(agentId, rawPath, paseo);
    if (!auth.ok) {
      throw new Error(auth.error);
    }
    const fsMod = await loadFs();
    if (offset === undefined && length === undefined) {
      const data = await fsMod.readFile(auth.resolvedPath);
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }

    const start = Math.max(0, offset ?? 0);
    if (start >= auth.size) {
      return new Uint8Array(0);
    }
    const toRead = Math.min(length ?? auth.size - start, auth.size - start);
    const handle = await fsMod.open(auth.resolvedPath, "r");
    try {
      const buf = new Uint8Array(toRead);
      const { bytesRead } = await handle.read(buf, 0, toRead, start);
      return bytesRead === toRead ? buf : buf.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  });

  return () => {
    cleanupCrossFile();
    cleanupCrossImage();
    removeTurnEnded();
    removeHook();
    pendingByAgent.clear();
    cardCache.clear();
  };
}
