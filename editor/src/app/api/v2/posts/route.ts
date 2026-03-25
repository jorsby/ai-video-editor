import { createClient } from '@/lib/supabase/server';
import { fetchToken } from '@/lib/octupost/client';
import { publishToAccount } from '@/lib/platforms';
import { type NextRequest, NextResponse } from 'next/server';

interface CreatePostBody {
  caption: string;
  mediaUrl: string;
  mediaType: 'video' | 'image' | 'carousel';
  accountIds: string[];
  scheduleType: 'now' | 'scheduled';
  scheduledDate?: string;
  scheduledTime?: string;
  timezone?: string;
  platformOptions?: Record<string, unknown>;
  projectId?: string;
  tags?: string[];
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient('social_auth');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: CreatePostBody = await req.json();
    const {
      caption,
      mediaUrl,
      mediaType,
      accountIds,
      scheduleType,
      scheduledDate,
      scheduledTime,
      timezone = 'UTC',
      platformOptions = {},
      projectId,
      tags = [],
    } = body;

    if (!accountIds?.length) {
      return NextResponse.json(
        { error: 'At least one account is required' },
        { status: 400 }
      );
    }

    // Compute scheduled_at if scheduled
    let scheduledAt: string | null = null;
    if (scheduleType === 'scheduled' && scheduledDate && scheduledTime) {
      scheduledAt = new Date(`${scheduledDate}T${scheduledTime}`).toISOString();
    }

    const status = scheduleType === 'now' ? 'publishing' : 'scheduled';

    // Create the post row
    const { data: post, error: postError } = await supabase
      .from('posts')
      .insert({
        user_id: user.id,
        project_id: projectId || null,
        caption,
        media_url: mediaUrl,
        media_type: mediaType,
        schedule_type: scheduleType,
        scheduled_at: scheduledAt,
        timezone,
        status,
        platform_options: platformOptions,
        tags,
      })
      .select()
      .single();

    if (postError || !post) {
      return NextResponse.json(
        { error: 'Failed to create post' },
        { status: 500 }
      );
    }

    // Look up platform for each accountId from social_accounts
    const { data: socialAccounts } = await supabase
      .from('tokens')
      .select('octupost_account_id, platform')
      .eq('user_id', user.id)
      .in('octupost_account_id', accountIds);

    const platformMap = new Map(
      (socialAccounts || []).map((a) => [a.octupost_account_id, a.platform])
    );

    // Create post_accounts rows
    const postAccountRows = accountIds.map((accountId) => ({
      post_id: post.id,
      octupost_account_id: accountId,
      platform: platformMap.get(accountId) || 'unknown',
      status: scheduleType === 'now' ? 'publishing' : 'pending',
    }));

    const { data: postAccounts, error: paError } = await supabase
      .from('post_accounts')
      .insert(postAccountRows)
      .select();

    if (paError) {
      return NextResponse.json({ error: 'Operation failed' }, { status: 500 });
    }

    // If publishing now, publish to each account in parallel
    if (scheduleType === 'now' && postAccounts) {
      const results = await Promise.allSettled(
        postAccounts.map(async (pa) => {
          try {
            const tokenData = await fetchToken(pa.octupost_account_id);
            const result = await publishToAccount({
              platform: pa.platform,
              accountId: pa.octupost_account_id,
              token: tokenData.access_token,
              mediaUrl,
              mediaType,
              caption,
              platformOptions,
            });

            await supabase
              .from('post_accounts')
              .update({
                status: result.success ? 'published' : 'failed',
                platform_post_id: result.platformPostId || null,
                error_message: result.error || null,
                published_at: result.success ? new Date().toISOString() : null,
              })
              .eq('id', pa.id);

            return result;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await supabase
              .from('post_accounts')
              .update({
                status: 'failed',
                error_message: msg,
              })
              .eq('id', pa.id);

            return { success: false, error: msg };
          }
        })
      );

      // Determine overall post status
      const outcomes = results.map((r) =>
        r.status === 'fulfilled' ? r.value : { success: false }
      );
      const allSuccess = outcomes.every((o) => o.success);
      const allFailed = outcomes.every((o) => !o.success);
      const finalStatus = allSuccess
        ? 'published'
        : allFailed
          ? 'failed'
          : 'partial';

      await supabase
        .from('posts')
        .update({ status: finalStatus, updated_at: new Date().toISOString() })
        .eq('id', post.id);

      // Re-fetch for response
      const { data: updatedPost } = await supabase
        .from('posts')
        .select('*, post_accounts(*)')
        .eq('id', post.id)
        .single();

      return NextResponse.json({ post: updatedPost });
    }

    return NextResponse.json({
      post: { ...post, post_accounts: postAccounts },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[POST /api/v2/posts]', message);
    return NextResponse.json({ error: 'Operation failed' }, { status: 500 });
  }
}
