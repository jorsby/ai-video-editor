import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import {
  compileScenePromptContract,
  mergeScenePromptContractGenerationMeta,
} from '@/lib/storyboard/prompt-compiler';
import {
  promptJSONSchema,
  validatedRuntimeSchema,
} from '@/lib/storyboard/scene-contracts';
import { createServiceClient } from '@/lib/supabase/admin';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, content-type, x-client-info, apikey',
};

const createSceneBodySchema = z.object({
  sort_order: z.number().int().min(1),
  audio_text: z.string().optional(),
  visual_direction: z.string().optional(),
  prompt: z.string().optional(),
  duration: z.literal(6).or(z.literal(10)).optional(),
  background_name: z.string().min(1).optional(),
  object_names: z.array(z.string()).max(4).optional(),
  language: z.string().min(2).max(5).optional(),
  prompt_json: promptJSONSchema.optional(),
  validated_runtime: validatedRuntimeSchema.optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

function jsonResponse(payload: Record<string, unknown>, status: number) {
  return NextResponse.json(payload, { status, headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

/**
 * POST /api/v2/storyboard/[id]/scenes — Create a new scene
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const { id: storyboardId } = await context.params;
    const body = await req.json().catch(() => null);
    const parsed = createSceneBodySchema.safeParse(body);

    if (!parsed.success) {
      return jsonResponse(
        { error: 'Validation failed', details: parsed.error.flatten() },
        400
      );
    }

    const supabase = createServiceClient();

    const { data: storyboard, error: storyboardErr } = await supabase
      .schema('studio')
      .from('storyboards')
      .select('id, plan_status, input_type, plan')
      .eq('id', storyboardId)
      .single();

    if (storyboardErr || !storyboard) {
      return jsonResponse({ error: 'Storyboard not found' }, 404);
    }

    if (storyboard.plan_status === 'approved') {
      return jsonResponse(
        { error: 'Cannot add scenes to an approved storyboard' },
        400
      );
    }

    const storyboardPlan =
      storyboard.plan && typeof storyboard.plan === 'object'
        ? (storyboard.plan as Record<string, unknown>)
        : {};
    const planVideoMode =
      typeof storyboardPlan.video_mode === 'string'
        ? storyboardPlan.video_mode
        : null;
    const isNarrativeMode =
      storyboard.input_type === 'voiceover_script' ||
      planVideoMode === 'narrative';

    const data = parsed.data;
    const hasPromptContractPatch =
      data.prompt_json !== undefined || data.validated_runtime !== undefined;

    if (data.prompt_json && data.prompt_json.scene_order !== data.sort_order) {
      return jsonResponse(
        {
          error:
            'prompt_json.scene_order must match sort_order for scene creation',
        },
        400
      );
    }

    const compiledPromptContract = data.prompt_json
      ? compileScenePromptContract({
          prompt_json: data.prompt_json,
          validated_runtime: data.validated_runtime,
        })
      : null;

    const promptContractGenerationMeta = hasPromptContractPatch
      ? mergeScenePromptContractGenerationMeta({
          prompt_json: compiledPromptContract?.prompt_json ?? data.prompt_json,
          validated_runtime:
            compiledPromptContract?.validated_runtime ?? data.validated_runtime,
          scene_payload: compiledPromptContract?.scene_payload,
        })
      : null;

    // Episode asset map guard (if map exists):
    // background/object slugs used in scenes must belong to episode_assets.
    const { data: linkedEpisode } = await supabase
      .schema('studio')
      .from('series_episodes')
      .select('id, series_id')
      .eq('storyboard_id', storyboardId)
      .maybeSingle();

    if (linkedEpisode) {
      const requestedSlugs = [
        ...(data.background_name ? [data.background_name] : []),
        ...(data.object_names ?? []),
      ];

      if (requestedSlugs.length > 0) {
        const { data: episodeAssetRows, error: episodeAssetErr } =
          await supabase
            .schema('studio')
            .from('episode_assets')
            .select('asset_id')
            .eq('episode_id', linkedEpisode.id);

        if (episodeAssetErr) {
          console.error(
            '[scenes/create] Episode asset map check failed:',
            episodeAssetErr
          );
          return jsonResponse(
            { error: 'Failed to validate episode asset map' },
            500
          );
        }

        const mappedAssetIds = new Set(
          (episodeAssetRows ?? []).map(
            (row: { asset_id: string }) => row.asset_id
          )
        );

        // Enforce only when mapping exists. If no mapping rows yet, keep backward compatibility.
        if (mappedAssetIds.size > 0) {
          const uniqueRequestedSlugs = [...new Set(requestedSlugs)];

          const { data: resolvedAssets, error: resolveErr } = await supabase
            .schema('studio')
            .from('series_assets')
            .select('id, slug')
            .eq('series_id', linkedEpisode.series_id)
            .in('slug', uniqueRequestedSlugs);

          if (resolveErr) {
            console.error(
              '[scenes/create] Asset slug resolution failed:',
              resolveErr
            );
            return jsonResponse(
              { error: 'Failed to validate scene assets' },
              500
            );
          }

          const foundSlugs = new Set(
            (resolvedAssets ?? []).map((row: { slug: string }) => row.slug)
          );
          const unknownSlugs = uniqueRequestedSlugs.filter(
            (slug) => !foundSlugs.has(slug)
          );

          if (unknownSlugs.length > 0) {
            return jsonResponse(
              {
                error: 'Scene references unknown asset slugs',
                unknown_asset_slugs: unknownSlugs,
              },
              400
            );
          }

          const unmappedSlugs = (resolvedAssets ?? [])
            .filter((row: { id: string }) => !mappedAssetIds.has(row.id))
            .map((row: { slug: string }) => row.slug);

          if (unmappedSlugs.length > 0) {
            return jsonResponse(
              {
                error:
                  'Scene uses assets not mapped to this episode. Update episode asset map first.',
                unmapped_asset_slugs: unmappedSlugs,
              },
              400
            );
          }
        }
      }
    }

    const insert: Record<string, unknown> = {
      storyboard_id: storyboardId,
      order: data.sort_order,
    };

    if (data.audio_text !== undefined) insert.audio_text = data.audio_text;
    if (data.visual_direction !== undefined)
      insert.visual_direction = data.visual_direction;
    if (data.prompt !== undefined) {
      insert.prompt = data.prompt;
    } else if (compiledPromptContract) {
      insert.prompt =
        compiledPromptContract.scene_payload.compile_status === 'ready'
          ? compiledPromptContract.scene_payload.prompt
          : null;
    }
    if (data.duration !== undefined) insert.duration = data.duration;
    if (data.background_name !== undefined)
      insert.background_name = data.background_name;
    if (data.object_names !== undefined)
      insert.object_names = data.object_names;
    if (data.language !== undefined) insert.language = data.language;
    if (promptContractGenerationMeta) {
      // TODO(db): promote prompt contract fields to first-class scene columns
      // once migration is in place. For now we persist under generation_meta.
      insert.generation_meta = promptContractGenerationMeta;
    }

    const { data: scene, error: insertErr } = await supabase
      .schema('studio')
      .from('scenes')
      .insert(insert)
      .select('id, storyboard_id, order')
      .single();

    if (insertErr || !scene) {
      console.error('[scenes/create] Insert failed:', insertErr);
      return jsonResponse({ error: 'Failed to create scene' }, 500);
    }

    const audioText = data.audio_text?.trim();
    if (audioText && isNarrativeMode) {
      const voiceoverLanguage = data.language ?? 'tr';
      const { error: voiceoverErr } = await supabase
        .schema('studio')
        .from('voiceovers')
        .insert({
          scene_id: scene.id,
          text: audioText,
          language: voiceoverLanguage,
          // Narrative scenes must pass through TTS webhook before success.
          status: 'pending',
        });

      if (voiceoverErr) {
        console.error('[scenes/create] Voiceover insert failed:', voiceoverErr);
        // Best effort rollback for consistency
        await supabase
          .schema('studio')
          .from('scenes')
          .delete()
          .eq('id', scene.id);
        return jsonResponse({ error: 'Failed to create scene voiceover' }, 500);
      }
    }

    if (storyboard.plan_status === 'empty') {
      await supabase
        .schema('studio')
        .from('storyboards')
        .update({ plan_status: 'draft' })
        .eq('id', storyboardId)
        .eq('plan_status', 'empty');
    }

    const responsePayload: Record<string, unknown> = {
      scene_id: scene.id,
      storyboard_id: scene.storyboard_id,
      sort_order: scene.order,
      status: 'created',
    };

    if (compiledPromptContract) {
      responsePayload.compiled_prompt =
        compiledPromptContract.scene_payload.prompt;
      responsePayload.compile_status =
        compiledPromptContract.scene_payload.compile_status;
      responsePayload.resolved_asset_refs =
        compiledPromptContract.scene_payload.resolved_asset_refs;
      responsePayload.reference_images =
        compiledPromptContract.scene_payload.reference_images;
    }

    return jsonResponse(responsePayload, 201);
  } catch (err) {
    console.error('[scenes/create] Error:', err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}
