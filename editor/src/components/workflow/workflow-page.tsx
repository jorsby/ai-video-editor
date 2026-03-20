'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Loader2,
  ChevronRight,
  CheckCircle2,
  XCircle,
  ArrowLeft,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CaptionEditor } from '@/components/post/caption-editor';
import { SchedulePicker } from '@/components/post/schedule-picker';
import { getTodayInTimezone } from '@/lib/schedule-validation';
import {
  readDraft,
  writeDraft,
  clearDraft,
} from '@/lib/post/workflow-draft-store';
import type { WorkflowDraft } from '@/lib/post/workflow-draft-store';
import {
  createWorkflowRun,
  createWorkflowRunLane,
  updateWorkflowRunLane,
} from '@/lib/supabase/workflow-run-service';
import { InstagramOptions } from '@/components/post/platform-options/instagram-options';
import { YouTubeOptions } from '@/components/post/platform-options/youtube-options';
import { TikTokOptions } from '@/components/post/platform-options/tiktok-options';
import type { RenderedVideo } from '@/types/rendered-video';
import type {
  SocialAccount,
  SocialPostAccount,
  AccountGroup,
} from '@/types/social';
import type {
  PlatformOptions,
  TikTokAccountOptions,
  PostVerificationResult,
} from '@/types/post';
import type { CaptionStyleOptions } from '@/types/caption-style';
import { DEFAULT_CAPTION_STYLE } from '@/types/caption-style';

interface LanguageLane {
  language: string;
  video: RenderedVideo;
  caption: string;
  platformOptions: PlatformOptions;
  captionStyle: CaptionStyleOptions;
  assignedGroupId: string | null;
  tiktokOverride: boolean;
  captionStatus: 'idle' | 'generating' | 'done' | 'error';
  publishStatus: LanePublishStatus;
}

type LanePublishPhase = 'idle' | 'preflight' | 'submitting';

type LanePublishStatus =
  | { phase: LanePublishPhase }
  | { phase: 'done'; result: PostVerificationResult; scheduledAt?: string }
  | { phase: 'error'; message: string };

// Maps language codes to fuzzy group name keywords for auto-matching
const LANG_KEYWORDS: Record<string, string> = {
  en: 'english',
  tr: 'turkish',
  ar: 'arabic',
  es: 'spanish',
  fr: 'french',
  de: 'german',
  it: 'italian',
  pt: 'portuguese',
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

const PLACEHOLDER_TITLES = new Set([
  'unknown',
  'n/a',
  'title',
  'youtube title',
  'video title',
]);
function sanitizeYoutubeTitle(title: string | undefined | null): string {
  const t = (title ?? '').trim();
  return PLACEHOLDER_TITLES.has(t.toLowerCase()) ? '' : t;
}

/** Advances a "HH:mm" time string by `minutes`, wrapping at 24 h. */
function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const totalMinutes = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  const newH = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, '0');
  const newM = (totalMinutes % 60).toString().padStart(2, '0');
  return `${newH}:${newM}`;
}

function resolveAccountIds(
  groupId: string | null,
  groups: AccountGroup[],
  accounts: SocialAccount[]
): string[] {
  if (!groupId) return [];
  const group = groups.find((g) => g.id === groupId);
  if (!group) return [];
  return accounts
    .filter((a) => group.account_ids.includes(a.octupost_account_id))
    .map((a) => a.octupost_account_id);
}

const DEFAULT_TIKTOK_OPTIONS: TikTokAccountOptions = {
  privacy_level: 'PUBLIC_TO_EVERYONE',
  allow_comments: true,
  allow_duet: true,
  allow_stitch: true,
  is_aigc: false,
  content_disclosure: false,
  brand_organic_toggle: false,
  brand_content_toggle: false,
};

