import { createServiceClient } from '@/lib/supabase/admin';
import { resolveProvider } from '@/lib/provider-routing';
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

function checkFalKey(): boolean {
  const key = process.env.FAL_KEY ?? '';
  return key.includes(':');
}

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
    const { error } = await supabase.from('storyboards').select('id').limit(0);
    if (error) {
      dbError = error.message;
    } else {
      dbOk = true;
    }
  } catch (e) {
    dbError = e instanceof Error ? e.message : 'Unknown error';
  }

  const [videoRouting, ttsRouting, imageRouting] = await Promise.all([
    resolveProvider({ service: 'video' }),
    resolveProvider({ service: 'tts' }),
    resolveProvider({ service: 'image' }),
  ]);

  const falNeeded = [videoRouting, ttsRouting, imageRouting].some(
    (routing) => routing.provider === 'fal'
  );

  const kieNeeded = [videoRouting, ttsRouting, imageRouting].some(
    (routing) => routing.provider === 'kie'
  );

  const falConfigured = checkFalKey();
  const kieCheck = checkKieConfig();
  const falOk = !falNeeded || falConfigured;
  const kieOk = !kieNeeded || kieCheck.ok;

  const providerOk = falOk && kieOk;
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
          },
          fal: {
            required: falNeeded,
            configured: falConfigured,
            ok: falOk,
          },
          kie: {
            required: kieNeeded,
            configured: kieCheck.ok,
            ok: kieOk,
            missing: kieCheck.missing,
          },
        },
      },
    },
    { status: allOk ? 200 : 503 }
  );
}
