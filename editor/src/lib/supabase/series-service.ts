/**
 * Series Production Engine service — CRUD for series, assets, variants,
 * episodes, and episode asset maps.
 *
 * Phase 1 schema-rewire notes:
 * - Canonical tables: series, series_assets, series_asset_variants, episodes.
 * - Canonical refs: variant slug in episodes.asset_variant_map and scene refs.
 * - Legacy compatibility fields are still exposed in API payloads where needed
 *   (for incremental UI migration).
 */

// Character image types (inlined after character-service removal)
export type CharacterImageAngle =
  | 'front'
  | 'frontal'
  | 'side'
  | 'back'
  | 'three_quarter';
export type CharacterImageKind = 'reference' | 'generated' | 'edited';
export type CharacterImageSource =
  | 'upload'
  | 'flux'
  | 'dalle'
  | 'midjourney'
  | 'generated';

// ── Types ────────────────────────────────────────────────────────────────────

export type SeriesAssetType = 'character' | 'location' | 'prop';
export type SeriesContentMode = 'narrative' | 'cinematic' | 'hybrid';
export type SeriesPlanStatus = 'draft' | 'finalized';
export type EpisodeStatus = 'draft' | 'ready' | 'in_progress' | 'done';

export interface EpisodeAssetVariantMap {
  characters: string[];
  locations: string[];
  props: string[];
}

interface JsonRecord {
  [key: string]: unknown;
}

export interface Series {
  id: string;
  user_id: string;
  project_id: string;
  name: string;
  genre: string | null;
  tone: string | null;
  bible: string | null;
  content_mode: SeriesContentMode;
  language: string | null;
  aspect_ratio: string | null;
  video_model: string | null;
  image_model: string | null;
  voice_id: string | null;
  tts_speed: number | null;
  visual_style: string | JsonRecord | null;
  creative_brief: JsonRecord | null;
  plan_status: SeriesPlanStatus;
  created_at: string;
  updated_at: string;

  // Legacy compatibility alias for old clients still sending/reading metadata.
  metadata?: JsonRecord;
}

export interface SeriesAsset {
  id: string;
  series_id: string;
  type: SeriesAssetType;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;

  // Legacy compatibility fields (removed from canonical schema).
  tags?: string[];
  character_id?: string | null;
}

export interface SeriesAssetVariant {
  id: string;
  asset_id: string;
  name: string;
  slug: string;
  prompt: string | null;
  image_url: string | null;
  is_main: boolean;
  where_to_use: string | null;
  reasoning: string | null;
  created_at: string;
  updated_at: string;

  // Legacy compatibility aliases.
  label?: string;
  description?: string | null;
  is_finalized?: boolean;
  finalized_at?: string | null;
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
  order: number;
  title: string | null;
  synopsis: string | null;
  audio_content: string | null;
  visual_outline: string | null;
  asset_variant_map: EpisodeAssetVariantMap;
  plan_json: JsonRecord | null;
  status: EpisodeStatus;
  created_at: string;
  updated_at: string;

  // Legacy compatibility aliases.
  project_id?: null;
  episode_number: number;
}

export interface EpisodeAssetMap {
  id: string;
  episode_id: string;
  asset_id: string;
  variant_slug?: string;
  type?: SeriesAssetType;
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
  episode_assets: EpisodeAssetMap[];
}

// ── Client type alias ─────────────────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: supabase route clients are untyped across this codebase
export type SupabaseClient = any;

const SERIES_ASSETS_BUCKET = 'series-assets';

const DEFAULT_EPISODE_ASSET_VARIANT_MAP: EpisodeAssetVariantMap = {
  characters: [],
  locations: [],
  props: [],
};

import { slugify } from '@/lib/utils/slugify';

function asNullableText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asJsonRecordOrNull(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function parseVisualStyle(value: unknown): string | JsonRecord | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    // Best-effort: old data may be JSON-encoded object in text column.
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as JsonRecord;
      }
    } catch {
      // keep plain text
    }

    return trimmed;
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonRecord;
  }

  return null;
}

