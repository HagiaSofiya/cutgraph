import { createHash } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface StoredUpload {
  sha256: string;
  filename: string;
  kind: 'image' | 'video';
  publicUrl: string;
}

const KIND_BY_EXT: Record<string, 'image' | 'video'> = {
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.gif': 'image',
  '.mp4': 'video',
  '.webm': 'video',
  '.mov': 'video',
};

// Content-addressed storage: the sha256 of the bytes is the filename (minus extension), so
// uploading the same file twice is a free no-op dedupe rather than a second copy on disk.
export class UploadStore {
  constructor(
    private readonly uploadsDir: string,
    private readonly publicBaseUrl: string,
  ) {}

  async save(bytes: Uint8Array, originalName: string): Promise<StoredUpload> {
    const ext = path.extname(originalName).toLowerCase();
    const kind = KIND_BY_EXT[ext];
    if (!kind) {
      throw new Error(`Unsupported upload type: "${ext || '(no extension)'}"`);
    }

    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const filename = `${sha256}${ext}`;
    const filePath = path.join(this.uploadsDir, filename);

    const alreadyStored = await stat(filePath).then(
      () => true,
      () => false,
    );
    if (!alreadyStored) {
      await mkdir(this.uploadsDir, { recursive: true });
      await writeFile(filePath, bytes);
    }

    return { sha256, filename, kind, publicUrl: `${this.publicBaseUrl}/${filename}` };
  }
}
