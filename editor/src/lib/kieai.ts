import { createHmac, timingSafeEqual } from 'node:crypto';

const KIE_API_BASE = process.env.KIE_API_BASE_URL ?? 'https://api.kie.ai';
const KIE_UPLOAD_BASE =
  process.env.KIE_UPLOAD_BASE_URL ?? 'https://kieai.redpandaai.co';
const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;
const uploadFileCache = new Map<string, Promise<KieUploadResult>>();

export type KieTaskState =
  | 'waiting'
  | 'queuing'
  | 'generating'
  | 'success'
  | 'fail'
  | string;

export interface KieTaskResponse {
  code?: number;
  msg?: string;
  data?: {
    task_id?: string;
    taskId?: string;
    state?: KieTaskState;
    resultJson?: string;
    model?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface KieCreateTaskParams {
  model: string;
  input: Record<string, unknown>;
  callbackUrl?: string;
}

export interface KieCreateTaskResult {
  taskId: string;
  response: KieTaskResponse;
}

export interface KieUploadResult {
  fileUrl: string;
  response: unknown;
}

export interface KieWebhookVerificationResult {
  ok: boolean;
  taskId: string | null;
  reason?: string;
}

export interface VerifyWebhookSignatureParams {
  payload: unknown;
  signature: string | null;
  timestamp: string | null;
  hmacKey: string;
  nowSeconds: number;
  toleranceSeconds?: number;
}

function getApiKey(): string {
  const key = process.env.KIE_API_KEY?.trim();
  if (!key) {
    throw new Error('KIE_API_KEY is not configured');
  }
  return key;
}

function getWebhookHmacKey(): string {
  const key = process.env.KIE_WEBHOOK_HMAC_KEY?.trim();
  if (!key) {
    throw new Error('KIE_WEBHOOK_HMAC_KEY is not configured');
  }
  return key;
}

function buildAuthHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    'Content-Type': 'application/json',
  };
}

function extractTaskId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const data = (payload as KieTaskResponse).data;
  if (!data || typeof data !== 'object') {
    return null;
  }

  const candidates = [data.task_id, data.taskId];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return null;
}

export async function createTask(
  params: KieCreateTaskParams
): Promise<KieCreateTaskResult> {
  const body: Record<string, unknown> = {
    model: params.model,
    input: params.input,
  };

  if (params.callbackUrl) {
    body.callBackUrl = params.callbackUrl;
  }

  const response = await fetch(`${KIE_API_BASE}/api/v1/jobs/createTask`, {
    method: 'POST',
    headers: buildAuthHeaders(),
    body: JSON.stringify(body),
  });

  const data = (await response
    .json()
    .catch(() => null)) as KieTaskResponse | null;

  if (!response.ok || !data) {
    throw new Error(
      `kie.ai createTask failed (${response.status})${data?.msg ? `: ${data.msg}` : ''}`
    );
  }

  // kie.ai returns HTTP 200 with error codes in the body (e.g. code: 402 for insufficient credits)
  if (typeof data.code === 'number' && data.code !== 200 && data.code !== 0) {
    throw new Error(
      `kie.ai createTask failed (code ${data.code})${data.msg ? `: ${data.msg}` : ''}`
    );
  }

  const taskId = extractTaskId(data);
  if (!taskId) {
    throw new Error('kie.ai createTask response missing task_id');
  }

  return { taskId, response: data };
}

export async function uploadFile(
  sourceUrl: string,
  fileName: string,
  uploadPath = 'video-assets'
): Promise<KieUploadResult> {
  const normalizedSourceUrl = sourceUrl.trim();
  if (!normalizedSourceUrl) {
    throw new Error('kie.ai upload failed: sourceUrl is required');
  }

  const cached = uploadFileCache.get(normalizedSourceUrl);
  if (cached) {
    return cached;
  }

  const uploadPromise = (async (): Promise<KieUploadResult> => {
    const response = await fetch(`${KIE_UPLOAD_BASE}/api/file-url-upload`, {
      method: 'POST',
      headers: buildAuthHeaders(),
      body: JSON.stringify({
        fileUrl: normalizedSourceUrl,
        fileName,
        uploadPath,
      }),
    });

    const data = (await response.json().catch(() => null)) as {
      data?: { fileUrl?: string; downloadUrl?: string; url?: string };
      msg?: string;
    } | null;

    const fileUrl =
      data?.data?.fileUrl ?? data?.data?.downloadUrl ?? data?.data?.url ?? null;

    if (!response.ok || !fileUrl) {
      throw new Error(
        `kie.ai upload failed (${response.status})${data?.msg ? `: ${data.msg}` : ''}`
      );
    }

    return { fileUrl, response: data };
  })();

  uploadFileCache.set(normalizedSourceUrl, uploadPromise);

  try {
    return await uploadPromise;
  } catch (error) {
    uploadFileCache.delete(normalizedSourceUrl);
    throw error;
  }
}

export async function getTaskStatus(taskId: string): Promise<KieTaskResponse> {
  const url = new URL(`${KIE_API_BASE}/api/v1/jobs/recordInfo`);
  url.searchParams.set('taskId', taskId);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
    },
  });

  const data = (await response
    .json()
    .catch(() => null)) as KieTaskResponse | null;

  if (!response.ok || !data) {
    throw new Error(`kie.ai getTaskStatus failed (${response.status})`);
  }

  return data;
}

function safeEqualBase64(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return timingSafeEqual(aBuffer, bBuffer);
}

export function verifyWebhook(params: {
  payload: unknown;
  signature: string | null;
  timestamp: string | null;
  toleranceSeconds?: number;
}): KieWebhookVerificationResult {
  return verifyWebhookSignature({
    ...params,
    hmacKey: getWebhookHmacKey(),
    nowSeconds: Math.floor(Date.now() / 1000),
  });
}

export function verifyWebhookSignature(
  params: VerifyWebhookSignatureParams
): KieWebhookVerificationResult {
  const {
    payload,
    signature,
    timestamp,
    hmacKey,
    nowSeconds,
    toleranceSeconds,
  } = params;

  if (!hmacKey) {
    throw new Error('KIE_WEBHOOK_HMAC_KEY is not configured');
  }

  if (!signature || !timestamp) {
    return { ok: false, taskId: null, reason: 'missing_signature_headers' };
  }

  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || ts <= 0) {
    return { ok: false, taskId: null, reason: 'invalid_timestamp' };
  }

  const tolerance = toleranceSeconds ?? DEFAULT_WEBHOOK_TOLERANCE_SECONDS;
  if (Math.abs(nowSeconds - ts) > tolerance) {
    return { ok: false, taskId: null, reason: 'timestamp_out_of_range' };
  }

  const taskId = extractTaskId(payload);
  if (!taskId) {
    return { ok: false, taskId: null, reason: 'missing_task_id' };
  }

  const signingInput = `${taskId}.${timestamp}`;
  const expected = createHmac('sha256', hmacKey)
    .update(signingInput)
    .digest('base64');

  if (!safeEqualBase64(signature, expected)) {
    return { ok: false, taskId, reason: 'signature_mismatch' };
  }

  return { ok: true, taskId };
}

export function parseResultJson(resultJson: unknown): Record<string, unknown> {
  if (typeof resultJson === 'string') {
    try {
      const parsed = JSON.parse(resultJson);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }

  if (resultJson && typeof resultJson === 'object') {
    return resultJson as Record<string, unknown>;
  }

  return {};
}
