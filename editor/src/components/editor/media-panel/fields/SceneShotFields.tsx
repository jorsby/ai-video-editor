import type { SceneSP, SceneShot } from '@/lib/api/structured-prompt-schemas';
import { Button } from '@/components/ui/button';
import { HighlightedPrompt } from '../panel/storyboard/highlighted-prompt';
import type { VariantImageMap } from '../shared/scene-types';
import { NumberField, SelectField, TextField, TextareaField } from './shared';

export type SceneShotsValue = SceneSP | null;

export type ShotSlugContext = {
  locationSlug: string | null;
  characterSlugs: string[];
  propSlugs: string[];
  imageMap: VariantImageMap;
};

const SHOT_TYPE_OPTIONS = [
  { value: 'close-up', label: 'Close-up' },
  { value: 'medium', label: 'Medium' },
  { value: 'wide', label: 'Wide' },
  { value: 'establishing', label: 'Establishing' },
  { value: 'over-the-shoulder', label: 'Over-the-shoulder' },
  { value: 'pov', label: 'POV' },
];

const CAMERA_MOVEMENT_OPTIONS = [
  { value: 'static', label: 'Static' },
  { value: 'pan-left', label: 'Pan left' },
  { value: 'pan-right', label: 'Pan right' },
  { value: 'tilt-up', label: 'Tilt up' },
  { value: 'tilt-down', label: 'Tilt down' },
  { value: 'zoom-in', label: 'Zoom in' },
  { value: 'zoom-out', label: 'Zoom out' },
  { value: 'dolly-in', label: 'Dolly in' },
  { value: 'dolly-out', label: 'Dolly out' },
  { value: 'tracking', label: 'Tracking' },
  { value: 'orbit', label: 'Orbit' },
  { value: 'handheld', label: 'Handheld' },
  { value: 'crane-up', label: 'Crane up' },
  { value: 'crane-down', label: 'Crane down' },
];

const DEFAULT_SHOT_LENGTH = 3;

function blankShot(order: number): SceneShot {
  return {
    order,
    shot_type: '',
    camera_movement: '',
    action: '',
    lighting: '',
    mood: '',
  };
}

function isTimed(s: SceneShot): boolean {
  return s.duration_from != null || s.duration_to != null;
}

/** Rewrite shots so duration_from[i] === duration_to[i-1] (or 0 for i=0),
 *  preserving each shot's own length. Shots without timing are left alone. */
function reconcileTiming(shots: SceneShot[]): SceneShot[] {
  if (!shots.some(isTimed)) return shots;
  const out: SceneShot[] = [];
  let cursor = 0;
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    const prevFrom = s.duration_from ?? cursor;
    const prevTo = s.duration_to ?? prevFrom + DEFAULT_SHOT_LENGTH;
    const ownLen = Math.max(DEFAULT_SHOT_LENGTH / 6, prevTo - prevFrom);
    const from = cursor;
    const to = +(from + ownLen).toFixed(2);
    out.push({ ...s, duration_from: from, duration_to: to });
    cursor = to;
  }
  return out;
}

/**
 * Array editor for scene shots. Each scene has one or more typed shots;
 * this renders them as a vertical stack with add/remove/reorder controls.
 */
