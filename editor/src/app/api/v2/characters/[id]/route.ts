import type { NextRequest } from 'next/server';
import {
  patchAssetByType,
  deleteAssetByType,
} from '@/lib/api/v2-asset-helpers';

type Ctx = { params: Promise<{ id: string }> };

export function PATCH(req: NextRequest, ctx: Ctx) {
  return patchAssetByType(req, ctx, 'character');
}

export function DELETE(req: NextRequest, ctx: Ctx) {
  return deleteAssetByType(req, ctx, 'character');
}
