# Cutgraph

A node-based editor for generative video workflows: a small DAG canvas, in the spirit of
ComfyUI, but for generative clips. Build a graph of image/video generation and editing steps,
run it and watch each node's status stream in live.

Everything currently runs in *fixture mode*: no real generation API is called. Generation
nodes resolve to local canned clips after a simulated delay, with a configurable failure rate,
behind one swappable adapter interface. The point is to prove the orchestration layer correct
(caching, staleness, partial failure, live status streaming, canvas performance) before a
single credit gets spent on a real adapter. See [Architecture decisions](#architecture-decisions)
for why that seam is designed the way it is.

## Quick start

Requires Node 20+ and `ffmpeg` on your `PATH` (used once, offline, to generate fixture media).

```bash
npm install
npm run generate-fixtures --workspace=@cutgraph/server
```

Then, in two terminals:

```bash
npm run dev --workspace=@cutgraph/server   # http://localhost:8787
npm run dev --workspace=@cutgraph/web      # http://localhost:5173
```

Open `http://localhost:5173`, add a few nodes from the toolbar, connect them and click **Run**.

## Node types

| Node | Params | Executes | Result |
|---|---|---|---|
| Image Input | none (upload) | client-side (uploads to the server) | persistent |
| Text to Image | `prompt`, `ratio` | backend job (SSE) | persistent |
| Image to Video | `prompt`, `duration`, `ratio` | backend job (SSE) | persistent |
| Trim | `start`, `end` | client-side (mediabunny) | ephemeral |
| Concat | up to 4 ordered inputs | client-side (mediabunny) | ephemeral |
| Export | `filename` | client-side (mediabunny, triggers a download) | ephemeral |

"Persistent" results survive a page reload (they're server URLs); "ephemeral" results are
`blob:` URLs that live only in the tab that created them and are re-run after a reload. See
[Architecture decisions](#architecture-decisions) below.

## Architecture

An npm workspaces monorepo, so the reducer and schemas are a single source of truth shared by
both apps:

```
packages/shared/     framework-agnostic core: no React, no server deps
  src/schemas/          Zod schemas for node params, the graph, jobs, SSE events
  src/types/            Graph, GraphNode, GraphEdge, MediaRef
  src/reducer/          the graph state machine (pure), staleness propagation, selectors
  src/cache/            stable hashing + cache-key derivation

apps/server/          Hono backend, orchestrates generation jobs only
  src/jobs/              fixtureAdapter (the swappable seam), jobRunner, jobStore
  src/sse/               sseHub, replay-buffered SSE streaming
  src/routes/            jobs, events (SSE), uploads, static fixture/upload serving
  fixtures/              generated media (gitignored; see `npm run generate-fixtures`)

apps/web/             Vite + React + @xyflow/react canvas
  src/state/             graphContext (the reducer wired to React), persistence, reconciliation
  src/orchestrator/      runGraph (the run loop) + one executor per node type
  src/canvas/            xyflow wiring, memoized data-sync bridge
  src/nodes/             one component per node type, shared NodeShell + MediaPreview
  src/media/             mediabunny wrapper (trim/concat/export/poster), blob store

scripts/generate-fixtures.mjs   offline ffmpeg script that seeds apps/server/fixtures/
```

React is a thin layer here on purpose: the reducer, cache-key derivation and run orchestrator
are plain, framework-agnostic TypeScript, independently unit-tested without touching a DOM.

## The four things this proves

### 1. Per-node result caching

`packages/shared/src/cache/cacheKey.ts` derives a node's cache key from its type, its own
params and its *resolved* upstream output ids. It hashes with SHA-256 (truncated) rather than
a weaker algorithm, because `MediaRef.id` *is* the cache key: a collision would serve the wrong
media, not just waste a demo run. Upstream ordering is canonicalized inside the function itself
(sorted by handle, not by call-site array order), so a graph rebuilt from localStorage in a
different insertion order still derives byte-identical keys.

The result cache (`Graph.resultCache`, keyed by cache key rather than by node) means:
- Editing shot 3's prompt recomputes shot 3 and everything downstream of it; shots 1 and 2
  keep byte-identical keys and are never re-run.
- **Edit-and-revert is an instant cache hit.** Change a prompt, change it back: the old key is
  still in the cache, so the node resolves immediately with no re-generation.
- A generation that completes *after* the user has already edited that node's params still
  lands in the result cache (in case they revert), even though the node itself stays stale.

### 2. Partial failure and staleness

`packages/shared/src/reducer/graphReducer.ts` is a pure reducer over an explicit six-state
machine (`idle | queued | running | succeeded | failed | stale`). Two invariants do most of the
work:

- **`markStaleIfMeaningful`**: a node only becomes stale if it has something to invalidate (a
  retained result, or an in-flight run). A never-run node stays idle.
- **cacheKey-echo guard**: every lifecycle action carries the cache key its run was launched
  with, and a terminal transition is only applied if that key still matches. This one
  precondition makes three different races safe for free: an edit landing mid-run, a duplicate
  SSE delivery and replay during refresh reconciliation.

A failed node retains its last-succeeded result (visible, not discarded) and is retried
independently via `orchestrator/runGraph.ts`'s `retryNode`, which does **not** cascade forward
into that node's stale descendants, so a retry can't silently trigger several downstream paid
generations once a real adapter is in place.

### 3. Streaming status

The backend only orchestrates the two generation node types (`TextToImage`, `ImageToVideo`) as
jobs; everything else executes client-side. `apps/server/src/sse/sseHub.ts` buffers each job's
last 3 events (queued/running/terminal) and replays them on (re)connect: via the
`Last-Event-ID` header on the browser's own automatic reconnect, or a `?lastEventId=` query
param for a fresh page load, which can't set that header itself.

On boot, `apps/web/src/state/reconciliation.ts` finds every node still queued/running with a
live job id, fetches its current status and either applies an already-terminal result directly
or resumes the SSE subscription. This was verified against a real ~25-second job that survived
a full page reload.

### 4. Canvas performance

A twelve-node graph never holds twelve decoded `<video>` elements. `MediaPreview.tsx` renders a
poster `<img>` by default (extracted via mediabunny's `CanvasSink`) and mounts a real `<video>`
only while that node is hovered or selected. `canvas/reconcileFlowNodes.ts` is a pure function
that diffs the logical graph against xyflow's node array and only replaces the `data` reference
for nodes that actually changed; every custom node component is wrapped in `React.memo`, so an
unrelated node's status change doesn't re-render the other eleven.

## Architecture decisions

- **Execution split.** The backend only ever sees the two node types that would eventually call
  a paid API. `ImageInput`, `Trim`, `Concat` and `Export` run entirely in the browser via
  mediabunny, moving through the same reducer with no network round-trip.
- **Server-resolvable media.** A generation job's inputs are always absolute, server-fetchable
  URLs (`apps/server/src/media/uploadStore.ts` content-addresses uploads by SHA-256), never an
  opaque id or a browser-only `blob:` URL. This is what keeps a future real adapter a small diff:
  it needs bytes or a URL, and it already has one.
- **Durability: persistent vs. ephemeral.** Client-side node results (`Trim`, `Concat`,
  `Export` and blob-backed `ImageInput` failures) never leave the tab and can't survive a
  reload; `apps/web/src/state/persistence.ts` strips them before writing to localStorage and
  coerces the node to `stale`. Generation results and uploads are real server URLs and persist
  as-is. This is a real, visible behavior difference between node types, not a bug: it falls
  directly out of "no database, no file storage beyond fixtures and uploads."
- **Concat**, mediabunny's own docs point out, has no single "concatenate N clips" call: the
  high-level `Conversion` API always creates its own track per input, which merges *simultaneous*
  tracks (e.g. video from one file + audio from another), not sequential playback. The
  implementation in `media/mediabunnyClient.ts` instead creates one `VideoSampleSource`/output
  track by hand and manually pumps decoded samples from each input in order, rewriting each
  sample's timestamp by a running cumulative offset.

## Fixture mode configuration

Env vars for `apps/server` (all optional):

| Variable | Default | Meaning |
|---|---|---|
| `CUTGRAPH_SIM_MIN_LATENCY_MS` / `_MAX_LATENCY_MS` | 400 / 1200 | simulated queue latency before a job starts running |
| `CUTGRAPH_SIM_MIN_PROCESSING_MS` / `_MAX_PROCESSING_MS` | 1500 / 4000 | simulated generation time |
| `CUTGRAPH_SIM_FAILURE_RATE` | 0.15 | probability a job fails |
| `CUTGRAPH_JOB_RETENTION_MS` | 600000 | how long a finished job stays queryable |
| `PORT` | 8787 | server port |
| `CUTGRAPH_PUBLIC_ORIGIN` | `http://localhost:<PORT>` | base URL used to build fixture/upload links |

## Testing

```bash
npm test          # 125 tests across all three packages
npm run typecheck
```

WebCodecs can't run in jsdom, so mediabunny itself is mocked in `apps/web` unit tests; the
orchestration logic around it (executors, the run loop, persistence, reconciliation) is what's
under test. The real codec paths (trim, concat, poster extraction, export) have been exercised
manually in a real browser end to end.

## Explicitly out of scope

Auth, a database, multi-user, undo/redo, a settings page, any node type beyond the six above.
Persistence is localStorage only.
