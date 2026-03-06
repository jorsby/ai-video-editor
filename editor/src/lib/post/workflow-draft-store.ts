import type { PlatformOptions, TikTokAccountOptions } from '@/types/post';
import type { CaptionStyleOptions } from '@/types/caption-style';

const STORAGE_PREFIX = 'jorsby_workflow_draft_';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7-day TTL

export interface WorkflowLaneDraft {
  caption: string;
  captionStyle: CaptionStyleOptions;
  assignedGroupId: string | null;
  platformOptions: PlatformOptions;
  tiktokOverride: boolean;
}

export interface WorkflowDraft {
  savedAt: number;
  scheduleType: 'now' | 'scheduled';
  scheduledDate: string;
  scheduledTime: string;
  timezone: string;
  sharedTikTokOptions: Record<string, TikTokAccountOptions>;
  lanes: Record<string, WorkflowLaneDraft>;
}

function storageKey(projectId: string): string {
  return `${STORAGE_PREFIX}${projectId}`;
}

export function readDraft(projectId: string): WorkflowDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (!raw) return null;
    const draft = JSON.parse(raw) as WorkflowDraft;
    if (Date.now() - draft.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(storageKey(projectId));
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function writeDraft(projectId: string, draft: WorkflowDraft): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify(draft));
  } catch {
    // Storage quota exceeded — fail silently
  }
}

export function clearDraft(projectId: string): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(storageKey(projectId));
}
