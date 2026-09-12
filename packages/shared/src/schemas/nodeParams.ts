import { z } from 'zod';
import {
  DEFAULT_IMAGE_TO_VIDEO_MODEL,
  DEFAULT_TEXT_TO_IMAGE_MODEL,
  ImageToVideoModelEnum,
  RatioEnum,
  TextToImageModelEnum,
} from './common';

export const ImageInputParamsSchema = z
  .object({
    sourceName: z.string(),
    sourceSize: z.number().nonnegative(),
    sourceLastModified: z.number(),
  })
  .strict();

export const TextToImageParamsSchema = z
  .object({
    prompt: z.string().min(1).max(2000),
    ratio: RatioEnum,
    model: TextToImageModelEnum.default(DEFAULT_TEXT_TO_IMAGE_MODEL),
  })
  .strict();

export const ImageToVideoParamsSchema = z
  .object({
    prompt: z.string().min(1).max(2000),
    duration: z.number().min(2).max(10).default(4),
    ratio: RatioEnum,
    model: ImageToVideoModelEnum.default(DEFAULT_IMAGE_TO_VIDEO_MODEL),
  })
  .strict();

export const TrimParamsSchema = z
  .object({
    start: z.number().min(0),
    end: z.number().min(0),
  })
  .strict()
  .refine((p) => p.end > p.start, { message: 'end must be greater than start', path: ['end'] });

// Input order comes from the fixed edge target handles (in-0..in-3), not from params.
export const ConcatParamsSchema = z.object({}).strict();

export const ExportParamsSchema = z
  .object({
    filename: z.string().min(1).max(200).default('cutgraph-export.mp4'),
  })
  .strict();

export type ImageInputParams = z.infer<typeof ImageInputParamsSchema>;
export type TextToImageParams = z.infer<typeof TextToImageParamsSchema>;
export type ImageToVideoParams = z.infer<typeof ImageToVideoParamsSchema>;
export type TrimParams = z.infer<typeof TrimParamsSchema>;
export type ConcatParams = z.infer<typeof ConcatParamsSchema>;
export type ExportParams = z.infer<typeof ExportParamsSchema>;

export const NodeParamsSchemaByType = {
  imageInput: ImageInputParamsSchema,
  textToImage: TextToImageParamsSchema,
  imageToVideo: ImageToVideoParamsSchema,
  trim: TrimParamsSchema,
  concat: ConcatParamsSchema,
  export: ExportParamsSchema,
} as const;

export type NodeTypeKey = keyof typeof NodeParamsSchemaByType;

export function validateNodeParams(nodeType: NodeTypeKey, rawParams: unknown) {
  return NodeParamsSchemaByType[nodeType].safeParse(rawParams);
}
