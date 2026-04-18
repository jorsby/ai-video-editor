/**
 * Typed-asset/variant helpers for the studio schema.
 *
 * Schema split (migration sync_schema_with_docs, 2026-04-13):
 *   project_assets         → characters | locations | props
 *   project_asset_variants → character_variants | location_variants | prop_variants
 *
 * Variants join back to their parent via character_id / location_id / prop_id;
 * parent carries project_id + video_id.
 */

type DB = any;

const VARIANT_TABLES = [
  'character_variants',
  'location_variants',
  'prop_variants',
] as const;

const ASSET_TABLES = ['characters', 'locations', 'props'] as const;

export type VariantTableName = (typeof VARIANT_TABLES)[number];
export type AssetTableName = (typeof ASSET_TABLES)[number];
export type AssetType = 'character' | 'location' | 'prop';

export const ASSET_TABLE_BY_TYPE: Record<AssetType, AssetTableName> = {
  character: 'characters',
  location: 'locations',
  prop: 'props',
};

export const VARIANT_TABLE_BY_TYPE: Record<AssetType, VariantTableName> = {
  character: 'character_variants',
  location: 'location_variants',
  prop: 'prop_variants',
};

export const ASSET_FK_BY_TYPE: Record<AssetType, string> = {
  character: 'character_id',
  location: 'location_id',
  prop: 'prop_id',
};

const TYPE_BY_ASSET_TABLE: Record<AssetTableName, AssetType> = {
  characters: 'character',
  locations: 'location',
  props: 'prop',
};

const TYPE_BY_VARIANT_TABLE: Record<VariantTableName, AssetType> = {
  character_variants: 'character',
  location_variants: 'location',
  prop_variants: 'prop',
};

export function assetTypeFromVariantTable(table: VariantTableName): AssetType {
  return TYPE_BY_VARIANT_TABLE[table];
}

export function assetTypeFromAssetTable(table: AssetTableName): AssetType {
  return TYPE_BY_ASSET_TABLE[table];
}

/* ── Variants ────────────────────────────────────────────────────────── */

/**
 * Find which variant table contains a given variant ID.
 * Queries all 3 tables in parallel and returns the first match.
 */
export async function resolveVariantTable(
  db: DB,
  variantId: string
): Promise<VariantTableName | null> {
  const results = await Promise.all(
    VARIANT_TABLES.map(async (table) => {
      const { data, error } = await db
        .from(table)
        .select('id')
        .eq('id', variantId)
        .maybeSingle();
      return !error && data ? table : null;
    })
  );
  return results.find((r) => r !== null) ?? null;
}

/**
 * Select columns from a variant by ID, auto-detecting the table.
 * Returns the data and table name, or null if not found.
 */
export async function selectVariantById(
  db: DB,
  variantId: string,
  selectColumns: string
): Promise<{ data: Record<string, unknown>; table: VariantTableName } | null> {
  for (const table of VARIANT_TABLES) {
    const { data, error } = await db
      .from(table)
      .select(selectColumns)
      .eq('id', variantId)
      .maybeSingle();
    if (!error && data) {
      return { data, table };
    }
  }
  return null;
}

function valuesMatch(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;

  if (actual == null || expected == null) {
    return actual == null && expected == null;
  }

  if (typeof actual === 'object' || typeof expected === 'object') {
    return JSON.stringify(actual) === JSON.stringify(expected);
  }

  return false;
}

/**
 * Update a variant by ID, auto-detecting the table.
 * Throws if the row is missing, the update errors, or the persisted row does not match.
 */
