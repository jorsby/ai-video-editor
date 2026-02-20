import { type NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { R2StorageService } from '@/lib/r2';

interface AbortRequest {
  key: string;
  uploadId: string;
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
    const body: AbortRequest = await request.json();
    const { key, uploadId } = body;

    if (!key || !uploadId) {
      return NextResponse.json(
        { error: 'key and uploadId are required' },
        { status: 400 }
      );
    }

    await r2.abortMultipartUpload(key, uploadId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in multipart abort route:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
