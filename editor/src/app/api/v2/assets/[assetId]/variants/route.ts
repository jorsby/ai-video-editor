import type { NextRequest } from 'next/server';
import {
  getVariantsByAsset,
  postVariantsByAsset,
} from '@/lib/api/v2-asset-helpers';

type Ctx = { params: Promise<{ assetId: string }> };

export function GET(req: NextRequest, ctx: Ctx) {
  return getVariantsByAsset(req, ctx);
}

export function POST(req: NextRequest, ctx: Ctx) {
  return postVariantsByAsset(req, ctx);
}
