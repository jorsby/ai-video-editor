import type React from 'react';
import { cn } from '@/lib/utils';

export const fieldInputCls =
  'w-full mt-0.5 px-1.5 py-1 text-[11px] rounded bg-background/40 border border-border/30 focus:border-primary/50 outline-none';

export const fieldLabelCls =
  'text-[9px] uppercase tracking-wide text-muted-foreground/60';

export function Field({
  label,
  required,
  hint,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: control is passed as children
    <label className={cn('block', className)}>
      <span className={fieldLabelCls}>
        {label}
        {required ? ' *' : hint ? ` (${hint})` : ''}
      </span>
      {children}
    </label>
  );
}

export function TextField({
  label,
  required,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  value: string | undefined;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  return (
    <Field label={label} required={required} hint={hint}>
      <input
        type="text"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={fieldInputCls}
      />
    </Field>
  );
}

export function TextareaField({
  label,
  required,
  hint,
  value,
  onChange,
  placeholder,
  rows = 2,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  value: string | undefined;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <Field label={label} required={required} hint={hint}>
      <textarea
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={cn(fieldInputCls, 'resize-y')}
      />
    </Field>
  );
}

export function NumberField({
  label,
  required,
  hint,
  value,
  onChange,
  placeholder,
  min,
  max,
  step,
  readOnly,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  readOnly?: boolean;
}) {
  return (
    <Field label={label} required={required} hint={hint}>
      <input
        type="number"
        value={value ?? ''}
        onChange={(e) => {
          if (readOnly) return;
          const v = e.target.value;
          if (v === '') onChange(undefined);
          else {
            const n = Number(v);
            if (Number.isFinite(n)) onChange(n);
          }
        }}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        readOnly={readOnly}
        className={cn(
          fieldInputCls,
          readOnly && 'opacity-60 cursor-not-allowed'
        )}
      />
    </Field>
  );
}

export function SelectField({
  label,
  required,
  hint,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  value: string | undefined;
  onChange: (next: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}) {
  return (
    <Field label={label} required={required} hint={hint}>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className={fieldInputCls}
      >
        <option value="" disabled>
          {placeholder ?? 'Select…'}
        </option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
