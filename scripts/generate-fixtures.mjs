#!/usr/bin/env node
// Generates cutgraph's fixture-mode media pool entirely offline via ffmpeg. The definitions
// below are duplicated in apps/server/src/jobs/fixturePool.ts, which is the source of truth the
// server actually reads at runtime -- this script only needs to produce files at those same
// paths. apps/server/tests/fixturePool.drift.test.ts fails if the two ever disagree.
//
// The video pool is deliberately uniform (one resolution, one framerate, one codec; only
// duration varies) so Concat's own risk -- sequential mediabunny concatenation -- never also
// has to solve re-encoding mismatched sources.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(__dirname, '..', 'apps', 'server', 'fixtures');

export const IMAGE_FIXTURES = [
  { file: 'img-0.png', width: 768, height: 768, color: '0xE63946' },
  { file: 'img-1.png', width: 768, height: 768, color: '0xF1A208' },
  { file: 'img-2.png', width: 768, height: 768, color: '0x2A9D8F' },
  { file: 'img-3.png', width: 768, height: 768, color: '0x264653' },
  { file: 'img-4.png', width: 768, height: 768, color: '0x8338EC' },
];

export const VIDEO_FIXTURES = [
  { file: 'clip-0.mp4', width: 1280, height: 720, durationSec: 2 },
  { file: 'clip-1.mp4', width: 1280, height: 720, durationSec: 3 },
  { file: 'clip-2.mp4', width: 1280, height: 720, durationSec: 4 },
  { file: 'clip-3.mp4', width: 1280, height: 720, durationSec: 5 },
  { file: 'clip-4.mp4', width: 1280, height: 720, durationSec: 6 },
];

function run(args) {
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function generateImage({ file, width, height, color }, index, dir) {
  run([
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=${color}:s=${width}x${height}`,
    '-vf', `drawtext=text='cutgraph image ${index}':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=(h-text_h)/2`,
    '-frames:v', '1',
    path.join(dir, file),
  ]);
}

function generateVideo({ file, width, height, durationSec }, index, dir) {
  run([
    '-y',
    '-f', 'lavfi',
    '-i', `testsrc2=size=${width}x${height}:rate=30:duration=${durationSec}`,
    '-vf', `drawtext=text='cutgraph clip ${index}':fontcolor=white:fontsize=32:x=20:y=20:box=1:boxcolor=black@0.5`,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-t', String(durationSec),
    path.join(dir, file),
  ]);
}

// Guarded so the fixture definitions above can be imported (by
// apps/server/tests/fixturePool.drift.test.ts) without shelling out to ffmpeg. Same isMain
// check apps/server/src/index.ts uses.
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const imageDir = path.join(fixturesRoot, 'text-to-image');
  const videoDir = path.join(fixturesRoot, 'image-to-video');
  ensureDir(imageDir);
  ensureDir(videoDir);

  console.log('Generating image fixtures...');
  IMAGE_FIXTURES.forEach((fixture, i) => generateImage(fixture, i, imageDir));

  console.log('Generating video fixtures...');
  VIDEO_FIXTURES.forEach((fixture, i) => generateVideo(fixture, i, videoDir));

  console.log(`Done. Wrote ${IMAGE_FIXTURES.length} images and ${VIDEO_FIXTURES.length} clips to ${fixturesRoot}`);
}
