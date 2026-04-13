import { errorResponse, HttpError, json, noContent, readJson } from '../../../_lib/http.js';
import { verifySmsChallenge } from '../../../_lib/phone-auth.js';
import { ensureAuthSchema, linkIdentityToCurrentUser, requireUser } from '../../../_lib/session.js';
import { normalizePhoneNumber } from '../../../_lib/sms.js';
import { getLinkedIdentitiesByUserId } from '../../../_lib/user-data.js';

export async function onRequestOptions() {
  return noContent();
}

export async function onRequestPost(context) {
  try {
    await ensureAuthSchema(context.env);
    const { user, error } = await requireUser(context, { allowDeviceFallback: false });
    if (error) return error;

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
    await linkIdentityToCurrentUser(context.env, user.id, {
      provider: 'phone',
      providerUserId: phoneNumber,
      providerDisplay: phoneNumber,
      deviceId,
    });

    return json({
      ok: true,
      linkedIdentities: await getLinkedIdentitiesByUserId(context.env, user.id),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
