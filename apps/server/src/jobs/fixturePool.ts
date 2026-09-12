// The pool is uniform on purpose: every video fixture shares one resolution, framerate and
// codec, so Concat's own risk (sequential mediabunny concatenation) never has to also solve
// re-encoding mismatched sources. Duration is the only thing that varies.
//
// These definitions are duplicated in scripts/generate-fixtures.mjs, which is what actually
// produces these files via ffmpeg. fixturePool.drift.test.ts fails if the two ever disagree.

export interface ImageFixture {
  file: string;
  width: number;
  height: number;
}

export interface VideoFixture {
  file: string;
  width: number;
  height: number;
  durationSec: number;
}

export const IMAGE_FIXTURES: ImageFixture[] = [
  { file: 'img-0.png', width: 768, height: 768 },
  { file: 'img-1.png', width: 768, height: 768 },
  { file: 'img-2.png', width: 768, height: 768 },
  { file: 'img-3.png', width: 768, height: 768 },
  { file: 'img-4.png', width: 768, height: 768 },
];

export const VIDEO_FIXTURES: VideoFixture[] = [
  { file: 'clip-0.mp4', width: 1280, height: 720, durationSec: 2 },
  { file: 'clip-1.mp4', width: 1280, height: 720, durationSec: 3 },
  { file: 'clip-2.mp4', width: 1280, height: 720, durationSec: 4 },
  { file: 'clip-3.mp4', width: 1280, height: 720, durationSec: 5 },
  { file: 'clip-4.mp4', width: 1280, height: 720, durationSec: 6 },
];

export const IMAGE_FIXTURES_SUBDIR = 'text-to-image';
export const VIDEO_FIXTURES_SUBDIR = 'image-to-video';
