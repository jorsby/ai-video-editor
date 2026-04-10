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
          'id, "order", title, prompt, audio_text, audio_url, audio_duration, video_url, video_duration, status, location_variant_slug, character_variant_slugs, prop_variant_slugs, tts_status, video_status'
        )
        .eq('id', sceneId)
        .single();

      if (cancelled) return;
      if (scErr) {
        setError(scErr.message);
        setIsLoading(false);
        return;
      }

      const sceneRow = row as unknown as SceneData;

      // Collect variant slugs
      const slugSet = new Set<string>();
      if (sceneRow.location_variant_slug)
        slugSet.add(sceneRow.location_variant_slug);
      for (const c of sceneRow.character_variant_slugs ?? []) slugSet.add(c);
      for (const p of sceneRow.prop_variant_slugs ?? []) slugSet.add(p);

      const newImageMap = new Map<string, VariantInfo>();
      if (slugSet.size > 0) {
        const { data: variantRows } = await supabase
          .from('project_asset_variants')
          .select('id, slug, image_url, image_gen_status')
          .in('slug', [...slugSet]);

        if (cancelled) return;

        for (const v of variantRows ?? []) {
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
        {
          event: 'UPDATE',
          schema: 'studio',
          table: 'project_asset_variants',
        },
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
