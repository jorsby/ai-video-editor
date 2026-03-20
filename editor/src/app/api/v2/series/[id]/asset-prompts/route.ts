import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';

type RouteContext = { params: Promise<{ id: string }> };

const assetPromptSchema = z.object({
  id: z.string().uuid(),
  generation_prompt: z.string().nullable(),
  generation_meta: z.record(z.string(), z.unknown()).optional(),
  feedback: z.string().nullable().optional(),
});

const bodySchema = z.object({
  objects: z.array(assetPromptSchema).optional(),
  backgrounds: z.array(assetPromptSchema).optional(),
});

function normalizePrompt(value: string | null | undefined) {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const { id: seriesId } = await context.params;

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

    const { data: series, error: seriesError } = await db
      .from('series')
      .select('id, project_id, user_id')
      .eq('id', seriesId)
      .single();

    if (seriesError || !series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    if (series.user_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { data: storyboards } = await db
      .from('storyboards')
      .select('id')
      .eq('project_id', series.project_id);

    const storyboardIds = (storyboards ?? []).map((s: { id: string }) => s.id);
    if (storyboardIds.length === 0) {
      return NextResponse.json({
        success: true,
        updated_objects: 0,
        updated_backgrounds: 0,
      });
    }

    const { data: scenes } = await db
      .from('scenes')
      .select('id')
      .in('storyboard_id', storyboardIds);

    const sceneIds = (scenes ?? []).map((s: { id: string }) => s.id);
    if (sceneIds.length === 0) {
      return NextResponse.json({
        success: true,
        updated_objects: 0,
        updated_backgrounds: 0,
      });
    }

    let updatedObjects = 0;
    let updatedBackgrounds = 0;

    for (const patch of parsed.data.objects ?? []) {
      const updates: Record<string, unknown> = {
        generation_prompt: normalizePrompt(patch.generation_prompt),
      };

      if (patch.generation_meta !== undefined) {
        updates.generation_meta = patch.generation_meta;
      }
      if (patch.feedback !== undefined) {
        updates.feedback = normalizePrompt(patch.feedback);
      }

      const { error } = await db
        .from('objects')
        .update(updates)
        .eq('id', patch.id)
        .in('scene_id', sceneIds);

      if (error) {
        return NextResponse.json(
          { error: `Failed to update object prompt ${patch.id}` },
          { status: 500 }
        );
      }

      updatedObjects++;
    }

    for (const patch of parsed.data.backgrounds ?? []) {
      const updates: Record<string, unknown> = {
        generation_prompt: normalizePrompt(patch.generation_prompt),
      };

      if (patch.generation_meta !== undefined) {
        updates.generation_meta = patch.generation_meta;
      }
      if (patch.feedback !== undefined) {
        updates.feedback = normalizePrompt(patch.feedback);
      }

      const { error } = await db
        .from('backgrounds')
        .update(updates)
        .eq('id', patch.id)
        .in('scene_id', sceneIds);

      if (error) {
        return NextResponse.json(
          { error: `Failed to update background prompt ${patch.id}` },
          { status: 500 }
        );
      }

      updatedBackgrounds++;
    }

    return NextResponse.json({
      success: true,
      series_id: seriesId,
      updated_objects: updatedObjects,
      updated_backgrounds: updatedBackgrounds,
    });
  } catch (error) {
    console.error('[v2/series/asset-prompts] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
