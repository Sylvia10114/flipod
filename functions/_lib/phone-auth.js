import { HttpError } from './http.js';
import { sha256Hex } from './session.js';

const MAX_ATTEMPTS = 5;
const DEFAULT_TTL_SECONDS = 300;
const DEFAULT_RESEND_LOCK_SECONDS = 60;
const DEFAULT_DAILY_LIMIT = 20;

function toIso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function readPositiveInt(rawValue, fallback) {
  const value = Number.parseInt(String(rawValue ?? ''), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getSmsChallengeConfig(env) {
  return {
    ttlSeconds: readPositiveInt(env.VERIFICATION_CODE_TTL_SECONDS, DEFAULT_TTL_SECONDS),
    cooldownSeconds: readPositiveInt(
      env.VERIFICATION_CODE_RESEND_LOCK_SECONDS,
      DEFAULT_RESEND_LOCK_SECONDS
    ),
    dailyLimit: readPositiveInt(env.VERIFICATION_CODE_DAILY_LIMIT, DEFAULT_DAILY_LIMIT),
  };
}

export async function getLatestSmsChallenge(env, phoneNumber) {
  return env.DB.prepare(
    `SELECT id, phone_number AS phoneNumber, code_hash AS codeHash, expires_at AS expiresAt,
            cooldown_until AS cooldownUntil, attempt_count AS attemptCount, verified_at AS verifiedAt,
            created_at AS createdAt, updated_at AS updatedAt
     FROM sms_challenges
     WHERE phone_number = ?
     ORDER BY created_at DESC
     LIMIT 1`
  ).bind(phoneNumber).first();
}

export async function createSmsChallenge(env, phoneNumber, code) {
  const { ttlSeconds, cooldownSeconds } = getSmsChallengeConfig(env);
  const id = crypto.randomUUID();
  const codeHash = await sha256Hex(code);
  const expiresAt = toIso(ttlSeconds * 1000);
  const cooldownUntil = toIso(cooldownSeconds * 1000);

  await env.DB.prepare(
    `INSERT INTO sms_challenges (id, phone_number, code_hash, expires_at, cooldown_until)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(id, phoneNumber, codeHash, expiresAt, cooldownUntil).run();

  return {
    id,
    expiresAt,
    cooldownUntil,
  };
}

export async function countSmsChallengesSince(env, phoneNumber, sinceIso) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM sms_challenges
     WHERE phone_number = ? AND created_at >= ?`
  ).bind(phoneNumber, sinceIso).first();

  return Number(row?.count || 0);
}

export async function verifySmsChallenge(env, phoneNumber, code) {
  const latest = await getLatestSmsChallenge(env, phoneNumber);
  if (!latest) {
    throw new HttpError(400, '请先获取验证码', 'sms_challenge_missing');
  }

  if (latest.verifiedAt) {
    throw new HttpError(400, '验证码已使用，请重新获取', 'sms_challenge_used');
  }

  if (Date.parse(latest.expiresAt) <= Date.now()) {
    throw new HttpError(400, '验证码已过期，请重新获取', 'sms_code_expired');
  }

  if (Number(latest.attemptCount || 0) >= MAX_ATTEMPTS) {
    throw new HttpError(429, '验证码错误次数过多，请稍后重试', 'sms_attempts_exceeded');
  }

  const codeHash = await sha256Hex(code);
  if (codeHash !== latest.codeHash) {
    const nextAttempts = Number(latest.attemptCount || 0) + 1;
    await env.DB.prepare(
      `UPDATE sms_challenges
       SET attempt_count = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(nextAttempts, latest.id).run();

    if (nextAttempts >= MAX_ATTEMPTS) {
      throw new HttpError(429, '验证码错误次数过多，请稍后重试', 'sms_attempts_exceeded');
    }

    throw new HttpError(400, '验证码错误', 'sms_code_invalid');
  }

  await env.DB.prepare(
    `UPDATE sms_challenges
     SET verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(latest.id).run();

  return latest;
}

export function getSmsChallengeWindow(env) {
  const { ttlSeconds, cooldownSeconds, dailyLimit } = getSmsChallengeConfig(env);
  return {
    ttlSeconds,
    cooldownSeconds,
    dailyLimit,
  };
}
