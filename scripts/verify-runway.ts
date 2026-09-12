#!/usr/bin/env tsx
// The live-API verification matrix for the Runway adapter.
//
// Every automated test mocks the SDK client, so the parameter mapping tables in
// apps/server/src/jobs/runwayParams.ts are verified against the SDK's *types* and never against
// the API's actual behavior -- a wrong mapping is a 400 at generation time, which is exactly the
// class of bug a mock cannot catch. This script closes that gap by driving the real
// RunwayGenerationAdapter (not a reimplementation of it) once per interesting parameter
// combination.
//
// Usage:
//   CUTGRAPH_RUNWAY_API_KEY=... npx tsx scripts/verify-runway.ts          # dry run, spends nothing
//   CUTGRAPH_RUNWAY_API_KEY=... npx tsx scripts/verify-runway.ts --confirm
//
// Costs roughly 125 credits (~$1.25) against the $10 minimum top-up at dev.runwayml.com.

import RunwayML from '@runwayml/sdk';
import type { GenerateRequest, GenerateResult } from '@cutgraph/shared';
import { loadConfig } from '../apps/server/src/config';
import { RunwayGenerationAdapter } from '../apps/server/src/jobs/runwayAdapter';
import {
  mapGen4ImageRatio,
  mapGrokImageRatio,
  mapImageToVideoDuration,
  mapImageToVideoRatio,
} from '../apps/server/src/jobs/runwayParams';
import { UploadStore } from '../apps/server/src/media/uploadStore';

interface Case {
  name: string;
  why: string;
  credits: string;
  request: Omit<GenerateRequest, 'jobId' | 'cacheKey'>;
  // What the mapping tables turn the params into. Printed next to the outcome so a 400 can be
  // read against the exact value that caused it.
  mapped: () => string;
}

// Video cases need a real input image; case 1's output feeds them, so this is a placeholder the
// runner substitutes at call time. sha256 is required by MediaInputRef but never read by the
// adapter -- only .url is -- and we genuinely do not know it here.
const INPUT_PLACEHOLDER = '__FROM_CASE_1__';
const placeholderInput = { url: INPUT_PLACEHOLDER, kind: 'image' as const, sha256: '' };

const CASES: Case[] = [
  {
    name: 'gen4_image @ 16:9',
    why: 'baseline text-to-image',
    credits: '5-8',
    request: {
      nodeType: 'textToImage',
      params: { prompt: 'a lighthouse on a cliff at dusk', ratio: '16:9', model: 'gen4_image' },
      inputs: [],
    },
    mapped: () => `ratio=${mapGen4ImageRatio('16:9')}`,
  },
  {
    name: 'grok_imagine_image_2 @ 1:1',
    why: 'second text-to-image model, entirely different ratio union',
    credits: '4-8',
    request: {
      nodeType: 'textToImage',
      params: { prompt: 'a lighthouse on a cliff at dusk', ratio: '1:1', model: 'grok_imagine_image_2' },
      inputs: [],
    },
    mapped: () => `ratio=${mapGrokImageRatio('1:1')}`,
  },
  {
    name: 'gen4.5 @ 16:9, 5s',
    why: 'baseline image-to-video',
    credits: '60',
    request: {
      nodeType: 'imageToVideo',
      params: { prompt: 'slow push in, waves below', ratio: '16:9', duration: 5, model: 'gen4.5' },
      inputs: [placeholderInput],
    },
    mapped: () => `ratio=${mapImageToVideoRatio('16:9')} duration=${mapImageToVideoDuration('gen4.5', 5)}`,
  },
  {
    name: 'gen4.5 @ 4:3, 2s',
    why: 'the documented near-miss -- 4:3 has no exact pixel pair, maps ~0.5% off',
    credits: '24',
    request: {
      nodeType: 'imageToVideo',
      params: { prompt: 'slow push in, waves below', ratio: '4:3', duration: 2, model: 'gen4.5' },
      inputs: [placeholderInput],
    },
    mapped: () => `ratio=${mapImageToVideoRatio('4:3')} duration=${mapImageToVideoDuration('gen4.5', 2)}`,
  },
  {
    name: 'gen4_turbo @ 16:9, 7s',
    why: 'duration snapping -- the SDK types this as a bare number, so nothing catches 7 at compile time',
    credits: '25',
    request: {
      nodeType: 'imageToVideo',
      params: { prompt: 'slow push in, waves below', ratio: '16:9', duration: 7, model: 'gen4_turbo' },
      inputs: [placeholderInput],
    },
    mapped: () =>
      `ratio=${mapImageToVideoRatio('16:9')} duration=${mapImageToVideoDuration('gen4_turbo', 7)} (from 7)`,
  },
];

