import type { CharacterSP } from '@/lib/api/structured-prompt-schemas';
import { NumberField, SelectField, TextField, TextareaField } from './shared';

export type CharacterSPValue = Partial<CharacterSP>;

const GENDER_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'non-binary', label: 'Non-binary' },
  { value: 'other', label: 'Other' },
];

/**
 * Typed fields for a character's structured_prompt.
 * `variant=true` marks all fields optional (variant overlays parent).
 * When `parentFallback` is provided, its values are shown as placeholder text
 * on empty inputs so users see what's inherited from the parent.
 */
export function CharacterFields({
  value,
  onChange,
  variant = false,
  parentFallback,
}: {
  value: CharacterSPValue;
  onChange: (next: CharacterSPValue) => void;
  variant?: boolean;
  parentFallback?: CharacterSPValue;
}) {
  const required = !variant;
  const set = <K extends keyof CharacterSPValue>(
    key: K,
    next: CharacterSPValue[K] | undefined
  ) => {
    const copy = { ...value };
    if (next === undefined || next === '' || next === null) {
      delete copy[key];
    } else {
      (copy as Record<string, unknown>)[key as string] = next as unknown;
    }
    onChange(copy);
  };
  const ph = (key: keyof CharacterSPValue, fallback: string): string => {
    const pv = parentFallback?.[key];
    return pv != null && String(pv).trim() !== '' ? String(pv) : fallback;
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Age"
          required={required}
          min={0}
          value={value.age}
          onChange={(n) => set('age', n)}
          placeholder={ph('age', '35')}
        />
        <SelectField
          label="Gender"
          required={required}
          value={value.gender}
          onChange={(v) => set('gender', v)}
          options={GENDER_OPTIONS}
          placeholder={ph('gender', 'Select…')}
        />
      </div>

      <TextField
        label="Era"
        required={required}
        value={value.era}
        onChange={(v) => set('era', v)}
        placeholder={ph('era', '1850s Ottoman / 2450 AD / contemporary')}
      />

      <TextareaField
        label="Appearance"
        required={required}
        value={value.appearance}
        onChange={(v) => set('appearance', v)}
        placeholder={ph(
          'appearance',
          'short black hair, brown eyes, athletic build'
        )}
        rows={2}
      />

      <TextareaField
        label="Outfit"
        required={required}
        value={value.outfit}
        onChange={(v) => set('outfit', v)}
        placeholder={ph('outfit', 'navy suit, white shirt')}
        rows={2}
      />

      <TextareaField
        label="Extras"
        hint="optional"
        value={value.extras}
        onChange={(v) => set('extras', v)}
        placeholder={ph(
          'extras',
          'scars, glasses, tattoos, ethnicity, distinguishing features'
        )}
        rows={2}
      />
    </div>
  );
}