export function SceneShotFields({
  value,
  onChange,
  slugContext,
}: {
  value: SceneShotsValue;
  onChange: (next: SceneSP) => void;
  slugContext?: ShotSlugContext;
}) {
  const shots: SceneShot[] = Array.isArray(value) ? (value as SceneShot[]) : [];
  const timingEnabled = shots.length > 0 && shots.every(isTimed);

  const update = (index: number, next: SceneShot) => {
    const copy = [...shots];
    copy[index] = next;
    if (timingEnabled) {
      // `next` may have changed its duration_to; cascade downstream.
      onChange(reconcileTiming(copy));
    } else {
      onChange(copy);
    }
  };

  const remove = (index: number) => {
    const copy = shots
      .filter((_, i) => i !== index)
      .map((s, i) => ({ ...s, order: i }));
    onChange(timingEnabled ? reconcileTiming(copy) : copy);
  };

  const add = () => {
    if (timingEnabled) {
      const last = shots[shots.length - 1];
      const from = last?.duration_to ?? 0;
      const seeded: SceneShot = {
        ...blankShot(shots.length),
        duration_from: from,
        duration_to: +(from + DEFAULT_SHOT_LENGTH).toFixed(2),
      };
      onChange([...shots, seeded]);
    } else {
      onChange([...shots, blankShot(shots.length)]);
    }
  };

  const toggleTiming = (enabled: boolean) => {
    if (enabled) {
      // Seed contiguous defaults from shot 0.
      const next = shots.map((s, i) => ({
        ...s,
        duration_from: i * DEFAULT_SHOT_LENGTH,
        duration_to: (i + 1) * DEFAULT_SHOT_LENGTH,
      }));
      onChange(next);
    } else {
      // biome-ignore lint/correctness/noUnusedVariables: destructuring to strip
      const next = shots.map(({ duration_from, duration_to, ...rest }) => rest);
      onChange(next as SceneSP);
    }
  };

  const totalDuration = timingEnabled
    ? shots.reduce((m, s) => Math.max(m, s.duration_to ?? 0), 0)
    : null;

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-[10px] text-muted-foreground/80 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={timingEnabled}
          onChange={(e) => toggleTiming(e.target.checked)}
          disabled={shots.length === 0}
          className="h-3 w-3"
        />
        <span>Enable per-shot timing</span>
        {totalDuration != null ? (
          <span className="ml-auto text-[10px] font-medium text-foreground/80">
            Total: {totalDuration}s
          </span>
        ) : null}
      </label>

      {shots.length === 0 ? (
        <p className="text-[10px] text-muted-foreground/60 italic">
          No shots. Add one to describe this scene.
        </p>
      ) : null}

      {shots.map((shot, i) => (
        <ShotCard
          /** biome-ignore lint/suspicious/noArrayIndexKey: reorder normalises the index */
          key={i}
          index={i}
          shot={shot}
          onChange={(next) => update(i, next)}
          onRemove={() => remove(i)}
          canRemove={shots.length > 1}
          slugContext={slugContext}
          timingEnabled={timingEnabled}
        />
      ))}

      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="h-7 text-[10px] self-start"
        onClick={add}
      >
        + Add shot
      </Button>
    </div>
  );
}

function ShotCard({
  index,
  shot,
  onChange,
  onRemove,
  canRemove,
  slugContext,
  timingEnabled,
}: {
  index: number;
  shot: SceneShot;
  onChange: (next: SceneShot) => void;
  onRemove: () => void;
  canRemove: boolean;
  slugContext?: ShotSlugContext;
  timingEnabled: boolean;
}) {
  const set = <K extends keyof SceneShot>(key: K, v: SceneShot[K]) => {
    onChange({ ...shot, [key]: v });
  };

  return (
    <div className="rounded-md border border-border/30 bg-muted/10 p-2 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-wide text-muted-foreground/80">
          Shot {index + 1}
        </span>
        {canRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="text-[9px] text-muted-foreground/60 hover:text-destructive"
          >
            Remove
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <SelectField
          label="Shot type"
          required
          value={shot.shot_type}
          onChange={(v) => set('shot_type', v)}
          options={SHOT_TYPE_OPTIONS}
        />
        <SelectField
          label="Camera movement"
          required
          value={shot.camera_movement}
          onChange={(v) => set('camera_movement', v)}
          options={CAMERA_MOVEMENT_OPTIONS}
        />
      </div>

      <TextareaField
        label="Action"
        required
        value={shot.action}
        onChange={(v) => set('action', v)}
        placeholder="what happens in this shot — use @slug to tag characters, locations, props"
        rows={2}
      />
      {slugContext && shot.action && shot.action.includes('@') ? (
        <div className="text-[10px] leading-relaxed text-foreground/70 bg-background/30 rounded px-1.5 py-1 border border-border/20">
          <HighlightedPrompt
            prompt={shot.action}
            locationSlug={slugContext.locationSlug}
            characterSlugs={slugContext.characterSlugs}
            propSlugs={slugContext.propSlugs}
            imageMap={slugContext.imageMap}
          />
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <TextField
          label="Lighting"
          required
          value={shot.lighting}
          onChange={(v) => set('lighting', v)}
          placeholder="golden hour side-light"
        />
        <TextField
          label="Mood"
          required
          value={shot.mood}
          onChange={(v) => set('mood', v)}
          placeholder="somber / tense / joyful"
        />
      </div>

      <TextareaField
        label="Setting notes"
        hint="optional"
        value={shot.setting_notes}
        onChange={(v) => set('setting_notes', v)}
        rows={2}
      />

      {timingEnabled ? (
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Starts at"
            hint="seconds (locked)"
            step={0.5}
            min={0}
            readOnly
            value={shot.duration_from}
            onChange={() => {
              // locked — duration_from derives from previous shot's duration_to
            }}
          />
          <NumberField
            label="Ends at"
            hint="seconds from scene start"
            step={0.5}
            min={0}
            value={shot.duration_to}
            onChange={(n) => set('duration_to', n)}
            placeholder="5"
          />
        </div>
      ) : null}
      {timingEnabled &&
      shot.duration_from != null &&
      shot.duration_to != null ? (
        <p className="text-[9px] text-muted-foreground/60">
          Duration: {(shot.duration_to - shot.duration_from).toFixed(1)}s
        </p>
      ) : null}
    </div>
  );
}
