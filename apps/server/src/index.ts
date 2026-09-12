import { pathToFileURL } from 'node:url';
import { serve } from '@hono/node-server';
import RunwayML from '@runwayml/sdk';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppConfig } from './config';
import { loadConfig } from './config';
import type { AdapterKind, GenerationAdapter } from '@cutgraph/shared';
import { FixtureGenerationAdapter } from './jobs/fixtureAdapter';
import { JobRunner } from './jobs/jobRunner';
import { JobStore } from './jobs/jobStore';
import { RunwayGenerationAdapter } from './jobs/runwayAdapter';
import { IMAGE_TO_VIDEO_MODELS, TEXT_TO_IMAGE_MODELS } from './jobs/runwayParams';
import { SpendGuard } from './jobs/spendGuard';
import { UploadStore } from './media/uploadStore';
import { createEventsRoute } from './routes/events';
import { createStaticRoute } from './routes/fixtures';
import type { HealthInfo } from './routes/health';
import { createHealthRoute } from './routes/health';
import { createJobsRoute } from './routes/jobs';
import { createUploadsRoute } from './routes/uploads';

interface SelectedAdapter {
  adapter: GenerationAdapter;
  active: AdapterKind;
  models: HealthInfo['models'];
}

function createAdapter(config: AppConfig, uploadStore: UploadStore): SelectedAdapter {
  // Fixture "generation" is a hash into a pool of pre-rendered ffmpeg files, so it has no models
  // to report -- an empty list is what tells the canvas there is no model behind these results.
  const fixture = (): SelectedAdapter => ({
    adapter: new FixtureGenerationAdapter(config.sim, `${config.publicOrigin}/fixtures`),
    active: 'fixture',
    models: { textToImage: [], imageToVideo: [] },
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
    active: 'runway',
    models: { textToImage: [...TEXT_TO_IMAGE_MODELS], imageToVideo: [...IMAGE_TO_VIDEO_MODELS] },
  };
}

export function createApp(config: AppConfig = loadConfig()) {
  const jobStore = new JobStore(config.jobRetentionMs);
  const uploadStore = new UploadStore(config.uploadsDir, `${config.publicOrigin}/uploads`);
  const { adapter, active, models } = createAdapter(config, uploadStore);
  const isRunway = active === 'runway';
  const jobRunner = new JobRunner(jobStore, adapter, config.jobTimeoutMs);

  // Spend limits only bite for the paid adapter -- fixture mode (and every existing test) stays
  // unlimited.
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

  app.route(
    '/api/health',
    createHealthRoute({ requested: config.adapter ?? 'fixture', active, models }, spendGuard),
  );
  app.route('/api/jobs', createJobsRoute(jobRunner, spendGuard));
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
