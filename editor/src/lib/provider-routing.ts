import type { NextRequest } from 'next/server';

export type GenerationProvider = 'kie';
export type ProviderService = 'video' | 'tts' | 'image';

export type ProviderResolutionSource = 'request' | 'db' | 'env' | 'default';
export type ProviderErrorSource = Exclude<ProviderResolutionSource, 'default'>;

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

const SUPPORTED_PROVIDER = 'kie' as const;

export class ProviderRoutingError extends Error {
  readonly code = 'UNSUPPORTED_PROVIDER';
  readonly statusCode = 400;

  constructor(
    readonly source: ProviderErrorSource,
    readonly service: ProviderService,
    readonly field: string,
    readonly value: string
  ) {
    super(
      `Unsupported provider "${value}" from ${source} "${field}" for ${service}. Only "${SUPPORTED_PROVIDER}" is allowed.`
    );
    this.name = 'ProviderRoutingError';
  }
}

export function isProviderRoutingError(
  error: unknown
): error is ProviderRoutingError {
  return error instanceof ProviderRoutingError;
}

type ProviderValueParseResult =
  | { kind: 'unset' }
  | { kind: 'valid'; provider: 'kie' }
  | { kind: 'invalid'; value: string };

function parseProviderValue(rawValue: unknown): ProviderValueParseResult {
  if (rawValue === null || rawValue === undefined) return { kind: 'unset' };

  if (typeof rawValue !== 'string') {
    return { kind: 'invalid', value: String(rawValue) };
  }

  if (!rawValue) return { kind: 'unset' };

  const trimmed = rawValue.trim();
  if (!trimmed) return { kind: 'unset' };

  let normalized = trimmed.toLowerCase();

  // Accept JSON/string encoded values from generic key-value tables.
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    normalized = trimmed.slice(1, -1).trim().toLowerCase();
  }

  if (normalized === SUPPORTED_PROVIDER) {
    return { kind: 'valid', provider: SUPPORTED_PROVIDER };
  }

  return { kind: 'invalid', value: normalized || trimmed };
}

function toRoutingInput(payload: unknown): ProviderRoutingInput | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  return payload as ProviderRoutingInput;
}

function resolveFromCandidates(options: {
  source: ProviderErrorSource;
  service: ProviderService;
  candidates: Array<{ field: string; value: string | null | undefined }>;
}): 'kie' | null {
  for (const candidate of options.candidates) {
    const parsed = parseProviderValue(candidate.value);

    if (parsed.kind === 'unset') {
      continue;
    }

    if (parsed.kind === 'valid') {
      return parsed.provider;
    }

    throw new ProviderRoutingError(
      options.source,
      options.service,
      candidate.field,
      parsed.value
    );
  }

  return null;
}

function resolveFromRequest(
  req: NextRequest | undefined,
  service: ProviderService
): 'kie' | null {
  if (!req) return null;

  return resolveFromCandidates({
    source: 'request',
    service,
    candidates: [
      { field: 'provider', value: req.nextUrl.searchParams.get('provider') },
      {
        field: `provider_${service}`,
        value: req.nextUrl.searchParams.get(`provider_${service}`),
      },
      { field: 'x-provider', value: req.headers.get('x-provider') },
      {
        field: `x-provider-${service}`,
        value: req.headers.get(`x-provider-${service}`),
      },
    ],
  });
}

function resolveFromInput(
  input: ProviderRoutingInput,
  service: ProviderService,
  source: ProviderErrorSource
): 'kie' | null {
  return resolveFromCandidates({
    source,
    service,
    candidates: [
      { field: 'provider', value: input.provider },
      { field: `provider_${service}`, value: input[`provider_${service}`] },
      { field: service, value: input[service] },
    ],
  });
}

function resolveFromEnv(service: ProviderService): 'kie' | null {
  const envName = PROVIDER_ENV_BY_SERVICE[service];

  return resolveFromCandidates({
    source: 'env',
    service,
    candidates: [{ field: envName, value: process.env[envName] }],
  });
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

  const requestOverride = resolveFromRequest(req, service);
  if (requestOverride) {
    return { provider: requestOverride, source: 'request' };
  }

  const bodyOverride = resolveFromInput(
    toRoutingInput(body) ?? {},
    service,
    'request'
  );
  if (bodyOverride) {
    return { provider: bodyOverride, source: 'request' };
  }

  const mergedDbConfig =
    toRoutingInput(dbConfig) ?? (await loadProviderRoutingFromDb(supabase));

  const dbOverride = resolveFromInput(mergedDbConfig ?? {}, service, 'db');
  if (dbOverride) {
    return { provider: dbOverride, source: 'db' };
  }

  const envOverride = resolveFromEnv(service);
  if (envOverride) {
    return { provider: envOverride, source: 'env' };
  }

  // Provider policy: hard-locked to KIE.
  return { provider: SUPPORTED_PROVIDER, source: 'default' };
}
