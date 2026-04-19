import type { SceneSP, SceneShot } from '@/lib/api/structured-prompt-schemas';
import { Button } from '@/components/ui/button';
import { NumberField, SelectField, TextField, TextareaField } from './shared';

export type SceneShotsValue = SceneSP | null;

const SHOT_TYPE_OPTIONS = [
  { value: 'close-up', label: 'Close-up' },
  { value: 'medium', label: 'Medium' },
  { value: 'wide', label: 'Wide' },
  { value: 'establishing', label: 'Establishing' },
  { value: 'over-the-shoulder', label: 'Over-the-shoulder' },
  { value: 'pov', label: 'POV' },
];

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

/**
 * Array editor for scene shots. Each scene has one or more typed shots;
 * this renders them as a vertical stack with add/remove/reorder controls.
 */
export function SceneShotFields({
  value,
  onChange,
}: {
  value: SceneShotsValue;
  onChange: (next: SceneSP) => void;
}) {
  const shots: SceneShot[] = Array.isArray(value) ? (value as SceneShot[]) : [];

  const update = (index: number, next: SceneShot) => {
    const copy = [...shots];
    copy[index] = next;
    onChange(copy);
  };

  const remove = (index: number) => {
    const copy = shots.filter((_, i) => i !== index);
    // Re-normalize order values so they remain 0..n-1
    onChange(copy.map((s, i) => ({ ...s, order: i })));
  };

  const add = () => {
    onChange([...shots, blankShot(shots.length)]);
  };

  return (
    <div className="flex flex-col gap-3">
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
}: {
  index: number;
  shot: SceneShot;
  onChange: (next: SceneShot) => void;
  onRemove: () => void;
  canRemove: boolean;
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
        <TextField
          label="Camera movement"
          required
          value={shot.camera_movement}
          onChange={(v) => set('camera_movement', v)}
          placeholder="slow pan left / static / dolly in"
        />
      </div>

      <TextareaField
        label="Action"
        required
        value={shot.action}
        onChange={(v) => set('action', v)}
        placeholder="what happens in this shot"
        rows={2}
      />

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

      <NumberField
        label="Duration hint"
        hint="seconds, optional"
        step={0.5}
        min={0.5}
        value={shot.duration_hint}
        onChange={(n) => set('duration_hint', n)}
        placeholder="3.5"
      />
    </div>
  );
}
