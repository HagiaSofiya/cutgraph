import { pathToFileURL } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppConfig } from './config';
import { loadConfig } from './config';
import { FixtureGenerationAdapter } from './jobs/fixtureAdapter';
import { JobRunner } from './jobs/jobRunner';
import { JobStore } from './jobs/jobStore';
import { UploadStore } from './media/uploadStore';
import { createEventsRoute } from './routes/events';
import { createStaticRoute } from './routes/fixtures';
import { healthRoute } from './routes/health';
import { createJobsRoute } from './routes/jobs';
import { createUploadsRoute } from './routes/uploads';

export function createApp(config: AppConfig = loadConfig()) {
  const jobStore = new JobStore(config.jobRetentionMs);
  const adapter = new FixtureGenerationAdapter(config.sim, `${config.publicOrigin}/fixtures`);
  const jobRunner = new JobRunner(jobStore, adapter);
  const uploadStore = new UploadStore(config.uploadsDir, `${config.publicOrigin}/uploads`);

  const app = new Hono();
  // Dev-scale CORS: the Vite dev server and this API run on different origins. mediabunny's
  // UrlSource issues cross-origin Range requests to seek within fixture/upload video files, so
  // Range must be explicitly allowed and Content-Range/Accept-Ranges explicitly exposed --
  // neither is on the CORS-safelisted-header default.
  app.use(
    '*',
    cors({
      allowHeaders: ['Content-Type', 'Range'],
      exposeHeaders: ['Content-Range', 'Content-Length', 'Accept-Ranges'],
    }),
  );

  app.route('/api/health', healthRoute);
  app.route('/api/jobs', createJobsRoute(jobRunner));
  app.route('/api/jobs', createEventsRoute(jobStore));
  app.route('/api/uploads', createUploadsRoute(uploadStore));
  app.route('/fixtures', createStaticRoute(config.fixturesDir, '/fixtures'));
  app.route('/uploads', createStaticRoute(config.uploadsDir, '/uploads'));

  return { app, jobStore, jobRunner, uploadStore, config };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const { app, jobStore, config } = createApp();
  setInterval(() => jobStore.sweepExpired(), 60_000).unref();
  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`cutgraph server listening on http://localhost:${info.port}`);
  });
}
