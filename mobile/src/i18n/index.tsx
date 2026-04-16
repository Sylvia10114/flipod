import React from 'react';
import uiCopy from './ui-copy.json';
import type { NativeLanguage } from '../types';
import { DEFAULT_NATIVE_LANGUAGE } from '../types';
import { normalizeNativeLanguage } from '../content-localization';

type UiValue = string | UiDictionary;
type UiDictionary = {
  [key: string]: UiValue;
};
type UiParams = Record<string, string | number>;

type UiI18nValue = {
  nativeLanguage: NativeLanguage;
  t: (key: string, params?: UiParams) => string;
};

const SUPPORTED_NATIVE_LANGUAGES: NativeLanguage[] = [
  'english',
  'simplified_chinese',
  'traditional_chinese',
  'japanese',
  'korean',
  'spanish',
  'french',
  'brazilian_portuguese',
  'italian',
  'german',
];

const LANGUAGE_LABELS: Record<NativeLanguage, { selfLabel: string; englishLabel: string }> = {
  english: { selfLabel: 'English', englishLabel: 'English' },
  simplified_chinese: { selfLabel: '简体中文', englishLabel: 'Simplified Chinese' },
  traditional_chinese: { selfLabel: '繁體中文', englishLabel: 'Traditional Chinese' },
  japanese: { selfLabel: '日本語', englishLabel: 'Japanese' },
  korean: { selfLabel: '한국어', englishLabel: 'Korean' },
  spanish: { selfLabel: 'Español', englishLabel: 'Spanish' },
  french: { selfLabel: 'Français', englishLabel: 'French' },
  brazilian_portuguese: { selfLabel: 'Português (Brasil)', englishLabel: 'Brazilian Portuguese' },
  italian: { selfLabel: 'Italiano', englishLabel: 'Italian' },
  german: { selfLabel: 'Deutsch', englishLabel: 'German' },
};

const DICTIONARIES = uiCopy as Record<NativeLanguage, UiDictionary>;

function interpolate(template: string, params?: UiParams) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? `{${key}}`));
}

function lookup(dictionary: UiDictionary, key: string): string | null {
  const parts = key.split('.');
  let cursor: UiValue | undefined = dictionary;
  for (const part of parts) {
    if (!cursor || typeof cursor === 'string') {
      return null;
    }
    cursor = cursor[part];
  }
  return typeof cursor === 'string' ? cursor : null;
}

export function getNativeLanguageOptions() {
  return SUPPORTED_NATIVE_LANGUAGES.map(code => ({
    code,
    ...LANGUAGE_LABELS[code],
  }));
}

export function createUiI18n(nativeLanguage: NativeLanguage | string | null | undefined): UiI18nValue {
  const normalized = normalizeNativeLanguage(nativeLanguage);
  const dictionary = DICTIONARIES[normalized] || DICTIONARIES[DEFAULT_NATIVE_LANGUAGE];
  const fallback = DICTIONARIES.english;

  return {
    nativeLanguage: normalized,
    t(key, params) {
      const template = lookup(dictionary, key) || lookup(fallback, key) || key;
      return interpolate(template, params);
    },
  };
}

const UiI18nContext = React.createContext<UiI18nValue>(createUiI18n(DEFAULT_NATIVE_LANGUAGE));

export function UiI18nProvider({
  nativeLanguage,
  children,
}: {
  nativeLanguage: NativeLanguage | string | null | undefined;
  children: React.ReactNode;
}) {
  const value = React.useMemo(() => createUiI18n(nativeLanguage), [nativeLanguage]);
  return <UiI18nContext.Provider value={value}>{children}</UiI18nContext.Provider>;
}

export function useUiI18n() {
  return React.useContext(UiI18nContext);
}
