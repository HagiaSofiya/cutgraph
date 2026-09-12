import { CreateJobResponseSchema, FailureCodeEnum, JobStatusResponseSchema } from '@cutgraph/shared';
import type { CreateJobResponse, FailureCode, JobStatusResponse, MediaInputRef } from '@cutgraph/shared';

// Carries the server's FailureCode alongside the message so a rejected request (the spend
// guard's 429, say) reaches the canvas with the same taxonomy an SSE job.failed event has.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: FailureCode,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8787';

async function readError(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => undefined);
  const code = FailureCodeEnum.safeParse(body?.error?.code);
  return new ApiError(
    body?.error?.message ?? `request failed with status ${res.status}`,
    code.success ? code.data : undefined,
  );
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
  if (!res.ok) throw await readError(res);
  return CreateJobResponseSchema.parse(await res.json());
}

export async function getJobStatus(jobId: string): Promise<JobStatusResponse | undefined> {
  const res = await fetch(`${API_BASE}/api/jobs/${jobId}`);
  if (res.status === 404) return undefined;
  if (!res.ok) throw await readError(res);
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
  if (!res.ok) throw await readError(res);
  return res.json();
}
