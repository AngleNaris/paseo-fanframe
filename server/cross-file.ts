import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  CROSS_FILE_TIMELINE_KIND,
  CROSS_FILE_TIMELINE_VERSION,
  MAX_CROSS_FILE_BYTES,
  SAFE_FILE_ID_REGEX,
  abortCrossFileUploadRpc,
  beginCrossFileUploadRpc,
  crossFileChunkHeaderSchema,
  crossFileMetaSchema,
  finishCrossFileUploadRpc,
  inferCrossFileKind,
  putCrossFileChunkRpc,
  readCrossFileBytesRpc,
  sendCrossFileMessageRpc,
  type CrossFileMeta,
} from "../shared/cross-file";

type FsDirent = { name: string; isFile(): boolean; isDirectory(): boolean };
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
  mkdir(path: string, opts?: { recursive?: boolean; mode?: number }): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array | string, opts?: { mode?: number }): Promise<void>;
  appendFile(path: string, data: Uint8Array, opts?: { mode?: number }): Promise<void>;
  open(path: string, flags: string): Promise<FsFileHandle>;
  rename(oldPath: string, newPath: string): Promise<void>;
  readdir(path: string, opts?: { withFileTypes?: boolean }): Promise<unknown[]>;
  stat(path: string): Promise<{ isFile(): boolean; mtimeMs: number; size: number }>;
  unlink(path: string): Promise<void>;
  rm(path: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void>;
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

const MAX_STORED_FILES = 300;
const MAX_STORED_AGE_MS = 30 * 24 * 3600 * 1000;
const MAX_UPLOAD_HEADER_BYTES = 16 * 1024;
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_WIRE_BYTES = 20 * 1024 * 1024;
const UPLOAD_SESSION_TTL_MS = 10 * 60 * 1000;

const FORWARDABLE_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

interface StoredFileMeta extends CrossFileMeta {
  storedName: string;
}

interface ActiveUploadSession {
  uploadId: string;
  fileId: string;
  name: string;
  storedName: string;
  mimeType: string;
  expectedSize: number;
  width: number;
  height: number;
  totalChunks: number;
  nextChunkIndex: number;
  receivedBytes: number;
  partPath: string;
  finalDir: string;
  finalPath: string;
  metaPath: string;
  createdAt: number;
}

let fileCardSeq = 0;

function sanitizeStoredFileName(rawName: string): string {
  const base = rawName
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.replace(/[\u0000-\u001f<>:"|?*]/g, "_")
    .trim();
  const collapsed = (base || "file").replace(/^\.+/, "").replace(/\.+$/, "").trim();
  if (!collapsed || collapsed === "." || collapsed === "..") return "file";
  if (collapsed.length <= 120) return collapsed;
  const dot = collapsed.lastIndexOf(".");
  if (dot > 0 && collapsed.length - dot <= 16) {
    const ext = collapsed.slice(dot);
    return `${collapsed.slice(0, 120 - ext.length)}${ext}`;
  }
  return collapsed.slice(0, 120);
}

async function resolveStorageDir(): Promise<string> {
  const [pathMod, osMod, procMod, fsMod] = await Promise.all([
    loadPath(),
    loadOs(),
    loadProcess(),
    loadFs(),
  ]);
  const home = procMod.env.PASEO_HOME?.trim() || pathMod.join(osMod.homedir(), ".paseo");
  const dir = pathMod.join(home, "plugin-data", "paseo-fanframe", "shared-files");
  await fsMod.mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function assertSafeFileId(fileId: string): void {
  if (!SAFE_FILE_ID_REGEX.test(fileId)) {
    throw new Error("Invalid file identifier.");
  }
}

async function removeStoredFile(dir: string, fileId: string): Promise<void> {
  const [fsMod, pathMod] = await Promise.all([loadFs(), loadPath()]);
  await fsMod.unlink(pathMod.join(dir, `${fileId}.meta.json`)).catch(() => undefined);
  await fsMod.rm(pathMod.join(dir, fileId), { recursive: true, force: true }).catch(() => undefined);
}

async function pruneStorageDir(dir: string): Promise<void> {
  const [fsMod, pathMod] = await Promise.all([loadFs(), loadPath()]);
  const rawEntries = (await fsMod.readdir(dir, { withFileTypes: true })) as FsDirent[];
  const metas: Array<{ fileId: string; mtimeMs: number }> = [];
  const cutoff = Date.now() - MAX_STORED_AGE_MS;

  for (const entry of rawEntries) {
    if (entry.isFile() && entry.name.endsWith(".part")) {
      const partPath = pathMod.join(dir, entry.name);
      const st = await fsMod.stat(partPath).catch(() => null);
      if (st && Date.now() - st.mtimeMs > UPLOAD_SESSION_TTL_MS) {
        await fsMod.unlink(partPath).catch(() => undefined);
      }
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".meta.json")) continue;
    const fileId = entry.name.slice(0, -".meta.json".length);
    if (!SAFE_FILE_ID_REGEX.test(fileId)) continue;
    const metaPath = pathMod.join(dir, entry.name);
    try {
      const st = await fsMod.stat(metaPath);
      if (st.mtimeMs < cutoff) {
        await removeStoredFile(dir, fileId);
      } else {
        metas.push({ fileId, mtimeMs: st.mtimeMs });
      }
    } catch {
      await removeStoredFile(dir, fileId);
    }
  }

  if (metas.length <= MAX_STORED_FILES) return;
  metas.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const extra of metas.slice(MAX_STORED_FILES)) {
    await removeStoredFile(dir, extra.fileId);
  }
}

async function readStoredFileMeta(fileId: string): Promise<{ meta: StoredFileMeta; filePath: string }> {
  assertSafeFileId(fileId);
  const [dir, fsMod, pathMod, bufMod] = await Promise.all([
    resolveStorageDir(),
    loadFs(),
    loadPath(),
    loadBuffer(),
  ]);
  const metaPath = pathMod.join(dir, `${fileId}.meta.json`);
  const raw = await fsMod.readFile(metaPath);
  const parsedJson = JSON.parse(bufMod.Buffer.from(raw).toString("utf8")) as Record<string, unknown>;
  const base = crossFileMetaSchema.parse(parsedJson);
  const storedName =
    typeof parsedJson.storedName === "string" && parsedJson.storedName.trim().length > 0
      ? sanitizeStoredFileName(parsedJson.storedName)
      : sanitizeStoredFileName(base.name);
  const filePath = pathMod.join(dir, fileId, storedName);
  return {
    meta: { ...base, path: filePath, storedName },
    filePath,
  };
}

export function registerCrossFileHandlers(server: PluginServerContext): () => void {
  const activeUploads = new Map<string, ActiveUploadSession>();

  const cleanupUpload = async (uploadId: string) => {
    const session = activeUploads.get(uploadId);
    if (!session) return;
    activeUploads.delete(uploadId);
    const fsMod = await loadFs().catch(() => null);
    if (fsMod) {
      await fsMod.unlink(session.partPath).catch(() => undefined);
    }
  };

  const cleanupStaleUploads = async () => {
    const now = Date.now();
    for (const [id, session] of Array.from(activeUploads.entries())) {
      if (now - session.createdAt > UPLOAD_SESSION_TTL_MS) {
        await cleanupUpload(id);
      }
    }
  };

  server.handle(beginCrossFileUploadRpc, async (input) => {
    await cleanupStaleUploads();
    if (input.size <= 0 || input.size > MAX_CROSS_FILE_BYTES) {
      throw new Error("单文件体积超出 50 MiB 上限。");
    }

    const [dir, pathMod, cryptoMod, fsMod] = await Promise.all([
      resolveStorageDir(),
      loadPath(),
      loadCrypto(),
      loadFs(),
    ]);
    await pruneStorageDir(dir).catch(() => undefined);

    const token = cryptoMod.randomUUID().replace(/-/g, "").slice(0, 12);
    const stamp = Date.now().toString(36);
    const fileId = `file_${stamp}_${token}`;
    const uploadId = `upl_${stamp}_${cryptoMod.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const cleanDisplayName = input.name.trim().slice(0, 160) || "file";
    const storedName = sanitizeStoredFileName(cleanDisplayName);
    const partPath = pathMod.join(dir, `${uploadId}.part`);
    const finalDir = pathMod.join(dir, fileId);
    const finalPath = pathMod.join(finalDir, storedName);
    const metaPath = pathMod.join(dir, `${fileId}.meta.json`);

    await fsMod.writeFile(partPath, new Uint8Array(0), { mode: 0o600 });

    activeUploads.set(uploadId, {
      uploadId,
      fileId,
      name: cleanDisplayName,
      storedName,
      mimeType: input.mimeType.trim() || "application/octet-stream",
      expectedSize: input.size,
      width: input.width,
      height: input.height,
      totalChunks: input.totalChunks,
      nextChunkIndex: 0,
      receivedBytes: 0,
      partPath,
      finalDir,
      finalPath,
      metaPath,
      createdAt: Date.now(),
    });

    return { uploadId, fileId };
  });

  server.handle(putCrossFileChunkRpc, async (packet) => {
    if (packet.byteLength < 8) {
      throw new Error("Malformed file chunk packet.");
    }
    const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
    const headerLen = view.getUint32(0, false);
    if (headerLen <= 0 || headerLen > MAX_UPLOAD_HEADER_BYTES || 4 + headerLen > packet.byteLength) {
      throw new Error("Invalid file chunk header length.");
    }

    const bufMod = await loadBuffer();
    const headerSlice = packet.subarray(4, 4 + headerLen);
    const header = crossFileChunkHeaderSchema.parse(
      JSON.parse(bufMod.Buffer.from(headerSlice).toString("utf8")) as unknown,
    );

    const session = activeUploads.get(header.uploadId);
    if (!session) {
      throw new Error("Upload session expired or not found.");
    }
    if (header.chunkIndex !== session.nextChunkIndex || header.chunkIndex >= session.totalChunks) {
      await cleanupUpload(header.uploadId);
      throw new Error("Unexpected upload chunk sequence.");
    }

    const payload = packet.subarray(4 + headerLen);
    if (payload.byteLength === 0 || payload.byteLength > MAX_CHUNK_BYTES) {
      await cleanupUpload(header.uploadId);
      throw new Error("Invalid upload chunk size.");
    }
    if (session.receivedBytes + payload.byteLength > MAX_CROSS_FILE_BYTES) {
      await cleanupUpload(header.uploadId);
      throw new Error("File size exceeds 50 MiB limit.");
    }

    const fsMod = await loadFs();
    await fsMod.appendFile(session.partPath, payload, { mode: 0o600 });
    session.receivedBytes += payload.byteLength;
    session.nextChunkIndex += 1;

    return { ok: true, receivedBytes: session.receivedBytes };
  });

  server.handle(finishCrossFileUploadRpc, async ({ uploadId }) => {
    const session = activeUploads.get(uploadId);
    if (!session) {
      throw new Error("Upload session expired or not found.");
    }
    if (session.nextChunkIndex !== session.totalChunks || session.receivedBytes <= 0) {
      await cleanupUpload(uploadId);
      throw new Error("Incomplete file upload.");
    }

    const fsMod = await loadFs();
    try {
      await fsMod.mkdir(session.finalDir, { recursive: true, mode: 0o700 });
      await fsMod.rename(session.partPath, session.finalPath);

      const kind = inferCrossFileKind(session.mimeType, session.name);
      const storedMeta: StoredFileMeta = {
        fileId: session.fileId,
        name: session.name,
        storedName: session.storedName,
        mimeType: session.mimeType,
        kind,
        size: session.receivedBytes,
        width: session.width,
        height: session.height,
        path: session.finalPath,
      };
      await fsMod.writeFile(session.metaPath, JSON.stringify(storedMeta), { mode: 0o600 });
      activeUploads.delete(uploadId);

      const publicMeta: CrossFileMeta = {
        fileId: storedMeta.fileId,
        name: storedMeta.name,
        mimeType: storedMeta.mimeType,
        kind: storedMeta.kind,
        size: storedMeta.size,
        width: storedMeta.width,
        height: storedMeta.height,
        path: storedMeta.path,
      };
      return publicMeta;
    } catch (err) {
      await cleanupUpload(uploadId);
      throw err;
    }
  });

  server.handle(abortCrossFileUploadRpc, async ({ uploadId }) => {
    await cleanupUpload(uploadId);
    return { ok: true };
  });

  server.handle(sendCrossFileMessageRpc, async (input, { paseo }) => {
    try {
      const [bufMod, fsMod, loaded] = await Promise.all([
        loadBuffer(),
        loadFs(),
        Promise.all(input.fileIds.map((id) => readStoredFileMeta(id))),
      ]);

      const wireImages: Array<{ data: string; mimeType: string }> = [];
      const wireAttachments: Array<{
        type: "uploaded_file";
        id: string;
        fileName: string;
        mimeType: string;
        size: number;
        path: string;
      }> = [];
      const timelineFiles: CrossFileMeta[] = [];

      for (const { meta, filePath } of loaded) {
        const publicMeta: CrossFileMeta = {
          fileId: meta.fileId,
          name: meta.name,
          mimeType: meta.mimeType,
          kind: meta.kind,
          size: meta.size,
          width: meta.width,
          height: meta.height,
          path: filePath,
        };
        timelineFiles.push(publicMeta);

        if (
          meta.kind === "image" &&
          FORWARDABLE_IMAGE_MIMES.has(meta.mimeType.toLowerCase()) &&
          meta.size <= MAX_IMAGE_WIRE_BYTES
        ) {
          const bytes = await fsMod.readFile(filePath);
          wireImages.push({
            data: bufMod.Buffer.from(bytes).toString("base64"),
            mimeType: meta.mimeType,
          });
        } else {
          wireAttachments.push({
            type: "uploaded_file",
            id: meta.fileId,
            fileName: meta.name,
            mimeType: meta.mimeType,
            size: meta.size,
            path: filePath,
          });
        }
      }

      const trimmed = input.text.trim();
      const onlyImages = wireImages.length > 0 && wireAttachments.length === 0;
      const onlyFiles = wireImages.length === 0 && wireAttachments.length > 0;
      const fallbackPrompt = onlyImages ? "[图片]" : onlyFiles ? "[文件]" : "[附件]";
      const effectivePrompt = trimmed.length > 0 ? trimmed : fallbackPrompt;

      await paseo.agents.ref(input.agentId).send(effectivePrompt, {
        ...(wireImages.length > 0 ? { images: wireImages } : {}),
        ...(wireAttachments.length > 0 ? { attachments: wireAttachments } : {}),
      });

      try {
        await paseo.agents.ref(input.agentId).timeline.append({
          type: "plugin",
          id: `fanframe-file-${Date.now().toString(36)}-${(++fileCardSeq).toString(36)}`,
          kind: CROSS_FILE_TIMELINE_KIND,
          version: CROSS_FILE_TIMELINE_VERSION,
          data: {
            createdAt: new Date().toISOString(),
            files: timelineFiles,
          },
        });
      } catch (timelineError) {
        console.warn("[fanframe] Failed to append cross-file timeline item:", timelineError);
      }

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  server.handle(readCrossFileBytesRpc, async ({ fileId, offset, length }) => {
    const { meta, filePath } = await readStoredFileMeta(fileId);
    const fsMod = await loadFs();

    if (offset === undefined && length === undefined) {
      const raw = await fsMod.readFile(filePath);
      return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    }

    const start = Math.max(0, offset ?? 0);
    if (start >= meta.size) {
      return new Uint8Array(0);
    }
    const toRead = Math.min(length ?? meta.size - start, meta.size - start);
    const handle = await fsMod.open(filePath, "r");
    try {
      const buf = new Uint8Array(toRead);
      const { bytesRead } = await handle.read(buf, 0, toRead, start);
      return bytesRead === toRead ? buf : buf.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  });

  return () => {
    for (const id of Array.from(activeUploads.keys())) {
      void cleanupUpload(id);
    }
  };
}