export async function updateVariantById(
  db: DB,
  variantId: string,
  updates: Record<string, unknown>
): Promise<boolean> {
  const table = await resolveVariantTable(db, variantId);
  if (!table) {
    throw new Error(`Variant ${variantId} not found in typed variant tables`);
  }

  const { error } = await db.from(table).update(updates).eq('id', variantId);

  if (error) {
    throw new Error(
      `Failed to update ${table}.${variantId}: ${error.message ?? 'unknown error'}`
    );
  }

  const verificationColumns = ['id', ...Object.keys(updates)].join(', ');
  const verification = await selectVariantById(
    db,
    variantId,
    verificationColumns
  );
  if (!verification) {
    throw new Error(`Variant ${variantId} disappeared after updating ${table}`);
  }

  for (const [column, expected] of Object.entries(updates)) {
    const actual = verification.data[column];
    if (!valuesMatch(actual, expected)) {
      throw new Error(
        `Variant ${variantId} update verification failed for ${column}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
      );
    }
  }

  return true;
}

/**
 * Best-effort variant update that swallows errors — use in webhook/batch paths
 * where a failure should be logged but not abort the rest of the flow.
 */
export async function updateVariantByIdSafe(
  db: DB,
  variantId: string,
  updates: Record<string, unknown>
): Promise<{ ok: boolean; table?: VariantTableName; error?: string }> {
  try {
    const table = await resolveVariantTable(db, variantId);
    if (!table) return { ok: false, error: 'variant not found' };
    const { error } = await db.from(table).update(updates).eq('id', variantId);
    if (error) return { ok: false, table, error: error.message };
    return { ok: true, table };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'unknown error',
    };
  }
}

/* ── Assets ──────────────────────────────────────────────────────────── */

export async function resolveAssetTable(
  db: DB,
  assetId: string
): Promise<AssetTableName | null> {
  const results = await Promise.all(
    ASSET_TABLES.map(async (table) => {
      const { data, error } = await db
        .from(table)
        .select('id')
        .eq('id', assetId)
        .maybeSingle();
      return !error && data ? table : null;
    })
  );
  return results.find((r) => r !== null) ?? null;
}

export async function selectAssetById(
  db: DB,
  assetId: string,
  selectColumns: string
): Promise<{
  data: Record<string, unknown>;
  table: AssetTableName;
  type: AssetType;
} | null> {
  for (const table of ASSET_TABLES) {
    const { data, error } = await db
      .from(table)
      .select(selectColumns)
      .eq('id', assetId)
      .maybeSingle();
    if (!error && data) {
      return { data, table, type: TYPE_BY_ASSET_TABLE[table] };
    }
  }
  return null;
}

export async function updateAssetById(
  db: DB,
  assetId: string,
  updates: Record<string, unknown>
): Promise<{ ok: boolean; table?: AssetTableName; error?: string }> {
  const table = await resolveAssetTable(db, assetId);
  if (!table) return { ok: false, error: 'asset not found' };
  const { error } = await db.from(table).update(updates).eq('id', assetId);
  if (error) return { ok: false, table, error: error.message };
  return { ok: true, table };
}

/* ── Project-scoped listings ─────────────────────────────────────────── */

type AssetRow = Record<string, unknown> & { id: string };

/**
 * List assets for a project. When `type` is passed, reads only that typed
 * table; otherwise fans out to all three in parallel.
 *
 * Each returned row is tagged with a `type` discriminant.
 */
export async function listAssetsByProject(
  db: DB,
  projectId: string,
  options: {
    type?: AssetType;
    selectColumns: string;
    orderBy?: { column: string; ascending?: boolean };
  }
): Promise<Array<AssetRow & { type: AssetType }>> {
  const types: AssetType[] = options.type
    ? [options.type]
    : ['character', 'location', 'prop'];

  const results = await Promise.all(
    types.map(async (t) => {
      let query = db
        .from(ASSET_TABLE_BY_TYPE[t])
        .select(options.selectColumns)
        .eq('project_id', projectId);
      if (options.orderBy) {
        query = query.order(options.orderBy.column, {
          ascending: options.orderBy.ascending ?? true,
        });
      }
      const { data, error } = await query;
      if (error || !data) return [] as Array<AssetRow & { type: AssetType }>;
      return (data as AssetRow[]).map((row) => ({ ...row, type: t }));
    })
  );

  return results.flat();
}

export type VariantImageMatch = {
  slug: string;
  image_url: string | null;
  type: AssetType;
};

/**
 * Resolve scene-level variant slugs (location / characters / props) to their
 * image URLs, scoped to a project to avoid cross-project slug collisions.
 *
 * Returns a map keyed by slug. Slugs with no image_url are omitted from the
 * returned map (caller can diff against the input to compute missing slugs).
 */
export async function listVariantsBySlugs(
  db: DB,
  projectId: string,
  slugs: {
    locationSlug?: string | null;
    characterSlugs?: string[];
    propSlugs?: string[];
  }
): Promise<Map<string, VariantImageMatch>> {
  const out = new Map<string, VariantImageMatch>();
  const jobs: Array<Promise<void>> = [];

  const locationSlug = slugs.locationSlug ?? null;
  const characterSlugs = (slugs.characterSlugs ?? []).filter(Boolean);
  const propSlugs = (slugs.propSlugs ?? []).filter(Boolean);

  const collect =
    (type: AssetType) =>
    ({
      data,
    }: {
      data: Array<{ slug: string; image_url: string | null }> | null;
    }) => {
      for (const v of data ?? []) {
        if (v.image_url) out.set(v.slug, { ...v, type });
      }
    };

  if (locationSlug) {
    jobs.push(
      db
        .from('location_variants')
        .select('slug, image_url, locations!inner(project_id)')
        .eq('slug', locationSlug)
        .eq('locations.project_id', projectId)
        .then(collect('location'))
    );
  }

  if (characterSlugs.length > 0) {
    jobs.push(
      db
        .from('character_variants')
        .select('slug, image_url, characters!inner(project_id)')
        .in('slug', characterSlugs)
        .eq('characters.project_id', projectId)
        .then(collect('character'))
    );
  }

  if (propSlugs.length > 0) {
    jobs.push(
      db
        .from('prop_variants')
        .select('slug, image_url, props!inner(project_id)')
        .in('slug', propSlugs)
        .eq('props.project_id', projectId)
        .then(collect('prop'))
    );
  }

  await Promise.all(jobs);
  return out;
}

/**
 * List every variant in a project, tagged with its type. Each row carries the
 * parent asset's `project_id` via an `!inner` join so we can filter server-side.
 *
 * `selectColumns` is the variant-side column list (no need to include the
 * embedded parent — the helper adds that automatically).
 */
export async function listAllProjectVariants(
  db: DB,
  projectId: string,
  options: {
    type?: AssetType;
    selectColumns: string;
  }
): Promise<Array<AssetRow & { type: AssetType }>> {
  const types: AssetType[] = options.type
    ? [options.type]
    : ['character', 'location', 'prop'];

  const results = await Promise.all(
    types.map(async (t) => {
      const parentTable = ASSET_TABLE_BY_TYPE[t];
      const { data, error } = await db
        .from(VARIANT_TABLE_BY_TYPE[t])
        .select(`${options.selectColumns}, ${parentTable}!inner(project_id)`)
        .eq(`${parentTable}.project_id`, projectId);
      if (error || !data) return [] as Array<AssetRow & { type: AssetType }>;
      return (data as AssetRow[]).map((row) => ({ ...row, type: t }));
    })
  );

  return results.flat();
}

/* ── Project generation settings (replaces dropped videos.* columns) ── */

export type ProjectVideoSettings = {
  videoModel: string;
  videoResolution: string;
  aspectRatio: string;
  imageModels: Record<string, string> | null;
};

const DEFAULT_VIDEO_SETTINGS: ProjectVideoSettings = {
  videoModel: 'grok-imagine/image-to-video',
  videoResolution: '480p',
  aspectRatio: '9:16',
  imageModels: null,
};

function stringFromSettings(
  settings: Record<string, unknown>,
  key: string
): string {
  const v = settings[key];
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Read `projects.generation_settings` (jsonb) and extract the video/image
 * generation fields that used to live as columns on `videos`.
 * Missing fields fall back to `DEFAULT_VIDEO_SETTINGS`.
 */
export async function getProjectVideoSettings(
  db: DB,
  projectId: string
): Promise<ProjectVideoSettings> {
  const { data } = await db
    .from('projects')
    .select('generation_settings')
    .eq('id', projectId)
    .maybeSingle();

  const settings =
    data?.generation_settings && typeof data.generation_settings === 'object'
      ? (data.generation_settings as Record<string, unknown>)
      : {};

  return {
    videoModel:
      stringFromSettings(settings, 'video_model') ||
      DEFAULT_VIDEO_SETTINGS.videoModel,
    videoResolution:
      stringFromSettings(settings, 'video_resolution') ||
      DEFAULT_VIDEO_SETTINGS.videoResolution,
    aspectRatio:
      stringFromSettings(settings, 'aspect_ratio') ||
      DEFAULT_VIDEO_SETTINGS.aspectRatio,
    imageModels:
      settings.image_models && typeof settings.image_models === 'object'
        ? (settings.image_models as Record<string, string>)
        : null,
  };
}

/**
 * Convenience: resolve a video_id to its project's video settings.
 * Used by routes that have a video but not a project on hand.
 */
export async function getVideoVideoSettings(
  db: DB,
  videoId: string
): Promise<ProjectVideoSettings | null> {
  const { data } = await db
    .from('videos')
    .select('project_id')
    .eq('id', videoId)
    .maybeSingle();
  if (!data?.project_id) return null;
  return getProjectVideoSettings(db, data.project_id as string);
}

export type ProjectTtsSettings = {
  voiceId: string;
  ttsSpeed: number;
  language: string;
};

const DEFAULT_TTS_SETTINGS: ProjectTtsSettings = {
  voiceId: '',
  ttsSpeed: 1.0,
  language: '',
};

/**
 * Read `projects.generation_settings` (jsonb) and extract the TTS fields
 * that used to live as columns on `videos` (voice_id, tts_speed, language).
 */
export async function getProjectTtsSettings(
  db: DB,
  projectId: string
): Promise<ProjectTtsSettings> {
  const { data } = await db
    .from('projects')
    .select('generation_settings')
    .eq('id', projectId)
    .maybeSingle();

  const settings =
    data?.generation_settings && typeof data.generation_settings === 'object'
      ? (data.generation_settings as Record<string, unknown>)
      : {};

  const speedRaw = settings.tts_speed;
  const ttsSpeed =
    typeof speedRaw === 'number' && Number.isFinite(speedRaw)
      ? speedRaw
      : DEFAULT_TTS_SETTINGS.ttsSpeed;

  return {
    voiceId:
      stringFromSettings(settings, 'voice_id') || DEFAULT_TTS_SETTINGS.voiceId,
    ttsSpeed,
    language:
      stringFromSettings(settings, 'language') || DEFAULT_TTS_SETTINGS.language,
  };
}

export type ProjectCreativeSettings = {
  genre: string;
  tone: string;
  bible: string;
  contentMode: string;
  visualStyle: string;
  creativeBrief: string;
  metadata: Record<string, unknown> | null;
};

const DEFAULT_CREATIVE_SETTINGS: ProjectCreativeSettings = {
  genre: '',
  tone: '',
  bible: '',
  contentMode: '',
  visualStyle: '',
  creativeBrief: '',
  metadata: null,
};

/**
 * Read `projects.generation_settings` (jsonb) and extract the creative/writing
 * fields that used to live as columns on `videos` (genre, tone, bible,
 * content_mode, visual_style, creative_brief, metadata).
 */
export async function getProjectCreativeSettings(
  db: DB,
  projectId: string
): Promise<ProjectCreativeSettings> {
  const { data } = await db
    .from('projects')
    .select('generation_settings')
    .eq('id', projectId)
    .maybeSingle();

  const settings =
    data?.generation_settings && typeof data.generation_settings === 'object'
      ? (data.generation_settings as Record<string, unknown>)
      : {};

  return {
    genre:
      stringFromSettings(settings, 'genre') || DEFAULT_CREATIVE_SETTINGS.genre,
    tone:
      stringFromSettings(settings, 'tone') || DEFAULT_CREATIVE_SETTINGS.tone,
    bible:
      stringFromSettings(settings, 'bible') || DEFAULT_CREATIVE_SETTINGS.bible,
    contentMode:
      stringFromSettings(settings, 'content_mode') ||
      DEFAULT_CREATIVE_SETTINGS.contentMode,
    visualStyle:
      stringFromSettings(settings, 'visual_style') ||
      DEFAULT_CREATIVE_SETTINGS.visualStyle,
    creativeBrief:
      stringFromSettings(settings, 'creative_brief') ||
      DEFAULT_CREATIVE_SETTINGS.creativeBrief,
    metadata:
      settings.metadata && typeof settings.metadata === 'object'
        ? (settings.metadata as Record<string, unknown>)
        : null,
  };
}

/**
 * Helper for flattening `scenes.structured_prompt` jsonb[] → string.
 * Collects all string values from each jsonb object, comma-joined per shot,
 * newline-joined across shots. Empty/null-safe.
 */
export function flattenStructuredPrompt(structuredPrompt: unknown): string {
  if (!Array.isArray(structuredPrompt)) return '';
  return structuredPrompt
    .map((shot) => {
      if (!shot || typeof shot !== 'object') return '';
      return Object.values(shot as Record<string, unknown>)
        .filter(
          (v): v is string => typeof v === 'string' && v.trim().length > 0
        )
        .join(', ');
    })
    .filter((line) => line.length > 0)
    .join('\n');
}
