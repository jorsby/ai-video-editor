'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Loader2, ChevronRight, CheckCircle2, XCircle, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CaptionEditor } from '@/components/post/caption-editor';
import { SchedulePicker } from '@/components/post/schedule-picker';
import { fetchWithRetry, pollMediaDownload } from '@/lib/post/publish-utils';
import { pollPostStatus, PollAuthError } from '@/lib/post/poll-post-status';
import { savePendingPost } from '@/lib/post/pending-posts-store';
import type { RenderedVideo } from '@/types/rendered-video';
import type { MixpostAccount, AccountGroupWithMembers } from '@/types/mixpost';
import type { PostFormData, PlatformOptions, PostVerificationResult } from '@/types/post';
import type { CaptionStyleOptions } from '@/types/caption-style';
import { DEFAULT_CAPTION_STYLE } from '@/types/caption-style';

interface LanguageLane {
  language: string;
  video: RenderedVideo;
  caption: string;
  youtubeTitle: string;
  captionStyle: CaptionStyleOptions;
  assignedGroupId: string | null;
  captionStatus: 'idle' | 'generating' | 'done' | 'error';
  publishStatus: LanePublishStatus;
  createdMediaId: number | null;
  createdPostUuid: string | null;
}

type LanePublishPhase = 'idle' | 'preflight' | 'uploading' | 'creating' | 'scheduling' | 'verifying';

type LanePublishStatus =
  | { phase: LanePublishPhase }
  | { phase: 'done'; result: PostVerificationResult; scheduledAt?: string }
  | { phase: 'error'; message: string };

// Maps language codes to fuzzy group name keywords for auto-matching
const LANG_KEYWORDS: Record<string, string> = {
  en: 'english', tr: 'turkish', ar: 'arabic', es: 'spanish',
  fr: 'french', de: 'german', it: 'italian', pt: 'portuguese',
};

// Maps language code to flag emoji + display label
const LANG_META: Record<string, { flag: string; label: string }> = {
  en: { flag: '🇬🇧', label: 'EN' },
  tr: { flag: '🇹🇷', label: 'TR' },
  ar: { flag: '🇸🇦', label: 'AR' },
  es: { flag: '🇪🇸', label: 'ES' },
  fr: { flag: '🇫🇷', label: 'FR' },
  de: { flag: '🇩🇪', label: 'DE' },
  it: { flag: '🇮🇹', label: 'IT' },
  pt: { flag: '🇧🇷', label: 'PT' },
};

const LANG_BADGE_COLOR: Record<string, string> = {
  en: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  tr: 'bg-red-500/20 text-red-300 border-red-500/30',
  ar: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  es: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  fr: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
};

// Language order for consistent display
const LANG_ORDER = ['en', 'tr', 'ar', 'es', 'fr', 'de', 'it', 'pt'];

const PLACEHOLDER_TITLES = new Set(['unknown', 'n/a', 'title', 'youtube title', 'video title']);
function sanitizeYoutubeTitle(title: string | undefined | null): string {
  const t = (title ?? '').trim();
  return PLACEHOLDER_TITLES.has(t.toLowerCase()) ? '' : t;
}

function resolveAccountIds(
  groupId: string | null,
  groups: AccountGroupWithMembers[],
  accounts: MixpostAccount[]
): number[] {
  if (!groupId) return [];
  const group = groups.find(g => g.id === groupId);
  if (!group) return [];
  return accounts.filter(a => group.account_uuids.includes(a.uuid)).map(a => a.id);
}

function defaultPlatformOptions(
  accountIds: number[],
  accounts: MixpostAccount[],
  youtubeTitle: string
): PlatformOptions {
  const providers = accounts
    .filter(a => accountIds.includes(a.id))
    .map(a => a.provider);
  return {
    ...(providers.includes('instagram') && { instagram: { type: 'reel' } }),
    ...(providers.includes('facebook') && { facebook: { type: 'reel' } }),
    ...(providers.includes('youtube') && { youtube: { title: youtubeTitle, status: 'public' } }),
    ...(providers.includes('tiktok') && { tiktok: {} }),
  };
}

