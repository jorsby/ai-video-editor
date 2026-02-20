import { create } from 'zustand';
import type { LanguageCode } from '@/lib/constants/languages';

interface LanguageState {
  activeLanguage: LanguageCode;
  availableLanguages: LanguageCode[];
  isLanguageSwitching: boolean;
  setActiveLanguage: (lang: LanguageCode) => void;
  setAvailableLanguages: (langs: LanguageCode[]) => void;
  setIsLanguageSwitching: (v: boolean) => void;
}

export const useLanguageStore = create<LanguageState>((set) => ({
  activeLanguage: 'en',
  availableLanguages: ['en'],
  isLanguageSwitching: false,
  setActiveLanguage: (lang) => set({ activeLanguage: lang }),
  setAvailableLanguages: (langs) => set({ availableLanguages: langs }),
  setIsLanguageSwitching: (v) => set({ isLanguageSwitching: v }),
}));
