import type { NativeLanguage } from './types';

const GOOGLE_TRANSLATE_CODES: Record<NativeLanguage, string> = {
  english: 'en',
  simplified_chinese: 'zh-CN',
  traditional_chinese: 'zh-TW',
  japanese: 'ja',
  korean: 'ko',
  spanish: 'es',
  french: 'fr',
  brazilian_portuguese: 'pt-BR',
  italian: 'it',
  german: 'de',
};

const wordTranslationCache = new Map<string, string>();

function normalizeWord(value: string) {
  return String(value || '').trim().toLowerCase();
}

export async function fetchWordTranslation(word: string, nativeLanguage: NativeLanguage): Promise<string> {
  const normalizedWord = normalizeWord(word);
  if (!normalizedWord || nativeLanguage === 'english') return '';

  const cacheKey = `${nativeLanguage}:${normalizedWord}`;
  const cached = wordTranslationCache.get(cacheKey);
  if (typeof cached === 'string') {
    return cached;
  }

  try {
    const response = await fetch(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${encodeURIComponent(GOOGLE_TRANSLATE_CODES[nativeLanguage])}&dt=bd&dt=t&dt=rm&q=${encodeURIComponent(normalizedWord)}`
    );
    if (!response.ok) {
      wordTranslationCache.set(cacheKey, '');
      return '';
    }

    const data = await response.json();
    const direct = String(data?.[0]?.[0]?.[0] || '').trim();
    const translated = direct && direct.toLowerCase() !== normalizedWord ? direct : '';
    wordTranslationCache.set(cacheKey, translated);
    return translated;
  } catch {
    wordTranslationCache.set(cacheKey, '');
    return '';
  }
}
