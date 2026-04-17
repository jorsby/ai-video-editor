import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';

// GET /api/assets?project_id=<uuid> — list all media assets for a project
export async function GET(req: NextRequest) {
  const user = await getUserOrApiKey(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const projectId = req.nextUrl.searchParams.get('project_id');
  if (!projectId) {
    return NextResponse.json(
      { error: 'project_id is required' },
      { status: 400 }
    );
  }

  const db = createServiceClient('studio');

  // Verify ownership
  const { data: project } = await db
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const { data: assets, error } = await db
    .from('media_assets')
    .select('id, project_id, type, name, url, prompt, size, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: 'Failed to fetch assets' },
      { status: 500 }
    );
  }

  return NextResponse.json({ assets: assets ?? [] });
}

// POST /api/assets — create a media asset
export async function POST(req: NextRequest) {
  const user = await getUserOrApiKey(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const { project_id, type, name, url, prompt, size } = body;

  if (!project_id || !type || !name || !url) {
    return NextResponse.json(
      { error: 'project_id, type, name, and url are required' },
      { status: 400 }
    );
  }

  const db = createServiceClient('studio');

  // Verify ownership
  const { data: project } = await db
    .from('projects')
    .select('id')
    .eq('id', project_id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const { data: asset, error } = await db
    .from('media_assets')
    .insert({
      project_id,
      type,
      name,
      url,
      prompt: prompt ?? null,
      size: size ?? null,
    })
    .select('id, project_id, type, name, url, prompt, size, created_at')
    .single();

  if (error) {
    return NextResponse.json(
      { error: 'Failed to create asset' },
      { status: 500 }
    );
  }

  return NextResponse.json({ asset }, { status: 201 });
}

// DELETE /api/assets?id=<uuid> — delete a media asset
export async function DELETE(req: NextRequest) {
  const user = await getUserOrApiKey(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const db = createServiceClient('studio');

  // Get asset and verify ownership via project
  const { data: asset } = await db
    .from('media_assets')
    .select('id, project_id')
    .eq('id', id)
    .maybeSingle();

  if (!asset) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
  }

  const { data: project } = await db
    .from('projects')
    .select('id')
    .eq('id', asset.project_id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { error } = await db.from('media_assets').delete().eq('id', id);

  if (error) {
    return NextResponse.json(
      { error: 'Failed to delete asset' },
      { status: 500 }
    );
  }

  return NextResponse.json({ id, deleted: true });
}
