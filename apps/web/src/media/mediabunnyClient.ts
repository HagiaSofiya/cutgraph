import {
  ALL_FORMATS,
  BufferTarget,
  CanvasSink,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  UrlSource,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
} from 'mediabunny';

function openInput(url: string): Input {
  return new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
}

async function canvasToPngBlob(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
  if (canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: 'image/png' });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob failed'))), 'image/png');
  });
}

export interface VideoMetadata {
  width: number;
  height: number;
  durationSec: number;
}

export async function probeVideo(url: string): Promise<VideoMetadata> {
  const input = openInput(url);
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error(`No video track found at ${url}`);
  const [width, height, durationSec] = await Promise.all([
    track.getDisplayWidth(),
    track.getDisplayHeight(),
    input.computeDuration(),
  ]);
  return { width, height, durationSec };
}

// Poster frames are extracted on demand (a node's video result may be hydrated from
// localStorage with no cached poster) rather than eagerly for every node up front.
export async function extractPoster(url: string, atSec = 0): Promise<string> {
  const input = openInput(url);
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error(`No video track found at ${url}`);
  const sink = new CanvasSink(track, { width: 320 });
  const frame = await sink.getCanvas(atSec);
  if (!frame) throw new Error(`Could not extract a frame at ${atSec}s from ${url}`);
  const blob = await canvasToPngBlob(frame.canvas);
  return URL.createObjectURL(blob);
}

export interface TrimResult extends VideoMetadata {
  blob: Blob;
}

export async function trim(url: string, startSec: number, endSec: number): Promise<TrimResult> {
  const input = openInput(url);
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error(`No video track found at ${url}`);
  const [width, height] = await Promise.all([track.getDisplayWidth(), track.getDisplayHeight()]);

  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const conversion = await Conversion.init({ input, output, trim: { start: startSec, end: endSec } });
  if (!conversion.isValid) {
    throw new Error('This clip cannot be trimmed as requested (see conversion.discardedTracks)');
  }
  await conversion.execute();

  const buffer = output.target.buffer;
  if (!buffer) throw new Error('Trim produced no output buffer');
  return {
    blob: new Blob([buffer], { type: output.format.mimeType }),
    width,
    height,
    durationSec: endSec - startSec,
  };
}

export interface ExportResult extends VideoMetadata {
  blob: Blob;
}

// A straight re-mux/re-encode into a standalone MP4 -- Export's job is just "make this
// upstream result into a real downloadable file," with no trim window of its own.
export async function remux(url: string): Promise<ExportResult> {
  const input = openInput(url);
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error(`No video track found at ${url}`);
  const [width, height, durationSec] = await Promise.all([
    track.getDisplayWidth(),
    track.getDisplayHeight(),
    input.computeDuration(),
  ]);

  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const conversion = await Conversion.init({ input, output });
  if (!conversion.isValid) {
    throw new Error('This clip cannot be exported (see conversion.discardedTracks)');
  }
  await conversion.execute();

  const buffer = output.target.buffer;
  if (!buffer) throw new Error('Export produced no output buffer');
  return { blob: new Blob([buffer], { type: output.format.mimeType }), width, height, durationSec };
}

export interface ConcatResult extends VideoMetadata {
  blob: Blob;
}

// mediabunny has no single "concatenate N clips" call, and the high-level `Conversion` class
// always adds its own track per input -- composing several `Conversion`s onto one `Output`
// merges *simultaneous* tracks (e.g. video from one file + audio from another), not sequential
// clips. So this bypasses `Conversion` and manually pumps decoded samples from every input,
// in order, into a single hand-created video track, rewriting each sample's timestamp by a
// running cumulative offset so clip 2 begins exactly where clip 1 ends.
export async function concat(urls: string[]): Promise<ConcatResult> {
  if (urls.length === 0) throw new Error('Concat requires at least one input');

  const inputs = urls.map(openInput);
  const firstTrack = await inputs[0].getPrimaryVideoTrack();
  if (!firstTrack) throw new Error('Concat input has no video track');
  const [width, height] = await Promise.all([firstTrack.getDisplayWidth(), firstTrack.getDisplayHeight()]);

  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const videoSource = new VideoSampleSource({ codec: 'avc', quality: new Quality('high') });
  output.addVideoTrack(videoSource);
  await output.start();

  let cumulativeOffsetSec = 0;
  for (const input of inputs) {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('Concat input has no video track');
    const sink = new VideoSampleSink(track);
    const clipDurationSec = await input.computeDuration();

    for await (const sample of sink.samples()) {
      const rebased = new VideoSample(sample.toCanvasImageSource(), {
        timestamp: sample.timestamp + cumulativeOffsetSec,
        duration: sample.duration,
      });
      await videoSource.add(rebased);
      rebased.close();
      sample.close();
    }
    cumulativeOffsetSec += clipDurationSec;
  }

  videoSource.close();
  await output.finalize();

  const buffer = output.target.buffer;
  if (!buffer) throw new Error('Concat produced no output buffer');
  return {
    blob: new Blob([buffer], { type: output.format.mimeType }),
    width,
    height,
    durationSec: cumulativeOffsetSec,
  };
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
