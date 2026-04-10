export interface UploadResult {
  fileName: string;
  filePath: string;
  contentType: string;
  presignedUrl: string;
  url: string;
}

export const uploadFile = async (file: File): Promise<UploadResult> => {
  // 1. Get presigned URL
  const response = await fetch('/api/uploads/presign', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fileNames: [file.name],
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to get presigned URL');
  }

  const { uploads } = await response.json();
  const uploadConfig = uploads[0];

  // 2. Upload to R2
  const uploadResponse = await fetch(uploadConfig.presignedUrl, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': file.type,
    },
  });

  if (!uploadResponse.ok) {
    throw new Error('Failed to upload file to storage');
  }

  return uploadConfig;
};

// --- Multipart upload ---

const MULTIPART_THRESHOLD = 5 * 1024 * 1024; // 5 MB
const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_CONCURRENT = 2;
const MAX_RETRIES = 5;
const BASE_RETRY_DELAY_MS = 2000;

interface CompletedPart {
  ETag: string;
  PartNumber: number;
}

async function uploadChunkWithRetry(
  presignedUrl: string,
  chunk: Blob,
  partNumber: number,
  signal: AbortSignal
): Promise<CompletedPart> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (signal.aborted) {
      throw new DOMException('Upload cancelled', 'AbortError');
    }

    try {
      const res = await fetch(presignedUrl, {
        method: 'PUT',
        body: chunk,
        signal,
      });

      if (!res.ok) {
        throw new Error(`Chunk ${partNumber} upload failed: ${res.status}`);
      }

      const etag = res.headers.get('ETag');
      if (!etag) {
        throw new Error(
          `Chunk ${partNumber} response missing ETag header — check R2 CORS ExposeHeaders config`
        );
      }

      return { ETag: etag, PartNumber: partNumber };
    } catch (error) {
      if (signal.aborted) {
        throw new DOMException('Upload cancelled', 'AbortError');
      }
      if (attempt === MAX_RETRIES - 1) throw error;
      // Exponential backoff: 2s, 4s, 8s, 16s, 32s
      await new Promise((r) =>
        setTimeout(r, BASE_RETRY_DELAY_MS * 2 ** attempt)
      );
    }
  }

  // Unreachable, but satisfies TypeScript
  throw new Error(`Chunk ${partNumber} failed after ${MAX_RETRIES} retries`);
}

async function uploadWithConcurrency(
  chunks: { url: string; blob: Blob; partNumber: number }[],
  maxConcurrent: number,
  onChunkComplete: () => void,
  signal: AbortSignal
): Promise<CompletedPart[]> {
  const results: CompletedPart[] = [];
  let index = 0;
  let firstError: Error | null = null;

  // Child controller: when any worker fails, abort all others
  const childController = new AbortController();
  const childSignal = childController.signal;

  // Propagate parent abort to child
  const onParentAbort = () => childController.abort();
  signal.addEventListener('abort', onParentAbort, { once: true });

  async function worker(): Promise<void> {
    while (index < chunks.length) {
      if (childSignal.aborted) return;

      const current = chunks[index++];
      try {
        const part = await uploadChunkWithRetry(
          current.url,
          current.blob,
          current.partNumber,
          childSignal
        );
        results.push(part);
        onChunkComplete();
      } catch (error) {
        if (!firstError) {
          firstError = error as Error;
        }
        childController.abort();
        return;
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(maxConcurrent, chunks.length) },
    () => worker()
  );

  // allSettled waits for ALL workers to finish — no background workers left running
  await Promise.allSettled(workers);

  signal.removeEventListener('abort', onParentAbort);

  if (firstError) {
    throw firstError;
  }

  return results;
}

export async function uploadFileMultipart(
  file: File,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal
): Promise<UploadResult> {
  // 1. Initiate multipart upload
  const initRes = await fetch('/api/uploads/multipart/initiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      fileSize: file.size,
      chunkSize: CHUNK_SIZE,
    }),
    ...(signal ? { signal } : {}),
  });

  if (!initRes.ok) {
    const errBody = await initRes.json().catch(() => ({}));
    throw new Error(
      `Failed to initiate multipart upload: ${errBody?.details || errBody?.error || initRes.status}`
    );
  }

  const { uploadId, key, presignedUrls, url, partCount } = await initRes.json();

  // 2. Slice file into chunks
  const chunks = Array.from({ length: partCount }, (_, i) => {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    return {
      url: presignedUrls[i],
      blob: file.slice(start, end),
      partNumber: i + 1,
    };
  });

  // 3. Upload all chunks
  let completedCount = 0;
  let parts: CompletedPart[];

  const uploadController = new AbortController();
  const uploadSignal = signal ?? uploadController.signal;

  try {
    parts = await uploadWithConcurrency(
      chunks,
      MAX_CONCURRENT,
      () => {
        completedCount++;
        onProgress?.(completedCount / partCount);
      },
      uploadSignal
    );
  } catch (error) {
    uploadController.abort();

    // Safe to abort on R2 — all workers have terminated (Promise.allSettled)
    fetch('/api/uploads/multipart/abort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, uploadId }),
    }).catch(() => {});
    throw error;
  }

  // 4. Complete multipart upload
  const completeRes = await fetch('/api/uploads/multipart/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, uploadId, parts }),
    ...(signal ? { signal } : {}),
  });

  if (!completeRes.ok) {
    throw new Error('Failed to complete multipart upload');
  }

  return {
    fileName: file.name,
    filePath: key,
    contentType: file.type || 'application/octet-stream',
    presignedUrl: '',
    url,
  };
}

export async function smartUpload(
  file: File,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal
): Promise<UploadResult> {
  if (file.size <= MULTIPART_THRESHOLD) {
    return uploadFile(file);
  }
  return uploadFileMultipart(file, onProgress, signal);
}
