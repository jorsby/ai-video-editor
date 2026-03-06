import { createServiceClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';

const REQUIRED_ENV_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'FAL_KEY',
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

  const falKey = process.env.FAL_KEY ?? '';
  const falOk = falKey.includes(':');

  const allOk = envOk && dbOk && falOk;
  const status = allOk
    ? 'healthy'
    : envOk && (dbOk || falOk)
      ? 'degraded'
      : 'unhealthy';

  return NextResponse.json(
    {
      status,
      checks: {
        env: { ok: envOk, missing },
        db: { ok: dbOk, error: dbError },
        fal: { ok: falOk },
      },
    },
    { status: allOk ? 200 : 503 }
  );
}
