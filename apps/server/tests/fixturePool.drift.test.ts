import { describe, expect, it } from 'vitest';
import {
  IMAGE_FIXTURES as GENERATED_IMAGE_FIXTURES,
  VIDEO_FIXTURES as GENERATED_VIDEO_FIXTURES,
} from '../../../scripts/generate-fixtures.mjs';
import { IMAGE_FIXTURES, VIDEO_FIXTURES } from '../src/jobs/fixturePool';

// fixturePool.ts is what the server reads at runtime; generate-fixtures.mjs is what writes the
// files. The two lists are duplicated by hand, and drift between them is invisible until the
// fixture adapter hands the browser a URL that 404s. Nothing else covers that.
//
// The generator carries an extra `color` per image, which the pool has no counterpart for, so
// only the fields both sides declare are compared.
describe('fixture pool / generator drift', () => {
  it('declares the same image fixtures on both sides', () => {
    expect(GENERATED_IMAGE_FIXTURES.map(({ file, width, height }) => ({ file, width, height }))).toEqual(
      IMAGE_FIXTURES.map(({ file, width, height }) => ({ file, width, height })),
    );
  });

  it('declares the same video fixtures on both sides', () => {
    expect(
      GENERATED_VIDEO_FIXTURES.map(({ file, width, height, durationSec }) => ({
        file,
        width,
        height,
        durationSec,
      })),
    ).toEqual(
      VIDEO_FIXTURES.map(({ file, width, height, durationSec }) => ({
        file,
        width,
        height,
        durationSec,
      })),
    );
  });
});
