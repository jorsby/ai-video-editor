import { createClient } from '@/lib/supabase/server';
import { fetchToken } from '@/lib/octupost/client';
import { deletePost as fbDeletePost, updatePost as fbUpdatePost } from '@/lib/platforms/facebook';
import { deleteVideo as ytDeleteVideo, updateVideo as ytUpdateVideo } from '@/lib/platforms/youtube';
import { deleteTweet } from '@/lib/platforms/twitter';
import { type NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/v2/posts/[id]
export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    const supabase = await createClient('social_auth');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: post, error } = await supabase
      .from('posts')
      .select('*, post_accounts(*)')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (error || !post) {
      return NextResponse.json(
        { error: error?.message || 'Post not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ post });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[GET /api/v2/posts/[id]]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT /api/v2/posts/[id]
export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    const supabase = await createClient('social_auth');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const {
      caption,
      accountIds,
      scheduledDate,
      scheduledTime,
      timezone,
      platformOptions,
    } = body;

    // Fetch existing post
    const { data: existingPost, error: fetchErr } = await supabase
      .from('posts')
      .select('*, post_accounts(*)')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (fetchErr || !existingPost) {
      return NextResponse.json(
        { error: fetchErr?.message || 'Post not found' },
        { status: 404 }
      );
    }

    // Build update payload for posts table
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (caption !== undefined) updates.caption = caption;
    if (timezone !== undefined) updates.timezone = timezone;
    if (platformOptions !== undefined) updates.platform_options = platformOptions;
    if (scheduledDate && scheduledTime) {
      updates.scheduled_at = new Date(
        `${scheduledDate}T${scheduledTime}`
      ).toISOString();
    }

    // Update the post row
    const { error: updateErr } = await supabase
      .from('posts')
      .update(updates)
      .eq('id', id);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // If accountIds changed, reconcile post_accounts
    if (accountIds !== undefined) {
      // Delete removed accounts
      await supabase
        .from('post_accounts')
        .delete()
        .eq('post_id', id)
        .not('octupost_account_id', 'in', `(${accountIds.join(',')})`);

      // Upsert new accounts
      const { data: socialAccounts } = await supabase
        .from('tokens')
        .select('octupost_account_id, platform')
        .eq('user_id', user.id)
        .in('octupost_account_id', accountIds);

      const platformMap = new Map(
        (socialAccounts || []).map((a) => [
          a.octupost_account_id,
          a.platform,
        ])
      );

      const existingIds = new Set(
        (existingPost.post_accounts || []).map(
          (pa: { octupost_account_id: string }) => pa.octupost_account_id
        )
      );
      const newAccountIds = accountIds.filter(
        (aid: string) => !existingIds.has(aid)
      );

      if (newAccountIds.length > 0) {
        await supabase.from('post_accounts').insert(
          newAccountIds.map((aid: string) => ({
            post_id: id,
            octupost_account_id: aid,
            platform: platformMap.get(aid) || 'unknown',
            status: 'pending',
          }))
        );
      }
    }

    // For published posts, attempt platform-level update (caption change)
    if (existingPost.status === 'published' && caption !== undefined) {
      const publishedAccounts = (existingPost.post_accounts || []).filter(
        (pa: { status: string; platform_post_id: string | null }) =>
          pa.status === 'published' && pa.platform_post_id
      );

      await Promise.allSettled(
        publishedAccounts.map(
          async (pa: {
            platform: string;
            platform_post_id: string;
            octupost_account_id: string;
          }) => {
            const tokenData = await fetchToken(pa.octupost_account_id);
            const token = tokenData.access_token;

            switch (pa.platform) {
              case 'facebook':
              case 'facebook_page':
                return fbUpdatePost(
                  pa.platform_post_id,
                  pa.octupost_account_id,
                  token,
                  caption
                );
              case 'youtube':
                return ytUpdateVideo(token, pa.platform_post_id, {
                  description: caption,
                });
              default:
                // Most platforms don't support post editing
                break;
            }
          }
        )
      );
    }

    // Re-fetch for response
    const { data: updatedPost } = await supabase
      .from('posts')
      .select('*, post_accounts(*)')
      .eq('id', id)
      .single();

    return NextResponse.json({ post: updatedPost });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[PUT /api/v2/posts/[id]]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/v2/posts/[id]
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    const supabase = await createClient('social_auth');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch post with accounts
    const { data: post, error: fetchErr } = await supabase
      .from('posts')
      .select('*, post_accounts(*)')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (fetchErr || !post) {
      return NextResponse.json(
        { error: fetchErr?.message || 'Post not found' },
        { status: 404 }
      );
    }

    // Best-effort delete from platforms for published posts
    const publishedAccounts = (post.post_accounts || []).filter(
      (pa: { status: string; platform_post_id: string | null }) =>
        pa.status === 'published' && pa.platform_post_id
    );

    if (publishedAccounts.length > 0) {
      await Promise.allSettled(
        publishedAccounts.map(
          async (pa: {
            platform: string;
            platform_post_id: string;
            octupost_account_id: string;
          }) => {
            const tokenData = await fetchToken(pa.octupost_account_id);
            const token = tokenData.access_token;

            switch (pa.platform) {
              case 'facebook':
              case 'facebook_page':
                return fbDeletePost(
                  pa.platform_post_id,
                  pa.octupost_account_id,
                  token
                );
              case 'youtube':
                return ytDeleteVideo(token, pa.platform_post_id);
              case 'twitter':
              case 'x':
                return deleteTweet(token, pa.platform_post_id);
              default:
                break;
            }
          }
        )
      );
    }

    // Delete from DB (cascade deletes post_accounts)
    const { error: deleteErr } = await supabase
      .from('posts')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (deleteErr) {
      return NextResponse.json({ error: deleteErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[DELETE /api/v2/posts/[id]]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
