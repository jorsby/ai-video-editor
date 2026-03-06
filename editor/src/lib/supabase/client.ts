import { createBrowserClient } from '@supabase/ssr';

export type DbSchema = 'public' | 'studio' | 'social_auth';

export function createClient(schema?: DbSchema) {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      ...(schema ? { db: { schema } } : undefined),
      // createBrowserClient uses a singleton by default. When a non-default
      // schema is requested we must opt out, otherwise the first call (usually
      // without schema) wins and all subsequent schema-specific calls silently
      // use the public schema — causing 406 from PostgREST.
      ...(schema && schema !== 'public' ? { isSingleton: false } : undefined),
    }
  );
}
