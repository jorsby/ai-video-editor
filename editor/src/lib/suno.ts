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
