import { fal } from '@fal-ai/client';
import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Aspect ratio presets with explicit dimensions
type AspectRatio = '16:9' | '9:16' | '1:1';

const ASPECT_RATIO_DIMENSIONS: Record<
  AspectRatio,
  { width: number; height: number }
> = {
  '1:1': { width: 1024, height: 1024 }, // 1:1 square
  '9:16': { width: 1024, height: 1920 }, // 9:16 portrait
  '16:9': { width: 1920, height: 1024 }, // 16:9 landscape
};

type OutputFormat = 'jpeg' | 'png' | 'webp';
type Acceleration = 'none' | 'regular' | 'high';

// Default configuration (easily modifiable)
const DEFAULTS = {
  aspectRatio: '9:16' as AspectRatio,
  numInferenceSteps: 8,
  numImages: 1,
  enableSafetyChecker: true,
  outputFormat: 'png' as OutputFormat,
  acceleration: 'none' as Acceleration,
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

    // Get dimensions from aspect ratio (default to landscape)
    const selectedRatio: AspectRatio =
      aspectRatio && ASPECT_RATIO_DIMENSIONS[aspectRatio as AspectRatio]
        ? aspectRatio
        : DEFAULTS.aspectRatio;
    const { width, height } = ASPECT_RATIO_DIMENSIONS[selectedRatio];

    // Configure fal client with API key
    fal.config({
      credentials: process.env.FAL_KEY || '',
    });

    const result = await fal.subscribe('fal-ai/z-image/turbo', {
      input: {
        prompt,
        image_size: { width, height },
        num_inference_steps: DEFAULTS.numInferenceSteps,
        num_images: DEFAULTS.numImages,
        enable_safety_checker: DEFAULTS.enableSafetyChecker,
        output_format: DEFAULTS.outputFormat,
        acceleration: DEFAULTS.acceleration,
      },
    });

    // Return the first image URL directly
    const imageUrl = result.data.images?.[0]?.url;

    if (!imageUrl) {
      return NextResponse.json(
        { error: 'No image generated' },
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
        type: 'image',
        url: imageUrl,
        name: prompt.substring(0, 100),
        prompt: prompt,
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      // Still return the URL even if DB save fails
      return NextResponse.json({ url: imageUrl });
    }

    return NextResponse.json({ url: imageUrl, id: asset.id });
  } catch (error) {
    console.error('Image generation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
