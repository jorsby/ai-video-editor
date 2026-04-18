const KIE_API_BASE = process.env.KIE_API_BASE_URL ?? 'https://api.kie.ai';

interface GenerateMusicResponseBody {
  code?: number;
  msg?: string;
  data?: {
    taskId?: string;
    task_id?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface GenerateMusicParams {
  prompt?: string;
  style: string;
  title: string;
  instrumental: boolean;
  callbackUrl: string;
}

export interface GenerateMusicResult {
  taskId: string;
  response: GenerateMusicResponseBody;
}

function getApiKey(): string {
  const key = process.env.KIE_API_KEY?.trim();
  if (!key) {
    throw new Error('KIE_API_KEY is not configured');
  }
  return key;
}

export async function generateMusic(
  params: GenerateMusicParams
): Promise<GenerateMusicResult> {
  const response = await fetch(`${KIE_API_BASE}/api/v1/generate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: params.prompt ?? '',
      style: params.style,
      title: params.title,
      customMode: true,
      instrumental: params.instrumental,
      model: 'V4_5PLUS',
      callBackUrl: params.callbackUrl,
    }),
  });

  const body = (await response
    .json()
    .catch(() => null)) as GenerateMusicResponseBody | null;

  if (!response.ok || !body) {
    throw new Error(
      `kie.ai generate music failed (${response.status})${body?.msg ? `: ${body.msg}` : ''}`
    );
  }

  if (typeof body.code === 'number' && body.code !== 200 && body.code !== 0) {
    throw new Error(
      `kie.ai generate music failed (code ${body.code})${body.msg ? `: ${body.msg}` : ''}`
    );
  }

  const taskId = body.data?.taskId ?? body.data?.task_id;
  if (typeof taskId !== 'string' || taskId.trim().length === 0) {
    throw new Error('kie.ai generate music response missing taskId');
  }

  return {
    taskId: taskId.trim(),
    response: body,
  };
}

export interface SunoRecordInfoTrack {
  id?: unknown;
  title?: unknown;
  audio_url?: unknown;
  image_url?: unknown;
  duration?: unknown;
  tags?: unknown;
  [key: string]: unknown;
}

export interface SunoRecordInfoResponse {
  code?: number;
  msg?: string;
  data?: {
    taskId?: string;
    status?: string;
    type?: string;
    errorCode?: unknown;
    errorMessage?: unknown;
    response?: {
      taskId?: string;
      sunoData?: unknown;
    } | null;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export async function getSunoRecordInfo(
  taskId: string
): Promise<SunoRecordInfoResponse> {
  const url = new URL(`${KIE_API_BASE}/api/v1/generate/record-info`);
  url.searchParams.set('taskId', taskId);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
    },
  });

  const body = (await response
    .json()
    .catch(() => null)) as SunoRecordInfoResponse | null;

  if (!body) {
    throw new Error(
      `kie.ai music record-info failed (${response.status}): invalid response`
    );
  }

  return body;
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function coerceString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function extractSunoTracksFromRecordInfo(
  info: SunoRecordInfoResponse
): SunoRecordInfoTrack[] {
  const data = info.data ?? null;
  if (!data) return [];

  const sources: unknown[] = [];
  const response = (data as Record<string, unknown>).response as
    | Record<string, unknown>
    | undefined
    | null;
  if (response && Array.isArray(response.sunoData)) {
    sources.push(...(response.sunoData as unknown[]));
  }
  const nestedData = (data as Record<string, unknown>).data;
  if (Array.isArray(nestedData)) {
    sources.push(...(nestedData as unknown[]));
  }

  const normalized: SunoRecordInfoTrack[] = [];
  for (const raw of sources) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    normalized.push({
      id: r.id,
      title: r.title,
      audio_url:
        coerceString(r.audio_url) ??
        coerceString(r.audioUrl) ??
        coerceString(r.audio_stream_url) ??
        coerceString(r.audioStreamUrl) ??
        coerceString(r.source_audio_url) ??
        coerceString(r.sourceAudioUrl),
      image_url:
        coerceString(r.image_url) ??
        coerceString(r.imageUrl) ??
        coerceString(r.source_image_url) ??
        coerceString(r.sourceImageUrl),
      duration: coerceNumber(r.duration),
      tags: r.tags,
    });
  }
  return normalized;
}

export function classifyRecordInfoStatus(
  info: SunoRecordInfoResponse
): 'done' | 'pending' | 'dead' {
  const tracks = extractSunoTracksFromRecordInfo(info);
  const hasAudio = tracks.some((t) => typeof t.audio_url === 'string');
  if (hasAudio) return 'done';

  const status =
    typeof info.data?.status === 'string' ? info.data.status.toUpperCase() : '';
  const msg = typeof info.msg === 'string' ? info.msg : '';

  if (
    /FAIL|ERROR|EXCEPTION|SENSITIVE|TIMEOUT/.test(status) ||
    info.code === 422 ||
    /record.?info is null/i.test(msg)
  ) {
    return 'dead';
  }

  return 'pending';
}
