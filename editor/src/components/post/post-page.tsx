'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { Loader2, Check, ArrowLeft, AlertTriangle, ExternalLink, XCircle, CheckCircle2, RotateCcw } from 'lucide-react';
import { pollPostStatus } from '@/lib/post/poll-post-status';
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
  PostVerificationResult,
} from '@/types/post';
import type { CaptionStyleOptions } from '@/types/caption-style';
import { DEFAULT_CAPTION_STYLE } from '@/types/caption-style';

interface PostPageProps {
  renderedVideoId: string;
}

type SubmitStep = 'idle' | 'preflight' | 'uploading' | 'creating' | 'scheduling' | 'verifying' | 'done' | 'error';

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
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [verifyingLabel, setVerifyingLabel] = useState('Waiting for confirmation...');
  const [verificationResult, setVerificationResult] = useState<PostVerificationResult | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      pollAbortRef.current?.abort();
    };
  }, []);

  // AI caption generation
  const [isGeneratingCaption, setIsGeneratingCaption] = useState(false);
  const [captionStyle, setCaptionStyle] =
    useState<CaptionStyleOptions>(DEFAULT_CAPTION_STYLE);

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

  // Auto-suggest Short length when only TikTok is selected
  useEffect(() => {
    if (
      selectedProviders.length === 1 &&
      selectedProviders[0] === 'tiktok'
    ) {
      setCaptionStyle((prev) => ({ ...prev, length: 'short' }));
    }
  }, [selectedProviders]);

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
          caption_style: captionStyle,
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

    setSubmitError(null);
    setVerificationResult(null);

    try {
      // Step 0: Preflight — check account authorization
      setSubmitStep('preflight');
      const unauthorizedAccounts = selectedAccounts.filter((a) => !a.authorized);
      if (unauthorizedAccounts.length > 0) {
        const names = unauthorizedAccounts
          .map((a) => `${a.name} (${a.provider})`)
          .join(', ');
        throw new Error(
          `The following accounts need to be re-authorized in Mixpost: ${names}`
        );
      }

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

      // Step 4: Verify actual publish status (only for "post now")
      if (scheduleType === 'now') {
        setSubmitStep('verifying');
        setVerifyingLabel('Waiting for confirmation...');

        pollAbortRef.current = new AbortController();

        const result = await pollPostStatus({
          postUuid: post.uuid,
          signal: pollAbortRef.current.signal,
          onStatusChange: (status) => {
            if (status === 'publishing') {
              setVerifyingLabel('Publishing to platforms...');
            }
          },
        });

        pollAbortRef.current = null;
        setVerificationResult(result);

        if (result.status === 'failed') {
          const failedAccounts = result.accounts.filter((a) => a.errors.length > 0);
          const errorSummary = failedAccounts
            .map((a) => `${a.accountName} (${a.provider}): ${a.errors.join(', ')}`)
            .join('\n');
          setSubmitError(errorSummary || 'Post failed on one or more platforms.');
          setSubmitStep('error');
          return;
        }

        // published or timeout (scheduled fallback)
        setSubmitStep('done');
        if (result.status === 'published') {
          toast.success('Post published successfully!');
        }
        // If still 'scheduled' after timeout, we show a warning in the done screen
      } else {
        // Scheduled posts skip verification
        setSubmitStep('done');
        toast.success('Post scheduled successfully!');
      }
    } catch (error) {
      setSubmitStep('error');
      setSubmitError((error as Error).message);
      toast.error((error as Error).message);
    }
  };

  const handleReset = () => {
    setSubmitStep('idle');
    setSubmitError(null);
    setVerificationResult(null);
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
    const isTimedOut =
      scheduleType === 'now' &&
      verificationResult?.status === 'scheduled';
    const isVerifiedPublished =
      scheduleType === 'now' &&
      verificationResult?.status === 'published';
    const hasPerAccountResults =
      verificationResult &&
      verificationResult.accounts.length > 0;

    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0c]">
        <div className="max-w-md w-full text-center">
          {isTimedOut ? (
            <div className="mb-4 mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-yellow-500/20">
              <AlertTriangle className="h-7 w-7 text-yellow-400" />
            </div>
          ) : (
            <div className="mb-4 mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-500/20">
              <Check className="h-7 w-7 text-green-400" />
            </div>
          )}

          <h2 className="mb-2 text-lg font-medium text-white">
            {isTimedOut
              ? 'Post Queued'
              : scheduleType === 'now'
                ? 'Post Published!'
                : 'Post Scheduled!'}
          </h2>

          <p className="mb-4 text-sm text-muted-foreground">
            {isTimedOut
              ? 'Your post was queued but confirmation is taking longer than expected. Check Mixpost for the final status.'
              : scheduleType === 'now'
                ? 'Your video has been published to the selected platforms.'
                : `Your video will be published on ${scheduledDate} at ${scheduledTime}.`}
          </p>

          {/* Per-account results */}
          {isVerifiedPublished && hasPerAccountResults && (
            <div className="mb-6 space-y-2 text-left">
              {verificationResult.accounts.map((account) => (
                <div
                  key={account.accountId}
                  className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-zinc-900/40 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    {account.errors.length > 0 ? (
                      <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
                    )}
                    <span className="text-sm text-white">
                      {account.accountName}
                    </span>
                    <span className="text-[10px] uppercase text-zinc-500">
                      {account.provider}
                    </span>
                  </div>
                  {account.external_url && (
                    <a
                      href={account.external_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                    >
                      View <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {account.errors.length > 0 && (
                    <span className="text-xs text-red-400">
                      {account.errors[0]}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          <Button onClick={() => window.close()}>Close</Button>
        </div>
      </div>
    );
  }

  // Error state (full-screen when post failed during verification or submission)
  if (submitStep === 'error') {
    const failedAccounts = verificationResult?.accounts.filter(
      (a) => a.errors.length > 0
    );

    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0c]">
        <div className="max-w-md w-full text-center">
          <div className="mb-4 mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-500/20">
            <XCircle className="h-7 w-7 text-red-400" />
          </div>
          <h2 className="mb-2 text-lg font-medium text-white">
            Publishing Failed
          </h2>

          {/* Per-account errors from Mixpost */}
          {failedAccounts && failedAccounts.length > 0 ? (
            <div className="mb-6 space-y-2 text-left">
              {failedAccounts.map((account) => (
                <div
                  key={account.accountId}
                  className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                    <span className="text-sm font-medium text-white">
                      {account.accountName}
                    </span>
                    <span className="text-[10px] uppercase text-zinc-500">
                      {account.provider}
                    </span>
                  </div>
                  {account.errors.map((err, i) => (
                    <p key={i} className="text-xs text-red-400 ml-5.5">
                      {err}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <p className="mb-6 text-sm text-muted-foreground">
              {submitError || 'Something went wrong. Please try again.'}
            </p>
          )}

          <div className="flex gap-3 justify-center">
            <Button
              variant="outline"
              onClick={handleReset}
              className="gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              Try Again
            </Button>
            <Button variant="outline" onClick={() => window.close()}>
              Close
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const isSubmitting =
    submitStep === 'preflight' ||
    submitStep === 'uploading' ||
    submitStep === 'creating' ||
    submitStep === 'scheduling' ||
    submitStep === 'verifying';

  const submitLabel = (() => {
    switch (submitStep) {
      case 'preflight':
        return 'Checking accounts...';
      case 'uploading':
        return 'Uploading media...';
      case 'creating':
        return 'Creating post...';
      case 'scheduling':
        return scheduleType === 'now' ? 'Publishing...' : 'Scheduling...';
      case 'verifying':
        return verifyingLabel;
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
                captionStyle={captionStyle}
                onCaptionStyleChange={setCaptionStyle}
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

          </div>
        </div>
      </main>
    </div>
  );
}