function toDbVisualStyle(value: unknown): string | null {
  if (typeof value === 'string') return asNullableText(value);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return null;
}

function normalizeEpisodeAssetVariantMap(
  value: unknown
): EpisodeAssetVariantMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_EPISODE_ASSET_VARIANT_MAP };
  }

  const input = value as Record<string, unknown>;
  const pickStringArray = (key: keyof EpisodeAssetVariantMap): string[] => {
    const raw = input[key];
    if (!Array.isArray(raw)) return [];
    const normalized = raw
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter(Boolean);
    return [...new Set(normalized)];
  };

  return {
    characters: pickStringArray('characters'),
    locations: pickStringArray('locations'),
    props: pickStringArray('props'),
  };
}

function toLegacySeriesRow(row: Record<string, unknown>): Series {
  const creativeBrief = asJsonRecordOrNull(row.creative_brief);

  return {
    ...(row as unknown as Series),
    visual_style: parseVisualStyle(row.visual_style),
    creative_brief: creativeBrief,
    metadata: creativeBrief ?? {},
  };
}

function resolveVariantImageUrl(
  supabase: SupabaseClient,
  imageUrl: string | null
): string | null {
  if (!imageUrl) return null;

  // Raw storage path: convert to public URL (bucket is public).
  if (!/^https?:\/\//i.test(imageUrl)) {
    const {
      data: { publicUrl },
    } = supabase.storage.from(SERIES_ASSETS_BUCKET).getPublicUrl(imageUrl);
    return publicUrl ?? imageUrl;
  }

  // Signed URL: normalize to public URL for consistency.
  if (imageUrl.includes('/object/sign/series-assets/')) {
    const signedPrefix = '/object/sign/series-assets/';
    const signedIndex = imageUrl.indexOf(signedPrefix);
    const rawPath = imageUrl.slice(signedIndex + signedPrefix.length);
    const pathOnly = rawPath.split('?')[0] ?? rawPath;
    const {
      data: { publicUrl },
    } = supabase.storage.from(SERIES_ASSETS_BUCKET).getPublicUrl(pathOnly);
    return publicUrl ?? imageUrl;
  }

  return imageUrl;
}

function toVariantWithCompatibility(
  supabase: SupabaseClient,
  variant: Record<string, unknown>
): SeriesAssetVariantWithImages {
  const resolvedImageUrl = resolveVariantImageUrl(
    supabase,
    typeof variant.image_url === 'string' ? variant.image_url : null
  );

  const base: SeriesAssetVariant = {
    ...(variant as unknown as SeriesAssetVariant),
    image_url: resolvedImageUrl,
    label: typeof variant.name === 'string' ? variant.name : undefined,
    description:
      typeof variant.where_to_use === 'string'
        ? variant.where_to_use
        : ((variant.where_to_use as string | null) ?? null),
    is_finalized: false,
    finalized_at: null,
  };

  const legacyImages: SeriesAssetVariantImage[] = resolvedImageUrl
    ? [
        {
          id: `${String(variant.id)}::canonical`,
          variant_id: String(variant.id),
          angle: 'front',
          kind: 'reference',
          url: resolvedImageUrl,
          storage_path:
            typeof variant.image_url === 'string' ? variant.image_url : '',
          source: 'generated',
          width: null,
          height: null,
          metadata: {
            source: 'series_asset_variants.image_url',
            prompt:
              typeof variant.prompt === 'string' ? variant.prompt : undefined,
          },
          created_at:
            typeof variant.created_at === 'string'
              ? variant.created_at
              : new Date().toISOString(),
          updated_at:
            typeof variant.updated_at === 'string'
              ? variant.updated_at
              : new Date().toISOString(),
        },
      ]
    : [];

  return {
    ...base,
    series_asset_variant_images: legacyImages,
  };
}

