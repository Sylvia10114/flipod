import { HttpError, json } from './http.js';
import {
  getBootstrapData,
  mergeBookmarks,
  mergePracticeData,
  mergeProfiles,
  mergeStringSet,
  mergeVocab,
  saveProfileByUserId,
  upsertBookmarks,
  upsertKnownWords,
  upsertLikedClips,
  upsertPracticeData,
  upsertVocabEntries,
} from './user-data.js';

const SESSION_TTL_DAYS = 90;

function randomId() {
  return crypto.randomUUID();
}

function addDays(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export async function sha256Hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function bearerTokenFromRequest(request) {
  const auth = request.headers.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function ensureTableColumn(env, tableName, columnName, ddl) {
  const pragma = await env.DB.prepare(`PRAGMA table_info(${tableName})`).all();
  const columns = (pragma.results || []).map(item => String(item.name || '').toLowerCase());
  if (columns.includes(columnName.toLowerCase())) {
    return;
  }
  await env.DB.prepare(ddl).run();
}

export async function ensureAuthSchema(env) {
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS user_devices (
         device_id TEXT PRIMARY KEY,
         user_id TEXT NOT NULL,
         created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
       )`
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS user_identities (
         id TEXT PRIMARY KEY,
         user_id TEXT NOT NULL,
         provider TEXT NOT NULL,
         provider_user_id TEXT NOT NULL,
         provider_display TEXT,
         created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         last_used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         UNIQUE(provider, provider_user_id),
         FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
       )`
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS auth_sessions (
         id TEXT PRIMARY KEY,
         user_id TEXT NOT NULL,
         device_id TEXT NOT NULL,
         token_hash TEXT NOT NULL UNIQUE,
         expires_at TEXT NOT NULL,
         created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         revoked_at TEXT,
         FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
       )`
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS sms_challenges (
         id TEXT PRIMARY KEY,
         phone_number TEXT NOT NULL,
         code_hash TEXT NOT NULL,
         expires_at TEXT NOT NULL,
         cooldown_until TEXT NOT NULL,
         attempt_count INTEGER NOT NULL DEFAULT 0,
         verified_at TEXT,
         created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
       )`
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS practice_records (
         user_id TEXT NOT NULL,
         clip_key TEXT NOT NULL,
         done INTEGER NOT NULL DEFAULT 0,
         words INTEGER NOT NULL DEFAULT 0,
         hard INTEGER NOT NULL DEFAULT 0,
         ts INTEGER NOT NULL DEFAULT 0,
         updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         PRIMARY KEY (user_id, clip_key),
         FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
       )`
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS known_words (
         user_id TEXT NOT NULL,
         word TEXT NOT NULL,
         created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         PRIMARY KEY (user_id, word),
         FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
       )`
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS liked_clips (
         user_id TEXT NOT NULL,
         clip_key TEXT NOT NULL,
         created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         PRIMARY KEY (user_id, clip_key),
         FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
       )`
    ),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON user_devices(user_id)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_user_identities_user_id ON user_identities(user_id)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_user_identities_provider_lookup ON user_identities(provider, provider_user_id)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_sms_challenges_phone_created_at ON sms_challenges(phone_number, created_at)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_practice_records_user_id ON practice_records(user_id)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_known_words_user_id ON known_words(user_id)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_liked_clips_user_id ON liked_clips(user_id)'),
  ]);

  await ensureTableColumn(
    env,
    'profiles',
    'native_language',
    `ALTER TABLE profiles ADD COLUMN native_language TEXT NOT NULL DEFAULT 'english'`
  );
  await ensureTableColumn(
    env,
    'vocab_entries',
    'content_key',
    'ALTER TABLE vocab_entries ADD COLUMN content_key TEXT'
  );
  await ensureTableColumn(
    env,
    'vocab_entries',
    'line_index',
    'ALTER TABLE vocab_entries ADD COLUMN line_index INTEGER'
  );

  await env.DB.prepare(
    `INSERT OR IGNORE INTO user_devices (device_id, user_id)
     SELECT device_id, id
     FROM users
     WHERE device_id IS NOT NULL AND TRIM(device_id) != ''`
  ).run();
}

async function getUserById(env, userId) {
  return env.DB.prepare(
    'SELECT id, device_id, created_at, updated_at FROM users WHERE id = ?'
  ).bind(userId).first();
}

async function createUser(env, deviceId) {
  const id = randomId();
  const effectiveDeviceId = deviceId || `legacy_${id}`;

  await env.DB.batch([
    env.DB.prepare('INSERT INTO users (id, device_id) VALUES (?, ?)').bind(id, effectiveDeviceId),
    env.DB.prepare('INSERT INTO profiles (user_id) VALUES (?)').bind(id),
    env.DB.prepare(
      `INSERT INTO user_devices (device_id, user_id)
       VALUES (?, ?)
       ON CONFLICT(device_id) DO UPDATE SET user_id = excluded.user_id, updated_at = CURRENT_TIMESTAMP`
    ).bind(effectiveDeviceId, id),
  ]);

  return { id, device_id: effectiveDeviceId };
}

export async function bindDeviceToUser(env, deviceId, userId) {
  if (!deviceId || !userId) return;
  await env.DB.prepare(
    `INSERT INTO user_devices (device_id, user_id)
     VALUES (?, ?)
     ON CONFLICT(device_id) DO UPDATE SET user_id = excluded.user_id, updated_at = CURRENT_TIMESTAMP`
  ).bind(deviceId, userId).run();
}

export async function findUserByDeviceId(env, deviceId) {
  if (!deviceId) return null;

  const mapped = await env.DB.prepare(
    `SELECT users.id, users.device_id, users.created_at, users.updated_at
     FROM user_devices
     JOIN users ON users.id = user_devices.user_id
     WHERE user_devices.device_id = ?`
  ).bind(deviceId).first();

  if (mapped) return mapped;

  const legacy = await env.DB.prepare(
    'SELECT id, device_id, created_at, updated_at FROM users WHERE device_id = ?'
  ).bind(deviceId).first();

  if (legacy) {
    await bindDeviceToUser(env, deviceId, legacy.id);
    return legacy;
  }

  return null;
}

export async function ensureUser(env, deviceId) {
  if (!env?.DB) {
    throw new Error('D1 binding DB is not configured');
  }
  if (!deviceId) {
    throw new Error('deviceId is required');
  }

  await ensureAuthSchema(env);

  const existing = await findUserByDeviceId(env, deviceId);
  if (existing) {
    await env.DB.prepare(
      'UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(existing.id).run();
    await bindDeviceToUser(env, deviceId, existing.id);
    return existing;
  }

  return createUser(env, deviceId);
}

async function getIdentity(env, provider, providerUserId) {
  return env.DB.prepare(
    `SELECT id, user_id AS userId, provider, provider_user_id AS providerUserId, provider_display AS providerDisplay
     FROM user_identities
     WHERE provider = ? AND provider_user_id = ?`
  ).bind(provider, providerUserId).first();
}

async function touchIdentity(env, identityId, providerDisplay) {
  await env.DB.prepare(
    `UPDATE user_identities
     SET provider_display = COALESCE(?, provider_display),
         last_used_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(providerDisplay || null, identityId).run();
}

async function attachIdentity(env, userId, provider, providerUserId, providerDisplay) {
  const existing = await getIdentity(env, provider, providerUserId);
  if (existing) {
    if (existing.userId !== userId) {
      throw new HttpError(409, '该登录方式已绑定到其他账号', 'identity_conflict');
    }
    await touchIdentity(env, existing.id, providerDisplay);
    return existing;
  }

  const identity = {
    id: randomId(),
    userId,
    provider,
    providerUserId,
    providerDisplay: providerDisplay || null,
  };

  await env.DB.prepare(
    `INSERT INTO user_identities (id, user_id, provider, provider_user_id, provider_display)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(
    identity.id,
    identity.userId,
    identity.provider,
    identity.providerUserId,
    identity.providerDisplay
  ).run();

  return identity;
}

export async function createAuthSession(env, userId, deviceId) {
  await ensureAuthSchema(env);
  const token = `${crypto.randomUUID()}_${crypto.randomUUID().replace(/-/g, '')}`;
  const tokenHash = await sha256Hex(token);
  const expiresAt = addDays(SESSION_TTL_DAYS);

  await env.DB.prepare(
    `INSERT INTO auth_sessions (id, user_id, device_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(randomId(), userId, deviceId, tokenHash, expiresAt).run();

  return { token, expiresAt };
}

export async function revokeSession(env, token) {
  if (!token) return;
  await ensureAuthSchema(env);
  const tokenHash = await sha256Hex(token);
  await env.DB.prepare(
    `UPDATE auth_sessions
     SET revoked_at = CURRENT_TIMESTAMP
     WHERE token_hash = ? AND revoked_at IS NULL`
  ).bind(tokenHash).run();
}

export async function getUserFromToken(env, token) {
  if (!token) return null;
  await ensureAuthSchema(env);
  const tokenHash = await sha256Hex(token);

  const row = await env.DB.prepare(
    `SELECT auth_sessions.id AS sessionId,
            auth_sessions.device_id AS sessionDeviceId,
            auth_sessions.expires_at AS expiresAt,
            users.id,
            users.device_id,
            users.created_at,
            users.updated_at
     FROM auth_sessions
     JOIN users ON users.id = auth_sessions.user_id
     WHERE auth_sessions.token_hash = ?
       AND auth_sessions.revoked_at IS NULL
       AND auth_sessions.expires_at > CURRENT_TIMESTAMP`
  ).bind(tokenHash).first();

  if (!row) return null;

  await env.DB.prepare(
    'UPDATE auth_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(row.sessionId).run();

  return row;
}

export async function mergeAnonymousUserIntoAccount(env, fromUserId, toUserId) {
  if (!fromUserId || !toUserId || fromUserId === toUserId) return;

  const [source, target] = await Promise.all([
    getBootstrapData(env, fromUserId),
    getBootstrapData(env, toUserId),
  ]);

  const mergedProfile = mergeProfiles(target.profile, source.profile);
  const mergedBookmarks = mergeBookmarks(target.bookmarks, source.bookmarks);
  const mergedVocab = mergeVocab(target.vocab, source.vocab);
  const mergedPractice = mergePracticeData(target.practiceData, source.practiceData);
  const mergedKnownWords = mergeStringSet(target.knownWords, source.knownWords);
  const mergedLikedClips = mergeStringSet(target.likedClipKeys, source.likedClipKeys, { lowercase: false });

  await saveProfileByUserId(env, toUserId, mergedProfile);
  await upsertBookmarks(env, toUserId, mergedBookmarks);
  await upsertVocabEntries(env, toUserId, mergedVocab);
  await upsertPracticeData(env, toUserId, mergedPractice);
  await upsertKnownWords(env, toUserId, mergedKnownWords);
  await upsertLikedClips(env, toUserId, mergedLikedClips);

  await env.DB.prepare(
    `INSERT INTO review_items (user_id, word, next_review_at, interval_days, updated_at)
     SELECT ?, word, next_review_at, interval_days, updated_at
     FROM review_items
     WHERE user_id = ?
     ON CONFLICT(user_id, word)
     DO UPDATE SET next_review_at = CASE
                                      WHEN excluded.next_review_at <= review_items.next_review_at
                                        THEN excluded.next_review_at
                                      ELSE review_items.next_review_at
                                    END,
                   interval_days = CASE
                                     WHEN excluded.interval_days <= review_items.interval_days
                                       THEN excluded.interval_days
                                     ELSE review_items.interval_days
                                   END,
                   updated_at = CURRENT_TIMESTAMP`
  ).bind(toUserId, fromUserId).run();

  await env.DB.batch([
    env.DB.prepare('UPDATE user_events SET user_id = ? WHERE user_id = ?').bind(toUserId, fromUserId),
    env.DB.prepare('DELETE FROM review_items WHERE user_id = ?').bind(fromUserId),
    env.DB.prepare('UPDATE user_devices SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').bind(toUserId, fromUserId),
    env.DB.prepare('UPDATE auth_sessions SET user_id = ? WHERE user_id = ?').bind(toUserId, fromUserId),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(fromUserId),
  ]);
}

export async function claimUserForIdentity(env, {
  provider,
  providerUserId,
  providerDisplay,
  deviceId,
}) {
  await ensureAuthSchema(env);

  const existingIdentity = await getIdentity(env, provider, providerUserId);
  const deviceUser = deviceId ? await findUserByDeviceId(env, deviceId) : null;

  if (existingIdentity) {
    const targetUser = await getUserById(env, existingIdentity.userId);
    if (!targetUser) {
      throw new HttpError(500, 'Identity points to missing user', 'broken_identity');
    }

    if (deviceUser && deviceUser.id !== targetUser.id) {
      await mergeAnonymousUserIntoAccount(env, deviceUser.id, targetUser.id);
    }

    if (deviceId) {
      await bindDeviceToUser(env, deviceId, targetUser.id);
    }
    await touchIdentity(env, existingIdentity.id, providerDisplay);
    return getUserById(env, targetUser.id);
  }

  if (deviceUser) {
    await attachIdentity(env, deviceUser.id, provider, providerUserId, providerDisplay);
    if (deviceId) {
      await bindDeviceToUser(env, deviceId, deviceUser.id);
    }
    return getUserById(env, deviceUser.id);
  }

  const user = await createUser(env, deviceId);
  await attachIdentity(env, user.id, provider, providerUserId, providerDisplay);
  return getUserById(env, user.id);
}

export async function linkIdentityToCurrentUser(env, userId, {
  provider,
  providerUserId,
  providerDisplay,
  deviceId,
}) {
  await ensureAuthSchema(env);
  await attachIdentity(env, userId, provider, providerUserId, providerDisplay);
  if (deviceId) {
    await bindDeviceToUser(env, deviceId, userId);
  }
}

export async function buildAuthBootstrap(env, user, session) {
  const data = await getBootstrapData(env, user.id);
  return {
    user: {
      id: user.id,
    },
    session: session ? {
      expiresAt: session.expiresAt,
    } : null,
    linkedIdentities: data.linkedIdentities,
    profile: data.profile,
    bookmarks: data.bookmarks,
    vocab: data.vocab,
    practiceData: data.practiceData,
    knownWords: data.knownWords,
    likedClipKeys: data.likedClipKeys,
    likeEvents: data.likeEvents,
  };
}

export async function requireUser(context, options = {}) {
  const allowDeviceFallback = options.allowDeviceFallback !== false;
  await ensureAuthSchema(context.env);

  const token = bearerTokenFromRequest(context.request);
  if (token) {
    try {
      const user = await getUserFromToken(context.env, token);
      if (!user) {
        return { error: json({ error: 'Invalid or expired session' }, { status: 401 }) };
      }
      return { user, token };
    } catch (error) {
      return { error: json({ error: error.message }, { status: 500 }) };
    }
  }

  if (!allowDeviceFallback) {
    return { error: json({ error: 'Missing Authorization header' }, { status: 401 }) };
  }

  const deviceId = context.request.headers.get('x-device-id');
  if (!deviceId) {
    return { error: json({ error: 'Missing Authorization or x-device-id header' }, { status: 401 }) };
  }

  try {
    const user = await ensureUser(context.env, deviceId);
    return { user, deviceId };
  } catch (error) {
    return { error: json({ error: error.message }, { status: 500 }) };
  }
}
