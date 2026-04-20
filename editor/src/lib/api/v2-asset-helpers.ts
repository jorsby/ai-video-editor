import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import { slugify as toSlug } from '@/lib/utils/slugify';
import {
  queueImageTask,
  getT2iModel,
  getI2iModel,
  getImageAspectRatio,
  getImageResolution,
} from '@/lib/image-provider';
import type { ImageModelId } from '@/lib/kie-image';
import { resolveWebhookBaseUrl } from '@/lib/webhook-base-url';
import {
  ASSET_FK_BY_TYPE,
  ASSET_TABLE_BY_TYPE,
  VARIANT_TABLE_BY_TYPE,
  getProjectVideoSettings,
  resolveAssetTable,
  resolveVariantTable,
  assetTypeFromAssetTable,
  assetTypeFromVariantTable,
  updateVariantByIdSafe,
} from '@/lib/api/variant-table-resolver';
import {
  CharacterSPSchema,
  CharacterSPPartialSchema,
  LocationSPSchema,
  LocationSPPartialSchema,
  PropSPSchema,
  PropSPPartialSchema,
  EXPECTED_CHARACTER_SP,
  EXPECTED_LOCATION_SP,
  EXPECTED_PROP_SP,
  validateStructuredPrompt,
  type CharacterSP,
  type LocationSP,
  type PropSP,
} from '@/lib/api/structured-prompt-schemas';

export type AssetType = 'character' | 'location' | 'prop';
export type AssetRouteScope = 'project' | 'video';

/* ── Shape shims (backward-compat with callers expecting v1 columns) ── */

type TypedVariantRow = {
  id: string;
  name: string | null;
  slug: string;
  structured_prompt: Record<string, unknown> | null;
  use_case: string | null;
  image_url: string | null;
  is_main: boolean | null;
  image_task_id: string | null;
  image_gen_status: string | null;
  generation_metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  [fk: string]: unknown;
};

type TypedAssetRow = {
  id: string;
  project_id: string;
  video_id: string | null;
  name: string;
  slug: string;
  structured_prompt: Record<string, unknown> | null;
  use_case: string | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
};

type LegacyVariant = {
  id: string;
  asset_id: string;
  name: string | null;
  slug: string;
  prompt: string | null;
  image_url: string | null;
  is_main: boolean;
  reasoning: string;
  image_task_id: string | null;
  image_gen_status: string | null;
  created_at: string;
  updated_at: string;
};

type LegacyAsset = {
  id: string;
  project_id: string;
  type: AssetType;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
  project_asset_variants?: LegacyVariant[];
};

/* ── Legacy fallback reader (for rows written before typed shape landed) ── */

function flattenPromptFromStructured(
  sp: Record<string, unknown> | null | undefined
): string | null {
  if (!sp || typeof sp !== 'object') return null;
  const directPrompt = sp.prompt;
  if (typeof directPrompt === 'string' && directPrompt.trim()) {
    return directPrompt.trim();
  }
  const parts = Object.values(sp)
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim());
  return parts.length > 0 ? parts.join('. ') : null;
}

/* ── Forgiving typed readers (compose-time, lenient about extras/missing) ── */

function readCharacterPartial(sp: unknown): Partial<CharacterSP> | null {
  if (!sp || typeof sp !== 'object' || Array.isArray(sp)) return null;
  const r = sp as Record<string, unknown>;
  const out: Partial<CharacterSP> = {};
  if (typeof r.age === 'number' && Number.isFinite(r.age)) out.age = r.age;
  if (typeof r.gender === 'string' && r.gender.trim())
    out.gender = r.gender.trim();
  if (typeof r.era === 'string' && r.era.trim()) out.era = r.era.trim();
  if (typeof r.appearance === 'string' && r.appearance.trim())
    out.appearance = r.appearance.trim();
  if (typeof r.outfit === 'string' && r.outfit.trim())
    out.outfit = r.outfit.trim();
  if (typeof r.extras === 'string' && r.extras.trim())
    out.extras = r.extras.trim();
  return out;
}

