import { type NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchToken } from '@/lib/octupost/client';
import { publishToAccount } from '@/lib/platforms';
import type { SocialPost, SocialPostAccount, PostStatus } from '@/types/social';

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (
    !cronSecret ||
    req.headers.get('authorization') !== `Bearer ${cronSecret}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = await createAdminClient('social_auth');

    const { data: posts, error } = await supabase
      .from('posts')
      .select('*, post_accounts(*)')
      .eq('status', 'scheduled')
      .lte('scheduled_at', new Date().toISOString())
      .or(
        `processing_started_at.is.null,processing_started_at.lt.${new Date(Date.now() - 10 * 60 * 1000).toISOString()}`
      );

    if (error) {
      console.error('[cron/publish-scheduled] query error:', error.message);
      return NextResponse.json({ error: 'Operation failed' }, { status: 500 });
    }

    let published = 0;
    let failed = 0;
    let skipped = 0;

    for (const post of (posts as (SocialPost & {
      post_accounts: SocialPostAccount[];
    })[]) ?? []) {
      const accounts = post.post_accounts ?? [];
      if (!accounts.length || !post.media_url) {
        skipped++;
        continue;
      }

      // Claim this post for processing
      await supabase
        .from('posts')
        .update({
          processing_started_at: new Date().toISOString(),
          status: 'publishing' as PostStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', post.id);

      const results = await Promise.allSettled(
        accounts.map(async (account) => {
          const token = await fetchToken(account.octupost_account_id);
          return publishToAccount({
            platform: account.platform,
            accountId: account.octupost_account_id,
            token: token.access_token,
            mediaUrl: post.media_url!,
            mediaType:
              (post.media_type as 'video' | 'image' | 'carousel') ?? 'video',
            caption: post.caption ?? '',
            platformOptions: post.platform_options ?? {},
          });
        })
      );

      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < accounts.length; i++) {
        const result = results[i];
        const account = accounts[i];

        if (result.status === 'fulfilled' && result.value.success) {
          successCount++;
          await supabase
            .from('post_accounts')
            .update({
              status: 'published',
              platform_post_id: result.value.platformPostId ?? null,
              published_at: new Date().toISOString(),
            })
            .eq('id', account.id);
        } else {
          failCount++;
          const errorMsg =
            result.status === 'fulfilled'
              ? (result.value.error ?? 'Unknown error')
              : (result.reason?.message ?? 'Unknown error');
          await supabase
            .from('post_accounts')
            .update({ status: 'failed', error_message: errorMsg })
            .eq('id', account.id);
        }
      }

      let postStatus: PostStatus;
      if (successCount === accounts.length) {
        postStatus = 'published';
        published++;
      } else if (successCount > 0) {
        postStatus = 'partial';
        published++;
      } else {
        postStatus = 'failed';
        failed++;
      }

      // Clear processing_started_at and set final status
      await supabase
        .from('posts')
        .update({
          status: postStatus,
          processing_started_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', post.id);
    }

    return NextResponse.json({ published, failed, skipped });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[cron/publish-scheduled]', message);
    return NextResponse.json({ error: 'Operation failed' }, { status: 500 });
  }
}
