import { z } from 'zod';

export const RatioEnum = z.enum(['1:1', '16:9', '9:16', '4:3']);

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
