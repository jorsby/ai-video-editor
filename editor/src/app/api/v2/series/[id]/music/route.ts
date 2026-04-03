import type { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/admin';
import {
  createProjectMusic,
  listProjectMusic,
  resolveProjectIdFromSeries,
} from '@/lib/api/v2-project-music';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: RouteContext) {
  const { id: seriesId } = await context.params;
  const db = createServiceClient('studio');

  const resolved = await resolveProjectIdFromSeries(db, seriesId);
  if (resolved.error) return resolved.error;

  return listProjectMusic(
    req,
    resolved.projectId,
    '[v2/series/:id/music][GET]'
  );
}

export async function POST(req: NextRequest, context: RouteContext) {
  const { id: seriesId } = await context.params;
  const db = createServiceClient('studio');

  const resolved = await resolveProjectIdFromSeries(db, seriesId);
  if (resolved.error) return resolved.error;

  return createProjectMusic(
    req,
    resolved.projectId,
    '[v2/series/:id/music][POST]'
  );
}
