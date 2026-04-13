import { errorResponse, json, noContent } from '../../_lib/http.js';
import { buildAuthBootstrap, ensureAuthSchema, requireUser } from '../../_lib/session.js';

export async function onRequestOptions() {
  return noContent();
}

export async function onRequestGet(context) {
  try {
    await ensureAuthSchema(context.env);
    const { user, error } = await requireUser(context, { allowDeviceFallback: false });
    if (error) return error;

    return json(await buildAuthBootstrap(context.env, user, null));
  } catch (error) {
    return errorResponse(error);
  }
}
