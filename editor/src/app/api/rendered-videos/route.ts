import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { R2StorageService } from '@/lib/r2';
import { config } from '@/lib/config';

const r2 = new R2StorageService({
  bucketName: config.r2.bucket,
  accessKeyId: config.r2.accessKeyId,
  secretAccessKey: config.r2.secretAccessKey,
  accountId: config.r2.accountId,
  cdn: config.r2.cdn,
});

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { project_id, language, url, file_size, duration, resolution } =
      await req.json();

    if (!project_id || !url) {
      return NextResponse.json(
        { error: 'project_id and url are required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('rendered_videos')
      .insert({
        project_id,
        user_id: user.id,
        language: language || 'en',
        url,
        file_size: file_size || null,
        duration: duration || null,
        resolution: resolution || null,
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to insert rendered video:', error);
      return NextResponse.json(
        { error: 'Failed to save rendered video' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, rendered_video: data });
  } catch (error) {
    console.error('Rendered videos POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const projectId = req.nextUrl.searchParams.get('project_id');

    if (!projectId) {
      return NextResponse.json(
        { error: 'project_id is required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('rendered_videos')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch rendered videos:', error);
      return NextResponse.json(
        { error: 'Failed to fetch rendered videos' },
        { status: 500 }
      );
    }

    return NextResponse.json({ rendered_videos: data });
  } catch (error) {
    console.error('Rendered videos GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const id = req.nextUrl.searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Rendered video ID is required' },
        { status: 400 }
      );
    }

    // Fetch the record to get the URL and verify ownership
    const { data: record, error: fetchError } = await supabase
      .from('rendered_videos')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !record) {
      return NextResponse.json(
        { error: 'Rendered video not found' },
        { status: 404 }
      );
    }

    // Delete from R2 first so if it fails, the DB record still exists
    const r2Key = r2.extractKeyFromUrl(record.url);
    if (r2Key) {
      await r2.deleteObject(r2Key);
    }

    // Delete the DB record
    const { error: deleteError } = await supabase
      .from('rendered_videos')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (deleteError) {
      console.error('Failed to delete rendered video record:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete rendered video' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Rendered videos DELETE error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
