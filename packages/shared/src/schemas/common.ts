import { z } from 'zod';

export const RatioEnum = z.enum(['1:1', '16:9', '9:16', '4:3']);

// The models each generation node type can run. Two each rather than Runway's full catalog on
// purpose: every extra model is a distinct SDK param variant with its own ratio literals and
// duration rules, and an unverified mapping surfaces as a 400 at generation time rather than a
// compile error. Both alternates were picked for mapping cleanly onto the four ratios above --
// gen4_image_turbo, the obvious-looking sibling, is excluded because it *requires* reference
// images, which this node type does not have.
export const TextToImageModelEnum = z.enum(['gen4_image', 'grok_imagine_image_2']);
export const ImageToVideoModelEnum = z.enum(['gen4.5', 'gen4_turbo']);

export const DEFAULT_TEXT_TO_IMAGE_MODEL = 'gen4_image' as const;
export const DEFAULT_IMAGE_TO_VIDEO_MODEL = 'gen4.5' as const;

export type TextToImageModel = z.infer<typeof TextToImageModelEnum>;
export type ImageToVideoModel = z.infer<typeof ImageToVideoModelEnum>;

export const NodeTypeSchema = z.enum([
  'imageInput',
  'textToImage',
  'imageToVideo',
  'trim',
  'concat',
  'export',
]);

export const NodeStatusSchema = z.enum([
  'idle',
  'queued',
  'running',
  'succeeded',
  'failed',
  'stale',
]);

export const MediaRefSchema = z.object({
  id: z.string(),
  kind: z.enum(['image', 'video']),
  url: z.string(),
  durability: z.enum(['persistent', 'ephemeral']),
  posterUrl: z.string().optional(),
  durationSec: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  sha256: z.string().optional(),
});
