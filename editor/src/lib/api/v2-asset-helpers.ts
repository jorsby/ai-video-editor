import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import { slugify as toSlug } from '@/lib/utils/slugify';

export type AssetType = 'character' | 'location' | 'prop';
export type AssetRouteScope = 'project' | 'series';

const ASSET_SELECT =
  'id, project_id, type, name, slug, description, sort_order, created_at, updated_at';
const VARIANT_SELECT =
  'id, asset_id, name, slug, prompt, image_url, is_main, where_to_use, reasoning, image_task_id, image_gen_status, created_at, updated_at';

function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// biome-ignore lint/suspicious/noExplicitAny: Supabase client type
type DB = any;

type ScopeResolution =
  | {
      projectId: string;
      error?: undefined;
    }
  | {
      projectId?: undefined;
      error: NextResponse;
    };

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

    return { projectId: project.id as string };
  }

  const { data: series, error: seriesError } = await db
    .from('series')
    .select('id, project_id')
    .eq('id', id)
    .maybeSingle();

  if (seriesError || !series) {
    return {
      error: NextResponse.json({ error: 'Series not found' }, { status: 404 }),
    };
  }

  if (typeof series.project_id !== 'string' || !series.project_id.trim()) {
    return {
      error: NextResponse.json({ error: 'Series not found' }, { status: 404 }),
    };
  }

  const { data: project, error: projectError } = await db
    .from('projects')
    .select('id, user_id')
    .eq('id', series.project_id)
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

  return { projectId: project.id as string };
}

async function getOwnedAsset(
  db: DB,
  userId: string,
  assetId: string,
  expectedType?: AssetType
) {
  const { data: asset, error } = await db
    .from('project_assets')
    .select(ASSET_SELECT)
    .eq('id', assetId)
    .maybeSingle();

  if (error || !asset) return null;
  if (expectedType && asset.type !== expectedType) return null;

  const { data: project } = await db
    .from('projects')
    .select('id')
    .eq('id', asset.project_id)
    .eq('user_id', userId)
    .maybeSingle();

  if (!project) return null;
  return asset;
}

