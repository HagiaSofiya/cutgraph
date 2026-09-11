import { Hono } from 'hono';
import type { UploadStore } from '../media/uploadStore';

export function createUploadsRoute(store: UploadStore): Hono {
  const app = new Hono();

  app.post('/', async (c) => {
    const body = await c.req.parseBody().catch(() => undefined);
    const file = body?.['file'];
    if (!(file instanceof File)) {
      return c.json({ error: { message: 'multipart field "file" is required' } }, 400);
    }

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const stored = await store.save(bytes, file.name);
      return c.json({ url: stored.publicUrl, sha256: stored.sha256, kind: stored.kind }, 201);
    } catch (err) {
      return c.json({ error: { message: err instanceof Error ? err.message : 'upload failed' } }, 400);
    }
  });

  return app;
}
