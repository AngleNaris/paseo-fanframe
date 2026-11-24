import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const CROSS_IMAGE_TIMELINE_KIND = "fanframe-image" as const;
export const CROSS_IMAGE_TIMELINE_VERSION = 1 as const;

export const ALLOWED_IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIMES)[number];

export const MAX_CROSS_IMAGES_PER_MESSAGE = 6;
export const MAX_CROSS_IMAGE_BYTES = 20 * 1024 * 1024;
export const SAFE_IMAGE_ID_REGEX = /^img_[a-z0-9]+_[a-f0-9]{8,16}$/;

export const crossImageMetaSchema = z.object({
  imageId: z.string().regex(SAFE_IMAGE_ID_REGEX),
  name: z.string().min(1).max(160),
  mimeType: z.enum(ALLOWED_IMAGE_MIMES),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  size: z.number().int().positive(),
});

export type CrossImageMeta = z.output<typeof crossImageMetaSchema>;

export const crossImageTimelineDataSchema = z.object({
  createdAt: z.string(),
  images: z.array(crossImageMetaSchema).min(1).max(MAX_CROSS_IMAGES_PER_MESSAGE),
});

export type CrossImageTimelineData = z.output<typeof crossImageTimelineDataSchema>;

/**
 * Packed binary header sent as prefix of `putCrossImageRpc` Uint8Array payload:
 * [4-byte uint32BE headerLength][UTF-8 JSON header][raw image bytes]
 */
export const crossImageUploadHeaderSchema = z.object({
  agentId: z.string().min(1).max(128),
  name: z.string().min(1).max(160),
  mimeType: z.enum(ALLOWED_IMAGE_MIMES),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
});

export type CrossImageUploadHeader = z.output<typeof crossImageUploadHeaderSchema>;

export const putCrossImageRpc = defineRpc({
  name: "fanframe.cross_image.put",
  input: z.instanceof(Uint8Array),
  output: crossImageMetaSchema,
});

export const sendCrossImageMessageRpc = defineRpc({
  name: "fanframe.cross_image.send",
  input: z.object({
    agentId: z.string().min(1).max(128),
    text: z.string().max(32768),
    imageIds: z.array(z.string().regex(SAFE_IMAGE_ID_REGEX)).min(1).max(MAX_CROSS_IMAGES_PER_MESSAGE),
  }),
  output: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
  }),
});

export const readCrossImageBytesRpc = defineRpc({
  name: "fanframe.cross_image.read",
  input: z.object({
    imageId: z.string().regex(SAFE_IMAGE_ID_REGEX),
  }),
  output: z.instanceof(Uint8Array),
});
