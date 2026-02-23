import { R2StorageService } from '@/lib/r2';
import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const r2 = new R2StorageService({
  bucketName: process.env.R2_BUCKET_NAME || '',
  accountId: process.env.R2_ACCOUNT_ID || '',
  accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  cdn: process.env.R2_PUBLIC_DOMAIN || '',
});

export async function POST(req: NextRequest) {
  try {
    const {
      text,
      voiceId = 'pNInz6obpgDQGcFmaJgB',
      project_id,
    } = await req.json();

    if (!text || !project_id) {
      return NextResponse.json(
        { error: 'Text and project_id are required' },
        { status: 400 }
      );
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    const model = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
    const url = `${process.env.ELEVENLABS_URL}/v1/text-to-speech/${voiceId}`;

    const headers = {
      Accept: 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': apiKey || '',
    };

    const data = {
      text,
      model_id: model,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.5,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
      signal: req.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('ElevenLabs API Error:', errorText);
      return NextResponse.json(
        { error: 'Failed to generate voiceover', details: errorText },
        { status: response.status }
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const fileName = `voiceovers/${Date.now()}.mp3`;
    const publicUrl = await r2.uploadData(fileName, buffer, 'audio/mpeg');

    // Save to Supabase
    const supabase = await createClient();
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
        type: 'voiceover',
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
    if ((error as DOMException)?.name === 'AbortError') {
      return new Response(null, { status: 499 });
    }
    console.error('Voiceover generation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
