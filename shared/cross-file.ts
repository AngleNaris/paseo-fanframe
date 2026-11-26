import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const CROSS_FILE_TIMELINE_KIND = "fanframe-file" as const;
export const CROSS_FILE_TIMELINE_VERSION = 1 as const;

export const CROSS_FILE_KINDS = [
  "image",
  "audio",
  "video",
  "pdf",
  "text",
  "archive",
  "document",
  "file",
] as const;

export type CrossFileKind = (typeof CROSS_FILE_KINDS)[number];

export const MAX_CROSS_FILES_PER_MESSAGE = 6;
export const MAX_CROSS_FILE_BYTES = 50 * 1024 * 1024;
export const CROSS_FILE_UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024;
export const CROSS_FILE_READ_CHUNK_BYTES = 4 * 1024 * 1024;
export const SAFE_FILE_ID_REGEX = /^file_[a-z0-9]+_[a-f0-9]{8,16}$/;
export const SAFE_UPLOAD_ID_REGEX = /^upl_[a-z0-9]+_[a-f0-9]{8,16}$/;

export const crossFileMetaSchema = z.object({
  fileId: z.string().regex(SAFE_FILE_ID_REGEX),
  name: z.string().min(1).max(160),
  mimeType: z.string().min(1).max(128),
  kind: z.enum(CROSS_FILE_KINDS),
  size: z.number().int().positive().max(MAX_CROSS_FILE_BYTES),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  path: z.string().min(1).max(1024).optional(),
});

export type CrossFileMeta = z.output<typeof crossFileMetaSchema>;

export const crossFileTimelineDataSchema = z.object({
  createdAt: z.string(),
  files: z.array(crossFileMetaSchema).min(1).max(MAX_CROSS_FILES_PER_MESSAGE),
});

export type CrossFileTimelineData = z.output<typeof crossFileTimelineDataSchema>;

export const beginCrossFileUploadRpc = defineRpc({
  name: "fanframe.cross_file.begin",
  input: z.object({
    agentId: z.string().min(1).max(128),
    name: z.string().min(1).max(160),
    mimeType: z.string().min(1).max(128),
    size: z.number().int().positive().max(MAX_CROSS_FILE_BYTES),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
    totalChunks: z.number().int().positive().max(64),
  }),
  output: z.object({
    uploadId: z.string().regex(SAFE_UPLOAD_ID_REGEX),
    fileId: z.string().regex(SAFE_FILE_ID_REGEX),
  }),
});

/**
 * Packed binary packet for `putCrossFileChunkRpc`:
 * [4-byte uint32BE headerLength][UTF-8 JSON { uploadId, chunkIndex }][raw chunk bytes]
 */
export const crossFileChunkHeaderSchema = z.object({
  uploadId: z.string().regex(SAFE_UPLOAD_ID_REGEX),
  chunkIndex: z.number().int().nonnegative().max(63),
});

export const putCrossFileChunkRpc = defineRpc({
  name: "fanframe.cross_file.chunk",
  input: z.instanceof(Uint8Array),
  output: z.object({
    ok: z.boolean(),
    receivedBytes: z.number().int().nonnegative(),
  }),
});

export const finishCrossFileUploadRpc = defineRpc({
  name: "fanframe.cross_file.finish",
  input: z.object({
    uploadId: z.string().regex(SAFE_UPLOAD_ID_REGEX),
  }),
  output: crossFileMetaSchema,
});

export const abortCrossFileUploadRpc = defineRpc({
  name: "fanframe.cross_file.abort",
  input: z.object({
    uploadId: z.string().regex(SAFE_UPLOAD_ID_REGEX),
  }),
  output: z.object({
    ok: z.boolean(),
  }),
});

export const sendCrossFileMessageRpc = defineRpc({
  name: "fanframe.cross_file.send",
  input: z.object({
    agentId: z.string().min(1).max(128),
    text: z.string().max(32768),
    fileIds: z
      .array(z.string().regex(SAFE_FILE_ID_REGEX))
      .min(1)
      .max(MAX_CROSS_FILES_PER_MESSAGE),
  }),
  output: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
  }),
});

export const readCrossFileBytesRpc = defineRpc({
  name: "fanframe.cross_file.read",
  input: z.object({
    fileId: z.string().regex(SAFE_FILE_ID_REGEX),
    offset: z.number().int().nonnegative().optional(),
    length: z.number().int().positive().max(16 * 1024 * 1024).optional(),
  }),
  output: z.instanceof(Uint8Array),
});

export function inferCrossFileKind(mimeType: string, fileName: string): CrossFileKind {
  const mime = mimeType.toLowerCase().trim();
  const extMatch = fileName.toLowerCase().match(/(\.[a-z0-9]{1,12})$/);
  const ext = extMatch?.[1] ?? "";

  if (
    mime === "image/jpeg" ||
    mime === "image/png" ||
    mime === "image/webp" ||
    mime === "image/gif" ||
    [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)
  ) {
    return "image";
  }
  if (mime.startsWith("audio/") || [".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac", ".opus"].includes(ext)) {
    return "audio";
  }
  if (mime.startsWith("video/") || [".mp4", ".webm", ".mov", ".m4v", ".mkv", ".avi"].includes(ext)) {
    return "video";
  }
  if (mime === "application/pdf" || ext === ".pdf") {
    return "pdf";
  }
  if (
    mime.startsWith("text/") ||
    [
      "application/json",
      "application/xml",
      "application/javascript",
      "application/typescript",
      "application/x-yaml",
      "application/yaml",
      "application/toml",
    ].includes(mime) ||
    [
      ".txt",
      ".md",
      ".markdown",
      ".json",
      ".jsonl",
      ".csv",
      ".tsv",
      ".xml",
      ".yaml",
      ".yml",
      ".toml",
      ".ini",
      ".log",
      ".html",
      ".htm",
      ".css",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".ts",
      ".tsx",
      ".py",
      ".rs",
      ".go",
      ".java",
      ".c",
      ".cpp",
      ".h",
      ".hpp",
      ".cs",
      ".sh",
      ".ps1",
      ".bat",
      ".sql",
      ".vue",
      ".svelte",
      ".svg",
    ].includes(ext)
  ) {
    return "text";
  }
  if (
    [
      "application/zip",
      "application/x-zip-compressed",
      "application/gzip",
      "application/x-tar",
      "application/x-7z-compressed",
      "application/vnd.rar",
    ].includes(mime) ||
    [".zip", ".tar", ".gz", ".tgz", ".7z", ".rar", ".bz2", ".xz"].includes(ext)
  ) {
    return "archive";
  }
  if (
    [
      ".doc",
      ".docx",
      ".xls",
      ".xlsx",
      ".ppt",
      ".pptx",
      ".odt",
      ".ods",
      ".odp",
      ".rtf",
      ".epub",
    ].includes(ext) ||
    mime.includes("wordprocessingml") ||
    mime.includes("spreadsheetml") ||
    mime.includes("presentationml") ||
    mime === "application/msword"
  ) {
    return "document";
  }
  return "file";
}
