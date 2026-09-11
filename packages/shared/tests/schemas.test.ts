import { describe, expect, it } from 'vitest';
import {
  ExportParamsSchema,
  ImageToVideoParamsSchema,
  TextToImageParamsSchema,
  TrimParamsSchema,
} from '../src/schemas/nodeParams';

describe('TrimParamsSchema', () => {
  it('accepts end > start', () => {
    expect(TrimParamsSchema.safeParse({ start: 0, end: 2 }).success).toBe(true);
  });

  it('rejects end <= start', () => {
    expect(TrimParamsSchema.safeParse({ start: 2, end: 2 }).success).toBe(false);
    expect(TrimParamsSchema.safeParse({ start: 5, end: 2 }).success).toBe(false);
  });

  it('rejects a negative start', () => {
    expect(TrimParamsSchema.safeParse({ start: -1, end: 2 }).success).toBe(false);
  });
});

describe('ImageToVideoParamsSchema', () => {
  it('rejects a duration outside [2, 10]', () => {
    expect(
      ImageToVideoParamsSchema.safeParse({ prompt: 'a cat', ratio: '1:1', duration: 1 }).success,
    ).toBe(false);
    expect(
      ImageToVideoParamsSchema.safeParse({ prompt: 'a cat', ratio: '1:1', duration: 11 }).success,
    ).toBe(false);
  });

  it('accepts a duration within [2, 10] and defaults when omitted', () => {
    const withDuration = ImageToVideoParamsSchema.safeParse({ prompt: 'a cat', ratio: '1:1', duration: 5 });
    expect(withDuration.success).toBe(true);

    const withoutDuration = ImageToVideoParamsSchema.parse({ prompt: 'a cat', ratio: '1:1' });
    expect(withoutDuration.duration).toBe(4);
  });

  it('rejects an unknown ratio', () => {
    expect(
      ImageToVideoParamsSchema.safeParse({ prompt: 'a cat', ratio: '2:1', duration: 4 }).success,
    ).toBe(false);
  });
});

describe('TextToImageParamsSchema', () => {
  it('rejects an empty prompt', () => {
    expect(TextToImageParamsSchema.safeParse({ prompt: '', ratio: '1:1' }).success).toBe(false);
  });

  it('accepts a non-empty prompt', () => {
    expect(TextToImageParamsSchema.safeParse({ prompt: 'a cat', ratio: '1:1' }).success).toBe(true);
  });
});

describe('ExportParamsSchema', () => {
  it('defaults the filename when omitted', () => {
    expect(ExportParamsSchema.parse({}).filename).toBe('cutgraph-export.mp4');
  });

  it('rejects an empty filename', () => {
    expect(ExportParamsSchema.safeParse({ filename: '' }).success).toBe(false);
  });
});
