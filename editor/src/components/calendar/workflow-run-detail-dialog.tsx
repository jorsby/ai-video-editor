'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import type { WorkflowRun, WorkflowRunLane } from '@/types/workflow-run';
import type { SocialPost } from '@/types/social';

// Maps language codes to display labels
const LANG_LABEL: Record<string, string> = {
  en: 'EN', tr: 'TR', ar: 'AR', es: 'ES',
  fr: 'FR', de: 'DE', it: 'IT', pt: 'PT',
};

const STATUS_LABEL: Record<WorkflowRunLane['status'], string> = {
  pending: 'Pending',
  uploading: 'Uploading',
  creating: 'Creating',
  scheduled: 'Scheduled',
  published: 'Published',
  failed: 'Failed',
  publishing: 'Publishing',
  partial: 'Partial',
};

const STATUS_CLASS: Record<WorkflowRunLane['status'], string> = {
  pending:   'text-muted-foreground',
  uploading: 'text-blue-400',
  creating:  'text-blue-400',
  scheduled: 'text-blue-400',
  published: 'text-emerald-400',
  failed:    'text-red-400',
  publishing: 'text-blue-400',
  partial:    'text-yellow-400',
};

function formatDateTime(isoOrSpace: string | null): string {
  if (!isoOrSpace) return '--';
  const date = new Date(isoOrSpace.replace(' ', 'T'));
  if (isNaN(date.getTime())) return '--';
  return date.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

interface WorkflowRunDetailDialogProps {
  run: WorkflowRun | null;
  onClose: () => void;
  /** Posts keyed by ID — used to open the full PostDetailDialog */
  postsById: Map<string, SocialPost>;
  onViewPost: (post: SocialPost) => void;
}

interface RefreshedLane extends WorkflowRunLane {
  refreshedPost?: SocialPost;
}

export function WorkflowRunDetailDialog({
  run,
  onClose,
  postsById,
  onViewPost,
}: WorkflowRunDetailDialogProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedLanes, setRefreshedLanes] = useState<Map<string, RefreshedLane>>(new Map());

  if (!run) return null;

  const dateLabel = run.schedule_type === 'scheduled' && run.base_date
    ? `${run.base_date}${run.base_time ? ' at ' + formatTime(run.base_time) : ''}`
    : formatDateTime(run.created_at);

  async function handleRefresh() {
    if (!run) return;
    setRefreshing(true);
    const updated = new Map<string, RefreshedLane>();
    await Promise.allSettled(
      run.lanes
        .filter(l => l.mixpost_uuid)
        .map(async (lane) => {
          try {
            const res = await fetch(`/api/v2/posts/${lane.mixpost_uuid}`);
            if (!res.ok) return;
            const data = await res.json();
            updated.set(lane.id, { ...lane, refreshedPost: data.post });
          } catch { /* ignore */ }
        })
    );
    setRefreshedLanes(updated);
    setRefreshing(false);
  }

  return (
    <Dialog open={!!run} onOpenChange={(open) => { if (!open) { setRefreshedLanes(new Map()); onClose(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Workflow Run</DialogTitle>
          <DialogDescription>
            {run.schedule_type === 'scheduled' ? 'Scheduled' : 'Published'}: {dateLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            {run.lanes.map((lane) => {
              const refreshed = refreshedLanes.get(lane.id);
              const cachedPost = lane.mixpost_uuid ? postsById.get(lane.mixpost_uuid) : undefined;
              const viewPost = refreshed?.refreshedPost ?? cachedPost;
              const langLabel = LANG_LABEL[lane.language] ?? lane.language.toUpperCase();
              const statusLabel = STATUS_LABEL[lane.status];
              const statusClass = STATUS_CLASS[lane.status];

              return (
                <div key={lane.id} className="space-y-0.5">
                  <div className="flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5">
                    <span className="w-8 shrink-0 text-xs font-medium text-foreground">{langLabel}</span>
                    <span className={`text-xs ${statusClass}`}>
                      {lane.status === 'published' ? '✓' : lane.status === 'failed' ? '✗' : '⟳'} {statusLabel}
                    </span>
                    <div className="ml-auto">
                      {viewPost ? (
                        <button
                          type="button"
                          onClick={() => { onClose(); onViewPost(viewPost); }}
                          className="text-[10px] text-blue-400 hover:underline"
                        >
                          View post →
                        </button>
                      ) : lane.mixpost_uuid ? (
                        <span className="text-[10px] text-muted-foreground">Not in cache</span>
                      ) : null}
                    </div>
                  </div>
                  {lane.error_message && (
                    <p className="px-2 text-[11px] text-red-400/80">{lane.error_message}</p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="border-t border-border/50 pt-2 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {run.timezone ?? 'UTC'} · {run.lanes.length} {run.lanes.length === 1 ? 'lane' : 'lanes'}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing || run.lanes.every(l => !l.mixpost_uuid)}
            >
              {refreshing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
