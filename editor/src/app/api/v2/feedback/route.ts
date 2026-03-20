import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';

const bodySchema = z.object({
  entity_type: z.enum(['object', 'background', 'scene', 'voiceover']),
  entity_id: z.string().uuid(),
  feedback: z.string().nullable(),
});

const ENTITY_TABLE: Record<
  z.infer<typeof bodySchema>['entity_type'],
  'objects' | 'backgrounds' | 'scenes' | 'voiceovers'
> = {
  object: 'objects',
  background: 'backgrounds',
  scene: 'scenes',
  voiceover: 'voiceovers',
};

function normalizeFeedback(value: string | null | undefined) {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
        { status: 400 }
      );
    }

    const db = createServiceClient('studio');
    const table = ENTITY_TABLE[parsed.data.entity_type];
    const feedback = normalizeFeedback(parsed.data.feedback);

    const { error } = await db
      .from(table)
      .update({ feedback })
      .eq('id', parsed.data.entity_id);

    if (error) {
      return NextResponse.json(
        { error: 'Failed to save feedback' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      entity_type: parsed.data.entity_type,
      entity_id: parsed.data.entity_id,
      feedback,
    });
  } catch (error) {
    console.error('[v2/feedback] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
