import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';

type RouteContext = {
  params: Promise<{ entityType: string; entityId: string }>;
};

const paramsSchema = z.object({
  entityType: z.enum(['object', 'background', 'scene', 'voiceover']),
  entityId: z.string().uuid(),
});

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { entityType, entityId } = paramsSchema.parse(await context.params);

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = createServiceClient('studio');

    const { data: logs, error } = await db
      .from('generation_logs')
      .select('*')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('version', { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: 'Failed to load generation logs' },
        { status: 500 }
      );
    }

    return NextResponse.json({ logs });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? 'Invalid parameters' },
        { status: 400 }
      );
    }

    console.error('[v2/generation-logs] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
