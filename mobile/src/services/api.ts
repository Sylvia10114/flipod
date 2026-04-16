import type {
  AuthBootstrapResponse,
  AuthInitResponse,
  Bookmark,
  LikeEvent,
  LocalizedClipContent,
  NativeLanguage,
  PracticeRecord,
  Profile,
  RankRequest,
  RankResponse,
  SessionResponse,
  VocabEntry,
} from '../types';

const runtimeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, '');
}

const DEFAULT_API_BASE_URL = 'http://115.190.10.83/flipod-api';

export const API_BASE_URL = normalizeBaseUrl(runtimeEnv?.EXPO_PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL);
export const CONTENT_BASE_URL = normalizeBaseUrl(runtimeEnv?.EXPO_PUBLIC_CONTENT_BASE_URL || API_BASE_URL);

type RequestOptions = {
  deviceId?: string;
  token?: string;
};

type ContentTranslationRequestItem = {
  contentKey: string;
  contentHash: string;
  title: string;
  lines: Array<{
    en: string;
    zh?: string;
  }>;
  questions: Array<{
    question: string;
    options: string[];
    answer: string;
    explanation_zh?: string;
  }>;
};

type LocalMigrationPayload = {
  deviceId: string;
  profile: Profile | null;
  bookmarks: Bookmark[];
  vocab: VocabEntry[];
  practiceData: Record<string, PracticeRecord>;
  knownWords: string[];
  likedClipKeys: string[];
  likeEvents: LikeEvent[];
};

async function request<T>(path: string, init: RequestInit = {}, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  headers.set('Content-Type', 'application/json');
  if (options.deviceId) {
    headers.set('x-device-id', options.deviceId);
  }
  if (options.token) {
    headers.set('Authorization', `Bearer ${options.token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const text = await response.text();
    let message = text || `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      message = parsed.error || message;
    } catch {
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export const api = {
  createSession(deviceId: string) {
    return request<SessionResponse>('/api/session', {
      method: 'POST',
      body: JSON.stringify({ deviceId }),
    });
  },
  requestSmsCode(phoneNumber: string) {
    return request<{ ok: boolean; retryAfterSeconds: number; expiresInSeconds: number; debugCode?: string }>(
      '/api/auth/sms/request',
      {
        method: 'POST',
        body: JSON.stringify({ phoneNumber }),
      }
    );
  },
  verifySmsCode(phoneNumber: string, code: string, deviceId: string) {
    return request<AuthInitResponse>('/api/auth/sms/verify', {
      method: 'POST',
      body: JSON.stringify({ phoneNumber, code, deviceId }),
    });
  },
  signInWithApple(identityToken: string, authorizationCode: string, deviceId: string, name?: string) {
    return request<AuthInitResponse>('/api/auth/apple', {
      method: 'POST',
      body: JSON.stringify({ identityToken, authorizationCode, deviceId, name }),
    });
  },
  getAuthBootstrap(token: string) {
    return request<AuthBootstrapResponse>('/api/auth/me', { method: 'GET' }, { token });
  },
  migrateLocal(token: string, payload: LocalMigrationPayload) {
    return request<AuthBootstrapResponse>('/api/auth/migrate-local', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, { token });
  },
  logout(token: string) {
    return request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }, { token });
  },
  deleteAccount(token: string) {
    return request<{ ok: boolean }>('/api/auth/delete', { method: 'POST' }, { token });
  },
  linkPhone(token: string, phoneNumber: string, code: string, deviceId: string) {
    return request<{ ok: boolean; linkedIdentities: AuthBootstrapResponse['linkedIdentities'] }>(
      '/api/auth/link/phone',
      {
        method: 'POST',
        body: JSON.stringify({ phoneNumber, code, deviceId }),
      },
      { token }
    );
  },
  linkApple(token: string, identityToken: string, authorizationCode: string, deviceId: string, name?: string) {
    return request<{ ok: boolean; linkedIdentities: AuthBootstrapResponse['linkedIdentities'] }>(
      '/api/auth/link/apple',
      {
        method: 'POST',
        body: JSON.stringify({ identityToken, authorizationCode, deviceId, name }),
      },
      { token }
    );
  },
  getProfile(token: string) {
    return request<{ profile: Profile }>('/api/profile', { method: 'GET' }, { token });
  },
  saveProfile(token: string, profile: Profile) {
    return request<{ ok: boolean }>('/api/profile', {
      method: 'POST',
      body: JSON.stringify(profile),
    }, { token });
  },
  getContentTranslations(locale: NativeLanguage, items: ContentTranslationRequestItem[]) {
    return request<{ translations: Record<string, LocalizedClipContent> }>('/api/content/translations', {
      method: 'POST',
      body: JSON.stringify({ locale, items }),
    });
  },
  rankFeed(payload: RankRequest, token?: string) {
    return request<RankResponse>('/api/rank', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, { token });
  },
  listBookmarks(token: string) {
    return request<{ bookmarks: Bookmark[] }>('/api/bookmarks', { method: 'GET' }, { token });
  },
  saveBookmark(token: string, bookmark: Bookmark) {
    return request<{ ok: boolean; id: string }>('/api/bookmarks', {
      method: 'POST',
      body: JSON.stringify(bookmark),
    }, { token });
  },
  removeBookmark(token: string, clipKey: string) {
    return request<{ ok: boolean }>('/api/bookmarks', {
      method: 'DELETE',
      body: JSON.stringify({ clipKey }),
    }, { token });
  },
  listVocab(token: string) {
    return request<{ vocab: VocabEntry[] }>('/api/vocab', { method: 'GET' }, { token });
  },
  saveVocab(token: string, entry: VocabEntry) {
    return request<{ ok: boolean; id: string }>('/api/vocab', {
      method: 'POST',
      body: JSON.stringify(entry),
    }, { token });
  },
  listPractice(token: string) {
    return request<{ practiceData: Record<string, PracticeRecord> }>('/api/practice', { method: 'GET' }, { token });
  },
  savePractice(token: string, clipKey: string, record: PracticeRecord) {
    return request<{ ok: boolean }>('/api/practice', {
      method: 'POST',
      body: JSON.stringify({ clipKey, record }),
    }, { token });
  },
  listKnownWords(token: string) {
    return request<{ knownWords: string[] }>('/api/known-words', { method: 'GET' }, { token });
  },
  saveKnownWord(token: string, word: string) {
    return request<{ ok: boolean }>('/api/known-words', {
      method: 'POST',
      body: JSON.stringify({ word }),
    }, { token });
  },
  listLikes(token: string) {
    return request<{ likedClipKeys: string[]; likeEvents: LikeEvent[] }>('/api/likes', { method: 'GET' }, { token });
  },
  saveLike(token: string, clipKey: string, tag: string, timestamp = Date.now()) {
    return request<{ ok: boolean }>('/api/likes', {
      method: 'POST',
      body: JSON.stringify({ clipKey, tag, timestamp }),
    }, { token });
  },
  removeLike(token: string, clipKey: string) {
    return request<{ ok: boolean }>('/api/likes', {
      method: 'DELETE',
      body: JSON.stringify({ clipKey }),
    }, { token });
  },
  trackEvent(token: string, eventType: string, payload: Record<string, unknown> = {}, clipId?: number) {
    return request<{ ok: boolean; id: string }>('/api/events', {
      method: 'POST',
      body: JSON.stringify({ eventType, payload, clipId }),
    }, { token });
  },
};
