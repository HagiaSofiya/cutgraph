import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';

export function createStaticRoute(root: string, mountPrefix: string): Hono {
  const app = new Hono();
  const prefix = new RegExp(`^${mountPrefix}`);
  app.use('/*', serveStatic({ root, rewriteRequestPath: (path) => path.replace(prefix, '') }));
  return app;
}
