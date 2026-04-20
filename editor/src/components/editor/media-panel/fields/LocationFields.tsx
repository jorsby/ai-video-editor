import type { LocationSP } from '@/lib/api/structured-prompt-schemas';
import { SelectField, TextField, TextareaField } from './shared';

export type LocationSPValue = Partial<LocationSP>;

const SETTING_TYPE_OPTIONS = [
  { value: 'interior', label: 'Interior' },
  { value: 'exterior', label: 'Exterior' },
];

const TIME_OF_DAY_OPTIONS = [
  { value: 'dawn', label: 'Dawn' },
  { value: 'morning', label: 'Morning' },
  { value: 'midday', label: 'Midday' },
  { value: 'afternoon', label: 'Afternoon' },
  { value: 'dusk', label: 'Dusk' },
  { value: 'night', label: 'Night' },
];

export function LocationFields({
  value,
  onChange,
  variant = false,
  parentFallback,
}: {
  value: LocationSPValue;
  onChange: (next: LocationSPValue) => void;
  variant?: boolean;
  parentFallback?: LocationSPValue;
}) {
  const required = !variant;
  const set = <K extends keyof LocationSPValue>(
    key: K,
    next: LocationSPValue[K] | undefined
  ) => {
    const copy = { ...value };
    if (next === undefined || next === '' || next === null) {
      delete copy[key];
    } else {
      (copy as Record<string, unknown>)[key as string] = next as unknown;
    }
    onChange(copy);
  };
  const ph = (key: keyof LocationSPValue, fallback: string): string => {
    const pv = parentFallback?.[key];
    return pv != null && String(pv).trim() !== '' ? String(pv) : fallback;
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <SelectField
          label="Setting"
          required={required}
          value={value.setting_type}
          onChange={(v) => set('setting_type', v)}
          options={SETTING_TYPE_OPTIONS}
          placeholder={ph('setting_type', 'Select…')}
        />
        <SelectField
          label="Time of day"
          required={required}
          value={value.time_of_day}
          onChange={(v) => set('time_of_day', v)}
          options={TIME_OF_DAY_OPTIONS}
          placeholder={ph('time_of_day', 'Select…')}
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
        label="Extras"
        hint="optional"
        value={value.extras}
        onChange={(v) => set('extras', v)}
        placeholder={ph(
          'extras',
          'architecture style, landmarks, mood, weather...'
        )}
        rows={3}
      />
    </div>
  );
}
