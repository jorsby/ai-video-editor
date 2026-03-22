import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const FAL_KEY = process.env.FAL_KEY!;

// Aspect ratio options matching the API
type AspectRatio = '16:9' | '9:16' | '1:1';

// Default configuration (easily modifiable)
const DEFAULTS = {
  aspectRatio: '9:16' as AspectRatio,
};

const FAL_ENDPOINT = 'fal-ai/kling-video/o3/standard/reference-to-video';

export async function POST(req: NextRequest) {
  try {
    const { prompt, aspectRatio, project_id, image_url } = await req.json();

    if (!prompt || !project_id) {
      return NextResponse.json(
        { error: 'Prompt and project_id are required' },
        { status: 400 }
      );
    }

    // Get aspect ratio (default to 9:16)
    const selectedRatio: AspectRatio =
      aspectRatio && ['16:9', '9:16', '1:1'].includes(aspectRatio)
        ? aspectRatio
        : DEFAULTS.aspectRatio;

    const falUrl = new URL(`https://queue.fal.run/${FAL_ENDPOINT}`);

    const falRes = await fetch(falUrl.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Key ${FAL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        aspect_ratio: selectedRatio,
        ...(image_url ? { image_url } : {}),
      }),
    });

    if (!falRes.ok) {
      const errText = await falRes.text();
      console.error('fal.ai video request failed:', falRes.status, errText);
      return NextResponse.json(
        { error: 'Video generation request failed' },
        { status: 500 }
      );
    }

    const falData = await falRes.json();

    // Save to Supabase
    const supabase = await createClient('studio');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: asset, error: dbError } = await supabase
      .from('assets')
      .insert({
        user_id: user.id,
        project_id,
        type: 'video',
        url: null,
        name: prompt.substring(0, 100),
        prompt: prompt,
        metadata: {
          fal_request_id: falData.request_id,
          endpoint: FAL_ENDPOINT,
        },
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      return NextResponse.json({ request_id: falData.request_id });
    }

    return NextResponse.json({ request_id: falData.request_id, id: asset.id });
  } catch (error) {
    console.error('Video generation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
