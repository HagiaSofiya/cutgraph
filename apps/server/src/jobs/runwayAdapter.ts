import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  GenerateHooks,
  GenerateRequest,
  GenerateResult,
  GenerationAdapter,
  ImageToVideoParams,
  TextToImageParams,
} from '@cutgraph/shared';
import type RunwayML from '@runwayml/sdk';
import type { StoredUpload, UploadStore } from '../media/uploadStore';
import { mapRunwayError } from './runwayErrors';
import {
  IMAGE_TO_VIDEO_MODEL,
  mapImageToVideoDuration,
  mapImageToVideoRatio,
  mapTextToImageRatio,
  pixelPairToDimensions,
  TEXT_TO_IMAGE_MODEL,
} from './runwayParams';

// Data URIs are capped at 5MB *encoded*; base64 inflates raw bytes by ~4/3, so this is the
// largest local file that stays under that cap with a safety margin.
const MAX_LOCAL_IMAGE_BYTES = 3_500_000;

const EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

// Matches the exact naming scheme UploadStore (and this adapter's own storeOutput) write:
// <sha256-hex>.<ext>. request.inputs[].url is client-supplied JSON, so anything that doesn't
// match this shape is refused rather than treated as a path to read off disk.
const LOCAL_UPLOAD_FILENAME = /^[0-9a-f]{64}\.(png|jpe?g|webp)$/i;

// Implements GenerationAdapter against the real Runway Dev API. Two responsibilities the fixture
// adapter never had to think about: resolving input images the API can actually fetch (see
// resolvePromptImage), and persisting outputs before Runway's own URLs expire in 24-48h (see
// storeOutput).
export class RunwayGenerationAdapter implements GenerationAdapter {
  constructor(
    private readonly client: RunwayML,
    private readonly uploadStore: UploadStore,
    private readonly uploadsDir: string,
    private readonly publicOrigin: string,
  ) {}

  async generate(request: GenerateRequest, hooks?: GenerateHooks): Promise<GenerateResult> {
    try {
      const result =
        request.nodeType === 'textToImage'
          ? await this.generateImage(request, hooks)
          : await this.generateVideo(request, hooks);
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: mapRunwayError(err) };
    }
  }

  private async generateImage(request: GenerateRequest, hooks?: GenerateHooks) {
    const params = request.params as TextToImageParams;
    const ratio = mapTextToImageRatio(params.ratio);

    const task = this.client.textToImage.create({
      model: TEXT_TO_IMAGE_MODEL,
      promptText: params.prompt,
      ratio,
    });
    await task; // task accepted server-side; distinct from waitForTaskOutput's polling below
    hooks?.onRunning?.();
    const output = await task.waitForTaskOutput();

    const stored = await this.storeOutput(output.output[0], 'image');
    const { width, height } = pixelPairToDimensions(ratio);
    return { url: stored.publicUrl, kind: 'image' as const, width, height };
  }

  private async generateVideo(request: GenerateRequest, hooks?: GenerateHooks) {
    const params = request.params as ImageToVideoParams;
    const ratio = mapImageToVideoRatio(params.ratio);
    const duration = mapImageToVideoDuration(params.duration);

    const inputUrl = request.inputs[0]?.url;
    if (!inputUrl) throw new Error('imageToVideo requires an input image');
    const promptImage = await this.resolvePromptImage(inputUrl);

    const task = this.client.imageToVideo.create({
      model: IMAGE_TO_VIDEO_MODEL,
      promptImage,
      promptText: params.prompt,
      ratio,
      duration,
    });
    await task;
    hooks?.onRunning?.();
    const output = await task.waitForTaskOutput();

    const stored = await this.storeOutput(output.output[0], 'video');
    const { width, height } = pixelPairToDimensions(ratio);
    return { url: stored.publicUrl, kind: 'video' as const, width, height, durationSec: duration };
  }

  // Runway fetches promptImage server-side, so a URL pointing at our own localhost origin is
  // unreachable to it. A URL under our own /uploads/ is read straight off disk and sent as a
  // data URI instead of looping back over HTTP; anything else (a genuine external HTTPS URL,
  // including a previously-stored real-Runway output feeding a downstream node) passes through
  // unchanged.
  private async resolvePromptImage(url: string): Promise<string> {
    const uploadsPrefix = `${this.publicOrigin}/uploads/`;
    if (!url.startsWith(uploadsPrefix)) return url;

    const filename = url.slice(uploadsPrefix.length);
    if (!LOCAL_UPLOAD_FILENAME.test(filename)) {
      throw new Error(`refusing to read unrecognized local upload filename "${filename}"`);
    }

    const bytes = await readFile(path.join(this.uploadsDir, filename));
    if (bytes.byteLength > MAX_LOCAL_IMAGE_BYTES) {
      const mb = (n: number) => (n / 1_000_000).toFixed(1);
      throw new Error(
        `input image (${mb(bytes.byteLength)}MB) exceeds the ${mb(MAX_LOCAL_IMAGE_BYTES)}MB data-URI limit for this adapter`,
      );
    }

    const mime = EXT_TO_MIME[path.extname(filename).toLowerCase()] ?? 'application/octet-stream';
    return `data:${mime};base64,${bytes.toString('base64')}`;
  }

  // Runway's task output URLs expire in 24-48h and are explicitly meant to be downloaded and
  // stored by the caller. Reuses UploadStore's content-addressed storage (same dedupe, same
  // static route) so JobResult.url stays a stable, persistent URL like the rest of the system
  // assumes.
  private async storeOutput(outputUrl: string, kind: 'image' | 'video'): Promise<StoredUpload> {
    const res = await fetch(outputUrl);
    if (!res.ok) throw new Error(`failed to download Runway output: HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());

    const ext = extensionForContentType(res.headers.get('content-type'), kind);
    return this.uploadStore.save(bytes, `output${ext}`);
  }
}

function extensionForContentType(contentType: string | null, kind: 'image' | 'video'): string {
  const type = contentType ?? '';
  if (type.includes('png')) return '.png';
  if (type.includes('jpeg') || type.includes('jpg')) return '.jpg';
  if (type.includes('webp')) return '.webp';
  if (type.includes('mp4')) return '.mp4';
  if (type.includes('webm')) return '.webm';
  if (type.includes('quicktime')) return '.mov';
  return kind === 'image' ? '.png' : '.mp4';
}
