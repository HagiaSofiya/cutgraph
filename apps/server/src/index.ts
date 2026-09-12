import { pathToFileURL } from 'node:url';
import { serve } from '@hono/node-server';
import RunwayML from '@runwayml/sdk';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppConfig } from './config';
import { loadConfig } from './config';
import type { GenerationAdapter } from '@cutgraph/shared';
import { FixtureGenerationAdapter } from './jobs/fixtureAdapter';
import { JobRunner } from './jobs/jobRunner';
import { JobStore } from './jobs/jobStore';
import { RunwayGenerationAdapter } from './jobs/runwayAdapter';
import { SpendGuard } from './jobs/spendGuard';
import { UploadStore } from './media/uploadStore';
import { createEventsRoute } from './routes/events';
import { createStaticRoute } from './routes/fixtures';
import { healthRoute } from './routes/health';
import { createJobsRoute } from './routes/jobs';
import { createUploadsRoute } from './routes/uploads';

function createAdapter(config: AppConfig, uploadStore: UploadStore): { adapter: GenerationAdapter; isRunway: boolean } {
  const fixture = () => ({
    adapter: new FixtureGenerationAdapter(config.sim, `${config.publicOrigin}/fixtures`),
    isRunway: false,
  });

  if (config.adapter !== 'runway') return fixture();

  if (!config.runwayApiKey) {
    console.warn(
      '[cutgraph] CUTGRAPH_ADAPTER=runway but CUTGRAPH_RUNWAY_API_KEY is missing or empty. ' +
        'Falling back to the fixture adapter.',
    );
    return fixture();
  }

  const client = new RunwayML({ apiKey: config.runwayApiKey });
  return {
    adapter: new RunwayGenerationAdapter(client, uploadStore, config.uploadsDir, config.publicOrigin),
    isRunway: true,
  };
}

export function createApp(config: AppConfig = loadConfig()) {
  const jobStore = new JobStore(config.jobRetentionMs);
  const uploadStore = new UploadStore(config.uploadsDir, `${config.publicOrigin}/uploads`);
  const { adapter, isRunway } = createAdapter(config, uploadStore);
  const jobRunner = new JobRunner(jobStore, adapter);

  // Spend limits only bite for the paid adapter -- fixture mode (the deployed demo, and every
  // existing test) stays unlimited.
  const spendGuard = isRunway
    ? new SpendGuard(config.spendGuard?.maxGenerationsTotal ?? 50, config.spendGuard?.maxConcurrentJobs ?? 3)
    : new SpendGuard(Infinity, Infinity);

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
  app.route('/api/jobs', createJobsRoute(jobRunner, jobStore, spendGuard));
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