function toAssetWithCompatibility(
  supabase: SupabaseClient,
  asset: Record<string, unknown>
): SeriesAssetWithVariants {
  const variantsRaw = Array.isArray(asset.series_asset_variants)
    ? (asset.series_asset_variants as Record<string, unknown>[])
    : [];

  return {
    ...(asset as unknown as SeriesAsset),
    slug:
      typeof asset.slug === 'string' && asset.slug.trim().length > 0
        ? asset.slug
        : slugify(String(asset.name ?? 'asset')),
    tags: [],
    character_id: null,
    series_asset_variants: variantsRaw.map((variant) =>
      toVariantWithCompatibility(supabase, variant)
    ),
  };
}

async function ensureSeriesProject(
  supabase: SupabaseClient,
  userId: string,
  input: {
    project_id?: string;
    project_description?: string;
    seriesName: string;
  }
): Promise<string> {
  if (input.project_id && input.project_id.trim().length > 0) {
    return input.project_id.trim();
  }

  const { data, error } = await supabase
    .from('projects')
    .insert({
      user_id: userId,
      name: `${input.seriesName} Project`,
      description: asNullableText(input.project_description),
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(`Failed to create default project: ${error?.message}`);
  }

  return data.id;
}

async function resolveProjectIdForSeries(
  supabase: SupabaseClient,
  seriesId: string
): Promise<string> {
  const { data, error } = await supabase
    .from('series')
    .select('project_id')
    .eq('id', seriesId)
    .single();

  if (error || !data?.project_id) {
    throw new Error(`Failed to resolve project for series: ${error?.message}`);
  }

  return data.project_id as string;
}

function collectVariantSlugs(map: EpisodeAssetVariantMap): string[] {
  return [...new Set([...map.characters, ...map.locations, ...map.props])];
}

async function buildEpisodeLegacyAssetRows(
  supabase: SupabaseClient,
  seriesId: string,
  episodeId: string,
  map: EpisodeAssetVariantMap
): Promise<EpisodeAssetMap[]> {
  const slugs = collectVariantSlugs(map);
  if (slugs.length === 0) return [];
  const projectId = await resolveProjectIdForSeries(supabase, seriesId);

  const { data: assetsData, error } = await supabase
    .from('project_assets')
    .select('id, type, series_asset_variants:project_asset_variants(slug)')
    .eq('project_id', projectId);

  if (error) {
    throw new Error(`Failed to resolve episode asset map: ${error.message}`);
  }

  const slugToAsset = new Map<
    string,
    { assetId: string; type: SeriesAssetType }
  >();

  for (const asset of (assetsData ?? []) as Array<{
    id: string;
    type: SeriesAssetType;
    series_asset_variants: Array<{ slug: string }> | null;
  }>) {
    for (const variant of asset.series_asset_variants ?? []) {
      if (typeof variant.slug === 'string' && variant.slug.trim()) {
        slugToAsset.set(variant.slug, { assetId: asset.id, type: asset.type });
      }
    }
  }

  const rows: EpisodeAssetMap[] = [];
  for (const slug of slugs) {
    const resolved = slugToAsset.get(slug);
    if (!resolved) continue;
    rows.push({
      id: `${episodeId}::${slug}`,
      episode_id: episodeId,
      asset_id: resolved.assetId,
      variant_slug: slug,
      type: resolved.type,
      created_at: new Date().toISOString(),
    });
  }

  return rows;
}

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
  return ((data ?? []) as Record<string, unknown>[]).map((row) =>
    toLegacySeriesRow(row)
  );
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

  return toLegacySeriesRow((data ?? {}) as Record<string, unknown>);
}