function readLocationPartial(sp: unknown): Partial<LocationSP> | null {
  if (!sp || typeof sp !== 'object' || Array.isArray(sp)) return null;
  const r = sp as Record<string, unknown>;
  const out: Partial<LocationSP> = {};
  if (typeof r.setting_type === 'string' && r.setting_type.trim())
    out.setting_type = r.setting_type.trim();
  if (typeof r.time_of_day === 'string' && r.time_of_day.trim())
    out.time_of_day = r.time_of_day.trim();
  if (typeof r.era === 'string' && r.era.trim()) out.era = r.era.trim();
  if (typeof r.extras === 'string' && r.extras.trim())
    out.extras = r.extras.trim();
  return out;
}

function readPropPartial(sp: unknown): Partial<PropSP> | null {
  if (!sp || typeof sp !== 'object' || Array.isArray(sp)) return null;
  const r = sp as Record<string, unknown>;
  const out: Partial<PropSP> = {};
  if (typeof r.prompt === 'string' && r.prompt.trim())
    out.prompt = r.prompt.trim();
  if (typeof r.brand === 'string' && r.brand.trim()) out.brand = r.brand.trim();
  return out;
}

/* ── Prefix/suffix constants ─────────────────────────────────────────── */

const ASSET_IMAGE_PROMPT_PREFIX: Record<AssetType, string> = {
  character:
    'Full-body head-to-toe character shot, standing, front-facing, neutral background, studio lighting',
  location:
    'Wide establishing shot, cinematic composition, atmospheric lighting',
  prop: 'Clean product shot, centered, neutral background, studio lighting',
};

const ASSET_IMAGE_PROMPT_SUFFIX =
  'Absolutely no text, no words, no letters, no writing, no labels';

/* ── Typed composers (typed shape → provider prompt string) ─────────── */

function composeCharacterBody(
  parentSp: unknown,
  variantSp: unknown
): string | null {
  const p = readCharacterPartial(parentSp);
  if (!p) return null;
  const v = readCharacterPartial(variantSp) ?? {};
  const age = v.age ?? p.age;
  const gender = v.gender ?? p.gender;
  const era = v.era ?? p.era;
  const appearance = v.appearance ?? p.appearance;
  const outfit = v.outfit ?? p.outfit;
  const extras = v.extras ?? p.extras;
  if (age == null || !gender || !era || !appearance || !outfit) return null;
  const core = `A ${age}-year-old ${gender} from ${era}. ${appearance}. Wearing ${outfit}`;
  return extras ? `${core}. ${extras}` : core;
}

function composeLocationBody(
  parentSp: unknown,
  variantSp: unknown
): string | null {
  const p = readLocationPartial(parentSp);
  if (!p) return null;
  const v = readLocationPartial(variantSp) ?? {};
  const settingType = v.setting_type ?? p.setting_type;
  const timeOfDay = v.time_of_day ?? p.time_of_day;
  const era = v.era ?? p.era;
  const extras = v.extras ?? p.extras;
  if (!settingType || !timeOfDay || !era) return null;
  const core = `${settingType}, ${timeOfDay}, ${era}`;
  return extras ? `${core}. ${extras}` : core;
}

function composePropBody(parentSp: unknown, variantSp: unknown): string | null {
  const p = readPropPartial(parentSp);
  if (!p) return null;
  const v = readPropPartial(variantSp) ?? {};
  const prompt = v.prompt ?? p.prompt;
  const brand = v.brand ?? p.brand;
  if (!prompt) return null;
  return brand ? `${prompt}. Brand: ${brand}` : prompt;
}

/**
 * Single source of truth for asset image prompts.
 *
 * Composes `<type prefix>. <typed body>. <safety suffix>` using typed fields
 * with variant-overlays-parent semantics. Falls back to legacy flatten for
 * rows written before the typed shape landed — so legacy assets still render
 * a prompt instead of returning empty.
 */
export function buildAssetImagePrompt(
  type: AssetType,
  assetStructuredPrompt: Record<string, unknown> | null | undefined,
  variantStructuredPrompt: Record<string, unknown> | null | undefined
): string {
  let body: string | null;
  switch (type) {
    case 'character':
      body = composeCharacterBody(
        assetStructuredPrompt,
        variantStructuredPrompt
      );
      break;
    case 'location':
      body = composeLocationBody(
        assetStructuredPrompt,
        variantStructuredPrompt
      );
      break;
    case 'prop':
      body = composePropBody(assetStructuredPrompt, variantStructuredPrompt);
      break;
  }

  if (!body) {
    const assetDesc = flattenPromptFromStructured(assetStructuredPrompt);
    const variantDesc = flattenPromptFromStructured(variantStructuredPrompt);
    const legacy = [assetDesc, variantDesc].filter(Boolean).join('. ');
    body = legacy || null;
  }

  const parts: string[] = [ASSET_IMAGE_PROMPT_PREFIX[type]];
  if (body) parts.push(body);
  parts.push(ASSET_IMAGE_PROMPT_SUFFIX);
  return parts.join('. ');
}

