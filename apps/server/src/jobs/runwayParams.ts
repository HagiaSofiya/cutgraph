import type { RatioEnum } from '@cutgraph/shared';
import { z } from 'zod';

export type Ratio = z.infer<typeof RatioEnum>;

// The models this adapter targets. Fixed, not configurable -- narrowed down from the full
// Runway catalog to the two that fit our schemas (prompt-only textToImage with no reference
// images; single-image, prompt + duration + ratio imageToVideo).
export const TEXT_TO_IMAGE_MODEL = 'gen4_image';
export const IMAGE_TO_VIDEO_MODEL = 'gen4.5';

// Verified against @runwayml/sdk 4.20.0's TextToImageCreateParams.Gen4Image.ratio. All four of
// our ratios have an exact pixel-pair match.
const TEXT_TO_IMAGE_RATIO_MAP: Record<Ratio, string> = {
  '1:1': '1024:1024',
  '16:9': '1280:720',
  '9:16': '720:1280',
  '4:3': '1440:1080',
};

// Verified against @runwayml/sdk 4.20.0's ImageToVideoCreateParams.Gen4_5.ratio:
// '1280:720' | '720:1280' | '1104:832' | '960:960' | '832:1104' | '1584:672'.
// 1:1, 16:9 and 9:16 are exact. gen4.5 has no exact 4:3 (1.333) pixel pair -- 1104:832 (1.327)
// is the closest available and is used as a documented approximation, not a silent guess.
const IMAGE_TO_VIDEO_RATIO_MAP: Record<Ratio, string> = {
  '1:1': '960:960',
  '16:9': '1280:720',
  '9:16': '720:1280',
  '4:3': '1104:832',
};

function mapRatio(map: Record<Ratio, string>, ratio: Ratio, context: string): string {
  const mapped = map[ratio];
  if (!mapped) {
    // Not reachable through the Zod-validated request path (RatioEnum only has four values),
    // but the mapping table is what actually defines "supported," so an unmapped value fails
    // loudly here rather than being silently passed through to the API.
    throw new Error(`${context}: unmapped ratio "${ratio}"`);
  }
  return mapped;
}

export function mapTextToImageRatio(ratio: Ratio): string {
  return mapRatio(TEXT_TO_IMAGE_RATIO_MAP, ratio, 'textToImage');
}

export function mapImageToVideoRatio(ratio: Ratio): string {
  return mapRatio(IMAGE_TO_VIDEO_RATIO_MAP, ratio, 'imageToVideo');
}

// Reverse of the ratio map: parses "1440:1080" -> { width: 1440, height: 1080 } so JobResult can
// report the dimensions we requested without inspecting the (expiring, re-downloaded) output.
export function pixelPairToDimensions(pixelPair: string): { width: number; height: number } {
  const [width, height] = pixelPair.split(':').map(Number);
  if (!width || !height) {
    throw new Error(`malformed pixel-pair ratio "${pixelPair}"`);
  }
  return { width, height };
}

// gen4.5's duration is documented as "must be an integer from 2 to 10", which already matches
// our schema's z.number().min(2).max(10) range -- the only real gap is fractional input, so this
// rounds rather than truncates (e.g. a 6.4s request becomes 6s, not silently 6.999->6).
export function mapImageToVideoDuration(duration: number): number {
  const rounded = Math.round(duration);
  return Math.min(10, Math.max(2, rounded));
}
