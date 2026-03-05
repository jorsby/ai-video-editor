'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { Loader2, Check, ArrowLeft, ExternalLink, XCircle, CheckCircle2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AccountSelector } from './account-selector';
import { CaptionEditor } from './caption-editor';
import { SchedulePicker } from './schedule-picker';
import { getTodayInTimezone } from '@/lib/schedule-validation';
import { INSTAGRAM_REELS_MAX_SECONDS } from '@/lib/constants/social-limits';
import { FacebookOptions } from './platform-options/facebook-options';
import { YouTubeOptions } from './platform-options/youtube-options';
import { TikTokOptions } from './platform-options/tiktok-options';
import { InstagramOptions } from './platform-options/instagram-options';
import type { RenderedVideo } from '@/types/rendered-video';
import type {
  SocialAccount,
  AccountGroup,
  AccountTag,
  SocialPost,
  SocialPostAccount,
} from '@/types/social';
import type {
  PlatformOptions,
  FacebookOptions as FacebookOptionsType,
  YouTubeOptions as YouTubeOptionsType,
  TikTokAccountOptions,
  InstagramOptions as InstagramOptionsType,
} from '@/types/post';
import type { CaptionStyleOptions } from '@/types/caption-style';
import { DEFAULT_CAPTION_STYLE } from '@/types/caption-style';
import type { LanguageCode } from '@/lib/constants/languages';

interface PostPageProps {
  renderedVideoId: string;
}

type SubmitStep = 'idle' | 'preflight' | 'submitting' | 'done' | 'error';