function toLegacyVariant(
  row: TypedVariantRow,
  _type: AssetType,
  assetId: string
): LegacyVariant {
  const sp = row.structured_prompt;
  const reasoning =
    sp && typeof sp === 'object' && typeof sp.reasoning === 'string'
      ? (sp.reasoning as string)
      : '';
  return {
    id: row.id,
    asset_id: assetId,
    name: row.name,
    slug: row.slug,
    prompt: flattenPromptFromStructured(row.structured_prompt),
    image_url: row.image_url,
    is_main: !!row.is_main,
    reasoning,
    image_task_id: row.image_task_id,
    image_gen_status: row.image_gen_status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toLegacyAsset(
  row: TypedAssetRow,
  type: AssetType,
  variants: TypedVariantRow[] | null | undefined
): LegacyAsset {
  return {
    id: row.id,
    project_id: row.project_id,
    type,
    name: row.name,
    slug: row.slug,
    description: row.use_case ?? null,
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
    project_asset_variants: (variants ?? []).map((v) =>
      toLegacyVariant(v, type, row.id)
    ),
  };
}

const TYPED_ASSET_SELECT =
  'id, project_id, video_id, name, slug, structured_prompt, use_case, sort_order, created_at, updated_at';

const TYPED_VARIANT_SELECT =
  'id, name, slug, structured_prompt, use_case, image_url, is_main, image_task_id, image_gen_status, generation_metadata, created_at, updated_at';

/* ── Utility ─────────────────────────────────────────────────────────── */

function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

type DB = any;

type AutoGenerateVariant = {
  id: string;
  assetStructuredPrompt: Record<string, unknown> | null;
  variantStructuredPrompt: Record<string, unknown> | null;
};

async function autoGenerateImages(
  db: DB,
  type: AssetType,
  variants: AutoGenerateVariant[],
  req: NextRequest,
  aspectRatio = '9:16',
  model?: ImageModelId,
  inputUrls?: string[],
  resolution = '2K'
): Promise<void> {
  const webhookBase = resolveWebhookBaseUrl(req);
  if (!webhookBase) return;

  for (const variant of variants) {
    const prompt = buildAssetImagePrompt(
      type,
      variant.assetStructuredPrompt,
      variant.variantStructuredPrompt
    );
    try {
      const webhookUrl = new URL(`${webhookBase}/api/webhook/kieai`);
      webhookUrl.searchParams.set('step', 'VideoAssetImage');
      webhookUrl.searchParams.set('variant_id', variant.id);

      const queued = await queueImageTask({
        prompt,
        webhookUrl: webhookUrl.toString(),
        model,
        inputUrls,
        aspectRatio,
        resolution,
      });

      await updateVariantByIdSafe(db, variant.id, {
        image_gen_status: 'generating',
        image_task_id: queued.requestId,
      });
    } catch (err) {
      console.error(
        `[auto-generate] Failed for variant ${variant.id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
}

type ScopeResolution =
  | { projectId: string; videoId: string | null; error?: undefined }
  | { projectId?: undefined; videoId?: undefined; error: NextResponse };

async function resolveOwnedProjectId(
  db: DB,
  userId: string,
  id: string,
  scope: AssetRouteScope
): Promise<ScopeResolution> {
  if (scope === 'project') {
    const { data: project, error } = await db
      .from('projects')
      .select('id, user_id')
      .eq('id', id)
      .maybeSingle();

    if (error || !project) {
      return {
        error: NextResponse.json(
          { error: 'Project not found' },
          { status: 404 }
        ),
      };
    }

    if (project.user_id !== userId) {
      return {
        error: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }),
      };
    }

    return { projectId: project.id as string, videoId: null };
  }

  const { data: video, error: videoError } = await db
    .from('videos')
    .select('id, project_id')
    .eq('id', id)
    .maybeSingle();

  if (videoError || !video) {
    return {
      error: NextResponse.json({ error: 'Video not found' }, { status: 404 }),
    };
  }

  if (typeof video.project_id !== 'string' || !video.project_id.trim()) {
    return {
      error: NextResponse.json({ error: 'Video not found' }, { status: 404 }),
    };
  }

  const { data: project, error: projectError } = await db
    .from('projects')
    .select('id, user_id')
    .eq('id', video.project_id)
    .maybeSingle();

  if (projectError || !project) {
    return {
      error: NextResponse.json({ error: 'Project not found' }, { status: 404 }),
    };
  }

  if (project.user_id !== userId) {
    return {
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }),
    };
  }

  return {
    projectId: project.id as string,
    videoId: video.id as string,
  };
}

async function getOwnedAsset(
  db: DB,
  userId: string,
  assetId: string,
  expectedType?: AssetType
): Promise<{ asset: LegacyAsset; type: AssetType; row: TypedAssetRow } | null> {
  const table = expectedType
    ? ASSET_TABLE_BY_TYPE[expectedType]
    : await resolveAssetTable(db, assetId);
  if (!table) return null;

  const { data: row, error } = await db
    .from(table)
    .select(TYPED_ASSET_SELECT)
    .eq('id', assetId)
    .maybeSingle();
  if (error || !row) return null;

  const { data: project } = await db
    .from('projects')
    .select('id')
    .eq('id', row.project_id)
    .eq('user_id', userId)
    .maybeSingle();

  if (!project) return null;

  const type = assetTypeFromAssetTable(table);
  return {
    asset: toLegacyAsset(row as TypedAssetRow, type, []),
    type,
    row: row as TypedAssetRow,
  };
}

async function getOwnedVariant(
  db: DB,
  userId: string,
  variantId: string
): Promise<{
  variant: LegacyVariant;
  asset: LegacyAsset;
  type: AssetType;
  variantTable: string;
  parentFk: string;
} | null> {
  const variantTable = await resolveVariantTable(db, variantId);
  if (!variantTable) return null;

  const type = assetTypeFromVariantTable(variantTable);
  const parentFk = ASSET_FK_BY_TYPE[type];

  const { data: variantRow, error: variantError } = await db
    .from(variantTable)
    .select(`${TYPED_VARIANT_SELECT}, ${parentFk}`)
    .eq('id', variantId)
    .maybeSingle();
  if (variantError || !variantRow) return null;

  const parentId = variantRow[parentFk] as string | null;
  if (!parentId) return null;

  const owned = await getOwnedAsset(db, userId, parentId, type);
  if (!owned) return null;

  return {
    variant: toLegacyVariant(variantRow as TypedVariantRow, type, parentId),
    asset: owned.asset,
    type,
    variantTable,
    parentFk,
  };
}

/* ── Asset list ─────────────────────────────────────────────────────── */

export async function getAssetsByType(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
  type: AssetType,
  options?: { scope?: AssetRouteScope }
) {
  const user = await getUserOrApiKey(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  const db = createServiceClient('studio');
  const resolved = await resolveOwnedProjectId(
    db,
    user.id,
    id,
    options?.scope ?? 'project'
  );

  if (resolved.error) return resolved.error;

  const parentTable = ASSET_TABLE_BY_TYPE[type];
  const variantTable = VARIANT_TABLE_BY_TYPE[type];

  const { data, error } = await db
    .from(parentTable)
    .select(`${TYPED_ASSET_SELECT}, ${variantTable}(${TYPED_VARIANT_SELECT})`)
    .eq('project_id', resolved.projectId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: `Failed to list ${type}s` },
      { status: 500 }
    );
  }

  const legacy = (data ?? []).map(
    (row: TypedAssetRow & Record<string, unknown>) =>
      toLegacyAsset(row, type, row[variantTable] as TypedVariantRow[] | null)
  );
  return NextResponse.json(legacy);
}

/* ── Asset batch create ─────────────────────────────────────────────── */

export async function postAssetsByType(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
  type: AssetType,
  options?: { scope?: AssetRouteScope }
) {
  const user = await getUserOrApiKey(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  if (!Array.isArray(body) || body.length === 0) {
    return NextResponse.json(
      { error: 'Body must be a non-empty array' },
      { status: 400 }
    );
  }

  const db = createServiceClient('studio');
  const resolved = await resolveOwnedProjectId(
    db,
    user.id,
    id,
    options?.scope ?? 'project'
  );

  if (resolved.error) return resolved.error;

  const parentTable = ASSET_TABLE_BY_TYPE[type];
  const variantTable = VARIANT_TABLE_BY_TYPE[type];
  const parentFk = ASSET_FK_BY_TYPE[type];
  const projectId = resolved.projectId;

  const { data: maxRow } = await db
    .from(parentTable)
    .select('sort_order')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  let nextSort =
    typeof maxRow?.sort_order === 'number' ? maxRow.sort_order + 1 : 0;

  const strictSchema =
    type === 'character'
      ? CharacterSPSchema
      : type === 'location'
        ? LocationSPSchema
        : PropSPSchema;
  const expectedMap =
    type === 'character'
      ? EXPECTED_CHARACTER_SP
      : type === 'location'
        ? EXPECTED_LOCATION_SP
        : EXPECTED_PROP_SP;

  const rows: Array<{
    project_id: string;
    video_id: string | null;
    name: string;
    slug: string;
    use_case: string | null;
    sort_order: number;
    structured_prompt: Record<string, unknown>;
  }> = [];

  for (let i = 0; i < body.length; i++) {
    const item = body[i];
    const name = typeof item?.name === 'string' ? item.name.trim() : '';
    if (!name) {
      return NextResponse.json(
        { error: `assets[${i}]: name must be non-empty` },
        { status: 400 }
      );
    }

    const slug =
      typeof item?.slug === 'string' && item.slug.trim()
        ? item.slug.trim()
        : toSlug(name);

    if (!slug) {
      return NextResponse.json(
        { error: `assets[${i}]: could not generate slug for "${name}"` },
        { status: 400 }
      );
    }

    // Strip route-level keys before validating the typed structured_prompt.
    const {
      name: _n,
      slug: _s,
      description: _d,
      ...sp
    } = (item ?? {}) as Record<string, unknown>;

    const validation = validateStructuredPrompt(
      strictSchema,
      sp,
      expectedMap,
      `assets[${i}].structured_prompt`
    );
    if (!validation.ok) return validation.response;

    rows.push({
      project_id: projectId,
      video_id: resolved.videoId,
      name,
      slug,
      use_case: toNullableString(item?.description) ?? '',
      sort_order: nextSort++,
      structured_prompt: validation.value as Record<string, unknown>,
    });
  }

  const { data: assets, error: insertErr } = await db
    .from(parentTable)
    .insert(rows)
    .select(TYPED_ASSET_SELECT);

  if (insertErr) {
    if (insertErr.code === '23505') {
      return NextResponse.json(
        { error: 'One or more slugs already exist' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: `Failed to create ${type}s`, detail: insertErr.message },
      { status: 500 }
    );
  }

  const typedAssets = (assets ?? []) as TypedAssetRow[];
  // Main variant starts with empty structured_prompt — variants overlay the
  // parent's typed fields; the main variant has no overrides by default.
  const mainVariants = typedAssets.map((asset) => ({
    [parentFk]: asset.id,
    name: 'Main',
    slug: `${asset.slug}-main`,
    is_main: true,
    structured_prompt: {},
  }));

  let insertedVariants: AutoGenerateVariant[] = [];
  if (mainVariants.length > 0) {
    const { data: variantRows } = await db
      .from(variantTable)
      .insert(mainVariants)
      .select(`id, ${parentFk}, structured_prompt`);

    const assetSpById = new Map<string, Record<string, unknown> | null>(
      typedAssets.map((a) => [a.id, a.structured_prompt ?? null])
    );

    insertedVariants = ((variantRows ?? []) as TypedVariantRow[]).map((v) => ({
      id: v.id,
      assetStructuredPrompt: assetSpById.get(v[parentFk] as string) ?? null,
      variantStructuredPrompt: v.structured_prompt ?? null,
    }));
  }

  if (insertedVariants.length > 0) {
    const settings = await getProjectVideoSettings(db, projectId);
    const imgModels = settings.imageModels;
    const t2iModel = getT2iModel(imgModels, type);
    const arForType = getImageAspectRatio(
      imgModels,
      type,
      false,
      settings.aspectRatio
    );
    const resForType = getImageResolution(imgModels, type, false);

    autoGenerateImages(
      db,
      type,
      insertedVariants,
      req,
      arForType,
      t2iModel,
      undefined,
      resForType
    ).catch(() => {});
  }

  const ids = (assets ?? []).map((asset: { id: string }) => asset.id);
  const { data: full } = await db
    .from(parentTable)
    .select(`${TYPED_ASSET_SELECT}, ${variantTable}(${TYPED_VARIANT_SELECT})`)
    .in('id', ids)
    .order('sort_order', { ascending: true });

  const legacy = (
    (full ?? assets ?? []) as Array<TypedAssetRow & Record<string, unknown>>
  ).map((row) =>
    toLegacyAsset(row, type, row[variantTable] as TypedVariantRow[] | null)
  );

  return NextResponse.json(legacy, { status: 201 });
}

/* ── Asset PATCH ────────────────────────────────────────────────────── */

export async function patchAssetByType(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
  type: AssetType
) {
  const user = await getUserOrApiKey(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};

  if (body?.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json(
        { error: 'name must be non-empty' },
        { status: 400 }
      );
    }

    updates.name = name;
    if (body?.slug === undefined) updates.slug = toSlug(name);
  }

  if (body?.slug !== undefined) {
    const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
    if (!slug) {
      return NextResponse.json(
        { error: 'slug must be non-empty' },
        { status: 400 }
      );
    }

    updates.slug = slug;
  }

  if (body?.description !== undefined) {
    updates.use_case = toNullableString(body.description);
  }

  if (body?.sort_order !== undefined) {
    if (typeof body.sort_order !== 'number') {
      return NextResponse.json(
        { error: 'sort_order must be a number' },
        { status: 400 }
      );
    }

    updates.sort_order = body.sort_order;
  }

  const db = createServiceClient('studio');
  const owned = await getOwnedAsset(db, user.id, id, type);
  if (!owned) {
    return NextResponse.json({ error: `${type} not found` }, { status: 404 });
  }

  // Typed-field patches: strip route keys, merge with existing structured_prompt,
  // validate merged object against strict schema (rejects unsetting required fields).
  const {
    name: _n,
    slug: _s,
    description: _d,
    sort_order: _o,
    structured_prompt: _sp,
    ...spPatch
  } = (body ?? {}) as Record<string, unknown>;

  if (Object.keys(spPatch).length > 0) {
    const existing =
      owned.row.structured_prompt &&
      typeof owned.row.structured_prompt === 'object' &&
      !Array.isArray(owned.row.structured_prompt)
        ? (owned.row.structured_prompt as Record<string, unknown>)
        : {};
    const merged: Record<string, unknown> = { ...existing };
    for (const [k, v] of Object.entries(spPatch)) {
      if (v === null) delete merged[k];
      else merged[k] = v;
    }
    const strictSchema =
      type === 'character'
        ? CharacterSPSchema
        : type === 'location'
          ? LocationSPSchema
          : PropSPSchema;
    const expectedMap =
      type === 'character'
        ? EXPECTED_CHARACTER_SP
        : type === 'location'
          ? EXPECTED_LOCATION_SP
          : EXPECTED_PROP_SP;

    const validation = validateStructuredPrompt(
      strictSchema,
      merged,
      expectedMap,
      'structured_prompt'
    );
    if (!validation.ok) return validation.response;
    updates.structured_prompt = validation.value as Record<string, unknown>;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const parentTable = ASSET_TABLE_BY_TYPE[type];
  const { data, error } = await db
    .from(parentTable)
    .update(updates)
    .eq('id', id)
    .select(TYPED_ASSET_SELECT)
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'Slug already exists' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: `Failed to update ${type}` },
      { status: 500 }
    );
  }

  return NextResponse.json(toLegacyAsset(data as TypedAssetRow, type, []));
}

/* ── Asset DELETE ────────────────────────────────────────────────────── */

export async function deleteAssetByType(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
  type: AssetType
) {
  const user = await getUserOrApiKey(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  const db = createServiceClient('studio');
  const owned = await getOwnedAsset(db, user.id, id, type);

  if (!owned) {
    return NextResponse.json({ error: `${type} not found` }, { status: 404 });
  }

  const parentTable = ASSET_TABLE_BY_TYPE[type];
  const { error } = await db.from(parentTable).delete().eq('id', id);
  if (error) {
    return NextResponse.json(
      { error: `Failed to delete ${type}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ id, deleted: true });
}

/* ── Variant list ───────────────────────────────────────────────────── */

export async function getVariantsByAsset(
  req: NextRequest,
  context: { params: Promise<{ assetId: string }> }
) {
  const user = await getUserOrApiKey(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { assetId } = await context.params;
  const db = createServiceClient('studio');
  const owned = await getOwnedAsset(db, user.id, assetId);

  if (!owned) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
  }

  const variantTable = VARIANT_TABLE_BY_TYPE[owned.type];
  const parentFk = ASSET_FK_BY_TYPE[owned.type];

  const { data, error } = await db
    .from(variantTable)
    .select(TYPED_VARIANT_SELECT)
    .eq(parentFk, assetId)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: 'Failed to list variants' },
      { status: 500 }
    );
  }

  const legacy = ((data ?? []) as TypedVariantRow[]).map((v) =>
    toLegacyVariant(v, owned.type, assetId)
  );
  return NextResponse.json(legacy);
}

