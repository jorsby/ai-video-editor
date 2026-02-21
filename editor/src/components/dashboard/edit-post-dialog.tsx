'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { MixpostPost } from '@/types/calendar';

interface EditPostDialogProps {
  post: MixpostPost;
  accountId: number;
  provider: string;
  isPlatformPost?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated?: (postUuid: string, fields: Record<string, string>) => void;
}

function getProviderLabel(provider: string): string {
  const labels: Record<string, string> = {
    youtube: 'YouTube',
    facebook: 'Facebook',
    facebook_page: 'Facebook',
  };
  return labels[provider] || provider;
}

function getOriginalContent(post: MixpostPost): { body: string; options?: Record<string, unknown> } {
  const original = post.versions.find((v) => v.is_original);
  const body = original?.content[0]?.body || '';
  return { body, options: original?.options };
}

export function EditPostDialog({
  post,
  accountId,
  provider,
  isPlatformPost = false,
  open,
  onOpenChange,
  onUpdated,
}: EditPostDialogProps) {
  const { body, options } = getOriginalContent(post);
  const isYouTube = provider === 'youtube';

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setError(null);
      if (isYouTube) {
        const ytOptions = options?.youtube as Record<string, string> | undefined;
        setTitle(ytOptions?.title || '');
        setDescription(body);
      } else {
        setMessage(body);
      }
    }
  }, [open, isYouTube, body, options]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);

    const fields: Record<string, string> = isYouTube
      ? { title, description }
      : { message };

    try {
      let res: Response;
      if (isPlatformPost) {
        // Synced platform post: use direct platform API with platform post ID
        const platformPostId = post.uuid.replace(/^(ig|tt|yt|fb)-/, '');
        res = await fetch('/api/social/posts', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platformPostId, accountId, fields }),
        });
      } else {
        // Mixpost post: use existing platform update route
        res = await fetch(`/api/mixpost/posts/${post.uuid}/platform`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId, fields }),
        });
      }

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to update post');
        return;
      }

      onUpdated?.(post.uuid, fields);
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to update post:', err);
      setError('Network error — please try again');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit on {getProviderLabel(provider)}</DialogTitle>
          <DialogDescription>
            {isYouTube
              ? 'Update the video title and description on YouTube.'
              : 'Update the post text on Facebook.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {isYouTube ? (
            <>
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-foreground">Title</p>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Video title"
                  disabled={isSaving}
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-foreground">Description</p>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Video description"
                  rows={6}
                  disabled={isSaving}
                />
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-foreground">Message</p>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Post text"
                rows={6}
                disabled={isSaving}
              />
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
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
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
