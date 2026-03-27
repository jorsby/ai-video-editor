import { type NextRequest, NextResponse } from 'next/server';

const NOT_SUPPORTED_MESSAGE =
  'SFX generation is not yet implemented on KIE. This fal-only endpoint has been retired.';

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    {
      success: false,
      error: NOT_SUPPORTED_MESSAGE,
      code: 'KIE_SFX_NOT_IMPLEMENTED',
      supported_provider: 'kie',
    },
    { status: 501 }
  );
}
