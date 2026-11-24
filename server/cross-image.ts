import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  CROSS_IMAGE_TIMELINE_KIND,
  CROSS_IMAGE_TIMELINE_VERSION,
  MAX_CROSS_IMAGE_BYTES,
  SAFE_IMAGE_ID_REGEX,
  crossImageMetaSchema,
  crossImageUploadHeaderSchema,
  putCrossImageRpc,
  readCrossImageBytesRpc,
  sendCrossImageMessageRpc,
  type AllowedImageMime,
  type CrossImageMeta,
} from "../shared/cross-image";

type FsDirent = { name: string; isFile(): boolean };
type FsModule = {
  mkdir(path: string, opts?: { recursive?: boolean; mode?: number }): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array | string, opts?: { mode?: number }): Promise<void>;
  readdir(path: string, opts?: { withFileTypes?: boolean }): Promise<unknown[]>;
  stat(path: string): Promise<{ isFile(): boolean; mtimeMs: number; size: number }>;
  unlink(path: string): Promise<void>;
};
type PathModule = {
  join(...parts: string[]): string;
};
type OsModule = { homedir(): string };
type CryptoModule = { randomUUID(): string };
type ProcessModule = { env: Record<string, string | undefined> };
type BufferInstance = Uint8Array & { toString(encoding: string): string };
type BufferModule = {
  Buffer: {
    from(input: Uint8Array | string, encoding?: string): BufferInstance;
  };
};

let fsPromise: Promise<FsModule> | null = null;
let pathPromise: Promise<PathModule> | null = null;
let osPromise: Promise<OsModule> | null = null;
let cryptoPromise: Promise<CryptoModule> | null = null;
let processPromise: Promise<ProcessModule> | null = null;
let bufferPromise: Promise<BufferModule> | null = null;

const loadFs = (): Promise<FsModule> =>
  (fsPromise ??= import("node:fs/promises" as string) as Promise<FsModule>);
const loadPath = (): Promise<PathModule> =>
  (pathPromise ??= import("node:path" as string) as Promise<PathModule>);
const loadOs = (): Promise<OsModule> =>
  (osPromise ??= import("node:os" as string) as Promise<OsModule>);
const loadCrypto = (): Promise<CryptoModule> =>
  (cryptoPromise ??= import("node:crypto" as string) as Promise<CryptoModule>);
const loadProcess = (): Promise<ProcessModule> =>
  (processPromise ??= import("node:process" as string) as Promise<ProcessModule>);
const loadBuffer = (): Promise<BufferModule> =>
  (bufferPromise ??= import("node:buffer" as string) as Promise<BufferModule>);

const MAX_STORED_IMAGES = 200;
const MAX_STORED_AGE_MS = 30 * 24 * 3600 * 1000;
const MAX_UPLOAD_HEADER_BYTES = 16 * 1024;

const MIME_TO_EXT: Record<AllowedImageMime, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

let imageCardSeq = 0;

async function resolveStorageDir(): Promise<string> {
  const [pathMod, osMod, procMod] = await Promise.all([loadPath(), loadOs(), loadProcess()]);
  const home = procMod.env.PASEO_HOME?.trim() || pathMod.join(osMod.homedir(), ".paseo");
  const dir = pathMod.join(home, "plugin-data", "paseo-fanframe", "shared-images");
  const fsMod = await loadFs();
  await fsMod.mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function assertSafeImageId(imageId: string): void {
  if (!SAFE_IMAGE_ID_REGEX.test(imageId)) {
    throw new Error("Invalid image identifier.");
  }
}

async function pruneStorageDir(dir: string): Promise<void> {
  const [fsMod, pathMod] = await Promise.all([loadFs(), loadPath()]);
  const rawEntries = (await fsMod.readdir(dir, { withFileTypes: true })) as FsDirent[];
  const metas: Array<{ imageId: string; mtimeMs: number; ext: string }> = [];
  const cutoff = Date.now() - MAX_STORED_AGE_MS;

  for (const entry of rawEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".meta.json")) continue;
    const imageId = entry.name.slice(0, -".meta.json".length);
    if (!SAFE_IMAGE_ID_REGEX.test(imageId)) continue;
    const metaPath = pathMod.join(dir, entry.name);
    try {
      const [st, raw] = await Promise.all([fsMod.stat(metaPath), fsMod.readFile(metaPath)]);
      const bufMod = await loadBuffer();
      const parsed = crossImageMetaSchema.safeParse(
        JSON.parse(bufMod.Buffer.from(raw).toString("utf8")),
      );
      const ext = parsed.success ? MIME_TO_EXT[parsed.data.mimeType] : "";
      if (st.mtimeMs < cutoff) {
        await removeImageFiles(dir, imageId, ext);
      } else {
        metas.push({ imageId, mtimeMs: st.mtimeMs, ext });
      }
    } catch {
      // Remove orphaned or corrupted metadata files cleanly.
      await fsMod.unlink(metaPath).catch(() => undefined);
    }
  }

  if (metas.length <= MAX_STORED_IMAGES) return;
  metas.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const extra of metas.slice(MAX_STORED_IMAGES)) {
    await removeImageFiles(dir, extra.imageId, extra.ext);
  }
}

