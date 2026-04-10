import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
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
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceClient('studio');

    const {
      project_id,
      url,
      file_size,
      duration,
      resolution,
      type,
      parent_id,
      virality_score,
      segment_title,
    } = await req.json();

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
        url,
        file_size: file_size || null,
        duration: duration || null,
        resolution: resolution || null,
        type: type || 'video',
        parent_id: parent_id || null,
        virality_score: virality_score ?? null,
        segment_title: segment_title || null,
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
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceClient('studio');

    const id = req.nextUrl.searchParams.get('id');
    const projectId = req.nextUrl.searchParams.get('project_id');

    // Fetch a single rendered video by ID
    if (id) {
      const { data, error } = await supabase
        .from('rendered_videos')
        .select('*')
        .eq('id', id)
        .eq('user_id', user.id)
        .single();

      if (error || !data) {
        return NextResponse.json(
          { error: 'Rendered video not found' },
          { status: 404 }
        );
      }

      return NextResponse.json({ rendered_video: data });
    }

    if (!projectId) {
      return NextResponse.json(
        { error: 'project_id or id is required' },
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
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceClient('studio');

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
