/**
 * Series Production Engine service — CRUD for series, assets, variants,
 * variant images, episodes, and episode–asset–variant overrides.
 * Uses admin (service-role) client for API routes.
 */

import type {
  CharacterImageAngle,
  CharacterImageKind,
  CharacterImageSource,
} from './character-service';

// Re-export for convenience
export type { CharacterImageAngle, CharacterImageKind, CharacterImageSource };

// ── Types ────────────────────────────────────────────────────────────────────

export type SeriesAssetType = 'character' | 'location' | 'prop';

export interface Series {
  id: string;
  user_id: string;
  name: string;
  genre: string | null;
  tone: string | null;
  bible: string | null;
  visual_style: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SeriesAsset {
  id: string;
  series_id: string;
  type: SeriesAssetType;
  name: string;
  description: string | null;
  tags: string[];
  character_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface SeriesAssetVariant {
  id: string;
  asset_id: string;
  label: string;
  description: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface SeriesAssetVariantImage {
  id: string;
  variant_id: string;
  angle: CharacterImageAngle;
  kind: CharacterImageKind;
  url: string | null;
  storage_path: string;
  source: CharacterImageSource;
  width: number | null;
  height: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SeriesEpisode {
  id: string;
  series_id: string;
  project_id: string;
  episode_number: number;
  title: string | null;
  synopsis: string | null;
  created_at: string;
  updated_at: string;
}

export interface EpisodeAssetVariant {
  id: string;
  episode_id: string;
  asset_id: string;
  variant_id: string;
  created_at: string;
}

// ── Expanded / joined types ───────────────────────────────────────────────────

export interface SeriesAssetVariantWithImages extends SeriesAssetVariant {
  series_asset_variant_images: SeriesAssetVariantImage[];
}

export interface SeriesAssetWithVariants extends SeriesAsset {
  series_asset_variants: SeriesAssetVariantWithImages[];
}

export interface SeriesWithAssets extends Series {
  series_assets: SeriesAssetWithVariants[];
}

export interface SeriesEpisodeWithVariants extends SeriesEpisode {
  episode_asset_variants: EpisodeAssetVariant[];
}

// ── Client type alias ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

// ── Series CRUD ───────────────────────────────────────────────────────────────

export async function listSeries(
  supabase: SupabaseClient,
  userId: string
): Promise<Series[]> {
  const { data, error } = await supabase
    .from('series')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) throw new Error(`Failed to list series: ${error.message}`);
  return data ?? [];
}

export async function getSeries(
  supabase: SupabaseClient,
  seriesId: string,
  userId: string
): Promise<Series | null> {
  const { data, error } = await supabase
    .from('series')
    .select('*')
    .eq('id', seriesId)
    .eq('user_id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to get series: ${error.message}`);
  }
  return data;
}

export async function getSeriesWithAssets(
  supabase: SupabaseClient,
  seriesId: string,
  userId: string
): Promise<SeriesWithAssets | null> {
  const { data, error } = await supabase
    .from('series')
    .select(
      '*, series_assets (*, series_asset_variants (*, series_asset_variant_images (*)))'
    )
    .eq('id', seriesId)
    .eq('user_id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to get series with assets: ${error.message}`);
  }
  return data;
}

export async function createSeries(
  supabase: SupabaseClient,
  userId: string,
  input: {
    name: string;
    genre?: string;
    tone?: string;
    bible?: string;
    visual_style?: Record<string, unknown>;
  }
): Promise<Series> {
  const { data, error } = await supabase
    .from('series')
    .insert({
      user_id: userId,
      name: input.name,
      genre: input.genre ?? null,
      tone: input.tone ?? null,
      bible: input.bible ?? null,
      visual_style: input.visual_style ?? {},
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create series: ${error.message}`);
  return data;
}

export async function updateSeries(
  supabase: SupabaseClient,
  seriesId: string,
  userId: string,
  input: {
    name?: string;
    genre?: string | null;
    tone?: string | null;
    bible?: string | null;
    visual_style?: Record<string, unknown>;
  }
): Promise<Series> {
  const { data, error } = await supabase
    .from('series')
    .update(input)
    .eq('id', seriesId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update series: ${error.message}`);
  return data;
}

export async function deleteSeries(
  supabase: SupabaseClient,
  seriesId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('series')
    .delete()
    .eq('id', seriesId)
    .eq('user_id', userId);

  if (error) throw new Error(`Failed to delete series: ${error.message}`);
}

// ── Series Asset CRUD ─────────────────────────────────────────────────────────

export async function listSeriesAssets(
  supabase: SupabaseClient,
  seriesId: string
): Promise<SeriesAssetWithVariants[]> {
  const { data, error } = await supabase
    .from('series_assets')
    .select('*, series_asset_variants (*, series_asset_variant_images (*))')
    .eq('series_id', seriesId)
    .order('sort_order', { ascending: true });

  if (error) throw new Error(`Failed to list series assets: ${error.message}`);
  return data ?? [];
}

export async function createSeriesAsset(
  supabase: SupabaseClient,
  seriesId: string,
  input: {
    type: SeriesAssetType;
    name: string;
    description?: string;
    tags?: string[];
    character_id?: string;
    sort_order?: number;
  }
): Promise<SeriesAsset> {
  const { data, error } = await supabase
    .from('series_assets')
    .insert({
      series_id: seriesId,
      type: input.type,
      name: input.name,
      description: input.description ?? null,
      tags: input.tags ?? [],
      character_id: input.character_id ?? null,
      sort_order: input.sort_order ?? 0,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create series asset: ${error.message}`);
  return data;
}

export async function updateSeriesAsset(
  supabase: SupabaseClient,
  assetId: string,
  input: {
    name?: string;
    description?: string | null;
    tags?: string[];
    character_id?: string | null;
    sort_order?: number;
  }
): Promise<SeriesAsset> {
  const { data, error } = await supabase
    .from('series_assets')
    .update(input)
    .eq('id', assetId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update series asset: ${error.message}`);
  return data;
}

export async function deleteSeriesAsset(
  supabase: SupabaseClient,
  assetId: string
): Promise<void> {
  const { error } = await supabase
    .from('series_assets')
    .delete()
    .eq('id', assetId);

  if (error) throw new Error(`Failed to delete series asset: ${error.message}`);
}

// ── Asset Variant CRUD ────────────────────────────────────────────────────────

export async function listAssetVariants(
  supabase: SupabaseClient,
  assetId: string
): Promise<SeriesAssetVariantWithImages[]> {
  const { data, error } = await supabase
    .from('series_asset_variants')
    .select('*, series_asset_variant_images (*)')
    .eq('asset_id', assetId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to list asset variants: ${error.message}`);
  return data ?? [];
}

export async function createAssetVariant(
  supabase: SupabaseClient,
  assetId: string,
  input: {
    label: string;
    description?: string;
    is_default?: boolean;
  }
): Promise<SeriesAssetVariant> {
  const { data, error } = await supabase
    .from('series_asset_variants')
    .insert({
      asset_id: assetId,
      label: input.label,
      description: input.description ?? null,
      is_default: input.is_default ?? false,
    })
    .select()
    .single();

  if (error)
    throw new Error(`Failed to create asset variant: ${error.message}`);
  return data;
}

export async function updateAssetVariant(
  supabase: SupabaseClient,
  variantId: string,
  input: {
    label?: string;
    description?: string | null;
    is_default?: boolean;
  }
): Promise<SeriesAssetVariant> {
  const { data, error } = await supabase
    .from('series_asset_variants')
    .update(input)
    .eq('id', variantId)
    .select()
    .single();

  if (error)
    throw new Error(`Failed to update asset variant: ${error.message}`);
  return data;
}

export async function deleteAssetVariant(
  supabase: SupabaseClient,
  variantId: string
): Promise<void> {
  const { error } = await supabase
    .from('series_asset_variants')
    .delete()
    .eq('id', variantId);

  if (error)
    throw new Error(`Failed to delete asset variant: ${error.message}`);
}

// ── Variant Image CRUD ────────────────────────────────────────────────────────

export async function addVariantImage(
  supabase: SupabaseClient,
  input: {
    variant_id: string;
    angle: CharacterImageAngle;
    kind: CharacterImageKind;
    url: string;
    storage_path: string;
    source: CharacterImageSource;
    width?: number;
    height?: number;
    metadata?: Record<string, unknown>;
  }
): Promise<SeriesAssetVariantImage> {
  const { data, error } = await supabase
    .from('series_asset_variant_images')
    .insert({
      variant_id: input.variant_id,
      angle: input.angle,
      kind: input.kind,
      url: input.url,
      storage_path: input.storage_path,
      source: input.source,
      width: input.width ?? null,
      height: input.height ?? null,
      metadata: input.metadata ?? {},
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to add variant image: ${error.message}`);
  return data;
}

export async function deleteVariantImage(
  supabase: SupabaseClient,
  imageId: string,
  variantId: string
): Promise<void> {
  const { error } = await supabase
    .from('series_asset_variant_images')
    .delete()
    .eq('id', imageId)
    .eq('variant_id', variantId);

  if (error)
    throw new Error(`Failed to delete variant image: ${error.message}`);
}

// ── Episode CRUD ──────────────────────────────────────────────────────────────

export async function listEpisodes(
  supabase: SupabaseClient,
  seriesId: string
): Promise<SeriesEpisodeWithVariants[]> {
  const { data, error } = await supabase
    .from('series_episodes')
    .select('*, episode_asset_variants (*)')
    .eq('series_id', seriesId)
    .order('episode_number', { ascending: true });

  if (error) throw new Error(`Failed to list episodes: ${error.message}`);
  return data ?? [];
}

export async function createEpisode(
  supabase: SupabaseClient,
  seriesId: string,
  input: {
    project_id: string;
    episode_number: number;
    title?: string;
    synopsis?: string;
  }
): Promise<SeriesEpisode> {
  const { data, error } = await supabase
    .from('series_episodes')
    .insert({
      series_id: seriesId,
      project_id: input.project_id,
      episode_number: input.episode_number,
      title: input.title ?? null,
      synopsis: input.synopsis ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create episode: ${error.message}`);
  return data;
}

export async function updateEpisode(
  supabase: SupabaseClient,
  episodeId: string,
  input: {
    episode_number?: number;
    title?: string | null;
    synopsis?: string | null;
  }
): Promise<SeriesEpisode> {
  const { data, error } = await supabase
    .from('series_episodes')
    .update(input)
    .eq('id', episodeId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update episode: ${error.message}`);
  return data;
}

export async function deleteEpisode(
  supabase: SupabaseClient,
  episodeId: string
): Promise<void> {
  const { error } = await supabase
    .from('series_episodes')
    .delete()
    .eq('id', episodeId);

  if (error) throw new Error(`Failed to delete episode: ${error.message}`);
}

// ── Episode Asset Variant Overrides ───────────────────────────────────────────

export async function setEpisodeAssetVariant(
  supabase: SupabaseClient,
  input: {
    episode_id: string;
    asset_id: string;
    variant_id: string;
  }
): Promise<EpisodeAssetVariant> {
  // Upsert: replace existing override for this episode+asset pair
  const { data, error } = await supabase
    .from('episode_asset_variants')
    .upsert(
      {
        episode_id: input.episode_id,
        asset_id: input.asset_id,
        variant_id: input.variant_id,
      },
      { onConflict: 'episode_id,asset_id' }
    )
    .select()
    .single();

  if (error)
    throw new Error(`Failed to set episode asset variant: ${error.message}`);
  return data;
}

export async function deleteEpisodeAssetVariant(
  supabase: SupabaseClient,
  episodeId: string,
  assetId: string
): Promise<void> {
  const { error } = await supabase
    .from('episode_asset_variants')
    .delete()
    .eq('episode_id', episodeId)
    .eq('asset_id', assetId);

  if (error)
    throw new Error(`Failed to delete episode asset variant: ${error.message}`);
}