async function removeImageFiles(dir: string, imageId: string, ext: string): Promise<void> {
  const [fsMod, pathMod] = await Promise.all([loadFs(), loadPath()]);
  await fsMod.unlink(pathMod.join(dir, `${imageId}.meta.json`)).catch(() => undefined);
  if (ext) {
    await fsMod.unlink(pathMod.join(dir, `${imageId}${ext}`)).catch(() => undefined);
  } else {
    for (const candidateExt of Object.values(MIME_TO_EXT)) {
      await fsMod.unlink(pathMod.join(dir, `${imageId}${candidateExt}`)).catch(() => undefined);
    }
  }
}

async function readStoredImage(imageId: string): Promise<{ meta: CrossImageMeta; bytes: Uint8Array }> {
  assertSafeImageId(imageId);
  const [dir, fsMod, pathMod, bufMod] = await Promise.all([
    resolveStorageDir(),
    loadFs(),
    loadPath(),
    loadBuffer(),
  ]);
  const metaPath = pathMod.join(dir, `${imageId}.meta.json`);
  const metaBytes = await fsMod.readFile(metaPath);
  const meta = crossImageMetaSchema.parse(
    JSON.parse(bufMod.Buffer.from(metaBytes).toString("utf8")),
  );
  const ext = MIME_TO_EXT[meta.mimeType];
  const fileBytes = await fsMod.readFile(pathMod.join(dir, `${imageId}${ext}`));
  return {
    meta,
    bytes: new Uint8Array(fileBytes.buffer, fileBytes.byteOffset, fileBytes.byteLength),
  };
}

export function registerCrossImageHandlers(server: PluginServerContext): () => void {
  server.handle(putCrossImageRpc, async (packet) => {
    if (packet.byteLength < 8) {
      throw new Error("Malformed image upload packet.");
    }
    const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
    const headerLen = view.getUint32(0, false);
    if (headerLen <= 0 || headerLen > MAX_UPLOAD_HEADER_BYTES || 4 + headerLen >= packet.byteLength) {
      throw new Error("Invalid image upload header length.");
    }

    const bufMod = await loadBuffer();
    const headerSlice = packet.subarray(4, 4 + headerLen);
    const headerJson = JSON.parse(bufMod.Buffer.from(headerSlice).toString("utf8")) as unknown;
    const header = crossImageUploadHeaderSchema.parse(headerJson);

    const payload = packet.subarray(4 + headerLen);
    if (payload.byteLength <= 0 || payload.byteLength > MAX_CROSS_IMAGE_BYTES) {
      throw new Error("Image size exceeds 20 MiB limit.");
    }

    const [dir, fsMod, pathMod, cryptoMod] = await Promise.all([
      resolveStorageDir(),
      loadFs(),
      loadPath(),
      loadCrypto(),
    ]);
    await pruneStorageDir(dir).catch(() => undefined);

    const imageId = `img_${Date.now().toString(36)}_${cryptoMod.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const ext = MIME_TO_EXT[header.mimeType];
    const meta: CrossImageMeta = {
      imageId,
      name: header.name.trim() || `image${ext}`,
      mimeType: header.mimeType,
      width: header.width,
      height: header.height,
      size: payload.byteLength,
    };

    await fsMod.writeFile(pathMod.join(dir, `${imageId}${ext}`), payload, { mode: 0o600 });
    await fsMod.writeFile(pathMod.join(dir, `${imageId}.meta.json`), JSON.stringify(meta), {
      mode: 0o600,
    });
    return meta;
  });

  server.handle(sendCrossImageMessageRpc, async (input, { paseo }) => {
    try {
      const [bufMod, loaded] = await Promise.all([
        loadBuffer(),
        Promise.all(input.imageIds.map((id) => readStoredImage(id))),
      ]);
      const trimmed = input.text.trim();
      const effectivePrompt = trimmed.length > 0 ? trimmed : "[图片]";
      const wireImages = loaded.map(({ meta, bytes }) => ({
        data: bufMod.Buffer.from(bytes).toString("base64"),
        mimeType: meta.mimeType,
      }));

      await paseo.agents.ref(input.agentId).send(effectivePrompt, { images: wireImages });

      try {
        await paseo.agents.ref(input.agentId).timeline.append({
          type: "plugin",
          id: `fanframe-img-${Date.now().toString(36)}-${(++imageCardSeq).toString(36)}`,
          kind: CROSS_IMAGE_TIMELINE_KIND,
          version: CROSS_IMAGE_TIMELINE_VERSION,
          data: {
            createdAt: new Date().toISOString(),
            images: loaded.map((entry) => entry.meta),
          },
        });
      } catch (timelineError) {
        console.warn("[fanframe] Failed to append cross-image timeline item:", timelineError);
      }

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  server.handle(readCrossImageBytesRpc, async ({ imageId }) => {
    const { bytes } = await readStoredImage(imageId);
    return bytes;
  });

  return () => {};
}
