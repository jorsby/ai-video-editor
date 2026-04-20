'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  IconDeviceFloppy,
  IconLoader2,
  IconRefresh,
} from '@tabler/icons-react';
import {
  CharacterFields,
  type CharacterSPValue,
  LocationFields,
  type LocationSPValue,
  PropFields,
  type PropSPValue,
} from './index';

export type AssetRole = 'character' | 'location' | 'prop';
export type InspectorMode = 'parent' | 'variant';

type TypedValue = Record<string, unknown>;

function endpointFor(mode: InspectorMode, role: AssetRole, id: string): string {
  if (mode === 'variant') return `/api/v2/variants/${id}`;
  const seg =
    role === 'character'
      ? 'characters'
      : role === 'location'
        ? 'locations'
        : 'props';
  return `/api/v2/${seg}/${id}`;
}

function requestBodyFor(mode: InspectorMode, value: TypedValue): TypedValue {
  // Parent endpoints accept typed fields at the top level; variant endpoint
  // accepts the typed object nested under `structured_prompt`.
  return mode === 'parent' ? value : { structured_prompt: value };
}

/**
 * Shared editor shell for an asset's typed structured_prompt fields.
 *
 * Used by the project assets panel (parent assets) and the storyboard video
 * assets gallery (variant overlays) to guarantee a single edit experience.
 */
export function AssetInspector({
  id,
  role,
  mode,
  initialValue,
  parentFallback,
  onSaved,
  onRegenerate,
  compact = false,
}: {
  id: string;
  role: AssetRole;
  mode: InspectorMode;
  initialValue: TypedValue;
  /** In variant mode, parent's typed fields shown as placeholders so empty
   *  overrides display the effective (inherited) value. Ignored in parent mode. */
  parentFallback?: TypedValue | null;
  onSaved?: (next: TypedValue) => void;
  onRegenerate?: () => void | Promise<void>;
  compact?: boolean;
}) {
  const [value, setValue] = useState<TypedValue>(() => initialValue ?? {});
  const [saving, setSaving] = useState(false);
  const [pendingRegen, setPendingRegen] = useState(false);

  useEffect(() => {
    setValue(initialValue ?? {});
  }, [initialValue]);

  const save = async (regenerateAfter: boolean) => {
    setSaving(true);
    setPendingRegen(regenerateAfter);
    try {
      const res = await fetch(endpointFor(mode, role, id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBodyFor(mode, value)),
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
      if (regenerateAfter && onRegenerate) {
        await onRegenerate();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
      setPendingRegen(false);
    }
  };

  const fallback = mode === 'variant' ? (parentFallback ?? null) : null;
  let fields: React.ReactNode;
  if (role === 'character') {
    fields = (
      <CharacterFields
        value={value as CharacterSPValue}
        onChange={(next) => setValue(next)}
        variant={mode === 'variant'}
        parentFallback={(fallback as CharacterSPValue) ?? undefined}
      />
    );
  } else if (role === 'location') {
    fields = (
      <LocationFields
        value={value as LocationSPValue}
        onChange={(next) => setValue(next)}
        variant={mode === 'variant'}
        parentFallback={(fallback as LocationSPValue) ?? undefined}
      />
    );
  } else {
    fields = (
      <PropFields
        value={value as PropSPValue}
        onChange={(next) => setValue(next)}
        variant={mode === 'variant'}
        parentFallback={(fallback as PropSPValue) ?? undefined}
      />
    );
  }

  const showRegenerate = mode === 'variant' && !!onRegenerate;

  return (
    <div className="space-y-2 rounded-md border border-border/30 bg-muted/10 p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
          Fields
        </p>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className={compact ? 'h-6 px-2 text-[10px]' : 'h-7 px-2 text-xs'}
            onClick={() => void save(false)}
            disabled={saving}
          >
            {saving && !pendingRegen ? (
              <IconLoader2 className="size-3 animate-spin" />
            ) : (
              <>
                <IconDeviceFloppy className="size-3" />
                Save
              </>
            )}
          </Button>
          {showRegenerate && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className={compact ? 'h-6 px-2 text-[10px]' : 'h-7 px-2 text-xs'}
              onClick={() => void save(true)}
              disabled={saving}
              title="Save and regenerate image"
            >
              {saving && pendingRegen ? (
                <IconLoader2 className="size-3 animate-spin" />
              ) : (
                <>
                  <IconRefresh className="size-3" />
                  Save & Regenerate
                </>
              )}
            </Button>
          )}
        </div>
      </div>
      {fields}
    </div>
  );
}
