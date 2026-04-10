/**
 * Video Production Engine service — CRUD for video, assets, variants,
 * chapters, and chapter asset maps.
 *
 * Phase 1 schema-rewire notes:
 * - Canonical tables: video, series_assets, series_asset_variants, chapters.
 * - Canonical refs: variant slug in chapters.asset_variant_map and scene refs.
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

export type VideoAssetType = 'character' | 'location' | 'prop';
export type VideoContentMode = 'narrative' | 'cinematic' | 'hybrid';
export type VideoPlanStatus = 'draft' | 'finalized';
export type ChapterStatus = 'draft' | 'ready' | 'in_progress' | 'done';

export interface ChapterAssetVariantMap {
  characters: string[];
  locations: string[];
  props: string[];
}

interface JsonRecord {
  [key: string]: unknown;
}

export interface Video {
  id: string;
  user_id: string;
  project_id: string;
  name: string;
  genre: string | null;
  tone: string | null;
  bible: string | null;
  content_mode: VideoContentMode;
  language: string | null;
  aspect_ratio: string | null;
  video_model: string | null;
  voice_id: string | null;
  tts_speed: number | null;
  visual_style: string | JsonRecord | null;
  creative_brief: JsonRecord | null;
  plan_status: VideoPlanStatus;
  created_at: string;
  updated_at: string;

  // Legacy compatibility alias for old clients still sending/reading metadata.
  metadata?: JsonRecord;
}

export interface VideoAsset {
  id: string;
  video_id: string;
  type: VideoAssetType;
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

export interface VideoAssetVariant {
  id: string;
  asset_id: string;
  name: string;
  slug: string;
  prompt: string | null;
  image_url: string | null;
  is_main: boolean;
  reasoning: string | null;
  created_at: string;
  updated_at: string;

  // Legacy compatibility aliases.
  label?: string;
  description?: string | null;
  is_finalized?: boolean;
  finalized_at?: string | null;
}

export interface VideoAssetVariantImage {
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

export interface VideoChapter {
  id: string;
  video_id: string;
  order: number;
  title: string | null;
  synopsis: string | null;
  audio_content: string | null;
  visual_outline: string | null;
  asset_variant_map: ChapterAssetVariantMap;
  plan_json: JsonRecord | null;
  status: ChapterStatus;
  created_at: string;
  updated_at: string;

  // Legacy compatibility aliases.
  project_id?: null;
  chapter_number: number;
}

export interface ChapterAssetMap {
  id: string;
  chapter_id: string;
  asset_id: string;
  variant_slug?: string;
  type?: VideoAssetType;
  created_at: string;
}

// ── Expanded / joined types ───────────────────────────────────────────────────

export interface VideoAssetVariantWithImages extends VideoAssetVariant {
  series_asset_variant_images: VideoAssetVariantImage[];
}

export interface VideoAssetWithVariants extends VideoAsset {
  series_asset_variants: VideoAssetVariantWithImages[];
}

export interface VideoWithAssets extends Video {
  series_assets: VideoAssetWithVariants[];
}

export interface VideoChapterWithVariants extends VideoChapter {
  episode_assets: ChapterAssetMap[];
}

// ── Client type alias ─────────────────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: supabase route clients are untyped across this codebase
export type SupabaseClient = any;

const SERIES_ASSETS_BUCKET = 'video-assets';

const DEFAULT_EPISODE_ASSET_VARIANT_MAP: ChapterAssetVariantMap = {
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

function normalizeChapterAssetVariantMap(
  value: unknown
): ChapterAssetVariantMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_EPISODE_ASSET_VARIANT_MAP };
  }

  const input = value as Record<string, unknown>;
  const pickStringArray = (key: keyof ChapterAssetVariantMap): string[] => {
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

function toLegacyVideoRow(row: Record<string, unknown>): Video {
  const creativeBrief = asJsonRecordOrNull(row.creative_brief);

  return {
    ...(row as unknown as Video),
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
  if (imageUrl.includes('/object/sign/video-assets/')) {
    const signedPrefix = '/object/sign/video-assets/';
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
): VideoAssetVariantWithImages {
  const resolvedImageUrl = resolveVariantImageUrl(
    supabase,
    typeof variant.image_url === 'string' ? variant.image_url : null
  );

  const base: VideoAssetVariant = {
    ...(variant as unknown as VideoAssetVariant),
    image_url: resolvedImageUrl,
    label: typeof variant.name === 'string' ? variant.name : undefined,
    description: null,
    is_finalized: false,
    finalized_at: null,
  };

  const legacyImages: VideoAssetVariantImage[] = resolvedImageUrl
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
): VideoAssetWithVariants {
  const variantsRaw = Array.isArray(asset.series_asset_variants)
    ? (asset.series_asset_variants as Record<string, unknown>[])
    : [];

  return {
    ...(asset as unknown as VideoAsset),
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

async function ensureVideoProject(
  supabase: SupabaseClient,
  userId: string,
  input: {
    project_id?: string;
    project_description?: string;
    videoName: string;
  }
): Promise<string> {
  if (input.project_id && input.project_id.trim().length > 0) {
    return input.project_id.trim();
  }

  const { data, error } = await supabase
    .from('projects')
    .insert({
      user_id: userId,
      name: `${input.videoName} Project`,
      description: asNullableText(input.project_description),
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(`Failed to create default project: ${error?.message}`);
  }

  return data.id;
}

async function resolveProjectIdForVideo(
  supabase: SupabaseClient,
  videoId: string
): Promise<string> {
  const { data, error } = await supabase
    .from('videos')
    .select('project_id')
    .eq('id', videoId)
    .single();

  if (error || !data?.project_id) {
    throw new Error(`Failed to resolve project for video: ${error?.message}`);
  }

  return data.project_id as string;
}

function collectVariantSlugs(map: ChapterAssetVariantMap): string[] {
  return [...new Set([...map.characters, ...map.locations, ...map.props])];
}

async function buildChapterLegacyAssetRows(
  supabase: SupabaseClient,
  videoId: string,
  chapterId: string,
  map: ChapterAssetVariantMap
): Promise<ChapterAssetMap[]> {
  const slugs = collectVariantSlugs(map);
  if (slugs.length === 0) return [];
  const projectId = await resolveProjectIdForVideo(supabase, videoId);

  const { data: assetsData, error } = await supabase
    .from('project_assets')
    .select('id, type, series_asset_variants:project_asset_variants(slug)')
    .eq('project_id', projectId);

  if (error) {
    throw new Error(`Failed to resolve chapter asset map: ${error.message}`);
  }

  const slugToAsset = new Map<
    string,
    { assetId: string; type: VideoAssetType }
  >();

  for (const asset of (assetsData ?? []) as Array<{
    id: string;
    type: VideoAssetType;
    series_asset_variants: Array<{ slug: string }> | null;
  }>) {
    for (const variant of asset.series_asset_variants ?? []) {
      if (typeof variant.slug === 'string' && variant.slug.trim()) {
        slugToAsset.set(variant.slug, { assetId: asset.id, type: asset.type });
      }
    }
  }

  const rows: ChapterAssetMap[] = [];
  for (const slug of slugs) {
    const resolved = slugToAsset.get(slug);
    if (!resolved) continue;
    rows.push({
      id: `${chapterId}::${slug}`,
      chapter_id: chapterId,
      asset_id: resolved.assetId,
      variant_slug: slug,
      type: resolved.type,
      created_at: new Date().toISOString(),
    });
  }

  return rows;
}

// ── Video CRUD ───────────────────────────────────────────────────────────────

export async function listVideo(
  supabase: SupabaseClient,
  userId: string
): Promise<Video[]> {
  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) throw new Error(`Failed to list video: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((row) =>
    toLegacyVideoRow(row)
  );
}

export async function getVideo(
  supabase: SupabaseClient,
  videoId: string,
  userId: string
): Promise<Video | null> {
  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .eq('id', videoId)
    .eq('user_id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to get video: ${error.message}`);
  }

  return toLegacyVideoRow((data ?? {}) as Record<string, unknown>);
}

export async function getVideoWithAssets(
  supabase: SupabaseClient,
  videoId: string,
  userId: string
): Promise<VideoWithAssets | null> {
  const { data, error } = await supabase
    .from('videos')
    .select(
      '*, series_assets:project_assets(*, series_asset_variants:project_asset_variants(*))'
    )
    .eq('id', videoId)
    .eq('user_id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to get video with assets: ${error.message}`);
  }

  if (!data) return null;

  const row = data as Record<string, unknown>;
  const assetsRaw = Array.isArray(row.series_assets)
    ? (row.series_assets as Record<string, unknown>[])
    : [];

  return {
    ...toLegacyVideoRow(row),
    series_assets: assetsRaw.map((asset) =>
      toAssetWithCompatibility(supabase, asset)
    ),
  };
}

export async function createVideo(
  supabase: SupabaseClient,
  userId: string,
  input: {
    project_id?: string;
    project_description?: string;
    name: string;
    genre?: string;
    tone?: string;
    bible?: string;
    content_mode?: VideoContentMode;
    language?: string;
    aspect_ratio?: string;
    video_model?: string;
    voice_id?: string;
    tts_speed?: number;
    visual_style?: unknown;
    creative_brief?: JsonRecord;
    plan_status?: VideoPlanStatus;
  }
): Promise<Video> {
  const projectId = await ensureVideoProject(supabase, userId, {
    project_id: input.project_id,
    project_description: input.project_description,
    videoName: input.name,
  });

  const { data, error } = await supabase
    .from('videos')
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

  if (error) throw new Error(`Failed to create video: ${error.message}`);
  return toLegacyVideoRow((data ?? {}) as Record<string, unknown>);
}

export async function updateVideo(
  supabase: SupabaseClient,
  videoId: string,
  userId: string,
  input: {
    name?: string;
    genre?: string | null;
    tone?: string | null;
    bible?: string | null;
    content_mode?: VideoContentMode;
    language?: string | null;
    aspect_ratio?: string | null;
    video_model?: string | null;
    voice_id?: string | null;
    tts_speed?: number | null;
    visual_style?: unknown;
    creative_brief?: JsonRecord | null;
    plan_status?: VideoPlanStatus;
  }
): Promise<Video> {
  const updates: Record<string, unknown> = { ...input };

  if ('visual_style' in input) {
    updates.visual_style = toDbVisualStyle(input.visual_style);
  }

  const { data, error } = await supabase
    .from('videos')
    .update(updates)
    .eq('id', videoId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update video: ${error.message}`);
  return toLegacyVideoRow((data ?? {}) as Record<string, unknown>);
}

export async function deleteVideo(
  supabase: SupabaseClient,
  videoId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('videos')
    .delete()
    .eq('id', videoId)
    .eq('user_id', userId);

  if (error) throw new Error(`Failed to delete video: ${error.message}`);
}

// ── Video Asset CRUD ─────────────────────────────────────────────────────────

export async function listVideoAssets(
  supabase: SupabaseClient,
  videoId: string
): Promise<VideoAssetWithVariants[]> {
  const projectId = await resolveProjectIdForVideo(supabase, videoId);
  const { data, error } = await supabase
    .from('project_assets')
    .select('*, series_asset_variants:project_asset_variants(*)')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true });

  if (error) throw new Error(`Failed to list video assets: ${error.message}`);

  return ((data ?? []) as Record<string, unknown>[]).map((asset) => {
    const legacyAsset = toAssetWithCompatibility(supabase, asset);
    return { ...legacyAsset, video_id: videoId };
  });
}

export async function createVideoAsset(
  supabase: SupabaseClient,
  videoId: string,
  input: {
    type: VideoAssetType;
    name: string;
    slug?: string;
    description?: string;
    sort_order?: number;
  }
): Promise<VideoAsset> {
  const finalSlug =
    asNullableText(input.slug) ?? slugify(input.name) ?? `asset-${Date.now()}`;
  const projectId = await resolveProjectIdForVideo(supabase, videoId);

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

  if (error) throw new Error(`Failed to create video asset: ${error.message}`);

  return {
    ...(data as VideoAsset),
    video_id: videoId,
    tags: [],
    character_id: null,
  };
}

export async function updateVideoAsset(
  supabase: SupabaseClient,
  assetId: string,
  input: {
    type?: VideoAssetType;
    name?: string;
    slug?: string;
    description?: string | null;
    sort_order?: number;
  }
): Promise<VideoAsset> {
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

  if (error) throw new Error(`Failed to update video asset: ${error.message}`);

  return {
    ...(data as VideoAsset),
    tags: [],
    character_id: null,
  };
}

export async function deleteVideoAsset(
  supabase: SupabaseClient,
  assetId: string
): Promise<void> {
  const { error } = await supabase
    .from('project_assets')
    .delete()
    .eq('id', assetId);

  if (error) throw new Error(`Failed to delete video asset: ${error.message}`);
}

// ── Asset Variant CRUD ────────────────────────────────────────────────────────

export async function listAssetVariants(
  supabase: SupabaseClient,
  assetId: string
): Promise<VideoAssetVariantWithImages[]> {
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
    reasoning?: string;
  }
): Promise<VideoAssetVariant> {
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
    reasoning?: string | null;
  }
): Promise<VideoAssetVariant> {
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
): Promise<VideoAssetVariantImage> {
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

// ── Chapter CRUD ──────────────────────────────────────────────────────────────

export async function listChapters(
  supabase: SupabaseClient,
  videoId: string
): Promise<VideoChapterWithVariants[]> {
  const { data, error } = await supabase
    .from('chapters')
    .select('*')
    .eq('video_id', videoId)
    .order('order', { ascending: true });

  if (error) throw new Error(`Failed to list chapters: ${error.message}`);

  const chapters = (data ?? []) as Array<Record<string, unknown>>;

  return Promise.all(
    chapters.map(async (row) => {
      const map = normalizeChapterAssetVariantMap(row.asset_variant_map);
      const legacyRows = await buildChapterLegacyAssetRows(
        supabase,
        videoId,
        String(row.id),
        map
      );

      return {
        ...(row as unknown as VideoChapter),
        order: Number(row.order ?? 0),
        chapter_number: Number(row.order ?? 0),
        project_id: null,
        asset_variant_map: map,
        plan_json: asJsonRecordOrNull(row.plan_json),
        episode_assets: legacyRows,
      };
    })
  );
}

export async function createChapter(
  supabase: SupabaseClient,
  videoId: string,
  input: {
    order?: number;
    chapter_number?: number;
    title?: string;
    synopsis?: string;
    audio_content?: string;
    visual_outline?: string;
    asset_variant_map?: ChapterAssetVariantMap;
    plan_json?: JsonRecord;
    status?: ChapterStatus;
  }
): Promise<VideoChapter> {
  const resolvedOrder =
    typeof input.order === 'number' ? input.order : input.chapter_number;

  if (!resolvedOrder || resolvedOrder < 1) {
    throw new Error('Chapter order must be a positive integer');
  }

  const { data, error } = await supabase
    .from('chapters')
    .insert({
      video_id: videoId,
      order: resolvedOrder,
      title: asNullableText(input.title),
      synopsis: asNullableText(input.synopsis),
      audio_content: asNullableText(input.audio_content),
      visual_outline: asNullableText(input.visual_outline),
      asset_variant_map: normalizeChapterAssetVariantMap(
        input.asset_variant_map
      ),
      plan_json: input.plan_json ?? null,
      status: input.status ?? 'draft',
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create chapter: ${error.message}`);

  const row = (data ?? {}) as Record<string, unknown>;
  return {
    ...(row as unknown as VideoChapter),
    order: Number(row.order ?? resolvedOrder),
    chapter_number: Number(row.order ?? resolvedOrder),
    project_id: null,
    asset_variant_map: normalizeChapterAssetVariantMap(row.asset_variant_map),
    plan_json: asJsonRecordOrNull(row.plan_json),
  };
}

export async function updateChapter(
  supabase: SupabaseClient,
  chapterId: string,
  input: {
    order?: number;
    chapter_number?: number;
    title?: string | null;
    synopsis?: string | null;
    audio_content?: string | null;
    visual_outline?: string | null;
    asset_variant_map?: ChapterAssetVariantMap;
    plan_json?: JsonRecord | null;
    status?: ChapterStatus;
  }
): Promise<VideoChapter> {
  const updates: Record<string, unknown> = { ...input };

  if (input.order !== undefined || input.chapter_number !== undefined) {
    const nextOrder =
      typeof input.order === 'number' ? input.order : input.chapter_number;

    if (!nextOrder || nextOrder < 1) {
      throw new Error('Chapter order must be a positive integer');
    }

    updates.order = nextOrder;
    delete updates.chapter_number;
  }

  if (input.asset_variant_map !== undefined) {
    updates.asset_variant_map = normalizeChapterAssetVariantMap(
      input.asset_variant_map
    );
  }

  const { data, error } = await supabase
    .from('chapters')
    .update(updates)
    .eq('id', chapterId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update chapter: ${error.message}`);

  const row = (data ?? {}) as Record<string, unknown>;
  return {
    ...(row as unknown as VideoChapter),
    order: Number(row.order ?? 0),
    chapter_number: Number(row.order ?? 0),
    project_id: null,
    asset_variant_map: normalizeChapterAssetVariantMap(row.asset_variant_map),
    plan_json: asJsonRecordOrNull(row.plan_json),
  };
}

export async function deleteChapter(
  supabase: SupabaseClient,
  chapterId: string
): Promise<void> {
  const { error } = await supabase
    .from('chapters')
    .delete()
    .eq('id', chapterId);

  if (error) throw new Error(`Failed to delete chapter: ${error.message}`);
}
