'use client';

import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AccountSelector } from './account-selector';
import { CaptionEditor } from './caption-editor';
import { SchedulePicker } from './schedule-picker';
import { validateScheduleNotInPast, getTodayInTimezone } from '@/lib/schedule-validation';
import { FacebookOptions } from './platform-options/facebook-options';
import { YouTubeOptions } from './platform-options/youtube-options';
import { TikTokOptions } from './platform-options/tiktok-options';
import { InstagramOptions } from './platform-options/instagram-options';
import type { SocialAccount, SocialPost, SocialPostAccount, AccountGroup, AccountTag } from '@/types/social';
import type {
  PlatformOptions,
  FacebookOptions as FacebookOptionsType,
  YouTubeOptions as YouTubeOptionsType,
  TikTokAccountOptions,
  InstagramOptions as InstagramOptionsType,
} from '@/types/post';

interface EditPostPageProps {
  postId: string;
}

export function EditPostPage({ postId }: EditPostPageProps) {
  // Data loading
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [groups, setGroups] = useState<AccountGroup[]>([]);
  const [tags, setTags] = useState<Record<string, AccountTag[]>>({});
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);
  const [mediaIsVideo, setMediaIsVideo] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form state
  const [caption, setCaption] = useState('');
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);

  // Platform options
  const [facebookOptions, setFacebookOptions] = useState<FacebookOptionsType>({ type: 'reel' });
  const [youtubeOptions, setYoutubeOptions] = useState<YouTubeOptionsType>({ title: '', status: 'public' });
  const [tiktokOptions, setTiktokOptions] = useState<Record<string, TikTokAccountOptions>>({});
  const [instagramOptions, setInstagramOptions] = useState<InstagramOptionsType>({ type: 'reel' });

  // Save state
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedSuccessfully, setSavedSuccessfully] = useState(false);

  // Load post + accounts on mount
  useEffect(() => {
    async function load() {
      try {
        const [postRes, accountsRes] = await Promise.all([
          fetch(`/api/v2/posts/${postId}`),
          fetch('/api/v2/accounts'),
        ]);

        if (!postRes.ok) throw new Error('Failed to load post');
        if (!accountsRes.ok) throw new Error('Failed to load accounts');

        const postData = await postRes.json();
        const accountsData = await accountsRes.json();

        const post: SocialPost & { post_accounts?: SocialPostAccount[] } = postData.post;

        // Map OctupostAccount response to SocialAccount shape
        const mappedAccounts: SocialAccount[] = (accountsData.accounts || []).map((a: {
          platform: string;
          account_id: string;
          account_name: string;
          account_username: string | null;
          language: string | null;
          expires_at: string;
        }) => ({
          id: a.account_id,
          user_id: '',
          octupost_account_id: a.account_id,
          platform: a.platform,
          account_name: a.account_name,
          account_username: a.account_username,
          language: a.language,
          expires_at: a.expires_at,
          synced_at: new Date().toISOString(),
        }));
        setAccounts(mappedAccounts);

        // Pre-fill form from existing post
        setCaption(post.caption ?? '');
        setSelectedAccountIds(
          (post.accounts || post.post_accounts || []).map((a) => a.octupost_account_id)
        );

        if (post.scheduled_at) {
          setScheduledDate(post.scheduled_at.slice(0, 10));
          setScheduledTime(post.scheduled_at.slice(11, 16));
        }

        // Media preview
        if (post.media_url) {
          setMediaPreviewUrl(post.media_url);
          setMediaIsVideo(post.media_type === 'video');
        }

        // Platform options
        const opts = (post.platform_options ?? {}) as Record<string, unknown>;

        const ig = opts.instagram as { type?: string } | undefined;
        if (ig?.type) setInstagramOptions({ type: ig.type as InstagramOptionsType['type'] });

        const fb = opts.facebook as { type?: string } | undefined;
        if (fb?.type) setFacebookOptions({ type: fb.type as FacebookOptionsType['type'] });

        const yt = opts.youtube as { title?: string; status?: string } | undefined;
        if (yt) {
          setYoutubeOptions({
            title: yt.title ?? '',
            status: (yt.status as YouTubeOptionsType['status']) ?? 'public',
          });
        }

        const ttk = opts.tiktok as Record<string, TikTokAccountOptions> | undefined;
        if (ttk) setTiktokOptions(ttk);

        // Optional: groups and tags
        try {
          const [groupsRes, tagsRes] = await Promise.all([
            fetch('/api/account-groups'),
            fetch('/api/account-tags'),
          ]);
          if (groupsRes.ok) setGroups((await groupsRes.json()).groups || []);
          if (tagsRes.ok) setTags((await tagsRes.json()).tags || {});
        } catch {
          // Not critical
        }
      } catch (error) {
        setLoadError((error as Error).message);
      } finally {
        setIsLoading(false);
      }
    }

    load();
  }, [postId]);

  // Derived: which providers are selected
  const selectedAccounts = useMemo(
    () => accounts.filter((a) => selectedAccountIds.includes(a.octupost_account_id)),
    [accounts, selectedAccountIds]
  );

  const selectedProviders = useMemo(
    () => Array.from(new Set(selectedAccounts.map((a) => a.platform))),
    [selectedAccounts]
  );

  const hasFacebook = selectedProviders.includes('facebook');
  const hasYouTube = selectedProviders.includes('youtube');
  const hasTikTok = selectedProviders.includes('tiktok');
  const hasInstagram = selectedProviders.includes('instagram');

  const tiktokAccounts = useMemo(
    () => selectedAccounts.filter((a) => a.platform === 'tiktok'),
    [selectedAccounts]
  );

  const handleSave = async () => {
    if (selectedAccountIds.length === 0) {
      toast.error('Please select at least one account');
      return;
    }
    if (!scheduledDate || !scheduledTime) {
      toast.error('Please set a date and time');
      return;
    }
    if (hasYouTube && !youtubeOptions.title.trim()) {
      toast.error('Please enter a YouTube title');
      return;
    }
    const scheduleError = validateScheduleNotInPast(scheduledDate, scheduledTime, timezone);
    if (scheduleError) {
      toast.error(scheduleError);
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    const platformOptions: PlatformOptions = {};
    if (hasFacebook) platformOptions.facebook = facebookOptions;
    if (hasYouTube) platformOptions.youtube = youtubeOptions;
    if (hasTikTok) platformOptions.tiktok = tiktokOptions;
    if (hasInstagram) platformOptions.instagram = instagramOptions;

    try {
      const res = await fetch(`/api/v2/posts/${postId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caption,
          scheduledDate,
          scheduledTime,
          timezone,
          accountIds: selectedAccountIds,
          platformOptions,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Failed to save changes');
      }

      setSavedSuccessfully(true);
      toast.success('Post updated successfully!');
    } catch (error) {
      setSaveError((error as Error).message);
      toast.error((error as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0c]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading post...</span>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0c]">
        <div className="max-w-md text-center">
          <h2 className="mb-2 text-lg font-medium text-white">Unable to Load Post</h2>
          <p className="mb-4 text-sm text-muted-foreground">{loadError}</p>
          <Button variant="outline" onClick={() => window.close()}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  if (savedSuccessfully) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0c]">
        <div className="flex flex-col items-center gap-4 text-center">
          <CheckCircle2 className="h-12 w-12 text-green-400" />
          <h2 className="text-lg font-medium text-white">Changes Saved</h2>
          <p className="text-sm text-muted-foreground">
            Your scheduled post has been updated.
          </p>
          <Button variant="outline" onClick={() => window.close()}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white">
      {/* Header */}
      <header className="border-b border-white/[0.06] px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center gap-4">
          <button
            type="button"
            onClick={() => window.close()}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-medium">Edit Scheduled Post</h1>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
          {/* Left: Media preview */}
          <div className="space-y-4">
            {mediaPreviewUrl ? (
              <div className="overflow-hidden rounded-xl border border-white/[0.08]">
                {mediaIsVideo ? (
                  <video
                    src={mediaPreviewUrl}
                    controls
                    className="w-full"
                    style={{ maxHeight: 400 }}
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mediaPreviewUrl}
                    alt="Post media"
                    className="w-full object-contain"
                    style={{ maxHeight: 400 }}
                  />
                )}
              </div>
            ) : (
              <div className="flex h-48 items-center justify-center rounded-xl border border-white/[0.08] bg-zinc-900/40 text-sm text-muted-foreground">
                No media
              </div>
            )}
          </div>

          {/* Right: Form */}
          <div className="space-y-6">
            {/* Accounts */}
            <section>
              <h2 className="mb-3 text-sm font-medium text-zinc-300">Accounts</h2>
              <AccountSelector
                accounts={accounts}
                groups={groups}
                tags={tags}
                selectedIds={selectedAccountIds}
                onSelectionChange={setSelectedAccountIds}
              />
            </section>

            {/* Caption */}
            <section>
              <CaptionEditor
                value={caption}
                onChange={setCaption}
                selectedAccounts={selectedAccounts}
              />
            </section>

            {/* Platform-specific options */}
            {(hasFacebook || hasYouTube || hasTikTok || hasInstagram) && (
              <section className="space-y-4">
                <h2 className="text-sm font-medium text-zinc-300">Platform Options</h2>
                {hasFacebook && (
                  <FacebookOptions value={facebookOptions} onChange={setFacebookOptions} />
                )}
                {hasYouTube && (
                  <YouTubeOptions value={youtubeOptions} onChange={setYoutubeOptions} />
                )}
                {hasTikTok && (
                  <TikTokOptions
                    accounts={tiktokAccounts}
                    value={tiktokOptions}
                    onChange={setTiktokOptions}
                  />
                )}
                {hasInstagram && (
                  <InstagramOptions value={instagramOptions} onChange={setInstagramOptions} />
                )}
              </section>
            )}

            {/* Schedule */}
            <section>
              <SchedulePicker
                scheduleType="scheduled"
                onScheduleTypeChange={() => {}}
                scheduledDate={scheduledDate}
                onScheduledDateChange={setScheduledDate}
                scheduledTime={scheduledTime}
                onScheduledTimeChange={setScheduledTime}
                timezone={timezone}
                onTimezoneChange={setTimezone}
                minDate={getTodayInTimezone(timezone)}
              />
            </section>

            {saveError && (
              <p className="text-sm text-destructive">{saveError}</p>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => window.close()}
                className="h-11 rounded-xl border-zinc-800 bg-zinc-900/50 px-6 text-[13px] font-medium text-white hover:bg-zinc-800 hover:text-white"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={isSaving || selectedAccountIds.length === 0}
                className="h-11 flex-1 gap-2 rounded-xl text-[13px] font-medium"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
