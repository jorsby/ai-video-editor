import { createClient } from '@/lib/supabase/server';
import { fetchToken } from '@/lib/octupost/client';
import { publishToAccount } from '@/lib/platforms';
import { type NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    const supabase = await createClient('social_auth');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch the post with accounts
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

    if (post.status !== 'scheduled' && post.status !== 'draft') {
      return NextResponse.json(
        { error: `Cannot publish a post with status "${post.status}"` },
        { status: 400 }
      );
    }

    // Mark as publishing
    await supabase
      .from('posts')
      .update({ status: 'publishing', updated_at: new Date().toISOString() })
      .eq('id', id);

    const pendingAccounts = (post.post_accounts || []).filter(
      (pa: { status: string }) =>
        pa.status === 'pending' || pa.status === 'failed'
    );

    // Publish in parallel
    const results = await Promise.allSettled(
      pendingAccounts.map(
        async (pa: {
          id: string;
          octupost_account_id: string;
          platform: string;
        }) => {
          try {
            // Mark uploading
            await supabase
              .from('post_accounts')
              .update({ status: 'publishing' })
              .eq('id', pa.id);

            const tokenData = await fetchToken(pa.octupost_account_id);
            const result = await publishToAccount({
              platform: pa.platform,
              accountId: pa.octupost_account_id,
              token: tokenData.access_token,
              mediaUrl: post.media_url,
              mediaType: post.media_type,
              caption: post.caption || '',
              platformOptions: post.platform_options || {},
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
              .update({ status: 'failed', error_message: msg })
              .eq('id', pa.id);
            return { success: false, error: msg };
          }
        }
      )
    );

    // Determine overall status
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
      .eq('id', id);

    // Re-fetch
    const { data: updatedPost } = await supabase
      .from('posts')
      .select('*, post_accounts(*)')
      .eq('id', id)
      .single();

    return NextResponse.json({ post: updatedPost });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[POST /api/v2/posts/[id]/publish]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
