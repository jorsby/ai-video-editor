'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { Series } from '@/lib/supabase/series-service';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (series: Series) => void;
}

export function CreateSeriesDialog({ open, onOpenChange, onCreated }: Props) {
  const [name, setName] = useState('');
  const [genre, setGenre] = useState('');
  const [tone, setTone] = useState('');
  const [bible, setBible] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          genre: genre.trim() || undefined,
          tone: tone.trim() || undefined,
          bible: bible.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create series');
      }

      const { series } = await res.json();
      onCreated(series);
      // Reset form
      setName('');
      setGenre('');
      setTone('');
      setBible('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Series</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="series-name">
              Series Name <span className="text-destructive">*</span>
            </label>
            <Input
              id="series-name"
              placeholder="e.g. The Last Signal"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="series-genre">
                Genre
              </label>
              <Input
                id="series-genre"
                placeholder="e.g. Thriller"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="series-tone">
                Tone
              </label>
              <Input
                id="series-tone"
                placeholder="e.g. Dark & suspenseful"
                value={tone}
                onChange={(e) => setTone(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="series-bible">
              Series Bible
            </label>
            <Textarea
              id="series-bible"
              placeholder="World rules, recurring motifs, narrative context..."
              value={bible}
              onChange={(e) => setBible(e.target.value)}
              rows={4}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || isLoading}>
              {isLoading ? 'Creating...' : 'Create Series'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
