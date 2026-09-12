import { describe, expect, it } from 'vitest';
import {
  mapImageToVideoDuration,
  mapImageToVideoRatio,
  mapTextToImageRatio,
  pixelPairToDimensions,
} from '../src/jobs/runwayParams';

describe('mapTextToImageRatio', () => {
  it('maps every RatioEnum value to an exact gen4_image pixel pair', () => {
    expect(mapTextToImageRatio('gen4_image', '1:1')).toBe('1024:1024');
    expect(mapTextToImageRatio('gen4_image', '16:9')).toBe('1280:720');
    expect(mapTextToImageRatio('gen4_image', '9:16')).toBe('720:1280');
    expect(mapTextToImageRatio('gen4_image', '4:3')).toBe('1440:1080');
  });
});

describe('mapImageToVideoRatio', () => {
  it('maps 1:1, 16:9 and 9:16 to exact gen4.5 pixel pairs', () => {
    expect(mapImageToVideoRatio('1:1')).toBe('960:960');
    expect(mapImageToVideoRatio('16:9')).toBe('1280:720');
    expect(mapImageToVideoRatio('9:16')).toBe('720:1280');
  });

  it('maps 4:3 to the nearest available pixel pair (gen4.5 has no exact match)', () => {
    expect(mapImageToVideoRatio('4:3')).toBe('1104:832');
  });
});

describe('pixelPairToDimensions', () => {
  it('parses width and height out of a pixel-pair string', () => {
    expect(pixelPairToDimensions('1440:1080')).toEqual({ width: 1440, height: 1080 });
  });

  it('throws on a malformed pixel pair', () => {
    expect(() => pixelPairToDimensions('not-a-ratio')).toThrow();
  });
});

describe('mapImageToVideoDuration', () => {
  it('rounds to the nearest integer', () => {
    expect(mapImageToVideoDuration('gen4.5', 6.4)).toBe(6);
    expect(mapImageToVideoDuration('gen4.5', 6.5)).toBe(7);
  });

  it('clamps to the [2, 10] range', () => {
    expect(mapImageToVideoDuration('gen4.5', 1)).toBe(2);
    expect(mapImageToVideoDuration('gen4.5', 11)).toBe(10);
  });

  it('passes integers within range through unchanged', () => {
    expect(mapImageToVideoDuration('gen4.5', 4)).toBe(4);
  });
});

describe('the alternate models', () => {
  it('maps all four ratios to exact grok_imagine_image_2 pixel pairs', () => {
    expect(mapTextToImageRatio('grok_imagine_image_2', '1:1')).toBe('1024:1024');
    expect(mapTextToImageRatio('grok_imagine_image_2', '16:9')).toBe('1280:720');
    expect(mapTextToImageRatio('grok_imagine_image_2', '9:16')).toBe('720:1280');
    // Unlike gen4.5's image-to-video 4:3, this one is exact -- 1152/864 is 4:3 on the nose.
    expect(mapTextToImageRatio('grok_imagine_image_2', '4:3')).toBe('1152:864');
  });

  it('snaps gen4_turbo duration to the two values that model accepts', () => {
    // The SDK types gen4_turbo's duration as a bare number, so nothing would catch an
    // out-of-range value at compile time -- snapping is what keeps it a documented
    // approximation instead of a 400.
    expect(mapImageToVideoDuration('gen4_turbo', 2)).toBe(5);
    expect(mapImageToVideoDuration('gen4_turbo', 4)).toBe(5);
    expect(mapImageToVideoDuration('gen4_turbo', 7)).toBe(5);
    expect(mapImageToVideoDuration('gen4_turbo', 8)).toBe(10);
    expect(mapImageToVideoDuration('gen4_turbo', 10)).toBe(10);
  });

  it('leaves gen4.5 duration on its own integer 2..10 rule', () => {
    expect(mapImageToVideoDuration('gen4.5', 6.4)).toBe(6);
    expect(mapImageToVideoDuration('gen4.5', 11)).toBe(10);
  });
});
