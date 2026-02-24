export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'EN', name: 'English' },
  { code: 'tr', label: 'TR', name: 'Turkish' },
  { code: 'ar', label: 'AR', name: 'Arabic' },
  { code: 'es', label: 'ES', name: 'Spanish' },
  { code: 'fr', label: 'FR', name: 'French' },
  { code: 'de', label: 'DE', name: 'German' },
  { code: 'pt', label: 'PT', name: 'Portuguese' },
  { code: 'it', label: 'IT', name: 'Italian' },
  { code: 'ru', label: 'RU', name: 'Russian' },
  { code: 'ja', label: 'JA', name: 'Japanese' },
  { code: 'ko', label: 'KO', name: 'Korean' },
  { code: 'zh', label: 'ZH', name: 'Chinese' },
  { code: 'hi', label: 'HI', name: 'Hindi' },
  { code: 'nl', label: 'NL', name: 'Dutch' },
  { code: 'pl', label: 'PL', name: 'Polish' },
  { code: 'sv', label: 'SV', name: 'Swedish' },
  { code: 'da', label: 'DA', name: 'Danish' },
  { code: 'fi', label: 'FI', name: 'Finnish' },
  { code: 'no', label: 'NO', name: 'Norwegian' },
  { code: 'uk', label: 'UK', name: 'Ukrainian' },
  { code: 'cs', label: 'CS', name: 'Czech' },
  { code: 'ro', label: 'RO', name: 'Romanian' },
  { code: 'hu', label: 'HU', name: 'Hungarian' },
  { code: 'id', label: 'ID', name: 'Indonesian' },
  { code: 'ms', label: 'MS', name: 'Malay' },
] as const;

// Widen LanguageCode so any string (including future codes) is valid
export type LanguageCode = string;

// Helper for display
export function getLanguageName(code: string): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.name ?? code.toUpperCase();
}

// Known default voices — fallback for codes not listed
export const DEFAULT_VOICE_MAP: Record<string, string> = {
  en: 'NFG5qt843uXKj4pFvR7C',
  tr: '75SIZa3vvET95PHhf1yD',
  ar: 'IES4nrmZdUBHByLBde0P',
};
export const FALLBACK_VOICE = 'NFG5qt843uXKj4pFvR7C';
