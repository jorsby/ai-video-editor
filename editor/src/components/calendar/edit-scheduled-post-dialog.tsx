'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { MixpostPost, MixpostMedia } from '@/types/calendar';

const DIALOG_TIMEZONES = [
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'New York (ET)' },
  { value: 'America/Chicago', label: 'Chicago (CT)' },
  { value: 'America/Denver', label: 'Denver (MT)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (PT)' },
  { value: 'America/Anchorage', label: 'Anchorage (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Honolulu (HT)' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Paris (CET)' },
  { value: 'Europe/Helsinki', label: 'Helsinki (EET)' },
  { value: 'Europe/Istanbul', label: 'Istanbul (TRT)' },
  { value: 'Europe/Moscow', label: 'Moscow (MSK)' },
  { value: 'Asia/Dubai', label: 'Dubai (GST)' },
  { value: 'Asia/Karachi', label: 'Karachi (PKT)' },
  { value: 'Asia/Kolkata', label: 'Mumbai/Kolkata (IST)' },
  { value: 'Asia/Dhaka', label: 'Dhaka (BST)' },
  { value: 'Asia/Bangkok', label: 'Bangkok (ICT)' },
  { value: 'Asia/Shanghai', label: 'Shanghai (CST)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { value: 'Asia/Seoul', label: 'Seoul (KST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST)' },
  { value: 'Pacific/Auckland', label: 'Auckland (NZST)' },
];

function extractMediaIds(fullPost: MixpostPost | null): number[] {
  if (!fullPost) return [];
  const ids: number[] = [];
  for (const version of fullPost.versions) {
    if (!version.is_original) continue;
    for (const content of version.content) {
      for (const item of content.media) {
        if (typeof item === 'object' && item !== null && 'id' in item) {
          ids.push((item as MixpostMedia).id);
        } else if (typeof item === 'number') {
          ids.push(item);
        }
      }
    }
  }
  return ids;
}

interface EditScheduledPostDialogProps {
  post: MixpostPost;
  fullPost: MixpostPost | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}

export function EditScheduledPostDialog({
  post,
  fullPost,
  open,
  onOpenChange,
  onUpdated,
}: EditScheduledPostDialogProps) {
  const [caption, setCaption] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const original = post.versions.find((v) => v.is_original);
    setCaption(original?.content[0]?.body ?? '');
    setDate(post.scheduled_at?.slice(0, 10) ?? '');
    setTime(post.scheduled_at?.slice(11, 16) ?? '');
    setTimezone('UTC');
    setError(null);
  }, [open, post]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const accountIds = post.accounts.map((a) => a.id);
      const mediaIds = extractMediaIds(fullPost);

      const res = await fetch(`/api/mixpost/posts/${post.uuid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption, date, time, timezone, accountIds, mediaIds }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || 'Failed to update post. Please try again.');
        return;
      }

      onOpenChange(false);
      onUpdated();
    } catch {
      setError('Network error — please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Scheduled Post</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-muted-foreground">Caption</label>
            <Textarea
              rows={4}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Post caption"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">Date</label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">Time</label>
              <Input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-muted-foreground">Timezone</label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                {DIALOG_TIMEZONES.map((tz) => (
                  <SelectItem key={tz.value} value={tz.value}>
                    {tz.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
