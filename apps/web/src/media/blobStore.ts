// Client-side-only binary data that never belongs in the reducer (which must stay
// JSON-serializable for localStorage) or in the graph itself. Two distinct concerns live here:
//
// 1. Result blobs, keyed by cacheKey -- the ephemeral output of Trim/Concat/Export, exposed to
//    the rest of the app only as an object URL (MediaRef.url / posterUrl).
// 2. Pending uploads, keyed by node id -- the raw File a user picked for an ImageInput node,
//    held here from selection until that node's executor actually uploads it on Run.

interface StoredBlob {
  blob: Blob;
  url: string;
}

const resultBlobs = new Map<string, StoredBlob>();
const pendingUploads = new Map<string, File>();

export function putResultBlob(cacheKey: string, blob: Blob): string {
  const existing = resultBlobs.get(cacheKey);
  if (existing) URL.revokeObjectURL(existing.url);
  const url = URL.createObjectURL(blob);
  resultBlobs.set(cacheKey, { blob, url });
  return url;
}

export function getResultBlobUrl(cacheKey: string): string | undefined {
  return resultBlobs.get(cacheKey)?.url;
}

export function setPendingUpload(nodeId: string, file: File): void {
  pendingUploads.set(nodeId, file);
}

export function getPendingUpload(nodeId: string): File | undefined {
  return pendingUploads.get(nodeId);
}

export function clearPendingUpload(nodeId: string): void {
  pendingUploads.delete(nodeId);
}
