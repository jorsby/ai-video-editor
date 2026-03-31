import type { NextRequest } from 'next/server';
import {
  patchVariantById,
  deleteVariantById,
} from '@/lib/api/v2-asset-helpers';

type Ctx = { params: Promise<{ id: string }> };

export function PATCH(req: NextRequest, ctx: Ctx) {
  return patchVariantById(req, ctx);
}

export function DELETE(req: NextRequest, ctx: Ctx) {
  return deleteVariantById(req, ctx);
}
