import type { NextRequest } from 'next/server';

export type GenerationProvider = 'fal' | 'kie';
export type ProviderService = 'video' | 'tts' | 'image';

export type ProviderResolutionSource = 'request' | 'db' | 'env' | 'default';

export interface ProviderResolution {
  provider: GenerationProvider;
  source: ProviderResolutionSource;
}

interface ProviderRoutingInput {
  provider?: string | null;
  provider_video?: string | null;
  provider_tts?: string | null;
  provider_image?: string | null;
  video?: string | null;
  tts?: string | null;
  image?: string | null;
}

const PROVIDER_ENV_BY_SERVICE: Record<ProviderService, string> = {
  video: 'PROVIDER_VIDEO',
  tts: 'PROVIDER_TTS',
  image: 'PROVIDER_IMAGE',
};

function normalizeProvider(
  value: string | null | undefined
): GenerationProvider | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalized = trimmed.toLowerCase();
  if (normalized === 'fal' || normalized === 'kie') {
    return normalized;
  }

  // Accept JSON encoded values like "fal" from generic key-value tables.
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const unwrapped = trimmed.slice(1, -1).trim().toLowerCase();
    if (unwrapped === 'fal' || unwrapped === 'kie') {
      return unwrapped;
    }
  }

  return null;
}

function toRoutingInput(payload: unknown): ProviderRoutingInput | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  return payload as ProviderRoutingInput;
}

function extractFromRequest(
  req: NextRequest | undefined,
  service: ProviderService
): GenerationProvider | null {
  if (!req) return null;

  const direct = normalizeProvider(req.nextUrl.searchParams.get('provider'));
  if (direct) return direct;

  const serviceParam = normalizeProvider(
    req.nextUrl.searchParams.get(`provider_${service}`)
  );
  if (serviceParam) return serviceParam;

  const headerDirect = normalizeProvider(req.headers.get('x-provider'));
  if (headerDirect) return headerDirect;

  const headerScoped = normalizeProvider(
    req.headers.get(`x-provider-${service}`)
  );
  if (headerScoped) return headerScoped;

  return null;
}

function extractFromInput(
  input: ProviderRoutingInput,
  service: ProviderService
): GenerationProvider | null {
  const direct = normalizeProvider(input.provider);
  if (direct) return direct;

  const scoped = normalizeProvider(input[`provider_${service}`]);
  if (scoped) return scoped;

  const byService = normalizeProvider(input[service]);
  if (byService) return byService;

  return null;
}

function resolveFromEnv(service: ProviderService): GenerationProvider | null {
  const envName = PROVIDER_ENV_BY_SERVICE[service];
  return normalizeProvider(process.env[envName]);
}

export async function loadProviderRoutingFromDb(
  // biome-ignore lint/suspicious/noExplicitAny: Supabase client type is generated outside this repo.
  supabase?: any
): Promise<ProviderRoutingInput | null> {
  if (!supabase) return null;

  const table = process.env.PROVIDER_ROUTING_TABLE;
  if (!table) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from(table)
      .select('key, value')
      .in('key', [
        'provider',
        'provider_video',
        'provider_tts',
        'provider_image',
      ]);

    if (error || !Array.isArray(data)) return null;

    const output: ProviderRoutingInput = {};

    for (const row of data) {
      const key = typeof row?.key === 'string' ? row.key : null;
      const value =
        typeof row?.value === 'string'
          ? row.value
          : typeof row?.value === 'object' && row?.value !== null
            ? JSON.stringify(row.value)
            : null;

      if (!key) continue;
      if (
        key === 'provider' ||
        key === 'provider_video' ||
        key === 'provider_tts' ||
        key === 'provider_image'
      ) {
        output[key as keyof ProviderRoutingInput] = value;
      }
    }

    return output;
  } catch {
    return null;
  }
}

export async function resolveProvider(options: {
  service: ProviderService;
  req?: NextRequest;
  body?: unknown;
  dbConfig?: unknown;
  // biome-ignore lint/suspicious/noExplicitAny: Supabase client type is generated outside this repo.
  supabase?: any;
}): Promise<ProviderResolution> {
  const { service, req, body, dbConfig, supabase } = options;

  const requestOverride =
    extractFromRequest(req, service) ||
    extractFromInput(toRoutingInput(body) ?? {}, service);

  if (requestOverride) {
    return { provider: requestOverride, source: 'request' };
  }

  const mergedDbConfig =
    toRoutingInput(dbConfig) ?? (await loadProviderRoutingFromDb(supabase));

  const dbOverride = extractFromInput(mergedDbConfig ?? {}, service);
  if (dbOverride) {
    return { provider: dbOverride, source: 'db' };
  }

  const envOverride = resolveFromEnv(service);
  if (envOverride) {
    return { provider: envOverride, source: 'env' };
  }

  // Keep fal as default during migration rollout.
  return { provider: 'fal', source: 'default' };
}
