import { createBrowserClient } from '@supabase/ssr';

export type DbSchema = 'public' | 'studio' | 'social_auth';

export function createClient(schema?: DbSchema) {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    schema ? { db: { schema } } : undefined
  );
}
