import { errorResponse, HttpError, json, noContent, readJson } from '../../../_lib/http.js';
import { getLinkedIdentitiesByUserId } from '../../../_lib/user-data.js';
import { verifySmsChallenge } from '../../../_lib/phone-auth.js';
import { claimUserForIdentity, createAuthSession, ensureAuthSchema } from '../../../_lib/session.js';
import { normalizePhoneNumber } from '../../../_lib/sms.js';

export async function onRequestOptions() {
  return noContent();
}

export async function onRequestPost(context) {
  try {
    await ensureAuthSchema(context.env);

    const body = await readJson(context.request);
    const phoneNumber = normalizePhoneNumber(body?.phoneNumber || '');
    const code = String(body?.code || '').trim();
    const deviceId = String(body?.deviceId || '').trim();

    if (!code) {
      throw new HttpError(400, '验证码不能为空', 'sms_code_required');
    }
    if (!deviceId) {
      throw new HttpError(400, 'deviceId is required', 'device_id_required');
    }

    await verifySmsChallenge(context.env, phoneNumber, code);

    const user = await claimUserForIdentity(context.env, {
      provider: 'phone',
      providerUserId: phoneNumber,
      providerDisplay: phoneNumber,
      deviceId,
    });
    const session = await createAuthSession(context.env, user.id, deviceId);
    const linkedIdentities = await getLinkedIdentitiesByUserId(context.env, user.id);

    return json({
      user: {
        id: user.id,
      },
      session: {
        token: session.token,
        expiresAt: session.expiresAt,
      },
      linkedIdentities,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
