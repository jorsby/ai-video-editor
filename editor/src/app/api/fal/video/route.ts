import { fal } from '@fal-ai/client';
import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Aspect ratio options matching the API
type AspectRatio = '16:9' | '9:16' | '1:1';

// Default configuration (easily modifiable)
const DEFAULTS = {
  aspectRatio: '9:16' as AspectRatio,
  numFrames: 60,
  numInferenceSteps: 12,
  fps: 15,
  enableSafetyChecker: true,
  videoOutputType: 'X264 (.mp4)' as const,
  videoQuality: 'high' as const,
  videoWriteMode: 'balanced' as const,
};

export async function POST(req: NextRequest) {
  try {
    const { prompt, aspectRatio, project_id } = await req.json();

    if (!prompt || !project_id) {
      return NextResponse.json(
        { error: 'Prompt and project_id are required' },
        { status: 400 }
      );
    }

    // Get aspect ratio (default to 16:9)
    const selectedRatio: AspectRatio =
      aspectRatio && ['16:9', '9:16', '1:1'].includes(aspectRatio)
        ? aspectRatio
        : DEFAULTS.aspectRatio;

    // Configure fal client with API key
    fal.config({
      credentials: process.env.FAL_KEY || '',
    });

    const result = await fal.subscribe(
      'fal-ai/kling-video/o3/standard/reference-to-video',
      {
        input: {
          prompt,
          aspect_ratio: selectedRatio,
        },
      }
    );

    // Return the video URL directly
    const videoUrl = result.data.video?.url;

    if (!videoUrl) {
      return NextResponse.json(
        { error: 'No video generated' },
        { status: 500 }
      );
    }

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
        url: videoUrl,
        name: prompt.substring(0, 100),
        prompt: prompt,
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      // Still return the URL even if DB save fails
      return NextResponse.json({ url: videoUrl });
    }

    return NextResponse.json({ url: videoUrl, id: asset.id });
  } catch (error) {
    console.error('Video generation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
