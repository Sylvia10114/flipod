function toIsoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function pickNewer(left, right) {
  const leftTime = Date.parse(left || '');
  const rightTime = Date.parse(right || '');
  if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return null;
  if (Number.isNaN(leftTime)) return 'right';
  if (Number.isNaN(rightTime)) return 'left';
  return rightTime >= leftTime ? 'right' : 'left';
}

function parseJsonArray(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const SUPPORTED_NATIVE_LANGUAGES = new Set([
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
]);

function normalizeNativeLanguage(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return SUPPORTED_NATIVE_LANGUAGES.has(normalized) ? normalized : 'english';
}

export function defaultProfile() {
  return {
    level: null,
    interests: [],
    nativeLanguage: 'english',
    theme: 'dark',
    onboardingDone: false,
    updatedAt: null,
  };
}

export function normalizeProfile(profile) {
  if (!profile) return defaultProfile();
  return {
    level: profile.level || null,
    interests: Array.isArray(profile.interests) ? profile.interests.filter(Boolean) : [],
    nativeLanguage: normalizeNativeLanguage(profile.nativeLanguage),
    theme: profile.theme === 'light' ? 'light' : 'dark',
    onboardingDone: Boolean(profile.onboardingDone),
    updatedAt: profile.updatedAt || null,
  };
}

export function maskPhoneNumber(phoneNumber) {
  if (!phoneNumber) return '';
  const digits = phoneNumber.replace(/\D/g, '');
  if (digits.length >= 11) {
    const local = digits.slice(-11);
    return `+86 ${local.slice(0, 3)}****${local.slice(-4)}`;
  }
  return phoneNumber;
}

export async function getProfileByUserId(env, userId) {
  const profile = await env.DB.prepare(
    'SELECT level, interests, native_language AS nativeLanguage, theme, onboarding_done AS onboardingDone, updated_at AS updatedAt FROM profiles WHERE user_id = ?'
  ).bind(userId).first();

  return normalizeProfile({
    level: profile?.level || null,
    interests: profile?.interests ? parseJsonArray(profile.interests) : [],
    nativeLanguage: profile?.nativeLanguage || 'english',
    theme: profile?.theme || 'dark',
    onboardingDone: Boolean(profile?.onboardingDone),
    updatedAt: profile?.updatedAt || null,
  });
}

export async function getBookmarksByUserId(env, userId) {
  const result = await env.DB.prepare(
    'SELECT id, clip_key AS clipKey, title, source, tag, created_at AS createdAt FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(userId).all();

  return (result.results || []).map(item => ({
    id: item.id,
    clipKey: item.clipKey,
    title: item.title || '',
    source: item.source || '',
    tag: item.tag || '',
    createdAt: item.createdAt || null,
  }));
}

export async function getVocabByUserId(env, userId) {
  const result = await env.DB.prepare(
    `SELECT id, word, cefr, phonetic, definition_zh AS definitionZh, context, context_zh AS contextZh, content_key AS contentKey,
            line_index AS lineIndex, known,
            created_at AS createdAt, updated_at AS updatedAt
     FROM vocab_entries
     WHERE user_id = ?
     ORDER BY updated_at DESC, created_at DESC`
  ).bind(userId).all();

  return (result.results || []).map(item => ({
    id: item.id,
    word: String(item.word || '').toLowerCase(),
    cefr: item.cefr || '',
    phonetic: item.phonetic || '',
    definitionZh: item.definitionZh || '',
    context: item.context || '',
    contextZh: item.contextZh || '',
    contentKey: item.contentKey || '',
    lineIndex: Number.isInteger(item.lineIndex) ? item.lineIndex : null,
    known: Boolean(item.known),
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
  }));
}

export async function getPracticeDataByUserId(env, userId) {
  const result = await env.DB.prepare(
    `SELECT clip_key AS clipKey, done, words, hard, ts
     FROM practice_records
     WHERE user_id = ?`
  ).bind(userId).all();

  const practiceData = {};
  for (const item of result.results || []) {
    practiceData[item.clipKey] = {
      done: Boolean(item.done),
      words: Number(item.words || 0),
      hard: Number(item.hard || 0),
      ts: Number(item.ts || 0),
    };
  }
  return practiceData;
}

export async function getKnownWordsByUserId(env, userId) {
  const result = await env.DB.prepare(
    'SELECT word FROM known_words WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(userId).all();

  return (result.results || []).map(item => String(item.word || '').toLowerCase()).filter(Boolean);
}

export async function getLikedClipsByUserId(env, userId) {
  const result = await env.DB.prepare(
    'SELECT clip_key AS clipKey FROM liked_clips WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(userId).all();

  return (result.results || []).map(item => item.clipKey).filter(Boolean);
}

export async function getLikeEventsByUserId(env, userId, limit = 100) {
  const result = await env.DB.prepare(
    `SELECT payload, created_at AS createdAt
     FROM user_events
     WHERE user_id = ? AND event_type = 'clip_like'
     ORDER BY created_at DESC
     LIMIT ?`
  ).bind(userId, limit).all();

  return (result.results || [])
    .map(item => {
      try {
        const payload = item.payload ? JSON.parse(item.payload) : {};
        return {
          tag: String(payload.tag || ''),
          timestamp: Number(payload.timestamp || Date.parse(item.createdAt || '') || Date.now()),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.timestamp - b.timestamp);
}

export async function getLinkedIdentitiesByUserId(env, userId) {
  const result = await env.DB.prepare(
    `SELECT provider, provider_user_id AS providerUserId, provider_display AS providerDisplay, last_used_at AS lastUsedAt
     FROM user_identities
     WHERE user_id = ?
     ORDER BY created_at ASC`
  ).bind(userId).all();

  return (result.results || []).map(item => ({
    provider: item.provider,
    providerUserId: item.providerUserId,
    displayValue: item.provider === 'phone'
      ? maskPhoneNumber(item.providerDisplay || item.providerUserId)
      : (item.providerDisplay || 'Apple'),
    lastUsedAt: item.lastUsedAt || null,
  }));
}

export async function getBootstrapData(env, userId) {
  const [
    profile,
    bookmarks,
    vocab,
    practiceData,
    knownWords,
    likedClipKeys,
    likeEvents,
    linkedIdentities,
  ] = await Promise.all([
    getProfileByUserId(env, userId),
    getBookmarksByUserId(env, userId),
    getVocabByUserId(env, userId),
    getPracticeDataByUserId(env, userId),
    getKnownWordsByUserId(env, userId),
    getLikedClipsByUserId(env, userId),
    getLikeEventsByUserId(env, userId),
    getLinkedIdentitiesByUserId(env, userId),
  ]);

  return {
    profile,
    bookmarks,
    vocab,
    practiceData,
    knownWords,
    likedClipKeys,
    likeEvents,
    linkedIdentities,
  };
}

export function mergeProfiles(accountProfile, incomingProfile) {
  const account = normalizeProfile(accountProfile);
  const incoming = normalizeProfile(incomingProfile);

  if (account.onboardingDone) {
    return {
      ...account,
      nativeLanguage: account.nativeLanguage !== 'english'
        ? account.nativeLanguage
        : (incoming.nativeLanguage || account.nativeLanguage),
      updatedAt: account.updatedAt || incoming.updatedAt || null,
    };
  }

  const merged = {
    ...account,
    ...incoming,
    interests: incoming.interests.length > 0 ? incoming.interests : account.interests,
    theme: incoming.theme || account.theme || 'dark',
    onboardingDone: Boolean(incoming.onboardingDone),
    updatedAt: incoming.updatedAt || account.updatedAt || null,
  };
  return normalizeProfile(merged);
}

export function mergeBookmarks(primary, secondary) {
  const byKey = new Map();
  for (const item of [...primary, ...secondary]) {
    if (!item?.clipKey) continue;
    const existing = byKey.get(item.clipKey);
    if (!existing) {
      byKey.set(item.clipKey, { ...item });
      continue;
    }

    const winner = pickNewer(existing.createdAt, item.createdAt);
    const preferred = winner === 'right' ? item : existing;
    const fallback = winner === 'right' ? existing : item;
    byKey.set(item.clipKey, {
      ...fallback,
      ...preferred,
      clipKey: item.clipKey,
    });
  }
  return Array.from(byKey.values());
}

export function mergeVocab(primary, secondary) {
  const byWord = new Map();

  for (const raw of [...primary, ...secondary]) {
    const word = String(raw?.word || '').trim().toLowerCase();
    if (!word) continue;

    const item = { ...raw, word };
    const existing = byWord.get(word);
    if (!existing) {
      byWord.set(word, item);
      continue;
    }

    const newer = pickNewer(existing.updatedAt || existing.createdAt, item.updatedAt || item.createdAt);
    const latest = newer === 'right' ? item : existing;
    const older = newer === 'right' ? existing : item;

    byWord.set(word, {
      ...older,
      ...latest,
      word,
      known: Boolean(existing.known || item.known),
      cefr: latest.cefr || older.cefr || '',
      phonetic: latest.phonetic || older.phonetic || '',
      definitionZh: latest.definitionZh || older.definitionZh || '',
      context: latest.context || older.context || '',
      contextZh: latest.contextZh || older.contextZh || '',
      contentKey: latest.contentKey || older.contentKey || '',
      lineIndex: Number.isInteger(latest.lineIndex) ? latest.lineIndex : older.lineIndex ?? null,
      updatedAt: latest.updatedAt || older.updatedAt || null,
      createdAt: older.createdAt || latest.createdAt || null,
    });
  }

  return Array.from(byWord.values());
}

export function mergePracticeData(primary = {}, secondary = {}) {
  const merged = { ...primary };
  for (const [clipKey, incoming] of Object.entries(secondary)) {
    const current = merged[clipKey];
    if (!current) {
      merged[clipKey] = incoming;
      continue;
    }

    if (current.done && !incoming.done) continue;
    if (incoming.done && !current.done) {
      merged[clipKey] = incoming;
      continue;
    }

    merged[clipKey] = Number(incoming.ts || 0) >= Number(current.ts || 0) ? incoming : current;
  }
  return merged;
}

export function mergeStringSet(primary = [], secondary = [], options = {}) {
  const lowercase = options.lowercase !== false;
  return Array.from(
    new Set(
      [...primary, ...secondary]
        .map(item => String(item || '').trim())
        .filter(Boolean)
        .map(item => lowercase ? item.toLowerCase() : item)
    )
  );
}

export function mergeLikeEvents(primary = [], secondary = []) {
  const deduped = new Map();
  for (const item of [...primary, ...secondary]) {
    const tag = String(item?.tag || '');
    const timestamp = Number(item?.timestamp || 0);
    if (!tag || !timestamp) continue;
    deduped.set(`${tag}:${timestamp}`, { tag, timestamp });
  }

  return Array.from(deduped.values())
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-100);
}

export async function saveProfileByUserId(env, userId, profile) {
  const normalized = normalizeProfile(profile);
  await env.DB.prepare(
    `INSERT INTO profiles (user_id, level, interests, native_language, theme, onboarding_done, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id)
     DO UPDATE SET level = excluded.level,
                   interests = excluded.interests,
                   native_language = excluded.native_language,
                   theme = excluded.theme,
                   onboarding_done = excluded.onboarding_done,
                   updated_at = CURRENT_TIMESTAMP`
  ).bind(
    userId,
    normalized.level,
    JSON.stringify(normalized.interests),
    normalized.nativeLanguage,
    normalized.theme,
    normalized.onboardingDone ? 1 : 0
  ).run();
}

export async function upsertBookmarks(env, userId, bookmarks) {
  for (const item of bookmarks || []) {
    if (!item?.clipKey) continue;
    await env.DB.prepare(
      `INSERT INTO bookmarks (id, user_id, clip_key, title, source, tag, created_at)
       VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
       ON CONFLICT(user_id, clip_key)
       DO UPDATE SET title = excluded.title,
                     source = excluded.source,
                     tag = excluded.tag,
                     created_at = excluded.created_at`
    ).bind(
      item.id || crypto.randomUUID(),
      userId,
      item.clipKey,
      item.title || '',
      item.source || '',
      item.tag || '',
      toIsoDate(item.createdAt)
    ).run();
  }
}

export async function upsertVocabEntries(env, userId, vocab) {
  for (const item of vocab || []) {
    const word = String(item?.word || '').trim().toLowerCase();
    if (!word) continue;
    await env.DB.prepare(
      `INSERT INTO vocab_entries (
         id, user_id, word, cefr, phonetic, definition_zh, context, context_zh, content_key, line_index, known, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP))
       ON CONFLICT(user_id, word)
       DO UPDATE SET cefr = excluded.cefr,
                     phonetic = excluded.phonetic,
                     definition_zh = excluded.definition_zh,
                     context = excluded.context,
                     context_zh = excluded.context_zh,
                     content_key = COALESCE(excluded.content_key, vocab_entries.content_key),
                     line_index = COALESCE(excluded.line_index, vocab_entries.line_index),
                     known = MAX(vocab_entries.known, excluded.known),
                     updated_at = excluded.updated_at`
    ).bind(
      item.id || crypto.randomUUID(),
      userId,
      word,
      item.cefr || '',
      item.phonetic || '',
      item.definitionZh || '',
      item.context || '',
      item.contextZh || '',
      item.contentKey || '',
      Number.isInteger(item.lineIndex) ? item.lineIndex : null,
      item.known ? 1 : 0,
      toIsoDate(item.createdAt),
      toIsoDate(item.updatedAt || item.createdAt)
    ).run();
  }
}

export async function upsertPracticeData(env, userId, practiceData) {
  for (const [clipKey, record] of Object.entries(practiceData || {})) {
    if (!clipKey) continue;
    await env.DB.prepare(
      `INSERT INTO practice_records (user_id, clip_key, done, words, hard, ts, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, clip_key)
       DO UPDATE SET done = CASE WHEN practice_records.done = 1 THEN 1 ELSE excluded.done END,
                     words = excluded.words,
                     hard = excluded.hard,
                     ts = CASE WHEN excluded.ts >= practice_records.ts THEN excluded.ts ELSE practice_records.ts END,
                     updated_at = CURRENT_TIMESTAMP`
    ).bind(
      userId,
      clipKey,
      record?.done ? 1 : 0,
      Number(record?.words || 0),
      Number(record?.hard || 0),
      Number(record?.ts || 0)
    ).run();
  }
}

export async function upsertKnownWords(env, userId, words) {
  for (const raw of words || []) {
    const word = String(raw || '').trim().toLowerCase();
    if (!word) continue;
    await env.DB.prepare(
      `INSERT INTO known_words (user_id, word)
       VALUES (?, ?)
       ON CONFLICT(user_id, word) DO NOTHING`
    ).bind(userId, word).run();
  }
}

export async function replaceLikedClips(env, userId, likedClipKeys) {
  await env.DB.prepare('DELETE FROM liked_clips WHERE user_id = ?').bind(userId).run();
  for (const clipKey of likedClipKeys || []) {
    if (!clipKey) continue;
    await env.DB.prepare(
      `INSERT INTO liked_clips (user_id, clip_key)
       VALUES (?, ?)
       ON CONFLICT(user_id, clip_key) DO NOTHING`
    ).bind(userId, clipKey).run();
  }
}

export async function upsertLikedClips(env, userId, likedClipKeys) {
  for (const clipKey of likedClipKeys || []) {
    if (!clipKey) continue;
    await env.DB.prepare(
      `INSERT INTO liked_clips (user_id, clip_key)
       VALUES (?, ?)
       ON CONFLICT(user_id, clip_key) DO NOTHING`
    ).bind(userId, clipKey).run();
  }
}

export async function appendLikeEvents(env, userId, likeEvents) {
  for (const event of likeEvents || []) {
    const tag = String(event?.tag || '').trim().toLowerCase();
    const timestamp = Number(event?.timestamp || 0);
    if (!tag || !timestamp) continue;
    await env.DB.prepare(
      'INSERT INTO user_events (id, user_id, event_type, payload) VALUES (?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(),
      userId,
      'clip_like',
      JSON.stringify({ tag, timestamp })
    ).run();
  }
}
