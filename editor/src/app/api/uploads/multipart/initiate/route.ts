import { randomUUID } from 'node:crypto';
import { type NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { R2StorageService } from '@/lib/r2';

const DEFAULT_CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB

interface InitiateRequest {
  fileName: string;
  fileSize: number;
  chunkSize?: number;
  userId?: string;
}

const r2 = new R2StorageService({
  bucketName: config.r2.bucket,
  accessKeyId: config.r2.accessKeyId,
  secretAccessKey: config.r2.secretAccessKey,
  accountId: config.r2.accountId,
  cdn: config.r2.cdn,
});

export async function POST(request: NextRequest) {
  try {
    const body: InitiateRequest = await request.json();
    const {
      fileName,
      fileSize,
      chunkSize = DEFAULT_CHUNK_SIZE,
      userId = 'mockuser',
    } = body;

    if (!fileName || !fileSize) {
      return NextResponse.json(
        { error: 'fileName and fileSize are required' },
        { status: 400 }
      );
    }

    const partCount = Math.ceil(fileSize / chunkSize);
    const cleanName = fileName.trim();
    const filePath = `${userId}/${randomUUID()}-${cleanName}`;

    const result = await r2.createMultipartUpload(filePath, partCount);

    return NextResponse.json({
      success: true,
      uploadId: result.uploadId,
      key: result.key,
      presignedUrls: result.presignedUrls,
      url: result.url,
      chunkSize,
      partCount,
    });
  } catch (error) {
    console.error('Error in multipart initiate route:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