export async function getSeriesWithAssets(
  supabase: SupabaseClient,
  seriesId: string,
  userId: string
): Promise<SeriesWithAssets | null> {
  const { data, error } = await supabase
    .from('series')
    .select(
      '*, series_assets:project_assets(*, series_asset_variants:project_asset_variants(*))'
    )
    .eq('id', seriesId)
    .eq('user_id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to get series with assets: ${error.message}`);
  }

  if (!data) return null;

  const row = data as Record<string, unknown>;
  const assetsRaw = Array.isArray(row.series_assets)
    ? (row.series_assets as Record<string, unknown>[])
    : [];

  return {
    ...toLegacySeriesRow(row),
    series_assets: assetsRaw.map((asset) =>
      toAssetWithCompatibility(supabase, asset)
    ),
  };
}

export async function createSeries(
  supabase: SupabaseClient,
  userId: string,
  input: {
    project_id?: string;
    project_description?: string;
    name: string;
    genre?: string;
    tone?: string;
    bible?: string;
    content_mode?: SeriesContentMode;
    language?: string;
    aspect_ratio?: string;
    video_model?: string;
    image_model?: string;
    voice_id?: string;
    tts_speed?: number;
    visual_style?: unknown;
    creative_brief?: JsonRecord;
    plan_status?: SeriesPlanStatus;
  }
): Promise<Series> {
  const projectId = await ensureSeriesProject(supabase, userId, {
    project_id: input.project_id,
    project_description: input.project_description,
    seriesName: input.name,
  });

  const { data, error } = await supabase
    .from('series')
    .insert({
      user_id: userId,
      project_id: projectId,
      name: input.name,
      genre: asNullableText(input.genre),
      tone: asNullableText(input.tone),
      bible: asNullableText(input.bible),
      content_mode: input.content_mode ?? 'narrative',
      language: asNullableText(input.language),
      aspect_ratio: asNullableText(input.aspect_ratio),
      video_model: asNullableText(input.video_model),
      image_model: asNullableText(input.image_model),
      voice_id: asNullableText(input.voice_id),
      tts_speed:
        typeof input.tts_speed === 'number' && Number.isFinite(input.tts_speed)
          ? input.tts_speed
          : null,
      visual_style: toDbVisualStyle(input.visual_style),
      creative_brief: input.creative_brief ?? null,
      plan_status: input.plan_status ?? 'draft',
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create series: ${error.message}`);
  return toLegacySeriesRow((data ?? {}) as Record<string, unknown>);
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
    content_mode?: SeriesContentMode;
    language?: string | null;
    aspect_ratio?: string | null;
    video_model?: string | null;
    image_model?: string | null;
    voice_id?: string | null;
    tts_speed?: number | null;
    visual_style?: unknown;
    creative_brief?: JsonRecord | null;
    plan_status?: SeriesPlanStatus;
  }
): Promise<Series> {
  const updates: Record<string, unknown> = { ...input };

  if ('visual_style' in input) {
    updates.visual_style = toDbVisualStyle(input.visual_style);
  }

  const { data, error } = await supabase
    .from('series')
    .update(updates)
    .eq('id', seriesId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update series: ${error.message}`);
  return toLegacySeriesRow((data ?? {}) as Record<string, unknown>);
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
  const projectId = await resolveProjectIdForSeries(supabase, seriesId);
  const { data, error } = await supabase
    .from('project_assets')
    .select('*, series_asset_variants:project_asset_variants(*)')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true });

  if (error) throw new Error(`Failed to list series assets: ${error.message}`);

  return ((data ?? []) as Record<string, unknown>[]).map((asset) => {
    const legacyAsset = toAssetWithCompatibility(supabase, asset);
    return { ...legacyAsset, series_id: seriesId };
  });
}

