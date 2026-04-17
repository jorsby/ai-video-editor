import { useEffect, useState, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type {
  SceneData,
  VariantInfo,
  VariantImageMap,
} from '@/components/editor/media-panel/shared/scene-types';

interface UseSceneDataResult {
  scene: SceneData | null;
  imageMap: VariantImageMap;
  isLoading: boolean;
  error: string | null;
}

export function useSceneData(sceneId: string | null): UseSceneDataResult {
  const [scene, setScene] = useState<SceneData | null>(null);
  const [imageMap, setImageMap] = useState<VariantImageMap>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshRef = useRef(0);

  useEffect(() => {
    if (!sceneId) {
      setScene(null);
      setImageMap(new Map());
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    async function load() {
      const supabase = createClient('studio');

      const { data: row, error: scErr } = await supabase
        .from('scenes')
        .select(
          'id, "order", title, structured_prompt, audio_text, audio_url, audio_duration, video_url, video_duration, status, location_variant_slug, character_variant_slugs, prop_variant_slugs, tts_status, video_status, tts_generation_metadata, video_generation_metadata'
        )
        .eq('id', sceneId)
        .single();

      if (cancelled) return;
      if (scErr) {
        setError(scErr.message);
        setIsLoading(false);
        return;
      }

      // Map structured_prompt → prompt for backward compat
      const rawRow = row as any;
      const sceneRow: SceneData = {
        ...rawRow,
        prompt: Array.isArray(rawRow.structured_prompt)
          ? (rawRow.structured_prompt as Record<string, unknown>[])
              .map((s: Record<string, unknown>) =>
                Object.values(s)
                  .filter((v) => typeof v === 'string' && v.trim())
                  .join(', ')
              )
              .join('\n')
          : null,
      };

      // Collect variant slugs
      const slugSet = new Set<string>();
      if (sceneRow.location_variant_slug)
        slugSet.add(sceneRow.location_variant_slug);
      for (const c of sceneRow.character_variant_slugs ?? []) slugSet.add(c);
      for (const p of sceneRow.prop_variant_slugs ?? []) slugSet.add(p);

      const newImageMap = new Map<string, VariantInfo>();
      if (slugSet.size > 0) {
        const variantFields = 'id, slug, image_url, image_gen_status';
        const slugArr = [...slugSet];
        const [charResult, locResult, propResult] = await Promise.all([
          supabase
            .from('character_variants')
            .select(variantFields)
            .in('slug', slugArr),
          supabase
            .from('location_variants')
            .select(variantFields)
            .in('slug', slugArr),
          supabase
            .from('prop_variants')
            .select(variantFields)
            .in('slug', slugArr),
        ]);

        if (cancelled) return;

        for (const v of [
          ...(charResult.data ?? []),
          ...(locResult.data ?? []),
          ...(propResult.data ?? []),
        ]) {
          if (v.slug) {
            newImageMap.set(v.slug, {
              id: v.id,
              image_url: v.image_url,
              image_gen_status: v.image_gen_status ?? 'idle',
            });
          }
        }
      }

      if (!cancelled) {
        setScene(sceneRow);
        setImageMap(newImageMap);
        setIsLoading(false);
      }
    }

    load();

    // Realtime subscription for this scene
    const supabaseRT = createClient('studio');
    const channel = supabaseRT
      .channel(`scene-clip-panel-${sceneId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'studio', table: 'scenes' },
        (payload) => {
          if (!cancelled && (payload.new as any)?.id === sceneId) {
            load();
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'studio', table: 'character_variants' },
        () => {
          if (!cancelled) load();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'studio', table: 'location_variants' },
        () => {
          if (!cancelled) load();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'studio', table: 'prop_variants' },
        () => {
          if (!cancelled) load();
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabaseRT.removeChannel(channel);
    };
  }, [sceneId, refreshRef.current]);

  return { scene, imageMap, isLoading, error };
}