function defaultPlatformOptions(
  accountIds: string[],
  accounts: SocialAccount[],
  youtubeTitle: string
): PlatformOptions {
  const filteredAccounts = accounts.filter((a) =>
    accountIds.includes(a.octupost_account_id)
  );
  const platforms = filteredAccounts.map((a) => a.platform);

  const tiktokDefaults: Record<string, TikTokAccountOptions> = {};
  for (const acc of filteredAccounts.filter((a) => a.platform === 'tiktok')) {
    tiktokDefaults[`account-${acc.octupost_account_id}`] = {
      ...DEFAULT_TIKTOK_OPTIONS,
    };
  }

  return {
    ...(platforms.includes('instagram') && { instagram: { type: 'reel' } }),
    ...(platforms.includes('facebook') && { facebook: { type: 'reel' } }),
    ...(platforms.includes('youtube') && {
      youtube: { title: youtubeTitle, status: 'public' },
    }),
    ...(platforms.includes('tiktok') && { tiktok: tiktokDefaults }),
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
  const w = parseInt(m[1], 10),
    h = parseInt(m[2], 10);
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

function StepLabel({
  phase,
  scheduleType,
}: {
  phase: string;
  scheduleType: 'now' | 'scheduled';
}) {
  const labels: Record<string, string> = {
    preflight: 'Checking accounts...',
    submitting: scheduleType === 'now' ? 'Publishing...' : 'Scheduling...',
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
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [groups, setGroups] = useState<AccountGroup[]>([]);
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

  // Shared TikTok options (applied to all lanes unless overridden)
  const [sharedTikTokOptions, setSharedTikTokOptions] = useState<
    Record<string, TikTokAccountOptions>
  >({});

  const laneAbortRefs = useRef<Record<string, AbortController>>({});
  const [publishTotal, setPublishTotal] = useState(0);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateLane = useCallback(
    (language: string, partial: Partial<LanguageLane>) => {
      setLanes((prev) => ({
        ...prev,
        [language]: { ...prev[language], ...partial },
      }));
    },
    []
  );

  // Load all data on mount
  useEffect(() => {
    async function load() {
      try {
        const [rendersRes, accountsRes, groupsRes] = await Promise.all([
          fetch(`/api/rendered-videos?project_id=${projectId}`),
          fetch('/api/v2/accounts'),
          fetch('/api/account-groups'),
        ]);

        if (!rendersRes.ok) throw new Error('Failed to load renders');
        if (!accountsRes.ok) throw new Error('Failed to load accounts');
        if (!groupsRes.ok) throw new Error('Failed to load groups');

        const { rendered_videos } = await rendersRes.json();
        const accountsData = await accountsRes.json();
        const { groups: loadedGroups } = await groupsRes.json();

        // Map OctupostAccount response to SocialAccount shape
        const loadedAccounts: SocialAccount[] = (
          accountsData.accounts || []
        ).map(
          (a: {
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
          })
        );

        setAccounts(loadedAccounts);
        setGroups(
          (loadedGroups ?? []).map((g: any) => ({
            ...g,
            account_ids: g.account_uuids || g.account_ids || [],
          }))
        );

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
            ? loadedGroups.find((g: AccountGroup) =>
                g.name.toLowerCase().includes(keyword)
              )
            : null;

          const autoGroupId = autoGroup?.id ?? null;
          const autoAccountIds = autoGroupId
            ? loadedAccounts
                .filter((a: SocialAccount) =>
                  autoGroup!.account_ids.includes(a.octupost_account_id)
                )
                .map((a: SocialAccount) => a.octupost_account_id)
            : [];

          initialLanes[lang] = {
            language: lang,
            video,
            caption: '',
            platformOptions: defaultPlatformOptions(
              autoAccountIds,
              loadedAccounts,
              ''
            ),
            captionStyle: { ...DEFAULT_CAPTION_STYLE },
            assignedGroupId: autoGroupId,
            tiktokOverride: false,
            captionStatus: 'idle',
            publishStatus: { phase: 'idle' },
          };
        }

        // Build shared TikTok defaults from all TikTok accounts across all groups
        const allTikTokDefaults = new Map<string, TikTokAccountOptions>();
        for (const lane of Object.values(initialLanes)) {
          if (lane.platformOptions.tiktok) {
            for (const [key, opts] of Object.entries(
              lane.platformOptions.tiktok
            )) {
              if (!allTikTokDefaults.has(key)) {
                allTikTokDefaults.set(key, { ...opts });
              }
            }
          }
        }
        const initialSharedTikTok = Object.fromEntries(allTikTokDefaults);

        // Restore saved draft if available
        const savedDraft = readDraft(projectId);
        if (savedDraft) {
          setScheduleType(savedDraft.scheduleType);
          setScheduledDate(savedDraft.scheduledDate);
          setScheduledTime(savedDraft.scheduledTime);
          setTimezone(savedDraft.timezone);

          if (Object.keys(savedDraft.sharedTikTokOptions).length > 0) {
            setSharedTikTokOptions(savedDraft.sharedTikTokOptions);
          } else {
            setSharedTikTokOptions(initialSharedTikTok);
          }

          // Merge per-lane draft data — only for languages that still have renders
          for (const [lang, laneDraft] of Object.entries(savedDraft.lanes)) {
            if (initialLanes[lang]) {
              initialLanes[lang] = {
                ...initialLanes[lang],
                caption: laneDraft.caption,
                captionStyle: laneDraft.captionStyle,
                assignedGroupId: laneDraft.assignedGroupId,
                platformOptions: laneDraft.platformOptions,
                tiktokOverride: laneDraft.tiktokOverride,
              };
            }
          }
        } else {
          setSharedTikTokOptions(initialSharedTikTok);
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

  // Debounced auto-save draft to localStorage
  useEffect(() => {
    if (isLoading || isRunning) return;
    if (Object.keys(lanes).length === 0) return;

    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      const draft: WorkflowDraft = {
        savedAt: Date.now(),
        scheduleType,
        scheduledDate,
        scheduledTime,
        timezone,
        sharedTikTokOptions,
        lanes: Object.fromEntries(
          Object.entries(lanes).map(([lang, lane]) => [
            lang,
            {
              caption: lane.caption,
              captionStyle: lane.captionStyle,
              assignedGroupId: lane.assignedGroupId,
              platformOptions: lane.platformOptions,
              tiktokOverride: lane.tiktokOverride,
            },
          ])
        ),
      };
      writeDraft(projectId, draft);
    }, 500);

    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [
    lanes,
    scheduleType,
    scheduledDate,
    scheduledTime,
    timezone,
    sharedTikTokOptions,
    isLoading,
    isRunning,
    projectId,
  ]);

  // Propagate shared TikTok options to non-override lanes
  useEffect(() => {
    if (Object.keys(sharedTikTokOptions).length === 0) return;
    setLanes((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [lang, lane] of Object.entries(next)) {
        if (!lane.tiktokOverride && lane.platformOptions.tiktok) {
          const updatedTiktok: Record<string, TikTokAccountOptions> = {};
          for (const key of Object.keys(lane.platformOptions.tiktok)) {
            updatedTiktok[key] =
              sharedTikTokOptions[key] ?? lane.platformOptions.tiktok[key];
          }
          next[lang] = {
            ...lane,
            platformOptions: { ...lane.platformOptions, tiktok: updatedTiktok },
          };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [sharedTikTokOptions]);

  async function generateCaption(language: string) {
    const lane = lanes[language];
    if (!lane) return;

    if (!lane.assignedGroupId) {
      toast.warning(
        `Select a group for ${language.toUpperCase()} first — providers affect caption style and YouTube title.`
      );
      return;
    }

    updateLane(language, { captionStatus: 'generating' });

    try {
      const accountIds = resolveAccountIds(
        lane.assignedGroupId,
        groups,
        accounts
      );
      const providers = accounts
        .filter((a) => accountIds.includes(a.octupost_account_id))
        .map((a) => a.platform);

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
        captionStatus: 'done',
        platformOptions: {
          ...lane.platformOptions,
          ...(lane.platformOptions.youtube && {
            youtube: {
              ...lane.platformOptions.youtube,
              title: sanitizeYoutubeTitle(youtube_title),
            },
          }),
        },
      });
    } catch {
      updateLane(language, { captionStatus: 'error' });
      toast.error(`Caption generation failed for ${language.toUpperCase()}`);
    }
  }

  async function generateAllCaptions() {
    const langs = Object.keys(lanes);
    await Promise.allSettled(langs.map((lang) => generateCaption(lang)));
  }

  async function publishLane(
    lane: LanguageLane,
    scheduledTimeOverride?: string,
    laneId?: string
  ) {
    const accountIds = resolveAccountIds(
      lane.assignedGroupId,
      groups,
      accounts
    );

    // Preflight
    updateLane(lane.language, { publishStatus: { phase: 'preflight' } });

    if (accountIds.length === 0) {
      if (laneId)
        updateWorkflowRunLane(laneId, {
          status: 'failed',
          error_message: 'No accounts selected',
        }).catch(console.error);
      throw new Error('No accounts selected');
    }

    // Apply youtube title fallback if empty
    let platOpts = lane.platformOptions;
    if (platOpts.youtube && !platOpts.youtube.title.trim()) {
      platOpts = {
        ...platOpts,
        youtube: { ...platOpts.youtube, title: lane.caption.slice(0, 100) },
      };
    }

    // Single API call to create + publish/schedule
    updateLane(lane.language, { publishStatus: { phase: 'submitting' } });
    if (laneId)
      updateWorkflowRunLane(laneId, { status: 'publishing' }).catch(
        console.error
      );

    const postBody = {
      caption: lane.caption,
      mediaUrl: lane.video.url,
      mediaType: 'video' as const,
      accountIds,
      scheduleType,
      scheduledDate: scheduleType === 'scheduled' ? scheduledDate : undefined,
      scheduledTime:
        scheduleType === 'scheduled'
          ? (scheduledTimeOverride ?? scheduledTime)
          : undefined,
      timezone,
      platformOptions: platOpts,
    };

    const res = await fetch('/api/v2/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(postBody),
    });

    if (!res.ok) {
      const err = await res.json();
      const msg = err.error || 'Failed to create post';
      if (laneId)
        updateWorkflowRunLane(laneId, {
          status: 'failed',
          error_message: msg,
        }).catch(console.error);
      throw new Error(msg);
    }

    const data = await res.json();
    const postAccounts: SocialPostAccount[] = data.post?.post_accounts || [];
    const postId = data.post?.id;

    // Build verification result from response
    const failedAccounts = postAccounts.filter((pa) => pa.status === 'failed');
    const allFailed = failedAccounts.length === postAccounts.length;
    const anyFailed = failedAccounts.length > 0;

    const postStatus = data.post?.status as string;
    const resultStatus =
      postStatus === 'published'
        ? 'published'
        : postStatus === 'scheduled'
          ? 'scheduled'
          : postStatus === 'failed'
            ? 'failed'
            : anyFailed
              ? 'failed'
              : 'published';

    const result: PostVerificationResult = {
      status: resultStatus as PostVerificationResult['status'],
      accounts: postAccounts.map((pa) => {
        const acct = accounts.find(
          (a) => a.octupost_account_id === pa.octupost_account_id
        );
        return {
          accountId: pa.octupost_account_id,
          accountName: pa.account_name ?? acct?.account_name ?? pa.platform,
          platform: pa.platform,
          status: pa.status as 'published' | 'failed' | 'pending',
          errorMessage: pa.error_message,
          platformPostId: pa.platform_post_id,
        };
      }),
    };

    if (laneId) {
      const finalStatus = allFailed
        ? 'failed'
        : anyFailed
          ? 'partial'
          : scheduleType === 'now'
            ? 'published'
            : 'scheduled';
      const errMsg =
        failedAccounts
          .map((a) => a.error_message)
          .filter(Boolean)
          .join('; ') || undefined;
      updateWorkflowRunLane(laneId, {
        status: finalStatus,
        error_message: errMsg,
        mixpost_uuid: postId,
      }).catch(console.error);
    }

    if (anyFailed && !allFailed) {
      // Partial success
      updateLane(lane.language, { publishStatus: { phase: 'done', result } });
    } else if (allFailed) {
      const errMsg =
        failedAccounts
          .map((a) => a.error_message)
          .filter(Boolean)
          .join('; ') || 'All accounts failed';
      throw new Error(errMsg);
    } else {
      updateLane(lane.language, {
        publishStatus: {
          phase: 'done',
          result,
          ...(scheduleType === 'scheduled' && data.post?.scheduled_at
            ? { scheduledAt: data.post.scheduled_at }
            : {}),
        },
      });
    }
  }

  async function runWorkflow() {
    setIsRunning(true);

    // Snapshot current lanes before going async, sorted consistently
    const snapshot = { ...lanes };
    const activeLanes = Object.values(snapshot)
      .filter((l) => l.assignedGroupId && l.caption.trim())
      .sort(
        (a, b) =>
          (LANG_ORDER.indexOf(a.language) === -1
            ? 99
            : LANG_ORDER.indexOf(a.language)) -
          (LANG_ORDER.indexOf(b.language) === -1
            ? 99
            : LANG_ORDER.indexOf(b.language))
      );

    setPublishTotal(activeLanes.length);

    activeLanes.forEach((l) => {
      laneAbortRefs.current[l.language] = new AbortController();
    });

    // Create a workflow run record + one lane stub per active lane for observability.
    // These writes are best-effort — failures must never block publishing.
    const laneIdMap: Record<string, string> = {};
    try {
      const runId = await createWorkflowRun({
        project_id: projectId,
        schedule_type: scheduleType,
        base_date: scheduledDate || undefined,
        base_time: scheduledTime || undefined,
        timezone,
      });
      for (const lane of activeLanes) {
        const laneId = await createWorkflowRunLane({
          workflow_run_id: runId,
          language: lane.language,
        });
        laneIdMap[lane.language] = laneId;
      }
    } catch (err) {
      console.error('Failed to create workflow run record:', err);
    }

    // Publish sequentially to prevent simultaneous platform API bursts.
    // For "post now": each lane's schedule call fires only after the previous lane has
    // completed, ensuring the system processes one batch at a time.
    // For "scheduled": each lane gets a +2-minute offset so posts are spread across
    // separate scheduled runs instead of all queuing in the same minute.
    for (let i = 0; i < activeLanes.length; i++) {
      const lane = activeLanes[i];
      const timeOverride =
        scheduleType === 'scheduled' && scheduledTime
          ? addMinutesToTime(scheduledTime, i * 2)
          : undefined;

      await publishLane(lane, timeOverride, laneIdMap[lane.language]).catch(
        (err) => {
          updateLane(lane.language, {
            publishStatus: { phase: 'error', message: (err as Error).message },
          });
        }
      );
    }

    setIsRunning(false);
  }

  function retryLane(language: string) {
    const lane = lanes[language];
    if (!lane) return;

    const retryLaneData: LanguageLane = {
      ...lane,
      publishStatus: { phase: 'idle' },
    };

    updateLane(language, { publishStatus: { phase: 'idle' } });

    laneAbortRefs.current[language] = new AbortController();

    publishLane(retryLaneData).catch((err) => {
      updateLane(language, {
        publishStatus: { phase: 'error', message: (err as Error).message },
      });
    });
  }

  const laneList = Object.values(lanes).sort(
    (a, b) =>
      (LANG_ORDER.indexOf(a.language) === -1
        ? 99
        : LANG_ORDER.indexOf(a.language)) -
      (LANG_ORDER.indexOf(b.language) === -1
        ? 99
        : LANG_ORDER.indexOf(b.language))
  );

  const allLanesReady =
    laneList.length > 0 &&
    laneList.every((l) => l.assignedGroupId && l.caption.trim() !== '');

  const completedLanesCount = laneList.filter(
    (l) => l.publishStatus.phase === 'done' || l.publishStatus.phase === 'error'
  ).length;

  const publishingActive = useMemo(
    () => laneList.some((l) => l.publishStatus.phase !== 'idle'),
    [laneList]
  );

  // All unique TikTok accounts across all lanes (for shared TikTok section)
  const allTikTokAccounts = useMemo(() => {
    const seen = new Map<string, SocialAccount>();
    for (const lane of laneList) {
      const accountIds = resolveAccountIds(
        lane.assignedGroupId,
        groups,
        accounts
      );
      for (const acc of accounts.filter(
        (a) =>
          accountIds.includes(a.octupost_account_id) && a.platform === 'tiktok'
      )) {
        if (!seen.has(acc.octupost_account_id))
          seen.set(acc.octupost_account_id, acc);
      }
    }
    return Array.from(seen.values());
  }, [laneList, groups, accounts]);

  const lanePillData = useMemo(
    () =>
      laneList
        .filter((l) => l.publishStatus.phase !== 'idle')
        .map((l) => {
          const meta = LANG_META[l.language] ?? {
            flag: '🌐',
            label: l.language.toUpperCase(),
          };
          const status = l.publishStatus;
          return {
            language: l.language,
            flag: meta.flag,
            phase: status.phase,
            doneResult:
              status.phase === 'done'
                ? (status as { phase: 'done'; result: PostVerificationResult })
                    .result.status
                : null,
          };
        }),
    [laneList]
  );

  const publishCounts = useMemo(() => {
    const active = laneList.filter((l) => l.publishStatus.phase !== 'idle');
    const total = isRunning ? publishTotal : active.length;
    const done = active.filter((l) => l.publishStatus.phase === 'done').length;
    const errors = active.filter(
      (l) => l.publishStatus.phase === 'error'
    ).length;
    const published = active.filter(
      (l) =>
        l.publishStatus.phase === 'done' &&
        (l.publishStatus as { phase: 'done'; result: PostVerificationResult })
          .result.status === 'published'
    ).length;
    const scheduled = active.filter(
      (l) =>
        l.publishStatus.phase === 'done' &&
        (l.publishStatus as { phase: 'done'; result: PostVerificationResult })
          .result.status === 'scheduled'
    ).length;
    return { total, finished: done + errors, published, scheduled, errors };
  }, [laneList, isRunning, publishTotal]);

  const isAllDone =
    !isRunning &&
    publishCounts.finished === publishCounts.total &&
    publishCounts.total > 0;
  const isAllSuccess = isAllDone && publishCounts.errors === 0;

  // Clear draft after successful full publish
  useEffect(() => {
    if (isAllDone && isAllSuccess) {
      clearDraft(projectId);
    }
  }, [isAllDone, isAllSuccess, projectId]);

  function phaseText(phase: string, doneResult: string | null): string {
    if (phase === 'done') {
      if (doneResult === 'scheduled') return 'Scheduled';
      if (doneResult === 'published') return 'Published';
      return 'Done';
    }
    if (phase === 'error') return 'Failed';
    const map: Record<string, string> = {
      preflight: 'Checking',
      submitting: 'Publishing',
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
        <p className="text-zinc-400 text-sm">
          No rendered videos found for this project.
        </p>
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
        <button
          onClick={() => {
            clearDraft(projectId);
            toast.success('Draft cleared');
            window.location.reload();
          }}
          className="ml-auto text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Clear Draft
        </button>
      </div>

      {/* Lane rows */}
      <div className="flex-1 overflow-auto px-6 py-6 space-y-4 pb-36">
        {/* Shared TikTok settings (all languages) */}
        {allTikTokAccounts.length > 0 && !publishingActive && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
            <h3 className="text-sm font-medium text-zinc-300 mb-3">
              TikTok Settings (all languages)
            </h3>
            <p className="text-[10px] text-zinc-500 mb-3">
              These settings apply to all languages. Use &quot;Customize&quot;
              on individual lanes to override.
            </p>
            <TikTokOptions
              accounts={allTikTokAccounts}
              value={sharedTikTokOptions}
              onChange={setSharedTikTokOptions}
            />
          </div>
        )}
        {laneList.map((lane) => {
          const meta = LANG_META[lane.language] ?? {
            flag: '🌐',
            label: lane.language.toUpperCase(),
          };
          const badgeColor =
            LANG_BADGE_COLOR[lane.language] ??
            'bg-zinc-500/20 text-zinc-300 border-zinc-500/30';
          const accountIds = resolveAccountIds(
            lane.assignedGroupId,
            groups,
            accounts
          );
          const assignedAccounts = accounts.filter((a) =>
            accountIds.includes(a.octupost_account_id)
          );
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
                  {isPublishing && (
                    <StepLabel
                      phase={status.phase}
                      scheduleType={scheduleType}
                    />
                  )}
                  {isDone &&
                    (() => {
                      const doneStatus = status as {
                        phase: 'done';
                        result: PostVerificationResult;
                        scheduledAt?: string;
                      };
                      const isScheduled =
                        doneStatus.result.status === 'scheduled';
                      const formattedTime = isScheduled
                        ? formatScheduledAt(doneStatus.scheduledAt)
                        : null;
                      return (
                        <span className="flex items-center gap-1 text-xs text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {isScheduled
                            ? formattedTime
                              ? `Scheduled · ${formattedTime}`
                              : 'Scheduled'
                            : 'Published'}
                        </span>
                      );
                    })()}
                  {isError && (
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1 text-xs text-red-400">
                        <XCircle className="h-3.5 w-3.5" />
                        {
                          (status as { phase: 'error'; message: string })
                            .message
                        }
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
                  style={{
                    aspectRatio: videoAspectRatio(lane.video.resolution),
                  }}
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
                    onChange={(v) => updateLane(lane.language, { caption: v })}
                    selectedAccounts={assignedAccounts}
                    onGenerateCaption={() => generateCaption(lane.language)}
                    isGenerating={lane.captionStatus === 'generating'}
                    captionStyle={lane.captionStyle}
                    onCaptionStyleChange={(style) =>
                      updateLane(lane.language, { captionStyle: style })
                    }
                  />

                  {/* Platform options — shown when group has relevant accounts */}
                  {assignedAccounts.length > 0 && !isPublishing && !isDone && (
                    <div className="space-y-3">
                      {assignedAccounts.some(
                        (a) => a.platform === 'instagram'
                      ) &&
                        lane.platformOptions.instagram && (
                          <InstagramOptions
                            value={lane.platformOptions.instagram}
                            onChange={(v) =>
                              updateLane(lane.language, {
                                platformOptions: {
                                  ...lane.platformOptions,
                                  instagram: v,
                                },
                              })
                            }
                          />
                        )}
                      {assignedAccounts.some((a) => a.platform === 'youtube') &&
                        lane.platformOptions.youtube && (
                          <YouTubeOptions
                            value={lane.platformOptions.youtube}
                            onChange={(v) =>
                              updateLane(lane.language, {
                                platformOptions: {
                                  ...lane.platformOptions,
                                  youtube: v,
                                },
                              })
                            }
                          />
                        )}
                      {assignedAccounts.some((a) => a.platform === 'tiktok') &&
                        lane.platformOptions.tiktok !== undefined && (
                          <div>
                            {!lane.tiktokOverride ? (
                              <button
                                onClick={() =>
                                  updateLane(lane.language, {
                                    tiktokOverride: true,
                                  })
                                }
                                className="text-xs text-zinc-500 hover:text-zinc-300 underline underline-offset-2"
                              >
                                Customize TikTok for{' '}
                                {(
                                  LANG_META[lane.language]?.label ??
                                  lane.language
                                ).toUpperCase()}
                              </button>
                            ) : (
                              <div>
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-xs text-zinc-400">
                                    Custom TikTok Settings
                                  </span>
                                  <button
                                    onClick={() => {
                                      const updatedTiktok: Record<
                                        string,
                                        TikTokAccountOptions
                                      > = {};
                                      for (const key of Object.keys(
                                        lane.platformOptions.tiktok!
                                      )) {
                                        updatedTiktok[key] =
                                          sharedTikTokOptions[key] ??
                                          lane.platformOptions.tiktok![key];
                                      }
                                      updateLane(lane.language, {
                                        tiktokOverride: false,
                                        platformOptions: {
                                          ...lane.platformOptions,
                                          tiktok: updatedTiktok,
                                        },
                                      });
                                    }}
                                    className="text-xs text-zinc-500 hover:text-zinc-300 underline underline-offset-2"
                                  >
                                    Reset to shared
                                  </button>
                                </div>
                                <TikTokOptions
                                  accounts={assignedAccounts.filter(
                                    (a) => a.platform === 'tiktok'
                                  )}
                                  value={lane.platformOptions.tiktok}
                                  onChange={(v) =>
                                    updateLane(lane.language, {
                                      platformOptions: {
                                        ...lane.platformOptions,
                                        tiktok: v,
                                      },
                                    })
                                  }
                                />
                              </div>
                            )}
                          </div>
                        )}
                    </div>
                  )}

                  {/* Group selector */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-400">
                      Account Group
                    </label>
                    <select
                      value={lane.assignedGroupId ?? ''}
                      onChange={(e) => {
                        const newGroupId = e.target.value || null;
                        const newAccountIds = resolveAccountIds(
                          newGroupId,
                          groups,
                          accounts
                        );
                        const existingYtTitle =
                          lane.platformOptions?.youtube?.title ?? '';
                        const newPlatOpts = defaultPlatformOptions(
                          newAccountIds,
                          accounts,
                          existingYtTitle
                        );
                        // Apply shared TikTok options to any TikTok accounts in the new group
                        if (newPlatOpts.tiktok) {
                          for (const key of Object.keys(newPlatOpts.tiktok)) {
                            if (sharedTikTokOptions[key]) {
                              newPlatOpts.tiktok[key] = {
                                ...sharedTikTokOptions[key],
                              };
                            }
                          }
                        }
                        updateLane(lane.language, {
                          assignedGroupId: newGroupId,
                          platformOptions: newPlatOpts,
                          tiktokOverride: false,
                        });
                      }}
                      disabled={isPublishing || isDone}
                      className="w-full rounded-md border border-white/[0.06] bg-[#0a0a0c] px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/20 disabled:opacity-50"
                    >
                      <option value="">— Select a group —</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name} ({g.account_ids.length})
                        </option>
                      ))}
                    </select>

                    {/* Account preview */}
                    {assignedAccounts.length > 0 && (
                      <p className="text-[10px] text-zinc-500 leading-relaxed">
                        {assignedAccounts
                          .map(
                            (a) =>
                              `${a.account_name ?? a.octupost_account_id} (${a.platform})`
                          )
                          .join(' · ')}
                      </p>
                    )}
                  </div>

                  {/* Per-account results after publishing */}
                  {isDone &&
                    (
                      status as {
                        phase: 'done';
                        result: PostVerificationResult;
                      }
                    ).result.accounts.length > 0 && (
                      <div className="space-y-1 pt-1">
                        {(
                          status as {
                            phase: 'done';
                            result: PostVerificationResult;
                          }
                        ).result.accounts.map((acc, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 text-xs"
                          >
                            {acc.status === 'published' ? (
                              <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                            ) : (
                              <XCircle className="h-3 w-3 text-red-400 shrink-0" />
                            )}
                            <span className="text-zinc-300">
                              {acc.accountName}
                            </span>
                            <span className="text-zinc-600">
                              {acc.platform}
                            </span>
                            {acc.errorMessage && (
                              <span className="text-red-400 ml-1">
                                {acc.errorMessage}
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
                  minDate={getTodayInTimezone(timezone)}
                />
              </div>
            ) : isAllDone ? (
              <div className="flex-1 flex items-center gap-2">
                {isAllSuccess ? (
                  <span className="flex items-center gap-1.5 text-sm text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    All {scheduleType === 'now' ? 'published' : 'scheduled'}{' '}
                    successfully
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
                    {scheduleType === 'now' ? 'Publishing' : 'Scheduling'} (
                    {publishCounts.finished}/{publishCounts.total})...
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
                ) : scheduleType === 'now' ? (
                  `▶ Publish All (${laneList.length})`
                ) : (
                  `⏰ Schedule All (${laneList.length})`
                )}
              </Button>
            </div>
          </div>

          {/* Row 2: per-lane progress pills — appears when publishing starts */}
          {publishingActive && (
            <div className="border-t border-white/[0.06] pt-3">
              <div className="flex flex-wrap items-center gap-2">
                {lanePillData.map((pill) => {
                  const isInProgress =
                    pill.phase !== 'done' && pill.phase !== 'error';
                  const pillColor =
                    pill.phase === 'error'
                      ? 'bg-red-500/15 text-red-300 border-red-500/25'
                      : pill.doneResult === 'published'
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25'
                        : pill.doneResult === 'scheduled'
                          ? 'bg-blue-500/15 text-blue-300 border-blue-500/25'
                          : 'bg-white/[0.06] text-zinc-400 border-white/[0.08]';
                  return (
                    <span
                      key={pill.language}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${pillColor}`}
                    >
                      <span>{pill.flag}</span>
                      {isInProgress && (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      )}
                      {pill.phase === 'done' && (
                        <CheckCircle2 className="h-3 w-3" />
                      )}
                      {pill.phase === 'error' && (
                        <XCircle className="h-3 w-3" />
                      )}
                      <span>{phaseText(pill.phase, pill.doneResult)}</span>
                    </span>
                  );
                })}

                {/* Right-aligned summary when all lanes have resolved */}
                {!isRunning &&
                  publishCounts.finished === publishCounts.total &&
                  publishCounts.total > 0 && (
                    <span className="ml-auto text-xs text-zinc-400">
                      {[
                        publishCounts.published > 0 &&
                          `${publishCounts.published} published`,
                        publishCounts.scheduled > 0 &&
                          `${publishCounts.scheduled} scheduled`,
                        publishCounts.errors > 0 &&
                          `${publishCounts.errors} failed`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
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