function formatDuration(secs: number | null): string {
  if (!secs) return '';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function parseResolution(resolution: string | null) {
  if (!resolution) return null;
  const m = resolution.match(/^(\d+)x(\d+)$/);
  if (!m) return null;
  const w = parseInt(m[1], 10), h = parseInt(m[2], 10);
  return w && h ? { width: w, height: h } : null;
}

function videoAspectRatio(resolution: string | null): string {
  const p = parseResolution(resolution);
  return p ? `${p.width} / ${p.height}` : '16 / 9';
}

function formatScheduledAt(isoString: string | undefined): string | null {
  if (!isoString) return null;
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return null;
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
}

function StepLabel({ phase, scheduleType }: { phase: string; scheduleType: 'now' | 'scheduled' }) {
  const labels: Record<string, string> = {
    preflight: 'Checking accounts...',
    uploading: 'Uploading video...',
    creating: 'Creating post...',
    scheduling: scheduleType === 'now' ? 'Posting now...' : 'Scheduling...',
    verifying: 'Confirming post...',
  };
  return (
    <span className="text-xs text-zinc-400 flex items-center gap-1.5">
      <Loader2 className="h-3 w-3 animate-spin" />
      {labels[phase] ?? phase}
    </span>
  );
}

interface WorkflowPageProps {
  projectId: string;
}

export function WorkflowPage({ projectId }: WorkflowPageProps) {
  const [lanes, setLanes] = useState<Record<string, LanguageLane>>({});
  const [accounts, setAccounts] = useState<MixpostAccount[]>([]);
  const [groups, setGroups] = useState<AccountGroupWithMembers[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  // Shared schedule state (applies to all lanes)
  const [scheduleType, setScheduleType] = useState<'now' | 'scheduled'>('now');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone
  );

  const laneAbortRefs = useRef<Record<string, AbortController>>({});

  const updateLane = useCallback((language: string, partial: Partial<LanguageLane>) => {
    setLanes(prev => ({
      ...prev,
      [language]: { ...prev[language], ...partial },
    }));
  }, []);

  // Load all data on mount
  useEffect(() => {
    async function load() {
      try {
        const [rendersRes, accountsRes, groupsRes] = await Promise.all([
          fetch(`/api/rendered-videos?project_id=${projectId}`),
          fetch('/api/mixpost/accounts'),
          fetch('/api/account-groups'),
        ]);

        if (!rendersRes.ok) throw new Error('Failed to load renders');
        if (!accountsRes.ok) throw new Error('Failed to load accounts');
        if (!groupsRes.ok) throw new Error('Failed to load groups');

        const { rendered_videos } = await rendersRes.json();
        const { accounts: loadedAccounts } = await accountsRes.json();
        const { groups: loadedGroups } = await groupsRes.json();

        setAccounts(loadedAccounts ?? []);
        setGroups(loadedGroups ?? []);

        // Deduplicate by language — keep newest per language code
        const byLanguage = new Map<string, RenderedVideo>();
        const sorted = [...(rendered_videos ?? [])].sort(
          (a: RenderedVideo, b: RenderedVideo) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        for (const rv of sorted) {
          if (!byLanguage.has(rv.language)) byLanguage.set(rv.language, rv);
        }

        // Build initial lanes with fuzzy auto-matched groups
        const initialLanes: Record<string, LanguageLane> = {};
        for (const [lang, video] of byLanguage) {
          const keyword = LANG_KEYWORDS[lang] ?? '';
          const autoGroup = keyword
            ? loadedGroups.find((g: AccountGroupWithMembers) =>
                g.name.toLowerCase().includes(keyword)
              )
            : null;

          initialLanes[lang] = {
            language: lang,
            video,
            caption: '',
            youtubeTitle: '',
            captionStyle: { ...DEFAULT_CAPTION_STYLE },
            assignedGroupId: autoGroup?.id ?? null,
            captionStatus: 'idle',
            publishStatus: { phase: 'idle' },
            createdMediaId: null,
            createdPostUuid: null,
          };
        }
        setLanes(initialLanes);
      } catch (err) {
        setLoadError((err as Error).message);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [projectId]);

  async function generateCaption(language: string) {
    const lane = lanes[language];
    if (!lane) return;

    if (!lane.assignedGroupId) {
      toast.warning(`Select a group for ${language.toUpperCase()} first — providers affect caption style and YouTube title.`);
      return;
    }

    updateLane(language, { captionStatus: 'generating' });

    try {
      const accountIds = resolveAccountIds(lane.assignedGroupId, groups, accounts);
      const providers = accounts
        .filter(a => accountIds.includes(a.id))
        .map(a => a.provider);

      const res = await fetch('/api/generate-caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          language,
          selected_providers: providers,
          duration: lane.video.duration ?? 30,
          caption_style: lane.captionStyle,
        }),
      });

      if (!res.ok) throw new Error('Caption generation failed');
      const { caption, youtube_title, hashtags } = await res.json();
      const hashtagStr =
        Array.isArray(hashtags) && hashtags.length
          ? '\n\n' + hashtags.map((t: string) => `#${t}`).join(' ')
          : '';
      updateLane(language, {
        caption: (caption ?? '') + hashtagStr,
        youtubeTitle: sanitizeYoutubeTitle(youtube_title),
        captionStatus: 'done',
      });
    } catch {
      updateLane(language, { captionStatus: 'error' });
      toast.error(`Caption generation failed for ${language.toUpperCase()}`);
    }
  }

  async function generateAllCaptions() {
    const langs = Object.keys(lanes);
    await Promise.allSettled(langs.map(lang => generateCaption(lang)));
  }

  async function publishLane(lane: LanguageLane) {
    const signal = laneAbortRefs.current[lane.language]?.signal;
    const accountIds = resolveAccountIds(lane.assignedGroupId, groups, accounts);

    // Preflight — check authorization
    updateLane(lane.language, { publishStatus: { phase: 'preflight' } });
    const unauthorized = accounts.filter(
      a => accountIds.includes(a.id) && !a.authorized
    );
    if (unauthorized.length > 0) {
      throw new Error(
        `Unauthorized accounts: ${unauthorized.map(a => `${a.name} (${a.provider})`).join(', ')}`
      );
    }

    // Upload (skip if we already have a mediaId from a previous attempt)
    let mediaId = lane.createdMediaId;
    if (!mediaId) {
      updateLane(lane.language, { publishStatus: { phase: 'uploading' } });
      const mediaRes = await fetchWithRetry('/api/mixpost/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: lane.video.url }),
      });
      if (!mediaRes.ok) {
        const err = await mediaRes.json();
        throw new Error(err.error || 'Upload failed');
      }
      const mediaData = await mediaRes.json();
      if (mediaRes.status === 202 && mediaData.pending && mediaData.download_id) {
        mediaId = (await pollMediaDownload(mediaData.download_id)).id;
      } else {
        mediaId = Number(mediaData.media.id);
      }
      updateLane(lane.language, { createdMediaId: mediaId });
    }

    // Create post (skip if we already have a postUuid from a previous attempt)
    let postUuid = lane.createdPostUuid;
    if (!postUuid) {
      updateLane(lane.language, { publishStatus: { phase: 'creating' } });
      const hasYouTube = accounts
        .filter(a => accountIds.includes(a.id))
        .some(a => a.provider === 'youtube');
      const ytTitle = lane.youtubeTitle || lane.caption.slice(0, 100);

      const postBody: PostFormData & { mediaId: number } = {
        caption: lane.caption,
        accountIds,
        mediaId,
        scheduleType,
        scheduledDate: scheduleType === 'scheduled' ? scheduledDate : undefined,
        scheduledTime: scheduleType === 'scheduled' ? scheduledTime : undefined,
        timezone,
        platformOptions: defaultPlatformOptions(
          accountIds,
          accounts,
          hasYouTube ? ytTitle : ''
        ),
      };

      const postRes = await fetchWithRetry('/api/mixpost/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postBody),
      });
      if (!postRes.ok) {
        const err = await postRes.json();
        throw new Error(err.error || 'Create post failed');
      }
      postUuid = (await postRes.json()).post.uuid as string;
      updateLane(lane.language, { createdPostUuid: postUuid });
    }

    // Schedule / publish
    updateLane(lane.language, { publishStatus: { phase: 'scheduling' } });
    const schedRes = await fetchWithRetry('/api/mixpost/posts/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postUuid, postNow: scheduleType === 'now' }),
    });
    if (!schedRes.ok) {
      const err = await schedRes.json();
      throw new Error(err.error || 'Schedule failed');
    }

    const schedData = await schedRes.json() as { success: boolean; scheduled_at?: string; postUuid: string };

    // Verify (only for "post now" — scheduled posts skip verification)
    if (scheduleType === 'now') {
      updateLane(lane.language, { publishStatus: { phase: 'verifying' } });
      const result = await pollPostStatus({ postUuid, signal });
      updateLane(lane.language, { publishStatus: { phase: 'done', result } });
      if (result.status === 'unconfirmed') {
        savePendingPost(postUuid, []);
      }
    } else {
      updateLane(lane.language, {
        publishStatus: {
          phase: 'done',
          result: { status: 'scheduled', accounts: [] } as unknown as PostVerificationResult,
          scheduledAt: schedData.scheduled_at ?? undefined,
        },
      });
    }
  }

  async function runWorkflow() {
    setIsRunning(true);

    // Snapshot current lanes before going async
    const snapshot = { ...lanes };
    const activeLanes = Object.values(snapshot).filter(
      l => l.assignedGroupId && l.caption.trim()
    );

    activeLanes.forEach(l => {
      laneAbortRefs.current[l.language] = new AbortController();
    });

    await Promise.allSettled(
      activeLanes.map(lane =>
        publishLane(lane).catch(err => {
          const msg =
            err instanceof PollAuthError
              ? 'Session expired during verification — check Mixpost for status.'
              : (err as Error).message;
          updateLane(lane.language, {
            publishStatus: { phase: 'error', message: msg },
          });
        })
      )
    );

    setIsRunning(false);
  }

  function retryLane(language: string) {
    // Capture snapshot of lane before state update
    const lane = lanes[language];
    if (!lane) return;

    // Reset status + clear postUuid (keep mediaId for idempotent retry)
    const retryLaneData: LanguageLane = {
      ...lane,
      publishStatus: { phase: 'idle' },
      createdPostUuid: null,
    };

    updateLane(language, {
      publishStatus: { phase: 'idle' },
      createdPostUuid: null,
    });

    laneAbortRefs.current[language] = new AbortController();

    publishLane(retryLaneData).catch(err => {
      updateLane(language, {
        publishStatus: { phase: 'error', message: (err as Error).message },
      });
    });
  }

  const laneList = Object.values(lanes).sort(
    (a, b) =>
      (LANG_ORDER.indexOf(a.language) === -1 ? 99 : LANG_ORDER.indexOf(a.language)) -
      (LANG_ORDER.indexOf(b.language) === -1 ? 99 : LANG_ORDER.indexOf(b.language))
  );

  const allLanesReady =
    laneList.length > 0 &&
    laneList.every(l => l.assignedGroupId && l.caption.trim() !== '');

  const completedLanesCount = laneList.filter(
    l => l.publishStatus.phase === 'done' || l.publishStatus.phase === 'error'
  ).length;

  const publishingActive = useMemo(
    () => laneList.some(l => l.publishStatus.phase !== 'idle'),
    [laneList]
  );

  const lanePillData = useMemo(() =>
    laneList
      .filter(l => l.publishStatus.phase !== 'idle')
      .map(l => {
        const meta = LANG_META[l.language] ?? { flag: '🌐', label: l.language.toUpperCase() };
        const status = l.publishStatus;
        return {
          language: l.language,
          flag: meta.flag,
          phase: status.phase,
          doneResult:
            status.phase === 'done'
              ? (status as { phase: 'done'; result: PostVerificationResult }).result.status
              : null,
        };
      }),
    [laneList]
  );

  const publishCounts = useMemo(() => {
    const active = laneList.filter(l => l.publishStatus.phase !== 'idle');
    const total = active.length;
    const done = active.filter(l => l.publishStatus.phase === 'done').length;
    const errors = active.filter(l => l.publishStatus.phase === 'error').length;
    const published = active.filter(
      l => l.publishStatus.phase === 'done' &&
      (l.publishStatus as { phase: 'done'; result: PostVerificationResult }).result.status === 'published'
    ).length;
    const scheduled = active.filter(
      l => l.publishStatus.phase === 'done' &&
      (l.publishStatus as { phase: 'done'; result: PostVerificationResult }).result.status === 'scheduled'
    ).length;
    return { total, finished: done + errors, published, scheduled, errors };
  }, [laneList]);

  const isAllDone = !isRunning && publishCounts.finished === publishCounts.total && publishCounts.total > 0;
  const isAllSuccess = isAllDone && publishCounts.errors === 0;

  function phaseText(phase: string, doneResult: string | null): string {
    if (phase === 'done') {
      if (doneResult === 'scheduled') return 'Scheduled';
      if (doneResult === 'published') return 'Published';
      return 'Done';
    }
    if (phase === 'error') return 'Failed';
    const map: Record<string, string> = {
      preflight: 'Checking', uploading: 'Uploading',
      creating: 'Creating', scheduling: 'Scheduling', verifying: 'Verifying',
    };
    return map[phase] ?? phase;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0c] flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-[#0a0a0c] flex items-center justify-center">
        <p className="text-red-400 text-sm">{loadError}</p>
      </div>
    );
  }

  if (laneList.length === 0) {
    return (
      <div className="min-h-screen bg-[#0a0a0c] flex items-center justify-center">
        <p className="text-zinc-400 text-sm">No rendered videos found for this project.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white flex flex-col">
      {/* Header */}
      <div className="border-b border-white/[0.06] px-6 py-4 flex items-center gap-4 shrink-0">
        <button
          onClick={() => window.close()}
          className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Close
        </button>
        <div className="h-4 w-px bg-white/10" />
        <h1 className="text-sm font-semibold">Publish All Languages</h1>
        <span className="text-xs text-zinc-500">{laneList.length} videos</span>
      </div>

      {/* Lane rows */}
      <div className="flex-1 overflow-auto px-6 py-6 space-y-4 pb-36">
        {laneList.map(lane => {
          const meta = LANG_META[lane.language] ?? {
            flag: '🌐',
            label: lane.language.toUpperCase(),
          };
          const badgeColor =
            LANG_BADGE_COLOR[lane.language] ??
            'bg-zinc-500/20 text-zinc-300 border-zinc-500/30';
          const accountIds = resolveAccountIds(lane.assignedGroupId, groups, accounts);
          const assignedAccounts = accounts.filter(a => accountIds.includes(a.id));
          const status = lane.publishStatus;
          const isPublishing =
            status.phase !== 'idle' &&
            status.phase !== 'done' &&
            status.phase !== 'error';
          const isDone = status.phase === 'done';
          const isError = status.phase === 'error';

          return (
            <div
              key={lane.language}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5"
            >
              {/* Lane header row */}
              <div className="flex items-center gap-3 mb-4">
                <span className="text-xl">{meta.flag}</span>
                <span
                  className={`rounded-md border px-2 py-0.5 text-xs font-bold ${badgeColor}`}
                >
                  {meta.label}
                </span>
                {lane.video.duration != null && (
                  <span className="text-xs text-zinc-500">
                    {formatDuration(lane.video.duration)}
                  </span>
                )}
                {lane.video.resolution && (
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-zinc-500">
                    {lane.video.resolution}
                  </span>
                )}

                {/* Status (right-aligned) */}
                <div className="ml-auto flex items-center gap-2">
                  {isPublishing && <StepLabel phase={status.phase} scheduleType={scheduleType} />}
                  {isDone && (() => {
                    const doneStatus = status as { phase: 'done'; result: PostVerificationResult; scheduledAt?: string };
                    const isScheduled = doneStatus.result.status === 'scheduled';
                    const formattedTime = isScheduled ? formatScheduledAt(doneStatus.scheduledAt) : null;
                    return (
                      <span className="flex items-center gap-1 text-xs text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {isScheduled
                          ? formattedTime ? `Scheduled · ${formattedTime}` : 'Scheduled'
                          : 'Published'}
                      </span>
                    );
                  })()}
                  {isError && (
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1 text-xs text-red-400">
                        <XCircle className="h-3.5 w-3.5" />
                        {(status as { phase: 'error'; message: string }).message}
                      </span>
                      <button
                        onClick={() => retryLane(lane.language)}
                        className="text-xs text-zinc-400 hover:text-white underline underline-offset-2"
                      >
                        Retry
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* 3-column pipeline: Video → Caption → Group */}
              <div className="grid grid-cols-1 lg:grid-cols-[180px_24px_1fr] gap-4 items-start">
                {/* Video preview */}
                <div
                  className="rounded-lg overflow-hidden border border-white/[0.06] bg-black w-full"
                  style={{ aspectRatio: videoAspectRatio(lane.video.resolution) }}
                >
                  <video
                    src={lane.video.url}
                    className="w-full h-full object-contain"
                    preload="metadata"
                    controls
                    playsInline
                  />
                </div>

                {/* Arrow connector — visible on large screens */}
                <div className="hidden lg:flex items-start justify-center pt-10 text-zinc-600">
                  <ChevronRight className="h-4 w-4" />
                </div>

                {/* Caption + Group */}
                <div className="space-y-4">
                  <CaptionEditor
                    value={lane.caption}
                    onChange={v => updateLane(lane.language, { caption: v })}
                    selectedAccounts={assignedAccounts}
                    onGenerateCaption={() => generateCaption(lane.language)}
                    isGenerating={lane.captionStatus === 'generating'}
                    captionStyle={lane.captionStyle}
                    onCaptionStyleChange={style => updateLane(lane.language, { captionStyle: style })}
                  />

                  {/* YouTube title — only shown when group has YouTube accounts */}
                  {assignedAccounts.some(a => a.provider === 'youtube') && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-zinc-400">
                        YouTube Title
                      </label>
                      <input
                        type="text"
                        value={lane.youtubeTitle}
                        onChange={e =>
                          updateLane(lane.language, { youtubeTitle: e.target.value })
                        }
                        placeholder="Video title for YouTube..."
                        disabled={isPublishing || isDone}
                        className="w-full rounded-md border border-white/[0.06] bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-white/20 disabled:opacity-50"
                      />
                    </div>
                  )}

                  {/* Group selector */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-400">
                      Account Group
                    </label>
                    <select
                      value={lane.assignedGroupId ?? ''}
                      onChange={e =>
                        updateLane(lane.language, {
                          assignedGroupId: e.target.value || null,
                        })
                      }
                      disabled={isPublishing || isDone}
                      className="w-full rounded-md border border-white/[0.06] bg-[#0a0a0c] px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/20 disabled:opacity-50"
                    >
                      <option value="">— Select a group —</option>
                      {groups.map(g => (
                        <option key={g.id} value={g.id}>
                          {g.name} ({g.account_uuids.length})
                        </option>
                      ))}
                    </select>

                    {/* Account preview */}
                    {assignedAccounts.length > 0 && (
                      <p className="text-[10px] text-zinc-500 leading-relaxed">
                        {assignedAccounts
                          .map(a => `${a.name} (${a.provider})`)
                          .join(' · ')}
                      </p>
                    )}
                  </div>

                  {/* Per-account results after publishing */}
                  {isDone &&
                    (status as { phase: 'done'; result: PostVerificationResult })
                      .result.accounts.length > 0 && (
                      <div className="space-y-1 pt-1">
                        {(
                          status as { phase: 'done'; result: PostVerificationResult }
                        ).result.accounts.map((acc, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            {acc.status === 'published' ? (
                              <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                            ) : (
                              <XCircle className="h-3 w-3 text-red-400 shrink-0" />
                            )}
                            <span className="text-zinc-300">{acc.accountName}</span>
                            <span className="text-zinc-600">{acc.provider}</span>
                            {acc.external_url && (
                              <a
                                href={acc.external_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400 hover:underline ml-1"
                              >
                                View →
                              </a>
                            )}
                            {acc.errors.length > 0 && (
                              <span className="text-red-400 ml-1">
                                {acc.errors.join(', ')}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Sticky footer */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-white/[0.06] bg-[#0a0a0c]/95 backdrop-blur-sm px-6 py-4">
        <div className="flex flex-col gap-3 max-w-screen-xl mx-auto">
          {/* Row 1: controls */}
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
            {/* Schedule picker — hidden once publishing starts; replaced by status when done */}
            {!publishingActive ? (
              <div className="flex-1">
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
              </div>
            ) : isAllDone ? (
              <div className="flex-1 flex items-center gap-2">
                {isAllSuccess ? (
                  <span className="flex items-center gap-1.5 text-sm text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    All {scheduleType === 'now' ? 'published' : 'scheduled'} successfully
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-sm text-zinc-400">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    Done &middot; {publishCounts.errors} failed
                  </span>
                )}
              </div>
            ) : null}

            {/* Action buttons */}
            <div className="flex items-center gap-3 shrink-0">
              {!publishingActive && (
                <Button
                  variant="outline"
                  onClick={generateAllCaptions}
                  disabled={isRunning}
                  className="border-zinc-700 text-zinc-300 hover:text-white"
                >
                  ✨ Generate All Captions
                </Button>
              )}

              <Button
                onClick={runWorkflow}
                disabled={!allLanesReady || isRunning || isAllSuccess}
                className={`gap-2 min-w-[160px] ${isAllSuccess ? 'bg-emerald-700 hover:bg-emerald-700 border-emerald-600 text-white opacity-100' : ''}`}
              >
                {isRunning ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {scheduleType === 'now' ? 'Publishing' : 'Scheduling'} ({publishCounts.finished}/{publishCounts.total})...
                  </>
                ) : isAllSuccess ? (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    {scheduleType === 'now'
                      ? `All Published (${publishCounts.published})`
                      : `All Scheduled (${publishCounts.scheduled})`}
                  </>
                ) : isAllDone && publishCounts.errors > 0 ? (
                  `⚠ Retry Failed (${publishCounts.errors})`
                ) : (
                  scheduleType === 'now'
                    ? `▶ Publish All (${laneList.length})`
                    : `⏰ Schedule All (${laneList.length})`
                )}
              </Button>
            </div>
          </div>

          {/* Row 2: per-lane progress pills — appears when publishing starts */}
          {publishingActive && (
            <div className="border-t border-white/[0.06] pt-3">
              <div className="flex flex-wrap items-center gap-2">
                {lanePillData.map(pill => {
                  const isInProgress = pill.phase !== 'done' && pill.phase !== 'error';
                  const pillColor =
                    pill.phase === 'error'          ? 'bg-red-500/15 text-red-300 border-red-500/25' :
                    pill.doneResult === 'published' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25' :
                    pill.doneResult === 'scheduled' ? 'bg-blue-500/15 text-blue-300 border-blue-500/25' :
                                                      'bg-white/[0.06] text-zinc-400 border-white/[0.08]';
                  return (
                    <span
                      key={pill.language}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${pillColor}`}
                    >
                      <span>{pill.flag}</span>
                      {isInProgress && <Loader2 className="h-3 w-3 animate-spin" />}
                      {pill.phase === 'done' && <CheckCircle2 className="h-3 w-3" />}
                      {pill.phase === 'error' && <XCircle className="h-3 w-3" />}
                      <span>{phaseText(pill.phase, pill.doneResult)}</span>
                    </span>
                  );
                })}

                {/* Right-aligned summary when all lanes have resolved */}
                {!isRunning && publishCounts.finished === publishCounts.total && publishCounts.total > 0 && (
                  <span className="ml-auto text-xs text-zinc-400">
                    {[
                      publishCounts.published > 0 && `${publishCounts.published} published`,
                      publishCounts.scheduled > 0 && `${publishCounts.scheduled} scheduled`,
                      publishCounts.errors    > 0 && `${publishCounts.errors} failed`,
                    ].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
