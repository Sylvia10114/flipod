import { errorResponse, HttpError, json, noContent, readJson } from '../../../_lib/http.js';
import {
  countSmsChallengesSince,
  createSmsChallenge,
  getLatestSmsChallenge,
  getSmsChallengeWindow,
} from '../../../_lib/phone-auth.js';
import { ensureAuthSchema } from '../../../_lib/session.js';
import { normalizePhoneNumber, resolveSmsCode, sendAliyunSms, shouldUseTestCode } from '../../../_lib/sms.js';

export async function onRequestOptions() {
  return noContent();
}

export async function onRequestPost(context) {
  try {
    await ensureAuthSchema(context.env);

    const body = await readJson(context.request);
    const phoneNumber = normalizePhoneNumber(body?.phoneNumber || '');
    const existing = await getLatestSmsChallenge(context.env, phoneNumber);
    const window = getSmsChallengeWindow(context.env);

    if (existing && !existing.verifiedAt && Date.parse(existing.cooldownUntil) > Date.now()) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((Date.parse(existing.cooldownUntil) - Date.now()) / 1000)
      );
      throw new HttpError(429, '请求过于频繁，请稍后再试', 'sms_rate_limited');
    }

    const dailyCount = await countSmsChallengesSince(
      context.env,
      phoneNumber,
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    );
    if (dailyCount >= window.dailyLimit) {
      throw new HttpError(429, '今日验证码次数已达上限，请明天再试', 'sms_daily_limit_reached');
    }

    const code = resolveSmsCode(context.env, phoneNumber);
    const challenge = await createSmsChallenge(context.env, phoneNumber, code);

    try {
      await sendAliyunSms(context.env, phoneNumber, code);
    } catch (error) {
      await context.env.DB.prepare('DELETE FROM sms_challenges WHERE id = ?').bind(challenge.id).run();
      throw error;
    }

    const debugCode = context.env.AUTH_DEBUG_SMS_CODE === '1' || shouldUseTestCode(context.env, phoneNumber)
      ? code
      : undefined;

    return json({
      ok: true,
      retryAfterSeconds: window.cooldownSeconds,
      expiresInSeconds: window.ttlSeconds,
      dailyLimit: window.dailyLimit,
      debugCode,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
