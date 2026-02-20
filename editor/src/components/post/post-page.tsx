'use client';

import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { Loader2, Check, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AccountSelector } from './account-selector';
import { CaptionEditor } from './caption-editor';
import { SchedulePicker } from './schedule-picker';
import { FacebookOptions } from './platform-options/facebook-options';
import { YouTubeOptions } from './platform-options/youtube-options';
import { TikTokOptions } from './platform-options/tiktok-options';
import { InstagramOptions } from './platform-options/instagram-options';
import type { RenderedVideo } from '@/types/rendered-video';
import type {
  MixpostAccount,
  AccountGroupWithMembers,
  AccountTagMap,
} from '@/types/mixpost';
import type {
  PostFormData,
  PlatformOptions,
  FacebookOptions as FacebookOptionsType,
  YouTubeOptions as YouTubeOptionsType,
  TikTokAccountOptions,
  InstagramOptions as InstagramOptionsType,
} from '@/types/post';

interface PostPageProps {
  renderedVideoId: string;
}

type SubmitStep = 'idle' | 'uploading' | 'creating' | 'scheduling' | 'done' | 'error';

export function PostPage({ renderedVideoId }: PostPageProps) {
  // Data loading
  const [video, setVideo] = useState<RenderedVideo | null>(null);
  const [accounts, setAccounts] = useState<MixpostAccount[]>([]);
  const [groups, setGroups] = useState<AccountGroupWithMembers[]>([]);
  const [tags, setTags] = useState<AccountTagMap>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form state
  const [caption, setCaption] = useState('');
  const [selectedAccountIds, setSelectedAccountIds] = useState<number[]>([]);
  const [scheduleType, setScheduleType] = useState<'now' | 'scheduled'>('now');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone
  );

  // Platform options
  const [facebookOptions, setFacebookOptions] = useState<FacebookOptionsType>({
    type: 'reel',
  });
  const [youtubeOptions, setYoutubeOptions] = useState<YouTubeOptionsType>({
    title: '',
    status: 'public',
  });
  const [tiktokOptions, setTiktokOptions] = useState<
    Record<string, TikTokAccountOptions>
  >({});
  const [instagramOptions, setInstagramOptions] =
    useState<InstagramOptionsType>({ type: 'reel' });

  // Submission
  const [submitStep, setSubmitStep] = useState<SubmitStep>('idle');

  // AI caption generation
  const [isGeneratingCaption, setIsGeneratingCaption] = useState(false);

  // Derived: which providers are selected
  const selectedAccounts = useMemo(
    () => accounts.filter((a) => selectedAccountIds.includes(a.id)),
    [accounts, selectedAccountIds]
  );

  const selectedProviders = useMemo(
    () => Array.from(new Set(selectedAccounts.map((a) => a.provider))),
    [selectedAccounts]
  );

  const hasFacebook = selectedProviders.includes('facebook');
  const hasYouTube = selectedProviders.includes('youtube');
  const hasTikTok = selectedProviders.includes('tiktok');
  const hasInstagram = selectedProviders.includes('instagram');

  const tiktokAccounts = useMemo(
    () => selectedAccounts.filter((a) => a.provider === 'tiktok'),
    [selectedAccounts]
  );

  // Load data on mount
  useEffect(() => {
    async function loadData() {
      try {
        const [videoRes, accountsRes] = await Promise.all([
          fetch(`/api/rendered-videos?id=${renderedVideoId}`),
          fetch('/api/mixpost/accounts'),
        ]);

        if (!videoRes.ok) {
          throw new Error('Failed to load rendered video');
        }
        if (!accountsRes.ok) {
          throw new Error('Failed to load social accounts');
        }

        const videoData = await videoRes.json();
        const accountsData = await accountsRes.json();

        setVideo(videoData.rendered_video);
        setAccounts(accountsData.accounts || []);

        // Load groups and tags if available
        try {
          const [groupsRes, tagsRes] = await Promise.all([
            fetch('/api/account-groups'),
            fetch('/api/account-tags'),
          ]);
          if (groupsRes.ok) {
            const groupsData = await groupsRes.json();
            setGroups(groupsData.groups || []);
          }
          if (tagsRes.ok) {
            const tagsData = await tagsRes.json();
            setTags(tagsData.tags || {});
          }
        } catch {
          // Groups/tags are optional — not critical
        }
      } catch (error) {
        setLoadError((error as Error).message);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [renderedVideoId]);

  const handleGenerateCaption = async () => {
    if (!video?.project_id) return;

    setIsGeneratingCaption(true);
    try {
      const res = await fetch('/api/generate-caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: video.project_id,
          language: video.language || 'en',
          selected_providers: selectedProviders,
          duration: video.duration,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to generate caption');
      }

      const data = await res.json();

      const hashtagsStr = data.hashtags
        .map((tag: string) => `#${tag}`)
        .join(' ');
      setCaption(data.caption + '\n\n' + hashtagsStr);

      if (hasYouTube && data.youtube_title) {
        setYoutubeOptions((prev) => ({
          ...prev,
          title: data.youtube_title,
        }));
      }

      toast.success('Caption generated!');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setIsGeneratingCaption(false);
    }
  };

  const handleSubmit = async () => {
    if (selectedAccountIds.length === 0) {
      toast.error('Please select at least one account');
      return;
    }

    if (!video) return;

    if (
      scheduleType === 'scheduled' &&
      (!scheduledDate || !scheduledTime)
    ) {
      toast.error('Please set a date and time for scheduling');
      return;
    }

    try {
      // Step 1: Upload media to Mixpost
      setSubmitStep('uploading');
      const mediaRes = await fetch('/api/mixpost/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: video.url }),
      });

      if (!mediaRes.ok) {
        const err = await mediaRes.json();
        throw new Error(err.error || 'Failed to upload media');
      }

      const { media } = await mediaRes.json();
      const mediaId = Number(media.id);

      // Step 2: Create post
      setSubmitStep('creating');

      const platformOptions: PlatformOptions = {};
      if (hasFacebook) platformOptions.facebook = facebookOptions;
      if (hasYouTube) platformOptions.youtube = youtubeOptions;
      if (hasTikTok) platformOptions.tiktok = tiktokOptions;
      if (hasInstagram) platformOptions.instagram = instagramOptions;

      const postBody: PostFormData & { mediaId: number } = {
        caption,
        accountIds: selectedAccountIds,
        scheduleType,
        scheduledDate: scheduleType === 'scheduled' ? scheduledDate : undefined,
        scheduledTime: scheduleType === 'scheduled' ? scheduledTime : undefined,
        timezone,
        platformOptions,
        mediaId,
      };

      const postRes = await fetch('/api/mixpost/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postBody),
      });

      if (!postRes.ok) {
        const err = await postRes.json();
        throw new Error(err.error || 'Failed to create post');
      }

      const { post } = await postRes.json();

      // Step 3: Schedule/publish
      setSubmitStep('scheduling');

      const scheduleRes = await fetch('/api/mixpost/posts/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postUuid: post.uuid,
          postNow: scheduleType === 'now',
        }),
      });

      if (!scheduleRes.ok) {
        const err = await scheduleRes.json();
        throw new Error(err.error || 'Failed to schedule post');
      }

      setSubmitStep('done');
      toast.success(
        scheduleType === 'now'
          ? 'Post published successfully!'
          : 'Post scheduled successfully!'
      );
    } catch (error) {
      setSubmitStep('error');
      toast.error((error as Error).message);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0c]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (loadError || !video) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0c]">
        <div className="max-w-md text-center">
          <h2 className="mb-2 text-lg font-medium text-white">
            Unable to Load Video
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">
            {loadError || 'The rendered video could not be found.'}
          </p>
          <Button variant="outline" onClick={() => window.close()}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  // Success state
  if (submitStep === 'done') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0c]">
        <div className="max-w-md text-center">
          <div className="mb-4 mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-500/20">
            <Check className="h-7 w-7 text-green-400" />
          </div>
          <h2 className="mb-2 text-lg font-medium text-white">
            {scheduleType === 'now' ? 'Post Published!' : 'Post Scheduled!'}
          </h2>
          <p className="mb-6 text-sm text-muted-foreground">
            {scheduleType === 'now'
              ? 'Your video has been published to the selected platforms.'
              : `Your video will be published on ${scheduledDate} at ${scheduledTime}.`}
          </p>
          <Button onClick={() => window.close()}>Close</Button>
        </div>
      </div>
    );
  }

  const isSubmitting =
    submitStep === 'uploading' ||
    submitStep === 'creating' ||
    submitStep === 'scheduling';

  const submitLabel = (() => {
    switch (submitStep) {
      case 'uploading':
        return 'Uploading media...';
      case 'creating':
        return 'Creating post...';
      case 'scheduling':
        return scheduleType === 'now' ? 'Publishing...' : 'Scheduling...';
      default:
        return scheduleType === 'now' ? 'Publish Now' : 'Schedule Post';
    }
  })();

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white">
      {/* Header */}
      <header className="border-b border-white/[0.06] px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center gap-4">
          <button
            type="button"
            onClick={() => window.history.back()}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-medium">Publish to Social Media</h1>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
          {/* Left: Video preview */}
          <div className="space-y-4">
            <div className="overflow-hidden rounded-xl border border-white/[0.08]">
              <video
                src={video.url}
                controls
                className="w-full"
                style={{ maxHeight: 400 }}
              />
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {video.language && (
                <span className="rounded bg-white/10 px-2 py-0.5 font-semibold uppercase">
                  {video.language}
                </span>
              )}
              {video.resolution && <span>{video.resolution}</span>}
              {video.duration && (
                <span>
                  {Math.floor(video.duration / 60)}:
                  {Math.floor(video.duration % 60)
                    .toString()
                    .padStart(2, '0')}
                </span>
              )}
            </div>
          </div>

          {/* Right: Form */}
          <div className="space-y-6">
            {/* Accounts */}
            <section>
              <h2 className="mb-3 text-sm font-medium text-zinc-300">
                Select Accounts
              </h2>
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
                onGenerateCaption={handleGenerateCaption}
                isGenerating={isGeneratingCaption}
              />
            </section>

            {/* Platform-specific options */}
            {(hasFacebook || hasYouTube || hasTikTok || hasInstagram) && (
              <section className="space-y-4">
                <h2 className="text-sm font-medium text-zinc-300">
                  Platform Options
                </h2>
                {hasFacebook && (
                  <FacebookOptions
                    value={facebookOptions}
                    onChange={setFacebookOptions}
                  />
                )}
                {hasYouTube && (
                  <YouTubeOptions
                    value={youtubeOptions}
                    onChange={setYoutubeOptions}
                  />
                )}
                {hasTikTok && (
                  <TikTokOptions
                    accounts={tiktokAccounts}
                    value={tiktokOptions}
                    onChange={setTiktokOptions}
                  />
                )}
                {hasInstagram && (
                  <InstagramOptions
                    value={instagramOptions}
                    onChange={setInstagramOptions}
                  />
                )}
              </section>
            )}

            {/* Schedule */}
            <section>
              <SchedulePicker
                scheduleType={scheduleType}
                onScheduleTypeChange={setScheduleType}
                scheduledDate={scheduledDate}
                onScheduledDateChange={setScheduledDate}
                scheduledTime={scheduledTime}
                onScheduledTimeChange={setScheduledTime}
                timezone={timezone}
                onTimezoneChange={setTimezone}
              />
            </section>

            {/* Submit */}
            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => window.history.back()}
                className="h-11 rounded-xl border-zinc-800 bg-zinc-900/50 px-6 text-[13px] font-medium text-white hover:bg-zinc-800 hover:text-white"
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting || selectedAccountIds.length === 0}
                className="h-11 flex-1 gap-2 rounded-xl text-[13px] font-medium"
              >
                {isSubmitting && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {submitLabel}
              </Button>
            </div>

            {submitStep === 'error' && (
              <p className="text-xs text-red-400">
                Something went wrong. Please try again.
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