/* ── Variant batch create ───────────────────────────────────────────── */

export async function postVariantsByAsset(
  req: NextRequest,
  context: { params: Promise<{ assetId: string }> }
) {
  const user = await getUserOrApiKey(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { assetId } = await context.params;
  const body = await req.json().catch(() => null);
  const items = Array.isArray(body) ? body : body ? [body] : [];

  if (items.length === 0) {
    return NextResponse.json(
      { error: 'Body must be a non-empty array of variants' },
      { status: 400 }
    );
  }

  const db = createServiceClient('studio');
  const owned = await getOwnedAsset(db, user.id, assetId);

  if (!owned) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
  }

  const variantTable = VARIANT_TABLE_BY_TYPE[owned.type];
  const parentFk = ASSET_FK_BY_TYPE[owned.type];

  const partialSchema =
    owned.type === 'character'
      ? CharacterSPPartialSchema
      : owned.type === 'location'
        ? LocationSPPartialSchema
        : PropSPPartialSchema;
  const expectedMap =
    owned.type === 'character'
      ? EXPECTED_CHARACTER_SP
      : owned.type === 'location'
        ? EXPECTED_LOCATION_SP
        : EXPECTED_PROP_SP;

  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const name = typeof item?.name === 'string' ? item.name.trim() : '';
    if (!name) {
      return NextResponse.json(
        { error: `variants[${i}]: name must be non-empty` },
        { status: 400 }
      );
    }

    const slug =
      typeof item?.slug === 'string' && item.slug.trim()
        ? item.slug.trim()
        : toSlug(name);

    // Variants are partial overlays — strip route-level keys, rest is typed SP.
    const {
      name: _n,
      slug: _s,
      is_main: _im,
      image_url: _iu,
      ...sp
    } = (item ?? {}) as Record<string, unknown>;

    const validation = validateStructuredPrompt(
      partialSchema,
      sp,
      expectedMap,
      `variants[${i}].structured_prompt`
    );
    if (!validation.ok) return validation.response;

    rows.push({
      [parentFk]: assetId,
      name,
      slug,
      is_main: false,
      structured_prompt: validation.value as Record<string, unknown>,
    });
  }

  const { data, error } = await db
    .from(variantTable)
    .insert(rows)
    .select(TYPED_VARIANT_SELECT);

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'Variant slug already exists' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create variant(s)' },
      { status: 500 }
    );
  }

  const assetSp = (owned.row.structured_prompt ?? null) as Record<
    string,
    unknown
  > | null;
  const created: AutoGenerateVariant[] = (
    (data ?? []) as TypedVariantRow[]
  ).map((v) => ({
    id: v.id,
    assetStructuredPrompt: assetSp,
    variantStructuredPrompt: v.structured_prompt ?? null,
  }));

  if (created.length > 0) {
    const settings = await getProjectVideoSettings(db, owned.asset.project_id);
    const imageModels = settings.imageModels;
    const assetType = owned.type;

    // Check if main variant has an image for i2i
    const { data: mainVariant } = await db
      .from(variantTable)
      .select('image_url')
      .eq(parentFk, assetId)
      .eq('is_main', true)
      .maybeSingle();

    let model: ImageModelId;
    let inputUrls: string[] | undefined;
    let isI2i = false;
    if (mainVariant?.image_url) {
      model = getI2iModel(imageModels, assetType);
      inputUrls = [mainVariant.image_url as string];
      isI2i = true;
    } else {
      model = getT2iModel(imageModels, assetType);
    }

    const variantAr = getImageAspectRatio(
      imageModels,
      assetType,
      isI2i,
      settings.aspectRatio
    );
    const variantRes = getImageResolution(imageModels, assetType, isI2i);

    autoGenerateImages(
      db,
      assetType,
      created,
      req,
      variantAr,
      model,
      inputUrls,
      variantRes
    ).catch(() => {});
  }

  const legacy = ((data ?? []) as TypedVariantRow[]).map((v) =>
    toLegacyVariant(v, owned.type, assetId)
  );
  return NextResponse.json(legacy, { status: 201 });
}

