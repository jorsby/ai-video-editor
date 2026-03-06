import {
  PutObjectCommand,
  DeleteObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import mime from 'mime/lite';

interface r2Params {
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  accountId: string;
  cdn: string;
}

interface PresignedUrlOptions {
  expiresIn?: number;
  contentType?: string;
}

export interface MultipartUploadInit {
  uploadId: string;
  key: string;
  presignedUrls: string[];
  url: string;
}

export interface CompletedPart {
  ETag: string;
  PartNumber: number;
}

export interface PresignedUpload {
  fileName: string;
  filePath: string;
  contentType: string;
  presignedUrl: string;
  url: string;
}

export class R2StorageService {
  private client: S3Client;
  private bucketName: string;
  private accountId: string;
  private cdn: string;

  constructor(params: r2Params) {
    this.bucketName = params.bucketName;
    this.accountId = params.accountId;
    this.cdn = params.cdn;
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${params.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: params.accessKeyId,
        secretAccessKey: params.secretAccessKey,
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async uploadData(
    fileName: string,
    data: Buffer | string,
    contentType: string = 'application/octet-stream',
    maxRetries: number = 3
  ): Promise<string> {
    const type = mime.getType(fileName) || contentType;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.client.send(
          new PutObjectCommand({
            Bucket: this.bucketName,
            Key: fileName,
            Body: data,
            ContentType: type,
          })
        );

        return this.getUrl(fileName);
      } catch (error) {
        console.error(
          `[R2] Upload attempt ${attempt}/${maxRetries} failed:`,
          fileName
        );
        if (attempt === maxRetries) {
          console.error(
            '[R2] Error stack:',
            error instanceof Error ? error.stack : error
          );
          throw new Error('Failed to upload to R2');
        }
        // Exponential backoff: 1s, 2s, 4s
        await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
      }
    }

    throw new Error('Failed to upload to R2');
  }

  async uploadJson(fileName: string, data: any): Promise<string> {
    const content = JSON.stringify(data);
    return this.uploadData(fileName, content, 'application/json');
  }

  async createPresignedUpload(
    filePath: string,
    options: PresignedUrlOptions = {}
  ): Promise<PresignedUpload> {
    const inferredType =
      options.contentType ||
      mime.getType(filePath) ||
      'application/octet-stream';

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: filePath,
      ContentType: inferredType,
    });

    const presignedUrl = await getSignedUrl(this.client, command, {
      expiresIn: options.expiresIn ?? 3600,
    });

    return {
      fileName: filePath.split('/').pop() || filePath,
      filePath,
      contentType: inferredType,
      presignedUrl,
      url: this.getUrl(filePath),
    };
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        })
      );
    } catch (error) {
      console.error('[R2] Failed to delete file:', key);
      console.error(
        '[R2] Error stack:',
        error instanceof Error ? error.stack : error
      );
      throw new Error('Failed to delete from R2');
    }
  }

  extractKeyFromUrl(url: string): string | null {
    const prefix = this.cdn.endsWith('/') ? this.cdn : `${this.cdn}/`;
    if (!url.startsWith(prefix)) return null;
    return url.slice(prefix.length);
  }

  async createMultipartUpload(
    filePath: string,
    partCount: number,
    options: PresignedUrlOptions = {}
  ): Promise<MultipartUploadInit> {
    const contentType =
      options.contentType ||
      mime.getType(filePath) ||
      'application/octet-stream';

    const { UploadId } = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucketName,
        Key: filePath,
        ContentType: contentType,
      })
    );

    if (!UploadId) {
      throw new Error('Failed to initiate multipart upload');
    }

    const presignedUrls = await Promise.all(
      Array.from({ length: partCount }, (_, i) => {
        const command = new UploadPartCommand({
          Bucket: this.bucketName,
          Key: filePath,
          UploadId,
          PartNumber: i + 1,
        });
        return getSignedUrl(this.client, command, {
          expiresIn: options.expiresIn ?? 3600,
        });
      })
    );

    return {
      uploadId: UploadId,
      key: filePath,
      presignedUrls,
      url: this.getUrl(filePath),
    };
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: CompletedPart[]
  ): Promise<void> {
    const sorted = [...parts].sort((a, b) => a.PartNumber - b.PartNumber);

    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucketName,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: sorted },
      })
    );
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    try {
      await this.client.send(
        new AbortMultipartUploadCommand({
          Bucket: this.bucketName,
          Key: key,
          UploadId: uploadId,
        })
      );
    } catch (error) {
      console.error('[R2] Failed to abort multipart upload:', key, error);
    }
  }

  getUrl(fileName: string): string {
    return `${this.cdn}/${fileName}`;
  }
}
