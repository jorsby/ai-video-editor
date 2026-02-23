'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { Loader2, Check, ArrowLeft, ExternalLink, XCircle, CheckCircle2, RotateCcw } from 'lucide-react';
import { pollPostStatus, PollAuthError } from '@/lib/post/poll-post-status';
import { savePendingPost } from '@/lib/post/pending-posts-store';
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
import type { LanguageCode } from '@/lib/constants/languages';
import { fetchWithRetry, pollMediaDownload } from '@/lib/post/publish-utils';

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
  const [verifyElapsed, setVerifyElapsed] = useState(0);
  const pollAbortRef = useRef<AbortController | null>(null);
  const isSubmittingRef = useRef(false);

  // Track created resources so retry can re-use them instead of creating duplicates
  const [createdMediaId, setCreatedMediaId] = useState<number | null>(null);
  const [createdPostUuid, setCreatedPostUuid] = useState<string | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      pollAbortRef.current?.abort();
    };
  }, []);

  // Elapsed timer while verifying
  useEffect(() => {
    if (submitStep !== 'verifying') {
      setVerifyElapsed(0);
      return;
    }
    const interval = setInterval(() => {
      setVerifyElapsed((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [submitStep]);

  // AI caption generation
  const [isGeneratingCaption, setIsGeneratingCaption] = useState(false);
  const [captionStyle, setCaptionStyle] =
    useState<CaptionStyleOptions>(DEFAULT_CAPTION_STYLE);
  const [captionLanguage, setCaptionLanguage] = useState<LanguageCode>('en');

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

  // Sync caption language from video once loaded
  useEffect(() => {
    if (video?.language) {
      setCaptionLanguage(video.language as LanguageCode);
    }
  }, [video?.language]);

  const handleGenerateCaption = async () => {
    if (!video?.project_id) return;

    setIsGeneratingCaption(true);
    try {
      const res = await fetch('/api/generate-caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: video.project_id,
          language: captionLanguage,
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

      if (data.youtube_title) {
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
    if (isSubmittingRef.current) return;

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

    if (hasYouTube && !youtubeOptions.title.trim()) {
      toast.error('Please enter a YouTube title');
      return;
    }

    isSubmittingRef.current = true;
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

      // Step 1: Upload media to Mixpost (skip if already uploaded in a previous attempt)
      let mediaId = createdMediaId;
      if (!mediaId) {
        setSubmitStep('uploading');
        const mediaRes = await fetchWithRetry('/api/mixpost/media', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: video.url }),
        });

        if (!mediaRes.ok) {
          const err = await mediaRes.json();
          throw new Error(err.error || 'Failed to upload media');
        }

        const mediaResData = await mediaRes.json();

        // 202 = server-side polling exhausted; continue polling client-side
        if (mediaRes.status === 202 && mediaResData.pending && mediaResData.download_id) {
          const resolvedMedia = await pollMediaDownload(mediaResData.download_id);
          mediaId = Number(resolvedMedia.id);
        } else {
          mediaId = Number(mediaResData.media.id);
        }
        setCreatedMediaId(mediaId);
      }

      // Step 2: Create post (skip if already created in a previous attempt)
      let postUuid = createdPostUuid;
      if (!postUuid) {
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

        const postRes = await fetchWithRetry('/api/mixpost/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(postBody),
        });

        if (!postRes.ok) {
          const err = await postRes.json();
          throw new Error(err.error || 'Failed to create post');
        }

        const { post } = await postRes.json();
        postUuid = post.uuid as string;
        setCreatedPostUuid(postUuid);
      }

      // Step 3: Schedule/publish (with retry)
      setSubmitStep('scheduling');

      const scheduleRes = await fetchWithRetry('/api/mixpost/posts/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postUuid,
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
          postUuid,
          signal: pollAbortRef.current.signal,
          onStatusChange: (status) => {
            if (status === 'publishing') {
              setVerifyingLabel('Publishing to platforms...');
            }
          },
        });

        pollAbortRef.current = null;
        setVerificationResult(result);

        const failedAccounts = result.accounts.filter((a) => a.errors.length > 0);
        const succeededAccounts = result.accounts.filter((a) => a.status === 'published');

        if (result.status === 'failed') {
          // Partial success: some platforms published, some failed
          if (succeededAccounts.length > 0) {
            const errorSummary = failedAccounts
              .map((a) => `${a.accountName} (${a.provider}): ${a.errors.join(', ')}`)
              .join('\n');
            setSubmitError(errorSummary);
            setSubmitStep('error');
            return;
          }

          // Total failure: no platforms published
          const errorSummary = failedAccounts
            .map((a) => `${a.accountName} (${a.provider}): ${a.errors.join(', ')}`)
            .join('\n');
          setSubmitError(errorSummary || 'Post failed on all platforms.');
          setSubmitStep('error');
          return;
        }

        // published or timeout (unconfirmed)
        setSubmitStep('done');
        if (result.status === 'published') {
          toast.success('Post published successfully!');
        } else if (result.status === 'unconfirmed') {
          // Save to localStorage so the background check can notify when it eventually confirms
          savePendingPost(postUuid, selectedAccounts.map((a) => a.name));
        }
      } else {
        // Scheduled posts skip verification
        setSubmitStep('done');
        toast.success('Post scheduled successfully!');
      }
    } catch (error) {
      setSubmitStep('error');
      if (error instanceof PollAuthError) {
        setSubmitError('Your session expired while verifying the post. The post may have published — check Mixpost for the current status.');
      } else {
        setSubmitError((error as Error).message);
      }
      toast.error((error as Error).message);
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const handleReset = () => {
    setSubmitStep('idle');
    setSubmitError(null);
    setVerificationResult(null);
    setVerifyElapsed(0);
    setCreatedPostUuid(null); // Always create a fresh post; media is reused
  };

  const handleRetry = () => {
    // Narrow to only failed accounts so already-published accounts aren't double-posted
    if (verificationResult?.accounts && verificationResult.accounts.length > 0) {
      const failedIds = verificationResult.accounts
        .filter((a) => a.status === 'failed')
        .map((a) => a.accountId);
      if (failedIds.length > 0) {
        setSelectedAccountIds(failedIds);
      }
    }
    setSubmitStep('idle');
    setSubmitError(null);
    setVerificationResult(null);
    setVerifyElapsed(0);
    setCreatedPostUuid(null);
  };

  const handleFullReset = () => {
    setSubmitStep('idle');
    setSubmitError(null);
    setVerificationResult(null);
    setVerifyElapsed(0);
    setCreatedMediaId(null);
    setCreatedPostUuid(null);
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

  const isSubmitting =
    submitStep === 'preflight' ||
    submitStep === 'uploading' ||
    submitStep === 'creating' ||
    submitStep === 'scheduling' ||
    submitStep === 'verifying';

  const isPublishingOrResult = isSubmitting || submitStep === 'done' || submitStep === 'error';

  const isDone = submitStep === 'done';
  const isError = submitStep === 'error';
  const resultSucceededAccounts = verificationResult?.accounts.filter(a => a.status === 'published') ?? [];
  const hasPartialSuccess = isError && resultSucceededAccounts.length > 0;

  const headerTitle = isDone
    ? (verificationResult?.status === 'unconfirmed'
        ? 'Post Processing'
        : scheduleType === 'now' ? 'Published!' : 'Post Scheduled!')
    : isError
      ? (hasPartialSuccess ? 'Partially Published' : 'Publishing Failed')
      : (scheduleType === 'now' ? 'Publishing...' : 'Scheduling...');

  const headerSubtitle = isDone
    ? (verificationResult?.status === 'unconfirmed'
        ? 'Your video has been sent to all platforms and is being processed. Check back in Mixpost to see the final status.'
        : scheduleType === 'now'
          ? 'Your video has been published to the selected platforms.'
          : `Your video will be published on ${scheduledDate} at ${scheduledTime}.`)
    : isError
      ? (hasPartialSuccess
          ? 'Post failed on one or more platforms.'
          : 'Something went wrong while publishing.')
      : (scheduleType === 'now'
          ? 'Your video is being sent to your selected platforms.'
          : 'Your post is being prepared and scheduled.');

  // Progress panel helpers
  const STEP_ORDER: SubmitStep[] = ['preflight', 'uploading', 'creating', 'scheduling', 'verifying'];
  const currentStepIndex = (submitStep === 'done' || submitStep === 'error')
    ? STEP_ORDER.length  // past all steps → all marked done
    : STEP_ORDER.indexOf(submitStep as SubmitStep);

  const PUBLISH_STEPS: Array<{ key: SubmitStep; label: string }> = scheduleType === 'now'
    ? [
        { key: 'preflight',  label: 'Checking accounts' },
        { key: 'uploading',  label: 'Uploading media' },
        { key: 'creating',   label: 'Creating post' },
        { key: 'scheduling', label: 'Sending to platforms' },
        { key: 'verifying',  label: 'Waiting for confirmation' },
      ]
    : [
        { key: 'preflight',  label: 'Checking accounts' },
        { key: 'uploading',  label: 'Uploading media' },
        { key: 'creating',   label: 'Creating post' },
        { key: 'scheduling', label: 'Scheduling post' },
      ];

  function providerColor(provider: string): string {
    const map: Record<string, string> = {
      facebook: 'bg-blue-500', instagram: 'bg-pink-500',
      tiktok: 'bg-zinc-400', youtube: 'bg-red-500',
      twitter: 'bg-sky-400', x: 'bg-zinc-400',
    };
    return map[provider] ?? 'bg-zinc-600';
  }

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

          {/* Right: Form or Progress Panel */}
          <div className="space-y-6">
            {isPublishingOrResult ? (
              /* Progress panel — shown while publishing/scheduling is in flight and after completion */
              <div className="flex flex-col gap-6">
                {/* Header */}
                <div>
                  <h2 className="text-base font-semibold text-white">
                    {headerTitle}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {headerSubtitle}
                  </p>
                </div>

                {/* Step tracker */}
                <div className="rounded-xl border border-white/[0.08] bg-zinc-900/40 p-4 space-y-3">
                  {PUBLISH_STEPS.map((step, idx) => {
                    const isStepDone = currentStepIndex > idx;
                    const isActive = currentStepIndex === idx;
                    return (
                      <div key={step.key} className="flex items-center gap-3">
                        <div className="flex-shrink-0 flex items-center justify-center h-6 w-6">
                          {isStepDone ? (
                            <CheckCircle2 className="h-5 w-5 text-green-400" />
                          ) : isActive ? (
                            <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
                          ) : (
                            <div className="h-5 w-5 rounded-full border border-white/20" />
                          )}
                        </div>
                        <span
                          className={
                            isStepDone
                              ? 'text-sm text-zinc-500 line-through'
                              : isActive
                                ? 'text-sm font-medium text-white'
                                : 'text-sm text-zinc-500'
                          }
                        >
                          {step.label}
                        </span>
                        {step.key === 'verifying' && isActive && verifyElapsed > 0 && (
                          <span className="ml-auto text-xs text-zinc-500">{verifyElapsed}s</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Contextual message during long video verification */}
                {submitStep === 'verifying' && verifyElapsed > 30 && (
                  <p className="text-xs text-zinc-500 text-center">
                    Video posts can take a few minutes to process across all platforms — this is normal.
                  </p>
                )}

                {/* Pre-verification error message */}
                {isError && !verificationResult && submitError && (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3">
                    <p className="text-sm text-red-400">{submitError}</p>
                  </div>
                )}

                {/* Per-account status list */}
                {(verificationResult?.accounts.length ?? 0) > 0 ? (
                  /* Results available — show per-account outcome */
                  <div className="space-y-2">
                    <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Accounts
                    </h3>
                    <div className="rounded-xl border border-white/[0.08] bg-zinc-900/40 divide-y divide-white/[0.06]">
                      {verificationResult!.accounts.map((account) => (
                        <div key={account.accountId} className="flex items-center gap-3 px-4 py-3">
                          <div className="flex-shrink-0 flex items-center justify-center h-5 w-5">
                            {account.errors.length > 0 ? (
                              <XCircle className="h-4 w-4 text-red-400" />
                            ) : verificationResult?.status === 'unconfirmed' ? (
                              <Loader2 className="h-4 w-4 text-zinc-500 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-4 w-4 text-green-400" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium text-white truncate block">
                              {account.accountName}
                            </span>
                            <span className="text-[10px] uppercase text-zinc-500">
                              {account.provider}
                            </span>
                            {account.errors.length > 0 && (
                              <span className="text-xs text-red-400 block mt-0.5">
                                {account.errors[0]}
                              </span>
                            )}
                          </div>
                          {account.external_url && (
                            <a
                              href={account.external_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-xs font-medium text-blue-400 hover:text-blue-300 border border-blue-500/30 hover:border-blue-400/50 rounded-md px-2 py-0.5 shrink-0 transition-colors"
                            >
                              View post <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : selectedAccounts.length > 0 && isSubmitting ? (
                  /* In-flight — show spinner list */
                  <div className="space-y-2">
                    <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Accounts
                    </h3>
                    <div className="rounded-xl border border-white/[0.08] bg-zinc-900/40 divide-y divide-white/[0.06]">
                      {selectedAccounts.map((account) => (
                        <div key={account.id} className="flex items-center gap-3 px-4 py-3">
                          <div className={`h-2 w-2 rounded-full flex-shrink-0 ${providerColor(account.provider)}`} />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium text-white truncate block">
                              {account.name}
                            </span>
                            <span className="text-[10px] uppercase text-zinc-500">
                              {account.provider}
                            </span>
                          </div>
                          <Loader2 className="h-4 w-4 animate-spin text-zinc-500 flex-shrink-0" />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : selectedAccounts.length > 0 && verificationResult?.status === 'unconfirmed' ? (
                  /* Timed out with no account data — show neutral processing rows */
                  <div className="space-y-2">
                    <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Accounts
                    </h3>
                    <div className="rounded-xl border border-white/[0.08] bg-zinc-900/40 divide-y divide-white/[0.06]">
                      {selectedAccounts.map((account) => (
                        <div key={account.id} className="flex items-center gap-3 px-4 py-3">
                          <Loader2 className="h-4 w-4 text-zinc-500 animate-spin flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium text-white truncate block">
                              {account.name}
                            </span>
                            <span className="text-[10px] uppercase text-zinc-500">
                              {account.provider} · Processing
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {isDone &&
                  verificationResult?.status === 'published' &&
                  verificationResult.accounts.some((a) => a.external_url) && (
                    <div className="rounded-xl border border-green-500/20 bg-green-500/5 px-4 py-4 space-y-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-green-400">
                        Live on
                      </p>
                      <div className="flex flex-col gap-2">
                        {verificationResult.accounts
                          .filter((a) => a.external_url)
                          .map((account) => (
                            <a
                              key={account.accountId}
                              href={account.external_url!}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 text-sm text-white hover:text-green-300 transition-colors group"
                            >
                              <ExternalLink className="h-3.5 w-3.5 text-green-400 flex-shrink-0 group-hover:text-green-300" />
                              <span className="truncate">{account.accountName}</span>
                              <span className="text-[10px] uppercase text-zinc-500 ml-auto flex-shrink-0">
                                {account.provider}
                              </span>
                            </a>
                          ))}
                      </div>
                    </div>
                  )}

                {/* Footer: escape hatch during verifying, or action buttons after done/error */}
                {submitStep === 'verifying' && verifyElapsed <= 30 && (
                  <p className="text-center text-xs text-muted-foreground">
                    Post is queued —{' '}
                    <button
                      type="button"
                      onClick={() => window.close()}
                      className="underline hover:text-foreground transition-colors"
                    >
                      close this window
                    </button>{' '}
                    and check the calendar for the final status.
                  </p>
                )}
                {(isDone || isError) && (
                  <div className="flex gap-3">
                    {isError && (
                      <Button variant="outline" onClick={handleRetry} className="gap-2">
                        <RotateCcw className="h-4 w-4" />
                        Retry
                      </Button>
                    )}
                    {isError && (
                      <Button variant="outline" onClick={handleFullReset}>
                        Start Over
                      </Button>
                    )}
                    <Button variant="outline" onClick={() => window.close()}>
                      Close
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              /* Form — shown when not submitting */
              <>
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
                    language={captionLanguage}
                    onLanguageChange={setCaptionLanguage}
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
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSubmit}
                    disabled={selectedAccountIds.length === 0 || isSubmitting}
                    className="h-11 flex-1 gap-2 rounded-xl text-[13px] font-medium"
                  >
                    {scheduleType === 'now' ? 'Publish Now' : 'Schedule Post'}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
