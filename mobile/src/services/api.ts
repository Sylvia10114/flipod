import type { Bookmark, Profile, RankResponse, SessionResponse, VocabEntry } from '../types';

const runtimeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
export const API_BASE_URL = runtimeEnv?.EXPO_PUBLIC_API_BASE_URL || 'http://127.0.0.1:8788';

async function request<T>(path: string, init: RequestInit = {}, deviceId?: string): Promise<T> {
  const headers = new Headers(init.headers || {});
  headers.set('Content-Type', 'application/json');
  if (deviceId) {
    headers.set('x-device-id', deviceId);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
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
  getProfile(deviceId: string) {
    return request<{ profile: Profile }>('/api/profile', { method: 'GET' }, deviceId);
  },
  saveProfile(deviceId: string, profile: Profile) {
    return request<{ ok: boolean }>('/api/profile', {
      method: 'POST',
      body: JSON.stringify(profile),
    }, deviceId);
  },
  rankFeed(payload: Record<string, unknown>) {
    return request<RankResponse>('/api/rank', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  listBookmarks(deviceId: string) {
    return request<{ bookmarks: Bookmark[] }>('/api/bookmarks', { method: 'GET' }, deviceId);
  },
  saveBookmark(deviceId: string, bookmark: Bookmark) {
    return request<{ ok: boolean; id: string }>('/api/bookmarks', {
      method: 'POST',
      body: JSON.stringify(bookmark),
    }, deviceId);
  },
  removeBookmark(deviceId: string, clipKey: string) {
    return request<{ ok: boolean }>('/api/bookmarks', {
      method: 'DELETE',
      body: JSON.stringify({ clipKey }),
    }, deviceId);
  },
  listVocab(deviceId: string) {
    return request<{ vocab: VocabEntry[] }>('/api/vocab', { method: 'GET' }, deviceId);
  },
  saveVocab(deviceId: string, entry: VocabEntry) {
    return request<{ ok: boolean; id: string }>('/api/vocab', {
      method: 'POST',
      body: JSON.stringify(entry),
    }, deviceId);
  },
  trackEvent(deviceId: string, eventType: string, payload: Record<string, unknown> = {}, clipId?: number) {
    return request<{ ok: boolean; id: string }>('/api/events', {
      method: 'POST',
      body: JSON.stringify({ eventType, payload, clipId }),
    }, deviceId);
  },
};