export async function createSeriesAsset(
  supabase: SupabaseClient,
  seriesId: string,
  input: {
    type: SeriesAssetType;
    name: string;
    slug?: string;
    description?: string;
    sort_order?: number;
  }
): Promise<SeriesAsset> {
  const finalSlug =
    asNullableText(input.slug) ?? slugify(input.name) ?? `asset-${Date.now()}`;
  const projectId = await resolveProjectIdForSeries(supabase, seriesId);

  const { data, error } = await supabase
    .from('project_assets')
    .insert({
      project_id: projectId,
      type: input.type,
      name: input.name,
      slug: finalSlug,
      description: asNullableText(input.description),
      sort_order:
        typeof input.sort_order === 'number' &&
        Number.isFinite(input.sort_order)
          ? input.sort_order
          : 0,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create series asset: ${error.message}`);

  return {
    ...(data as SeriesAsset),
    series_id: seriesId,
    tags: [],
    character_id: null,
  };
}

export async function updateSeriesAsset(
  supabase: SupabaseClient,
  assetId: string,
  input: {
    type?: SeriesAssetType;
    name?: string;
    slug?: string;
    description?: string | null;
    sort_order?: number;
  }
): Promise<SeriesAsset> {
  const updates: Record<string, unknown> = { ...input };

  if (input.name && input.slug === undefined) {
    updates.slug = slugify(input.name);
  }

  const { data, error } = await supabase
    .from('project_assets')
    .update(updates)
    .eq('id', assetId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update series asset: ${error.message}`);

  return {
    ...(data as SeriesAsset),
    tags: [],
    character_id: null,
  };
}

export async function deleteSeriesAsset(
  supabase: SupabaseClient,
  assetId: string
): Promise<void> {
  const { error } = await supabase
    .from('project_assets')
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
    .from('project_asset_variants')
    .select('*')
    .eq('asset_id', assetId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to list asset variants: ${error.message}`);

  return ((data ?? []) as Record<string, unknown>[]).map((variant) =>
    toVariantWithCompatibility(supabase, variant)
  );
}

export async function createAssetVariant(
  supabase: SupabaseClient,
  assetId: string,
  input: {
    name?: string;
    label?: string;
    slug?: string;
    prompt?: string;
    image_url?: string;
    is_main?: boolean;
    where_to_use?: string;
    reasoning?: string;
    description?: string;
  }
): Promise<SeriesAssetVariant> {
  const resolvedName = asNullableText(input.name ?? input.label);
  if (!resolvedName) {
    throw new Error('Variant name is required');
  }

  const resolvedSlug = asNullableText(input.slug) ?? slugify(resolvedName);

  if (input.is_main) {
    const { error: resetError } = await supabase
      .from('project_asset_variants')
      .update({ is_main: false })
      .eq('asset_id', assetId)
      .eq('is_main', true);

    if (resetError) {
      throw new Error(
        `Failed to clear previous main variant: ${resetError.message}`
      );
    }
  }

  const { data, error } = await supabase
    .from('project_asset_variants')
    .insert({
      asset_id: assetId,
      name: resolvedName,
      slug: resolvedSlug,
      prompt: asNullableText(input.prompt),
      image_url: asNullableText(input.image_url),
      is_main: Boolean(input.is_main),
      where_to_use: asNullableText(input.where_to_use ?? input.description),
      reasoning: asNullableText(input.reasoning),
    })
    .select()
    .single();

  if (error)
    throw new Error(`Failed to create asset variant: ${error.message}`);

  return toVariantWithCompatibility(
    supabase,
    (data ?? {}) as Record<string, unknown>
  );
}

export async function updateAssetVariant(
  supabase: SupabaseClient,
  variantId: string,
  input: {
    name?: string;
    label?: string;
    slug?: string;
    prompt?: string | null;
    image_url?: string | null;
    is_main?: boolean;
    where_to_use?: string | null;
    reasoning?: string | null;
    description?: string | null;
  }
): Promise<SeriesAssetVariant> {
  const updates: Record<string, unknown> = {};

  if (input.name !== undefined || input.label !== undefined) {
    const nextName = asNullableText(input.name ?? input.label);
    if (!nextName) throw new Error('Variant name cannot be empty');
    updates.name = nextName;
    if (input.slug === undefined) {
      updates.slug = slugify(nextName);
    }
  }

  if (input.slug !== undefined) {
    const nextSlug = asNullableText(input.slug);
    if (!nextSlug) throw new Error('Variant slug cannot be empty');
    updates.slug = nextSlug;
  }

  if (input.prompt !== undefined) updates.prompt = asNullableText(input.prompt);
  if (input.image_url !== undefined)
    updates.image_url = asNullableText(input.image_url);
  if (input.where_to_use !== undefined || input.description !== undefined) {
    updates.where_to_use = asNullableText(
      input.where_to_use ?? input.description ?? null
    );
  }
  if (input.reasoning !== undefined)
    updates.reasoning = asNullableText(input.reasoning);

  if (input.is_main === true) {
    const { data: variantData, error: variantError } = await supabase
      .from('project_asset_variants')
      .select('asset_id')
      .eq('id', variantId)
      .single();

    if (variantError || !variantData?.asset_id) {
      throw new Error('Variant not found');
    }

    const { error: resetError } = await supabase
      .from('project_asset_variants')
      .update({ is_main: false })
      .eq('asset_id', variantData.asset_id)
      .eq('is_main', true)
      .neq('id', variantId);

    if (resetError) {
      throw new Error(
        `Failed to clear previous main variant: ${resetError.message}`
      );
    }

    updates.is_main = true;
  } else if (input.is_main === false) {
    updates.is_main = false;
  }

  const { data, error } = await supabase
    .from('project_asset_variants')
    .update(updates)
    .eq('id', variantId)
    .select()
    .single();

  if (error)
    throw new Error(`Failed to update asset variant: ${error.message}`);

  return toVariantWithCompatibility(
    supabase,
    (data ?? {}) as Record<string, unknown>
  );
}

export async function deleteAssetVariant(
  supabase: SupabaseClient,
  variantId: string
): Promise<void> {
  const { error } = await supabase
    .from('project_asset_variants')
    .delete()
    .eq('id', variantId);

  if (error)
    throw new Error(`Failed to delete asset variant: ${error.message}`);
}

// ── Variant image compatibility helpers ───────────────────────────────────────

/**
 * Legacy compatibility adapter.
 * Canonical schema stores one image on series_asset_variants.image_url.
 */
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
    .from('project_asset_variants')
    .update({ image_url: input.url })
    .eq('id', input.variant_id)
    .select('id, created_at, updated_at')
    .single();

  if (error) {
    throw new Error(`Failed to save variant image_url: ${error.message}`);
  }

  return {
    id: `${String(data.id)}::canonical`,
    variant_id: input.variant_id,
    angle: input.angle,
    kind: input.kind,
    url: input.url,
    storage_path: input.storage_path,
    source: input.source,
    width: input.width ?? null,
    height: input.height ?? null,
    metadata: input.metadata ?? {},
    created_at: data.created_at,
    updated_at: data.updated_at,
  };
}

/**
 * Legacy compatibility adapter.
 * Deletes canonical image_url from series_asset_variants row.
 */
export async function deleteVariantImage(
  supabase: SupabaseClient,
  _imageId: string,
  variantId: string
): Promise<void> {
  const { error } = await supabase
    .from('project_asset_variants')
    .update({ image_url: null })
    .eq('id', variantId);

  if (error) {
    throw new Error(`Failed to clear variant image_url: ${error.message}`);
  }
}

// ── Episode CRUD ──────────────────────────────────────────────────────────────

export async function listEpisodes(
  supabase: SupabaseClient,
  seriesId: string
): Promise<SeriesEpisodeWithVariants[]> {
  const { data, error } = await supabase
    .from('episodes')
    .select('*')
    .eq('series_id', seriesId)
    .order('order', { ascending: true });

  if (error) throw new Error(`Failed to list episodes: ${error.message}`);

  const episodes = (data ?? []) as Array<Record<string, unknown>>;

  return Promise.all(
    episodes.map(async (row) => {
      const map = normalizeEpisodeAssetVariantMap(row.asset_variant_map);
      const legacyRows = await buildEpisodeLegacyAssetRows(
        supabase,
        seriesId,
        String(row.id),
        map
      );

      return {
        ...(row as unknown as SeriesEpisode),
        order: Number(row.order ?? 0),
        episode_number: Number(row.order ?? 0),
        project_id: null,
        asset_variant_map: map,
        plan_json: asJsonRecordOrNull(row.plan_json),
        episode_assets: legacyRows,
      };
    })
  );
}

export async function createEpisode(
  supabase: SupabaseClient,
  seriesId: string,
  input: {
    order?: number;
    episode_number?: number;
    title?: string;
    synopsis?: string;
    audio_content?: string;
    visual_outline?: string;
    asset_variant_map?: EpisodeAssetVariantMap;
    plan_json?: JsonRecord;
    status?: EpisodeStatus;
  }
): Promise<SeriesEpisode> {
  const resolvedOrder =
    typeof input.order === 'number' ? input.order : input.episode_number;

  if (!resolvedOrder || resolvedOrder < 1) {
    throw new Error('Episode order must be a positive integer');
  }

  const { data, error } = await supabase
    .from('episodes')
    .insert({
      series_id: seriesId,
      order: resolvedOrder,
      title: asNullableText(input.title),
      synopsis: asNullableText(input.synopsis),
      audio_content: asNullableText(input.audio_content),
      visual_outline: asNullableText(input.visual_outline),
      asset_variant_map: normalizeEpisodeAssetVariantMap(
        input.asset_variant_map
      ),
      plan_json: input.plan_json ?? null,
      status: input.status ?? 'draft',
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create episode: ${error.message}`);

  const row = (data ?? {}) as Record<string, unknown>;
  return {
    ...(row as unknown as SeriesEpisode),
    order: Number(row.order ?? resolvedOrder),
    episode_number: Number(row.order ?? resolvedOrder),
    project_id: null,
    asset_variant_map: normalizeEpisodeAssetVariantMap(row.asset_variant_map),
    plan_json: asJsonRecordOrNull(row.plan_json),
  };
}

export async function updateEpisode(
  supabase: SupabaseClient,
  episodeId: string,
  input: {
    order?: number;
    episode_number?: number;
    title?: string | null;
    synopsis?: string | null;
    audio_content?: string | null;
    visual_outline?: string | null;
    asset_variant_map?: EpisodeAssetVariantMap;
    plan_json?: JsonRecord | null;
    status?: EpisodeStatus;
  }
): Promise<SeriesEpisode> {
  const updates: Record<string, unknown> = { ...input };

  if (input.order !== undefined || input.episode_number !== undefined) {
    const nextOrder =
      typeof input.order === 'number' ? input.order : input.episode_number;

    if (!nextOrder || nextOrder < 1) {
      throw new Error('Episode order must be a positive integer');
    }

    updates.order = nextOrder;
    delete updates.episode_number;
  }

  if (input.asset_variant_map !== undefined) {
    updates.asset_variant_map = normalizeEpisodeAssetVariantMap(
      input.asset_variant_map
    );
  }

  const { data, error } = await supabase
    .from('episodes')
    .update(updates)
    .eq('id', episodeId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update episode: ${error.message}`);

  const row = (data ?? {}) as Record<string, unknown>;
  return {
    ...(row as unknown as SeriesEpisode),
    order: Number(row.order ?? 0),
    episode_number: Number(row.order ?? 0),
    project_id: null,
    asset_variant_map: normalizeEpisodeAssetVariantMap(row.asset_variant_map),
    plan_json: asJsonRecordOrNull(row.plan_json),
  };
}

export async function deleteEpisode(
  supabase: SupabaseClient,
  episodeId: string
): Promise<void> {
  const { error } = await supabase
    .from('episodes')
    .delete()
    .eq('id', episodeId);

  if (error) throw new Error(`Failed to delete episode: ${error.message}`);
}
