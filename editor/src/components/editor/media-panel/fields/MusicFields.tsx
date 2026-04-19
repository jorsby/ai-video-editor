import type { MusicSP } from '@/lib/api/structured-prompt-schemas';
import { Switch } from '@/components/ui/switch';
import { NumberField, TextField, TextareaField } from './shared';

/**
 * Partial MusicSP that the UI manipulates before it's persisted. The
 * discriminator (`is_instrumental`) is always present; other fields may
 * be missing while the user is filling the form.
 */
export type MusicSPValue = {
  is_instrumental: boolean;
  genre?: string;
  mood?: string;
  instrumentation?: string;
  tempo_bpm?: number;
  lyrics?: string;
};

export function emptyMusicValue(isInstrumental = true): MusicSPValue {
  return { is_instrumental: isInstrumental };
}

export function MusicFields({
  value,
  onChange,
}: {
  value: MusicSPValue;
  onChange: (next: MusicSPValue) => void;
}) {
  const set = <K extends keyof MusicSPValue>(key: K, v: MusicSPValue[K]) => {
    const copy = { ...value };
    if (v === undefined || v === '' || v === null) {
      delete copy[key];
    } else {
      (copy as Record<string, unknown>)[key as string] = v as unknown;
    }
    onChange(copy);
  };

  const toggleInstrumental = (next: boolean) => {
    // When flipping to instrumental, drop lyrics; discriminated union forbids it.
    if (next) {
      const { lyrics: _l, ...rest } = value;
      onChange({ ...rest, is_instrumental: true });
    } else {
      onChange({ ...value, is_instrumental: false });
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center justify-between gap-2">
        <span className="text-[9px] uppercase tracking-wide text-muted-foreground/60">
          Instrumental *
        </span>
        <Switch
          checked={value.is_instrumental}
          onCheckedChange={toggleInstrumental}
          size="sm"
        />
      </label>

      <TextField
        label="Genre"
        required
        value={value.genre}
        onChange={(v) => set('genre', v)}
        placeholder="orchestral cinematic / lo-fi hip-hop"
      />

      <TextField
        label="Mood"
        required
        value={value.mood}
        onChange={(v) => set('mood', v)}
        placeholder="melancholic, hopeful"
      />

      <TextareaField
        label="Instrumentation"
        required
        value={value.instrumentation}
        onChange={(v) => set('instrumentation', v)}
        placeholder="strings, piano, soft percussion"
        rows={2}
      />

      <NumberField
        label="Tempo"
        hint="BPM, optional"
        min={20}
        max={400}
        step={1}
        value={value.tempo_bpm}
        onChange={(n) => set('tempo_bpm', n)}
        placeholder="72"
      />

      {value.is_instrumental ? null : (
        <TextareaField
          label="Lyrics"
          required
          value={value.lyrics}
          onChange={(v) => set('lyrics', v)}
          placeholder="lyrics text..."
          rows={6}
        />
      )}
    </div>
  );
}

/** Convert the UI value into a MusicSP payload for the API (unchanged at the
 * structural level; the server re-validates with zod). */
export function toMusicSPPayload(value: MusicSPValue): Record<string, unknown> {
  const base: Record<string, unknown> = {
    is_instrumental: value.is_instrumental,
    genre: value.genre,
    mood: value.mood,
    instrumentation: value.instrumentation,
  };
  if (value.tempo_bpm != null) base.tempo_bpm = value.tempo_bpm;
  if (!value.is_instrumental) base.lyrics = value.lyrics;
  return base;
}

/** Read a stored structured_prompt (possibly legacy) into a MusicSPValue. */
export function musicSPFromRow(raw: unknown): MusicSPValue {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return emptyMusicValue(true);
  }
  const r = raw as Record<string, unknown>;
  // New typed shape
  if (typeof r.is_instrumental === 'boolean') {
    const out: MusicSPValue = {
      is_instrumental: r.is_instrumental,
    };
    if (typeof r.genre === 'string') out.genre = r.genre;
    if (typeof r.mood === 'string') out.mood = r.mood;
    if (typeof r.instrumentation === 'string')
      out.instrumentation = r.instrumentation;
    if (typeof r.tempo_bpm === 'number') out.tempo_bpm = r.tempo_bpm;
    if (typeof r.lyrics === 'string' && !r.is_instrumental)
      out.lyrics = r.lyrics;
    return out;
  }
  // Legacy { prompt, extras } — best-effort mapping
  const legacyPrompt = typeof r.prompt === 'string' ? r.prompt : '';
  const legacyExtras = typeof r.extras === 'string' ? r.extras : '';
  const isInstrumental = !legacyPrompt.trim();
  return {
    is_instrumental: isInstrumental,
    genre: legacyExtras || undefined,
    ...(isInstrumental ? {} : { lyrics: legacyPrompt }),
  };
}

/** Narrow to `MusicSP` when the value is valid for API submission. */
export function isValidMusicSP(value: MusicSPValue): value is MusicSP {
  const baseOk =
    !!value.genre?.trim() &&
    !!value.mood?.trim() &&
    !!value.instrumentation?.trim();
  if (!baseOk) return false;
  if (value.is_instrumental) return true;
  return !!value.lyrics?.trim();
}