async function getOwnedVariant(db: DB, userId: string, variantId: string) {
  const { data: variant, error } = await db
    .from('project_asset_variants')
    .select(VARIANT_SELECT)
    .eq('id', variantId)
    .maybeSingle();

  if (error || !variant) return null;

  const asset = await getOwnedAsset(db, userId, variant.asset_id);
  if (!asset) return null;

  return { variant, asset };
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

  const { data, error } = await db
    .from('project_assets')
    .select(`${ASSET_SELECT}, project_asset_variants(${VARIANT_SELECT})`)
    .eq('project_id', resolved.projectId)
    .eq('type', type)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: `Failed to list ${type}s` },
      { status: 500 }
    );
  }

  return NextResponse.json(data ?? []);
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

  const projectId = resolved.projectId;

  const { data: maxRow } = await db
    .from('project_assets')
    .select('sort_order')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  let nextSort =
    typeof maxRow?.sort_order === 'number' ? maxRow.sort_order + 1 : 0;

  const rows: Array<{
    project_id: string;
    type: AssetType;
    name: string;
    slug: string;
    description: string | null;
    sort_order: number;
    _variant_prompt: string;
    _variant_where_to_use: string;
    _variant_reasoning: string;
  }> = [];

  for (const item of body) {
    const name = typeof item?.name === 'string' ? item.name.trim() : '';
    if (!name) {
      return NextResponse.json(
        { error: 'Each asset must have a non-empty name' },
        { status: 400 }
      );
    }

    const slug =
      typeof item?.slug === 'string' && item.slug.trim()
        ? item.slug.trim()
        : toSlug(name);

    if (!slug) {
      return NextResponse.json(
        { error: `Could not generate slug for "${name}"` },
        { status: 400 }
      );
    }

    const prompt = typeof item?.prompt === 'string' ? item.prompt.trim() : '';
    const whereToUse =
      typeof item?.where_to_use === 'string' ? item.where_to_use.trim() : '';

    if (!prompt) {
      return NextResponse.json(
        { error: `"prompt" is required for "${name}"` },
        { status: 400 }
      );
    }

    if (!whereToUse) {
      return NextResponse.json(
        { error: `"where_to_use" is required for "${name}"` },
        { status: 400 }
      );
    }

    rows.push({
      project_id: projectId,
      type,
      name,
      slug,
      description: toNullableString(item?.description),
      sort_order: nextSort++,
      _variant_prompt: prompt,
      _variant_where_to_use: whereToUse,
      _variant_reasoning: toNullableString(item?.reasoning) ?? '',
    });
  }

  const dbRows = rows.map(
    ({ _variant_prompt, _variant_where_to_use, _variant_reasoning, ...rest }) =>
      rest
  );

  const { data: assets, error: insertErr } = await db
    .from('project_assets')
    .insert(dbRows)
    .select(ASSET_SELECT);

  if (insertErr) {
    if (insertErr.code === '23505') {
      return NextResponse.json(
        { error: 'One or more slugs already exist' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: `Failed to create ${type}s` },
      { status: 500 }
    );
  }

  const mainVariants = (assets ?? []).map(
    (asset: { id: string; slug: string }, index: number) => {
      const inputRow = rows[index] as Record<string, unknown>;

      return {
        asset_id: asset.id,
        name: 'Main',
        slug: `${asset.slug}-main`,
        is_main: true,
        prompt: (inputRow._variant_prompt as string) ?? '',
        where_to_use: (inputRow._variant_where_to_use as string) ?? '',
        reasoning: (inputRow._variant_reasoning as string) ?? '',
      };
    }
  );

  if (mainVariants.length > 0) {
    await db.from('project_asset_variants').insert(mainVariants);
  }

  const ids = (assets ?? []).map((asset: { id: string }) => asset.id);
  const { data: full } = await db
    .from('project_assets')
    .select(`${ASSET_SELECT}, project_asset_variants(${VARIANT_SELECT})`)
    .in('id', ids)
    .order('sort_order', { ascending: true });

  return NextResponse.json(full ?? assets ?? [], { status: 201 });
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
    updates.description = toNullableString(body.description);
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

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const db = createServiceClient('studio');
  const asset = await getOwnedAsset(db, user.id, id, type);
  if (!asset) {
    return NextResponse.json({ error: `${type} not found` }, { status: 404 });
  }

  const { data, error } = await db
    .from('project_assets')
    .update(updates)
    .eq('id', id)
    .select(ASSET_SELECT)
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

  return NextResponse.json(data);
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
  const asset = await getOwnedAsset(db, user.id, id, type);

  if (!asset) {
    return NextResponse.json({ error: `${type} not found` }, { status: 404 });
  }

  const { error } = await db.from('project_assets').delete().eq('id', id);
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
  const asset = await getOwnedAsset(db, user.id, assetId);

  if (!asset) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
  }

  const { data, error } = await db
    .from('project_asset_variants')
    .select(VARIANT_SELECT)
    .eq('asset_id', assetId)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: 'Failed to list variants' },
      { status: 500 }
    );
  }

  return NextResponse.json(data ?? []);
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
  const isBatch = Array.isArray(body);
  const items = isBatch ? body : body ? [body] : [];

  if (items.length === 0) {
    return NextResponse.json(
      { error: 'At least one variant required' },
      { status: 400 }
    );
  }

  const db = createServiceClient('studio');
  const asset = await getOwnedAsset(db, user.id, assetId);

  if (!asset) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const item of items) {
    const name = typeof item?.name === 'string' ? item.name.trim() : '';
    if (!name) {
      return NextResponse.json(
        { error: 'Each variant must have a non-empty name' },
        { status: 400 }
      );
    }

    const slug =
      typeof item?.slug === 'string' && item.slug.trim()
        ? item.slug.trim()
        : toSlug(name);

    if (item?.is_main === true) {
      await db
        .from('project_asset_variants')
        .update({ is_main: false })
        .eq('asset_id', assetId)
        .eq('is_main', true);
    }

    const prompt = typeof item?.prompt === 'string' ? item.prompt.trim() : '';
    const whereToUse =
      typeof item?.where_to_use === 'string' ? item.where_to_use.trim() : '';

    if (!prompt) {
      return NextResponse.json(
        { error: `"prompt" is required for variant "${name}"` },
        { status: 400 }
      );
    }

    if (!whereToUse) {
      return NextResponse.json(
        { error: `"where_to_use" is required for variant "${name}"` },
        { status: 400 }
      );
    }

    rows.push({
      asset_id: assetId,
      name,
      slug,
      prompt,
      image_url: toNullableString(item?.image_url),
      is_main: item?.is_main === true,
      where_to_use: whereToUse,
      reasoning:
        typeof item?.reasoning === 'string' ? item.reasoning.trim() : '',
    });
  }

  const { data, error } = await db
    .from('project_asset_variants')
    .insert(rows)
    .select(VARIANT_SELECT);

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

  return NextResponse.json(isBatch ? (data ?? []) : (data ?? [])[0], {
    status: 201,
  });
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

  if (body?.prompt !== undefined)
    updates.prompt = toNullableString(body.prompt);
  if (body?.image_url !== undefined)
    updates.image_url = toNullableString(body.image_url);
  if (body?.where_to_use !== undefined)
    updates.where_to_use = toNullableString(body.where_to_use);
  if (body?.reasoning !== undefined)
    updates.reasoning = toNullableString(body.reasoning);

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

  const db = createServiceClient('studio');
  const owned = await getOwnedVariant(db, user.id, id);

  if (!owned) {
    return NextResponse.json({ error: 'Variant not found' }, { status: 404 });
  }

  if (updates.is_main === true) {
    await db
      .from('project_asset_variants')
      .update({ is_main: false })
      .eq('asset_id', owned.asset.id)
      .eq('is_main', true)
      .neq('id', id);
  }

  const { data, error } = await db
    .from('project_asset_variants')
    .update(updates)
    .eq('id', id)
    .select(VARIANT_SELECT)
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

  return NextResponse.json(data);
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

  const { error } = await db
    .from('project_asset_variants')
    .delete()
    .eq('id', id);

  if (error) {
    return NextResponse.json(
      { error: 'Failed to delete variant' },
      { status: 500 }
    );
  }

  return NextResponse.json({ id, deleted: true });
}