/* ── Variant PATCH ──────────────────────────────────────────────────── */

export async function patchVariantById(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getUserOrApiKey(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};

  const db = createServiceClient('studio');
  const owned = await getOwnedVariant(db, user.id, id);
  if (!owned) {
    return NextResponse.json({ error: 'Variant not found' }, { status: 404 });
  }

  // Pull existing structured_prompt so prompt/reasoning patches merge in
  const { data: existingRow } = await db
    .from(owned.variantTable)
    .select('structured_prompt')
    .eq('id', id)
    .maybeSingle();

  const existingSP: Record<string, unknown> =
    existingRow &&
    typeof existingRow.structured_prompt === 'object' &&
    existingRow.structured_prompt
      ? { ...(existingRow.structured_prompt as Record<string, unknown>) }
      : {};

  if (body?.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json(
        { error: 'name must be non-empty' },
        { status: 400 }
      );
    }
    updates.name = name;
    if (body?.slug === undefined) updates.slug = toSlug(name);
  }

  if (body?.slug !== undefined) {
    updates.slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  }

  // Typed-field patches for variants: strip route-level keys, merge with
  // existing structured_prompt, validate merged against PARTIAL schema.
  const {
    name: _n,
    slug: _s,
    is_main: _im,
    image_url: _iu,
    structured_prompt: _sp,
    ...spPatch
  } = (body ?? {}) as Record<string, unknown>;

  if (Object.keys(spPatch).length > 0) {
    for (const [k, v] of Object.entries(spPatch)) {
      if (v === null) delete existingSP[k];
      else existingSP[k] = v;
    }
    const partialSchema =
      owned.type === 'character'
        ? CharacterSPPartialSchema
        : owned.type === 'location'
          ? LocationSPPartialSchema
          : PropSPPartialSchema;
    const expectedMap =
      owned.type === 'character'
        ? EXPECTED_CHARACTER_SP
        : owned.type === 'location'
          ? EXPECTED_LOCATION_SP
          : EXPECTED_PROP_SP;

    const validation = validateStructuredPrompt(
      partialSchema,
      existingSP,
      expectedMap,
      'structured_prompt'
    );
    if (!validation.ok) return validation.response;
    updates.structured_prompt =
      Object.keys(validation.value as Record<string, unknown>).length > 0
        ? (validation.value as Record<string, unknown>)
        : {};
  }

  if (body?.image_url !== undefined) {
    updates.image_url = toNullableString(body.image_url);
  }

  if (body?.is_main !== undefined) {
    if (typeof body.is_main !== 'boolean') {
      return NextResponse.json(
        { error: 'is_main must be boolean' },
        { status: 400 }
      );
    }

    updates.is_main = body.is_main;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  if (updates.is_main === true) {
    await db
      .from(owned.variantTable)
      .update({ is_main: false })
      .eq(owned.parentFk, owned.variant.asset_id)
      .eq('is_main', true)
      .neq('id', id);
  }

  const { data, error } = await db
    .from(owned.variantTable)
    .update(updates)
    .eq('id', id)
    .select(TYPED_VARIANT_SELECT)
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'Variant slug already exists' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to update variant' },
      { status: 500 }
    );
  }

  return NextResponse.json(
    toLegacyVariant(data as TypedVariantRow, owned.type, owned.variant.asset_id)
  );
}

/* ── Variant DELETE ─────────────────────────────────────────────────── */

export async function deleteVariantById(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getUserOrApiKey(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  const db = createServiceClient('studio');
  const owned = await getOwnedVariant(db, user.id, id);

  if (!owned) {
    return NextResponse.json({ error: 'Variant not found' }, { status: 404 });
  }

  const { error } = await db.from(owned.variantTable).delete().eq('id', id);

  if (error) {
    return NextResponse.json(
      { error: 'Failed to delete variant' },
      { status: 500 }
    );
  }

  return NextResponse.json({ id, deleted: true });
}
