import {
  isProviderRoutingError,
  resolveProvider,
  type ProviderResolution,
} from '@/lib/provider-routing';
import { createServiceClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';

const REQUIRED_ENV_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_APP_URL',
  'OPENROUTER_API_KEY',
  'DEEPGRAM_API_KEY',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_ACCOUNT_ID',
  'R2_BUCKET_NAME',
  'R2_PUBLIC_DOMAIN',
  'SKYREELS_API_KEY',
] as const;

function checkKieConfig(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];

  if (!process.env.KIE_API_KEY) {
    missing.push('KIE_API_KEY');
  }

  if (!process.env.KIE_WEBHOOK_HMAC_KEY) {
    missing.push('KIE_WEBHOOK_HMAC_KEY');
  }

  return { ok: missing.length === 0, missing };
}

export async function GET() {
  const missing: string[] = [];
  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }
  const envOk = missing.length === 0;

  let dbOk = false;
  let dbError: string | undefined;
  try {
    const supabase = createServiceClient('studio');
    const { error } = await supabase.from('projects').select('id').limit(0);
    if (error) {
      dbError = error.message;
    } else {
      dbOk = true;
    }
  } catch (e) {
    dbError = e instanceof Error ? e.message : 'Unknown error';
  }

  let videoRouting: ProviderResolution = {
    provider: 'kie',
    source: 'default',
  };
  let ttsRouting: ProviderResolution = {
    provider: 'kie',
    source: 'default',
  };
  let imageRouting: ProviderResolution = {
    provider: 'kie',
    source: 'default',
  };
  let routingError:
    | {
        code: string;
        message: string;
        source: string;
        field: string;
        service: string;
        value: string;
      }
    | undefined;

  try {
    [videoRouting, ttsRouting, imageRouting] = await Promise.all([
      resolveProvider({ service: 'video' }),
      resolveProvider({ service: 'tts' }),
      resolveProvider({ service: 'image' }),
    ]);
  } catch (error) {
    if (isProviderRoutingError(error)) {
      routingError = {
        code: error.code,
        message: error.message,
        source: error.source,
        field: error.field,
        service: error.service,
        value: error.value,
      };
    } else {
      routingError = {
        code: 'PROVIDER_ROUTING_ERROR',
        message: error instanceof Error ? error.message : String(error),
        source: 'unknown',
        field: 'unknown',
        service: 'unknown',
        value: 'unknown',
      };
    }
  }

  const kieCheck = checkKieConfig();
  const providerOk = !routingError && kieCheck.ok;
  const allOk = envOk && dbOk && providerOk;

  const status = allOk
    ? 'healthy'
    : envOk && (dbOk || providerOk)
      ? 'degraded'
      : 'unhealthy';

  return NextResponse.json(
    {
      status,
      checks: {
        env: { ok: envOk, missing },
        db: { ok: dbOk, error: dbError },
        providers: {
          routing: {
            video: videoRouting,
            tts: ttsRouting,
            image: imageRouting,
            error: routingError,
          },
          kie: {
            required: true,
            configured: kieCheck.ok,
            ok: kieCheck.ok,
            missing: kieCheck.missing,
          },
        },
      },
    },
    { status: allOk ? 200 : 503 }
  );
}
