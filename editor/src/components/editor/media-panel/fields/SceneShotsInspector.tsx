'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { IconDeviceFloppy, IconLoader2 } from '@tabler/icons-react';
import type { SceneSP } from '@/lib/api/structured-prompt-schemas';
import { SceneShotFields, type ShotSlugContext } from './SceneShotFields';

/**
 * Shared editor shell for a scene's typed `structured_prompt` (array of shots).
 *
 * Mirrors AssetInspector's always-in-edit-mode pattern so the storyboard
 * matches the project-assets panel UX.
 */
export function SceneShotsInspector({
  sceneId,
  initialValue,
  onSaved,
  compact = false,
  slugContext,
}: {
  sceneId: string;
  initialValue: SceneSP | null;
  onSaved?: (next: SceneSP) => void;
  compact?: boolean;
  slugContext?: ShotSlugContext;
}) {
  const [value, setValue] = useState<SceneSP>(() => initialValue ?? []);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(initialValue ?? []);
  }, [initialValue]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/v2/scenes/${sceneId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ structured_prompt: value }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          reason?: string;
          path?: string;
        };
        const path = typeof body.path === 'string' ? ` (${body.path})` : '';
        const reason =
          typeof body.reason === 'string'
            ? body.reason
            : (body.error ?? 'Validation failed');
        toast.error(`${reason}${path}`);
        return;
      }
      toast.success('Saved');
      onSaved?.(value);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-border/30 bg-muted/10 p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
          Shots
        </p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className={compact ? 'h-6 px-2 text-[10px]' : 'h-7 px-2 text-xs'}
          onClick={() => void save()}
          disabled={saving}
        >
          {saving ? (
            <IconLoader2 className="size-3 animate-spin" />
          ) : (
            <>
              <IconDeviceFloppy className="size-3" />
              Save
            </>
          )}
        </Button>
      </div>
      <SceneShotFields
        value={value}
        onChange={(next) => setValue(next)}
        slugContext={slugContext}
      />
    </div>
  );
}
