import { verifyAppleIdentityToken } from '../../_lib/apple.js';
import { errorResponse, HttpError, json, noContent, readJson } from '../../_lib/http.js';
import { claimUserForIdentity, createAuthSession, ensureAuthSchema } from '../../_lib/session.js';
import { getLinkedIdentitiesByUserId } from '../../_lib/user-data.js';

export async function onRequestOptions() {
  return noContent();
}

export async function onRequestPost(context) {
  try {
    await ensureAuthSchema(context.env);

    const body = await readJson(context.request);
    const identityToken = String(body?.identityToken || '').trim();
    const authorizationCode = String(body?.authorizationCode || '').trim();
    const deviceId = String(body?.deviceId || '').trim();
    const name = String(body?.name || '').trim();

    if (!identityToken) {
      throw new HttpError(400, 'identityToken is required', 'apple_identity_token_required');
    }
    if (!authorizationCode) {
      throw new HttpError(400, 'authorizationCode is required', 'apple_authorization_code_required');
    }
    if (!deviceId) {
      throw new HttpError(400, 'deviceId is required', 'device_id_required');
    }

    const tokenPayload = await verifyAppleIdentityToken(
      identityToken,
      context.env.APPLE_AUDIENCE || 'com.flipod.mobile'
    );

    const user = await claimUserForIdentity(context.env, {
      provider: 'apple',
      providerUserId: tokenPayload.sub,
      providerDisplay: name || tokenPayload.email || 'Apple',
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
