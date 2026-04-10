import type { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/admin';
import {
  createProjectMusic,
  listVideoMusic,
  resolveProjectIdFromVideo,
} from '@/lib/api/v2-project-music';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: RouteContext) {
  const { id: videoId } = await context.params;
  const db = createServiceClient('studio');

  const resolved = await resolveProjectIdFromVideo(db, videoId);
  if (resolved.error) return resolved.error;

  return listVideoMusic(
    req,
    videoId,
    resolved.projectId,
    '[v2/video/:id/music][GET]'
  );
}

export async function POST(req: NextRequest, context: RouteContext) {
  const { id: videoId } = await context.params;
  const db = createServiceClient('studio');

  const resolved = await resolveProjectIdFromVideo(db, videoId);
  if (resolved.error) return resolved.error;

  return createProjectMusic(
    req,
    resolved.projectId,
    '[v2/video/:id/music][POST]',
    videoId
  );
}