function buildAdapter(apiKey: string) {
  const config = loadConfig();
  const uploadStore = new UploadStore(config.uploadsDir, `${config.publicOrigin}/uploads`);
  const client = new RunwayML({ apiKey });
  return new RunwayGenerationAdapter(client, uploadStore, config.uploadsDir, config.publicOrigin);
}

function describe(result: GenerateResult): string {
  return result.ok
    ? `OK   ${result.result.kind} ${result.result.width}x${result.result.height} -> ${result.result.url}`
    : `FAIL [${result.error.code ?? 'no code'}] ${result.error.message}`;
}

// Costs nothing: a deliberately invalid key should come back as AUTH rather than as an unmapped
// error, which is the one failure-taxonomy branch that can be checked for free.
async function verifyAuthFailure(): Promise<void> {
  console.log('\n--- auth failure (free) ---');
  const adapter = buildAdapter('definitely-not-a-valid-key');
  const result = await adapter.generate({
    jobId: 'verify-auth',
    cacheKey: 'verify-auth',
    nodeType: 'textToImage',
    params: { prompt: 'auth probe', ratio: '1:1', model: 'gen4_image' },
    inputs: [],
  });
  console.log(`  expected AUTH -> ${describe(result)}`);
}

async function main(): Promise<void> {
  const apiKey = process.env.CUTGRAPH_RUNWAY_API_KEY;
  if (!apiKey) {
    console.error(
      'CUTGRAPH_RUNWAY_API_KEY is not set.\n\n' +
        "Note this is cutgraph's own variable, not the SDK's default RUNWAYML_API_SECRET -- the\n" +
        'server passes the key explicitly (apps/server/src/index.ts), so setting only the SDK\n' +
        'variable silently leaves you in fixture mode.\n\n' +
        'Get a key at https://dev.runwayml.com/ (a separate portal from the consumer Runway app,\n' +
        'with its own credit pool; $10 minimum top-up before the first call).',
    );
    process.exit(1);
  }

  const confirmed = process.argv.includes('--confirm');

  console.log('Runway live verification matrix\n');
  for (const [i, c] of CASES.entries()) {
    console.log(`  ${i + 1}. ${c.name}`);
    console.log(`     ${c.why}`);
    console.log(`     mapped: ${c.mapped()}   ~${c.credits} credits`);
  }
  console.log('\n  + an auth-failure probe, which costs nothing.');
  console.log('\nTotal: ~125 credits (~$1.25).');

  if (!confirmed) {
    console.log('\nDry run -- nothing was sent. Re-run with --confirm to spend credits.');
    return;
  }

  const adapter = buildAdapter(apiKey);
  let inputImageUrl: string | undefined;

  for (const [i, c] of CASES.entries()) {
    const label = `${i + 1}. ${c.name}`;
    const inputs = c.request.inputs.map((input) =>
      input.url === INPUT_PLACEHOLDER ? { ...input, url: inputImageUrl ?? '' } : input,
    );

    if (inputs.some((input) => !input.url)) {
      console.log(`\n${label}\n  SKIPPED -- needs an input image, and no earlier case produced one.`);
      continue;
    }

    console.log(`\n${label}\n  mapped: ${c.mapped()}`);
    // Video generation polls until the task settles and can take several minutes; there is no
    // timeout here because JobRunner (not the adapter) is what enforces one in the server.
    const started = Date.now();
    const result = await adapter.generate(
      { ...c.request, inputs, jobId: `verify-${i + 1}`, cacheKey: `verify-${i + 1}` },
      { onRunning: () => console.log('  running...') },
    );
    console.log(`  ${describe(result)}  (${Math.round((Date.now() - started) / 1000)}s)`);

    if (result.ok && result.result.kind === 'image' && !inputImageUrl) {
      inputImageUrl = result.result.url;
    }
  }

  await verifyAuthFailure();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
