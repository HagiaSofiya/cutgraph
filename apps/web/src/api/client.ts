import { CreateJobResponseSchema, JobStatusResponseSchema } from '@cutgraph/shared';
import type { CreateJobResponse, JobStatusResponse, MediaInputRef } from '@cutgraph/shared';

export const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8787';

async function readErrorMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => undefined);
  return body?.error?.message ?? `request failed with status ${res.status}`;
}

export async function createJob(request: {
  nodeType: 'textToImage' | 'imageToVideo';
  params: Record<string, unknown>;
  inputs: MediaInputRef[];
  cacheKey: string;
}): Promise<CreateJobResponse> {
  const res = await fetch(`${API_BASE}/api/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res));
  return CreateJobResponseSchema.parse(await res.json());
}

export async function getJobStatus(jobId: string): Promise<JobStatusResponse | undefined> {
  const res = await fetch(`${API_BASE}/api/jobs/${jobId}`);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(await readErrorMessage(res));
  return JobStatusResponseSchema.parse(await res.json());
}

export interface UploadedFile {
  url: string;
  sha256: string;
  kind: 'image' | 'video';
}

export async function uploadFile(file: File): Promise<UploadedFile> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE}/api/uploads`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(await readErrorMessage(res));
  return res.json();
}
