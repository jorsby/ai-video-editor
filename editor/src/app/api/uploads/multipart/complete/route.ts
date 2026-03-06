import { type NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { R2StorageService, type CompletedPart } from '@/lib/r2';

interface CompleteRequest {
  key: string;
  uploadId: string;
  parts: CompletedPart[];
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
    const body: CompleteRequest = await request.json();
    const { key, uploadId, parts } = body;

    if (!key || !uploadId || !parts || !Array.isArray(parts)) {
      return NextResponse.json(
        { error: 'key, uploadId, and parts array are required' },
        { status: 400 }
      );
    }

    await r2.completeMultipartUpload(key, uploadId, parts);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in multipart complete route:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
