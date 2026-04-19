import type { PropSP } from '@/lib/api/structured-prompt-schemas';
import { TextField, TextareaField } from './shared';

export type PropSPValue = Partial<PropSP>;

export function PropFields({
  value,
  onChange,
  variant = false,
}: {
  value: PropSPValue;
  onChange: (next: PropSPValue) => void;
  variant?: boolean;
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

  return (
    <div className="flex flex-col gap-2">
      <TextareaField
        label="Prompt"
        required={required}
        value={value.prompt}
        onChange={(v) => set('prompt', v)}
        placeholder="aged letter, yellowed paper, handwritten Arabic script, wax seal"
        rows={3}
      />

      <TextField
        label="Brand"
        hint="optional"
        value={value.brand}
        onChange={(v) => set('brand', v)}
        placeholder="if product has a brand"
      />
    </div>
  );
}
