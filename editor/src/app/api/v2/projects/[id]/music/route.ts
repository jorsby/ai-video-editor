import type { NextRequest } from 'next/server';
import {
  createProjectMusic,
  listProjectMusic,
} from '@/lib/api/v2-project-music';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: RouteContext) {
  const { id: projectId } = await context.params;
  return listProjectMusic(req, projectId, '[v2/projects/:id/music][GET]');
}

export async function POST(req: NextRequest, context: RouteContext) {
  const { id: projectId } = await context.params;
  return createProjectMusic(req, projectId, '[v2/projects/:id/music][POST]');
}