export function PostPage({ renderedVideoId }: PostPageProps) {
  // Data loading
  const [video, setVideo] = useState<RenderedVideo | null>(null);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [groups, setGroups] = useState<AccountGroup[]>([]);
  const [tags, setTags] = useState<Record<string, AccountTag[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form state
  const [caption, setCaption] = useState('');
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
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
  const [postResult, setPostResult] = useState<{ post: SocialPost & { post_accounts: SocialPostAccount[] } } | null>(null);
  const isSubmittingRef = useRef(false);

  // AI caption generation
  const [isGeneratingCaption, setIsGeneratingCaption] = useState(false);
  const [captionStyle, setCaptionStyle] =
    useState<CaptionStyleOptions>(DEFAULT_CAPTION_STYLE);
  const [captionLanguage, setCaptionLanguage] = useState<LanguageCode>('en');

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
          fetch('/api/v2/accounts'),
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

        // The v2/accounts endpoint returns OctupostAccount objects and also syncs them to social_accounts.
        // Map to SocialAccount shape for the UI.
        const mappedAccounts: SocialAccount[] = (accountsData.accounts || []).map((a: {
          platform: string;
          account_id: string;
          account_name: string;
          account_username: string | null;
          language: string | null;
          expires_at: string;
        }) => ({
          id: a.account_id, // use account_id as the row id since we don't have the DB id
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

        // Load groups and tags if available
        try {
          const [groupsRes, tagsRes] = await Promise.all([
            fetch('/api/account-groups'),
            fetch('/api/account-tags'),
          ]);
          if (groupsRes.ok) {
            const groupsData = await groupsRes.json();
            setGroups((groupsData.groups || []).map((g: any) => ({ ...g, account_ids: g.account_uuids || g.account_ids || [] })));
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

    // Hard block: Instagram Graph API rejects all videos > 90 seconds.
    if (
      hasInstagram &&
      video.duration &&
      video.duration > INSTAGRAM_REELS_MAX_SECONDS
    ) {
      toast.error(
        `This video is ${Math.round(video.duration)}s — Instagram's API rejects all videos over ${INSTAGRAM_REELS_MAX_SECONDS}s. Please re-export with a shorter timeline, or deselect Instagram.`
      );
      return;
    }

    isSubmittingRef.current = true;
    setSubmitError(null);
    setPostResult(null);

    try {
      // Step 0: Preflight
      setSubmitStep('preflight');

      // Build platform options
      const platformOptions: PlatformOptions = {};
      if (hasFacebook) platformOptions.facebook = facebookOptions;
      if (hasYouTube) platformOptions.youtube = youtubeOptions;
      if (hasTikTok) platformOptions.tiktok = tiktokOptions;
      if (hasInstagram) platformOptions.instagram = instagramOptions;

      // Single API call to create + publish/schedule
      setSubmitStep('submitting');

      const postBody = {
        caption,
        mediaUrl: video.url,
        mediaType: 'video' as const,
        accountIds: selectedAccountIds,
        scheduleType,
        scheduledDate: scheduleType === 'scheduled' ? scheduledDate : undefined,
        scheduledTime: scheduleType === 'scheduled' ? scheduledTime : undefined,
        timezone,
        platformOptions,
        projectId: video.project_id,
      };

      const res = await fetch('/api/v2/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postBody),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create post');
      }

      const data = await res.json();
      setPostResult(data);
      setSubmitStep('done');

      // Check for failures in the response
      const postAccounts: SocialPostAccount[] = data.post?.post_accounts || [];
      const failedAccounts = postAccounts.filter((pa) => pa.status === 'failed');

      if (failedAccounts.length > 0 && failedAccounts.length < postAccounts.length) {
        // Partial success
        const errorSummary = failedAccounts
          .map((a) => `${a.platform}: ${a.error_message || 'Unknown error'}`)
          .join('\n');
        setSubmitError(errorSummary);
        setSubmitStep('error');
        return;
      } else if (failedAccounts.length > 0) {
        // All failed
        const errorSummary = failedAccounts
          .map((a) => `${a.platform}: ${a.error_message || 'Unknown error'}`)
          .join('\n');
        setSubmitError(errorSummary || 'Post failed on all platforms.');
        setSubmitStep('error');
        return;
      }

      if (scheduleType === 'now') {
        toast.success('Post published successfully!');
      } else {
        toast.success('Post scheduled successfully!');
      }
    } catch (error) {
      setSubmitStep('error');
      setSubmitError((error as Error).message);
      toast.error((error as Error).message);
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const handleReset = () => {
    setSubmitStep('idle');
    setSubmitError(null);
    setPostResult(null);
  };

  const handleRetry = () => {
    // Narrow to only failed accounts so already-published accounts aren't double-posted
    if (postResult?.post?.post_accounts) {
      const failedIds = postResult.post.post_accounts
        .filter((a) => a.status === 'failed')
        .map((a) => a.octupost_account_id);
      if (failedIds.length > 0) {
        setSelectedAccountIds(failedIds);
      }
    }
    setSubmitStep('idle');
    setSubmitError(null);
    setPostResult(null);
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

  const isSubmitting = submitStep === 'preflight' || submitStep === 'submitting';
  const isPublishingOrResult = isSubmitting || submitStep === 'done' || submitStep === 'error';
  const isDone = submitStep === 'done';
  const isError = submitStep === 'error';

  const postAccounts: SocialPostAccount[] = postResult?.post?.post_accounts || [];
  const resultSucceededAccounts = postAccounts.filter(a => a.status === 'published');
  const hasPartialSuccess = isError && resultSucceededAccounts.length > 0;

  const headerTitle = isDone
    ? (scheduleType === 'now' ? 'Published!' : 'Post Scheduled!')
    : isError
      ? (hasPartialSuccess ? 'Partially Published' : 'Publishing Failed')
      : (scheduleType === 'now' ? 'Publishing...' : 'Scheduling...');

  const headerSubtitle = isDone
    ? (scheduleType === 'now'
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
  const PUBLISH_STEPS: Array<{ key: SubmitStep; label: string }> = [
    { key: 'preflight', label: 'Checking accounts' },
    { key: 'submitting', label: scheduleType === 'now' ? 'Publishing to platforms' : 'Scheduling post' },
  ];

  const STEP_ORDER: SubmitStep[] = ['preflight', 'submitting'];
  const currentStepIndex = (submitStep === 'done' || submitStep === 'error')
    ? STEP_ORDER.length
    : STEP_ORDER.indexOf(submitStep as SubmitStep);

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
                      </div>
                    );
                  })}
                </div>

                {/* Pre-verification error message */}
                {isError && submitError && (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3">
                    <p className="text-sm text-red-400 whitespace-pre-line">{submitError}</p>
                  </div>
                )}

                {/* Per-account status list */}
                {postAccounts.length > 0 ? (
                  <div className="space-y-2">
                    <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Accounts
                    </h3>
                    <div className="rounded-xl border border-white/[0.08] bg-zinc-900/40 divide-y divide-white/[0.06]">
                      {postAccounts.map((pa) => {
                        // Look up account name from loaded accounts
                        const acct = accounts.find(a => a.octupost_account_id === pa.octupost_account_id);
                        const displayName = pa.account_name ?? acct?.account_name ?? pa.platform;

                        return (
                          <div key={pa.id} className="flex items-center gap-3 px-4 py-3">
                            <div className="flex-shrink-0 flex items-center justify-center h-5 w-5">
                              {pa.status === 'failed' ? (
                                <XCircle className="h-4 w-4 text-red-400" />
                              ) : pa.status === 'published' ? (
                                <CheckCircle2 className="h-4 w-4 text-green-400" />
                              ) : (
                                <Loader2 className="h-4 w-4 text-zinc-500 animate-spin" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="text-sm font-medium text-white truncate block">
                                {displayName}
                              </span>
                              <span className="text-[10px] uppercase text-zinc-500">
                                {pa.platform}
                              </span>
                              {pa.error_message && (
                                <span className="text-xs text-red-400 block mt-0.5">
                                  {pa.error_message}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
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
                        <div key={account.octupost_account_id} className="flex items-center gap-3 px-4 py-3">
                          <div className={`h-2 w-2 rounded-full flex-shrink-0 ${providerColor(account.platform)}`} />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium text-white truncate block">
                              {account.account_name ?? account.octupost_account_id}
                            </span>
                            <span className="text-[10px] uppercase text-zinc-500">
                              {account.platform}
                            </span>
                          </div>
                          <Loader2 className="h-4 w-4 animate-spin text-zinc-500 flex-shrink-0" />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {isDone &&
                  resultSucceededAccounts.length > 0 && (
                    <div className="rounded-xl border border-green-500/20 bg-green-500/5 px-4 py-4 space-y-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-green-400">
                        Published to {resultSucceededAccounts.length} account{resultSucceededAccounts.length > 1 ? 's' : ''}
                      </p>
                    </div>
                  )}

                {/* Footer: action buttons after done/error */}
                {(isDone || isError) && (
                  <div className="flex gap-3">
                    {isError && (
                      <Button variant="outline" onClick={handleRetry} className="gap-2">
                        <RotateCcw className="h-4 w-4" />
                        Retry
                      </Button>
                    )}
                    {isError && (
                      <Button variant="outline" onClick={handleReset}>
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
                    minDate={getTodayInTimezone(timezone)}
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
