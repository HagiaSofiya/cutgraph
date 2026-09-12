import type { ImageToVideoModel, RatioEnum, TextToImageModel } from '@cutgraph/shared';
import { z } from 'zod';

export type Ratio = z.infer<typeof RatioEnum>;

// The literal ratio unions TextToImageCreateParams.Gen4Image and ImageToVideoCreateParams.Gen4_5
// actually accept, copied from @runwayml/sdk 4.20.0's own .d.ts rather than widened to `string`,
// so a typo here is a compile error instead of a 400 from the API.
export type Gen4ImageRatio =
  | '1024:1024'
  | '1080:1080'
  | '1168:880'
  | '1360:768'
  | '1440:1080'
  | '1080:1440'
  | '1808:768'
  | '1920:1080'
  | '1080:1920'
  | '2112:912'
  | '1280:720'
  | '720:1280'
  | '720:720'
  | '960:720'
  | '720:960'
  | '1680:720';

// gen4.5 and gen4_turbo accept the identical six pixel pairs (verified against both
// ImageToVideoCreateParams.Gen4_5.ratio and .Gen4Turbo.ratio), so one map serves both models.
export type Gen45Ratio = '1280:720' | '720:1280' | '1104:832' | '960:960' | '832:1104' | '1584:672';

// Copied from TextToImageCreateParams.GrokImagineImage2.ratio, same as the gen4_image union
// above: a typo is then a compile error rather than a 400 from the API.
export type GrokImageRatio =
  | '1024:1024'
  | '1280:720'
  | '720:1280'
  | '1152:864'
  | '864:1152'
  | '1248:832'
  | '832:1248'
  | '1248:576'
  | '576:1248'
  | '1280:576'
  | '576:1280'
  | '1408:704'
  | '704:1408'
  | '2048:2048'
  | '2816:1584'
  | '1584:2816'
  | '2368:1776'
  | '1776:2368'
  | '2496:1664'
  | '1664:2496'
  | '2912:1344'
  | '1344:2912'
  | '3200:1440'
  | '1440:3200'
  | '2912:1456'
  | '1456:2912'
  | 'auto_1k'
  | 'auto_2k';

// What /api/health reports as runnable, per generation node type. The authoritative list is the
// Zod enum in shared -- these mirror it, and the Record types below make a model added there
// without a ratio mapping here a compile error.
export const TEXT_TO_IMAGE_MODELS = ['gen4_image', 'grok_imagine_image_2'] as const;
export const IMAGE_TO_VIDEO_MODELS = ['gen4.5', 'gen4_turbo'] as const;

// Verified against @runwayml/sdk 4.20.0's TextToImageCreateParams.Gen4Image.ratio. All four of
// our ratios have an exact pixel-pair match.
const GEN4_IMAGE_RATIO_MAP: Record<Ratio, Gen4ImageRatio> = {
  '1:1': '1024:1024',
  '16:9': '1280:720',
  '9:16': '720:1280',
  '4:3': '1440:1080',
};

// Verified against TextToImageCreateParams.GrokImagineImage2.ratio. All four of our ratios have
// an exact pixel-pair match here, including 4:3 (1152:864), which gen4_image also matches
// exactly -- no approximation is needed on either text-to-image model.
const GROK_IMAGE_RATIO_MAP: Record<Ratio, GrokImageRatio> = {
  '1:1': '1024:1024',
  '16:9': '1280:720',
  '9:16': '720:1280',
  '4:3': '1152:864',
};

// Verified against @runwayml/sdk 4.20.0's ImageToVideoCreateParams.Gen4_5.ratio:
// '1280:720' | '720:1280' | '1104:832' | '960:960' | '832:1104' | '1584:672'.
// 1:1, 16:9 and 9:16 are exact. gen4.5 has no exact 4:3 (1.333) pixel pair -- 1104:832 (1.327)
// is the closest available and is used as a documented approximation, not a silent guess.
const IMAGE_TO_VIDEO_RATIO_MAP: Record<Ratio, Gen45Ratio> = {
  '1:1': '960:960',
  '16:9': '1280:720',
  '9:16': '720:1280',
  '4:3': '1104:832',
};

function mapRatio<T extends string>(map: Record<Ratio, T>, ratio: Ratio, context: string): T {
  const mapped = map[ratio];
  if (!mapped) {
    // Not reachable through the Zod-validated request path (RatioEnum only has four values),
    // but the mapping table is what actually defines "supported," so an unmapped value fails
    // loudly here rather than being silently passed through to the API.
    throw new Error(`${context}: unmapped ratio "${ratio}"`);
  }
  return mapped;
}

export function mapGen4ImageRatio(ratio: Ratio): Gen4ImageRatio {
  return mapRatio(GEN4_IMAGE_RATIO_MAP, ratio, 'gen4_image');
}

export function mapGrokImageRatio(ratio: Ratio): GrokImageRatio {
  return mapRatio(GROK_IMAGE_RATIO_MAP, ratio, 'grok_imagine_image_2');
}

// Only used to report dimensions; both text-to-image models map every ratio exactly, so the
// pixel pair is always a faithful description of what was requested.
export function mapTextToImageRatio(model: TextToImageModel, ratio: Ratio): string {
  return model === 'gen4_image' ? mapGen4ImageRatio(ratio) : mapGrokImageRatio(ratio);
}

export function mapImageToVideoRatio(ratio: Ratio): Gen45Ratio {
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
//
// gen4_turbo is the awkward one: the SDK types its duration as a bare `number`, so nothing would
// catch an out-of-range value at compile time, and a wrong one is a 400 at generation time. It is
// therefore snapped to the two durations that model is documented to accept, the same way the
// 4:3 ratio approximation above prefers a documented near-miss over a silent guess.
const GEN4_TURBO_DURATIONS = [5, 10];

export function mapImageToVideoDuration(model: ImageToVideoModel, duration: number): number {
  if (model === 'gen4_turbo') {
    return GEN4_TURBO_DURATIONS.reduce((best, d) =>
      Math.abs(d - duration) < Math.abs(best - duration) ? d : best,
    );
  }
  const rounded = Math.round(duration);
  return Math.min(10, Math.max(2, rounded));
}
