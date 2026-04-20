import type { PropSP } from '@/lib/api/structured-prompt-schemas';
import { TextField, TextareaField } from './shared';

export type PropSPValue = Partial<PropSP>;

export function PropFields({
  value,
  onChange,
  variant = false,
  parentFallback,
}: {
  value: PropSPValue;
  onChange: (next: PropSPValue) => void;
  variant?: boolean;
  parentFallback?: PropSPValue;
}) {
  const required = !variant;
  const set = <K extends keyof PropSPValue>(
    key: K,
    next: PropSPValue[K] | undefined
  ) => {
    const copy = { ...value };
    if (next === undefined || next === '' || next === null) {
      delete copy[key];
    } else {
      (copy as Record<string, unknown>)[key as string] = next as unknown;
    }
    onChange(copy);
  };
  const ph = (key: keyof PropSPValue, fallback: string): string => {
    const pv = parentFallback?.[key];
    return pv != null && String(pv).trim() !== '' ? String(pv) : fallback;
  };

  return (
    <div className="flex flex-col gap-2">
      <TextareaField
        label="Prompt"
        required={required}
        value={value.prompt}
        onChange={(v) => set('prompt', v)}
        placeholder={ph(
          'prompt',
          'aged letter, yellowed paper, handwritten Arabic script, wax seal'
        )}
        rows={3}
      />

      <TextField
        label="Brand"
        hint="optional"
        value={value.brand}
        onChange={(v) => set('brand', v)}
        placeholder={ph('brand', 'if product has a brand')}
      />
    </div>
  );
}
