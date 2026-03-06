import { R2StorageService } from '@/lib/r2';
import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Note: Reusing SFX logic for Music as a placeholder or if using SFX "instrumental" capabilities.
// If a specific Music API becomes available, this should be updated.

const r2 = new R2StorageService({
  bucketName: process.env.R2_BUCKET_NAME || '',
  accountId: process.env.R2_ACCOUNT_ID || '',
  accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  cdn: process.env.R2_PUBLIC_DOMAIN || '',
});

export async function POST(req: NextRequest) {
  try {
    const { text, duration, project_id } = await req.json();

    if (!text || !project_id) {
      return NextResponse.json(
        { error: 'Text/Description and project_id are required' },
        { status: 400 }
      );
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    // Using SFX endpoint for now as discussed
    const url = `${process.env.ELEVENLABS_URL}/v1/sound-generation`;

    const headers = {
      Accept: 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': apiKey || '',
    };

    const data = {
      text, // Prompt might need to be adjusted to encourage "musical" results
      duration_seconds: duration || undefined,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('ElevenLabs Music/SFX API Error:', errorText);
      return NextResponse.json(
        { error: 'Failed to generate music', details: errorText },
        { status: response.status }
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const fileName = `music/${Date.now()}.mp3`;
    const publicUrl = await r2.uploadData(fileName, buffer, 'audio/mpeg');

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
        type: 'music',
        url: publicUrl,
        name: text.substring(0, 100),
        prompt: text,
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      // Still return the URL even if DB save fails
      return NextResponse.json({ url: publicUrl });
    }

    return NextResponse.json({ url: publicUrl, id: asset.id });
  } catch (error) {
    console.error('Music generation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
