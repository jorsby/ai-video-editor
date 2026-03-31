import { NextResponse } from 'next/server';

// Poll fallback intentionally disabled.
// Generation state must flow through webhook -> DB update -> realtime subscription.
export async function POST() {
  return NextResponse.json(
    {
      error: 'Polling disabled. Webhook-only mode is active.',
      mode: 'webhook-only',
    },
    { status: 410 }
  );
}
