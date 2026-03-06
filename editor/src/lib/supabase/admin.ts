import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient as createServerClient, type DbSchema } from './server';

export async function createAdminClient(schema?: DbSchema) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return createServerClient(schema);
  }

  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      db: schema ? { schema } : undefined,
    }
  );
}

/**
 * Create a service-role Supabase client for use in API routes (non-async context).
 * Returns a loosely-typed client to avoid issues with ungenerated DB types.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createServiceClient(schema: DbSchema = 'studio'): any {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      db: { schema },
    }
  );
}
