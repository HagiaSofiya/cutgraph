import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { GenerateRequest } from '@cutgraph/shared';
import type RunwayML from '@runwayml/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UploadStore } from '../src/media/uploadStore';
import { RunwayGenerationAdapter } from '../src/jobs/runwayAdapter';

const PUBLIC_ORIGIN = 'http://localhost:8787';

// Mimics APIPromiseWithAwaitableTask<T>: a thenable that resolves to the "task created" body,
// decorated with a waitForTaskOutput() that resolves to the terminal task.
function fakeTask<T>(created: T, waitForTaskOutput: () => Promise<unknown>) {
  const promise = Promise.resolve(created) as Promise<T> & { waitForTaskOutput: () => Promise<unknown> };
  promise.waitForTaskOutput = waitForTaskOutput;
  return promise;
}

function fakeRunwayResponse(bytes: Uint8Array, contentType: string) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: async () => bytes.buffer,
  } as unknown as Response;
}

describe('RunwayGenerationAdapter', () => {
  let tmpDir: string;
  let uploadsDir: string;
  let uploadStore: UploadStore;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'cutgraph-runway-test-'));
    uploadsDir = path.join(tmpDir, 'uploads');
    mkdirSync(uploadsDir, { recursive: true });
    uploadStore = new UploadStore(uploadsDir, `${PUBLIC_ORIGIN}/uploads`);
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(fakeRunwayResponse(new Uint8Array([1, 2, 3, 4]), 'image/png'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    fetchSpy.mockRestore();
  });

  function textToImageRequest(): GenerateRequest {
    return {
      jobId: 'job-1',
      nodeType: 'textToImage',
      params: { prompt: 'a cat', ratio: '16:9', model: 'gen4_image' },
      inputs: [],
      cacheKey: 'k1',
    };
  }

  it('creates a text-to-image task with mapped params and stores the output locally', async () => {
    const create = vi.fn().mockReturnValue(
      fakeTask({ id: 'task_1', estimatedCost: { credits: 1 } }, async () => ({
        id: 'task_1',
        status: 'SUCCEEDED',
        output: ['https://runway.example/out.png'],
      })),
    );
    const client = { textToImage: { create }, imageToVideo: { create: vi.fn() } } as unknown as RunwayML;
    const adapter = new RunwayGenerationAdapter(client, uploadStore, uploadsDir, PUBLIC_ORIGIN);

    const onRunning = vi.fn();
    const result = await adapter.generate(textToImageRequest(), { onRunning });

    expect(create).toHaveBeenCalledWith({ model: 'gen4_image', promptText: 'a cat', ratio: '1280:720' });
    expect(onRunning).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.kind).toBe('image');
      expect(result.result.width).toBe(1280);
      expect(result.result.height).toBe(720);
      // Stored through UploadStore, not Runway's own (expiring) URL.
      expect(result.result.url.startsWith(`${PUBLIC_ORIGIN}/uploads/`)).toBe(true);
      expect(result.result.url).not.toContain('runway.example');
    }
  });

  it('rounds duration and maps ratio for image-to-video, sending an external input URL unchanged', async () => {
    const create = vi.fn().mockReturnValue(
      fakeTask({ id: 'task_2', estimatedCost: { credits: 2 } }, async () => ({
        id: 'task_2',
        status: 'SUCCEEDED',
        output: ['https://runway.example/out.mp4'],
      })),
    );
    const client = { textToImage: { create: vi.fn() }, imageToVideo: { create } } as unknown as RunwayML;
    const adapter = new RunwayGenerationAdapter(client, uploadStore, uploadsDir, PUBLIC_ORIGIN);

    const request: GenerateRequest = {
      jobId: 'job-2',
      nodeType: 'imageToVideo',
      params: { prompt: 'walk forward', duration: 6.4, ratio: '4:3', model: 'gen4.5' },
      inputs: [{ url: 'https://elsewhere.example/source.jpg', kind: 'image', sha256: 'abc' }],
      cacheKey: 'k2',
    };
    const result = await adapter.generate(request);

    expect(create).toHaveBeenCalledWith({
      model: 'gen4.5',
      promptImage: 'https://elsewhere.example/source.jpg',
      promptText: 'walk forward',
      ratio: '1104:832',
      duration: 6,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.kind).toBe('video');
      expect(result.result.durationSec).toBe(6);
    }
  });

  it('reads a local upload off disk and sends it as a data URI instead of the unreachable localhost URL', async () => {
    const sha = 'a'.repeat(64);
    const filename = `${sha}.png`;
    writeFileSync(path.join(uploadsDir, filename), Buffer.from([137, 80, 78, 71]));

    const create = vi.fn().mockReturnValue(
      fakeTask({ id: 'task_3', estimatedCost: { credits: 2 } }, async () => ({
        id: 'task_3',
        status: 'SUCCEEDED',
        output: ['https://runway.example/out.mp4'],
      })),
    );
    const client = { textToImage: { create: vi.fn() }, imageToVideo: { create } } as unknown as RunwayML;
    const adapter = new RunwayGenerationAdapter(client, uploadStore, uploadsDir, PUBLIC_ORIGIN);

    const request: GenerateRequest = {
      jobId: 'job-3',
      nodeType: 'imageToVideo',
      params: { prompt: 'walk forward', duration: 4, ratio: '16:9', model: 'gen4.5' },
      inputs: [{ url: `${PUBLIC_ORIGIN}/uploads/${filename}`, kind: 'image', sha256: sha }],
      cacheKey: 'k3',
    };
    const result = await adapter.generate(request);

    const sentPromptImage = create.mock.calls[0][0].promptImage as string;
    expect(sentPromptImage.startsWith('data:image/png;base64,')).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('refuses a local-origin URL whose filename does not match the upload naming scheme', async () => {
    const client = { textToImage: { create: vi.fn() }, imageToVideo: { create: vi.fn() } } as unknown as RunwayML;
    const adapter = new RunwayGenerationAdapter(client, uploadStore, uploadsDir, PUBLIC_ORIGIN);

    const request: GenerateRequest = {
      jobId: 'job-4',
      nodeType: 'imageToVideo',
      params: { prompt: 'walk forward', duration: 4, ratio: '16:9', model: 'gen4.5' },
      inputs: [{ url: `${PUBLIC_ORIGIN}/uploads/../../etc/passwd`, kind: 'image', sha256: 'x' }],
      cacheKey: 'k4',
    };
    const result = await adapter.generate(request);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('refusing');
    expect((client.imageToVideo.create as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('fails the job with a clear message instead of throwing when a local input exceeds the data-URI size limit', async () => {
    const sha = 'b'.repeat(64);
    const filename = `${sha}.png`;
    writeFileSync(path.join(uploadsDir, filename), Buffer.alloc(4_000_000));

    const client = { textToImage: { create: vi.fn() }, imageToVideo: { create: vi.fn() } } as unknown as RunwayML;
    const adapter = new RunwayGenerationAdapter(client, uploadStore, uploadsDir, PUBLIC_ORIGIN);

    const request: GenerateRequest = {
      jobId: 'job-5',
      nodeType: 'imageToVideo',
      params: { prompt: 'walk forward', duration: 4, ratio: '16:9', model: 'gen4.5' },
      inputs: [{ url: `${PUBLIC_ORIGIN}/uploads/${filename}`, kind: 'image', sha256: sha }],
      cacheKey: 'k5',
    };
    const result = await adapter.generate(request);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('exceeds');
    expect((client.imageToVideo.create as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('never throws, even when the SDK client throws synchronously', async () => {
    const client = {
      textToImage: {
        create: vi.fn(() => {
          throw new Error('boom');
        }),
      },
      imageToVideo: { create: vi.fn() },
    } as unknown as RunwayML;
    const adapter = new RunwayGenerationAdapter(client, uploadStore, uploadsDir, PUBLIC_ORIGIN);

    const result = await adapter.generate(textToImageRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('boom');
  });

  it('sends the node\'s selected model, with that model\'s own ratio mapping', async () => {
    const create = vi.fn().mockReturnValue(
      fakeTask({ id: 'task_1', estimatedCost: { credits: 1 } }, async () => ({
        id: 'task_1',
        status: 'SUCCEEDED',
        output: ['https://runway.example/out.png'],
      })),
    );
    const client = { textToImage: { create }, imageToVideo: { create: vi.fn() } } as unknown as RunwayML;
    const adapter = new RunwayGenerationAdapter(client, uploadStore, uploadsDir, PUBLIC_ORIGIN);

    const result = await adapter.generate({
      ...textToImageRequest(),
      params: { prompt: 'a cat', ratio: '4:3', model: 'grok_imagine_image_2' },
    });

    // 4:3 resolves to a different pixel pair per model -- gen4_image would be 1440:1080.
    expect(create).toHaveBeenCalledWith({
      model: 'grok_imagine_image_2',
      promptText: 'a cat',
      ratio: '1152:864',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.width).toBe(1152);
      expect(result.result.height).toBe(864);
    }
  });

  it('snaps duration when the selected image-to-video model only accepts certain lengths', async () => {
    const create = vi.fn().mockReturnValue(
      fakeTask({ id: 'task_2', estimatedCost: { credits: 5 } }, async () => ({
        id: 'task_2',
        status: 'SUCCEEDED',
        output: ['https://runway.example/out.mp4'],
      })),
    );
    const client = { textToImage: { create: vi.fn() }, imageToVideo: { create } } as unknown as RunwayML;
    const adapter = new RunwayGenerationAdapter(client, uploadStore, uploadsDir, PUBLIC_ORIGIN);

    await adapter.generate({
      jobId: 'job-2',
      nodeType: 'imageToVideo',
      params: { prompt: 'walk forward', duration: 4, ratio: '16:9', model: 'gen4_turbo' },
      inputs: [{ url: 'https://example.com/in.png', kind: 'image', sha256: 'abc' }],
      cacheKey: 'k2',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gen4_turbo', duration: 5, ratio: '1280:720' }),
    );
  });
});
