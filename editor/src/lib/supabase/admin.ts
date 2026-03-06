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
