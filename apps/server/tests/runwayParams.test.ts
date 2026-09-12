import { describe, expect, it } from 'vitest';
import {
  mapImageToVideoDuration,
  mapImageToVideoRatio,
  mapTextToImageRatio,
  pixelPairToDimensions,
} from '../src/jobs/runwayParams';

describe('mapTextToImageRatio', () => {
  it('maps every RatioEnum value to an exact gen4_image pixel pair', () => {
    expect(mapTextToImageRatio('1:1')).toBe('1024:1024');
    expect(mapTextToImageRatio('16:9')).toBe('1280:720');
    expect(mapTextToImageRatio('9:16')).toBe('720:1280');
    expect(mapTextToImageRatio('4:3')).toBe('1440:1080');
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
    expect(mapImageToVideoDuration(6.4)).toBe(6);
    expect(mapImageToVideoDuration(6.5)).toBe(7);
  });

  it('clamps to the [2, 10] range', () => {
    expect(mapImageToVideoDuration(1)).toBe(2);
    expect(mapImageToVideoDuration(11)).toBe(10);
  });

  it('passes integers within range through unchanged', () => {
    expect(mapImageToVideoDuration(4)).toBe(4);
  });
});
