import { bearerTokenFromRequest, revokeSession } from '../../_lib/session.js';
import { errorResponse, json, noContent } from '../../_lib/http.js';

export async function onRequestOptions() {
  return noContent();
}

export async function onRequestPost(context) {
  try {
    const token = bearerTokenFromRequest(context.request);
    await revokeSession(context.env, token);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
