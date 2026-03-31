import type { NextRequest } from 'next/server';
import { getAssetsByType, postAssetsByType } from '@/lib/api/v2-asset-helpers';

type Ctx = { params: Promise<{ id: string }> };

export function GET(req: NextRequest, ctx: Ctx) {
  return getAssetsByType(req, ctx, 'character');
}

export function POST(req: NextRequest, ctx: Ctx) {
  return postAssetsByType(req, ctx, 'character');
}
