import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const FAL_KEY = process.env.FAL_KEY!;

// Aspect ratio presets
type AspectRatio = '16:9' | '9:16' | '1:1';

// Default configuration (easily modifiable)
const DEFAULTS = {
  aspectRatio: '9:16' as AspectRatio,
  numImages: 1,
};

const FAL_ENDPOINT = 'fal-ai/nano-banana-2';

export async function POST(req: NextRequest) {
  try {
    const { prompt, aspectRatio, project_id } = await req.json();

    if (!prompt || !project_id) {
      return NextResponse.json(
        { error: 'Prompt and project_id are required' },
        { status: 400 }
      );
    }

    // Get aspect ratio (default to 9:16)
    const selectedRatio: AspectRatio =
      aspectRatio && ['16:9', '9:16', '1:1'].includes(aspectRatio as string)
        ? (aspectRatio as AspectRatio)
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
        num_images: DEFAULTS.numImages,
        safety_tolerance: '6',
        output_format: 'jpeg',
      }),
    });

    if (!falRes.ok) {
      const errText = await falRes.text();
      console.error('fal.ai image request failed:', falRes.status, errText);
      return NextResponse.json(
        { error: 'Image generation request failed' },
        { status: 500 }
      );
    }

    const falData = await falRes.json();
    const imageUrl = falData.images?.[0]?.url;

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
