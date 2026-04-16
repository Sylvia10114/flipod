import { errorResponse, json, noContent } from '../../_lib/http.js';
import { ensureAuthSchema, requireUser } from '../../_lib/session.js';

export async function onRequestOptions() {
  return noContent();
}

export async function onRequestPost(context) {
  try {
    const auth = await requireUser(context, { allowDeviceFallback: false });
    if (auth.error) {
      return auth.error;
    }

    await ensureAuthSchema(context.env);
    await context.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(auth.user.id).run();
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
