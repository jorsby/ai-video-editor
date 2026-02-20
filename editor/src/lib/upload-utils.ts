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
const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_CONCURRENT = 4;
const MAX_RETRIES = 3;

interface CompletedPart {
  ETag: string;
  PartNumber: number;
}

async function uploadChunkWithRetry(
  presignedUrl: string,
  chunk: Blob,
  partNumber: number
): Promise<CompletedPart> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(presignedUrl, {
        method: 'PUT',
        body: chunk,
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
      if (attempt === MAX_RETRIES - 1) throw error;
      // Exponential backoff: 1s, 2s, 4s
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }

  // Unreachable, but satisfies TypeScript
  throw new Error(`Chunk ${partNumber} failed after ${MAX_RETRIES} retries`);
}

async function uploadWithConcurrency(
  chunks: { url: string; blob: Blob; partNumber: number }[],
  maxConcurrent: number,
  onChunkComplete: () => void
): Promise<CompletedPart[]> {
  const results: CompletedPart[] = [];
  let index = 0;

  async function next(): Promise<void> {
    while (index < chunks.length) {
      const current = chunks[index++];
      const part = await uploadChunkWithRetry(
        current.url,
        current.blob,
        current.partNumber
      );
      results.push(part);
      onChunkComplete();
    }
  }

  const workers = Array.from(
    { length: Math.min(maxConcurrent, chunks.length) },
    () => next()
  );
  await Promise.all(workers);

  return results;
}

export async function uploadFileMultipart(
  file: File,
  onProgress?: (progress: number) => void
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
  });

  if (!initRes.ok) {
    throw new Error('Failed to initiate multipart upload');
  }

  const { uploadId, key, presignedUrls, url, partCount } =
    await initRes.json();

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

  try {
    parts = await uploadWithConcurrency(chunks, MAX_CONCURRENT, () => {
      completedCount++;
      onProgress?.(completedCount / partCount);
    });
  } catch (error) {
    // Fire-and-forget abort
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
  onProgress?: (progress: number) => void
): Promise<UploadResult> {
  if (file.size <= MULTIPART_THRESHOLD) {
    return uploadFile(file);
  }
  return uploadFileMultipart(file, onProgress);
}
