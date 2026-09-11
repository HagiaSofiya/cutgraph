import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UploadStore } from '../src/media/uploadStore';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'cutgraph-uploads-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('UploadStore', () => {
  it('stores a file under its content hash and returns a public url', async () => {
    const store = new UploadStore(dir, 'http://localhost:8787/uploads');
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const stored = await store.save(bytes, 'photo.png');

    expect(stored.kind).toBe('image');
    expect(stored.filename).toBe(`${stored.sha256}.png`);
    expect(stored.publicUrl).toBe(`http://localhost:8787/uploads/${stored.filename}`);
  });

  it('dedupes identical bytes: the second save writes no new file', async () => {
    const store = new UploadStore(dir, 'http://localhost:8787/uploads');
    const bytes = new Uint8Array([9, 9, 9]);

    const first = await store.save(bytes, 'a.png');
    const second = await store.save(bytes, 'a.png');

    expect(first.sha256).toBe(second.sha256);
    expect(readdirSync(dir)).toHaveLength(1);
  });

  it('gives different names to different content', async () => {
    const store = new UploadStore(dir, 'http://localhost:8787/uploads');
    const a = await store.save(new Uint8Array([1]), 'a.png');
    const b = await store.save(new Uint8Array([2]), 'a.png');
    expect(a.sha256).not.toBe(b.sha256);
    expect(readdirSync(dir)).toHaveLength(2);
  });

  it('rejects an unsupported extension', async () => {
    const store = new UploadStore(dir, 'http://localhost:8787/uploads');
    await expect(store.save(new Uint8Array([1]), 'notes.txt')).rejects.toThrow();
  });

  it('classifies video extensions correctly', async () => {
    const store = new UploadStore(dir, 'http://localhost:8787/uploads');
    const stored = await store.save(new Uint8Array([1, 2, 3]), 'clip.mp4');
    expect(stored.kind).toBe('video');
  });
});
