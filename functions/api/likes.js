import { errorResponse, HttpError, json, noContent, readJson } from '../_lib/http.js';
import { requireUser } from '../_lib/session.js';
import { getLikeEventsByUserId, getLikedClipsByUserId } from '../_lib/user-data.js';

export async function onRequestOptions() {
  return noContent();
}

export async function onRequestGet(context) {
  try {
    const { user, error } = await requireUser(context);
    if (error) return error;

    const [likedClipKeys, likeEvents] = await Promise.all([
      getLikedClipsByUserId(context.env, user.id),
      getLikeEventsByUserId(context.env, user.id),
    ]);

    return json({ likedClipKeys, likeEvents });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestPost(context) {
  try {
    const { user, error } = await requireUser(context);
    if (error) return error;

    const body = await readJson(context.request);
    const clipKey = String(body?.clipKey || '').trim();
    const tag = String(body?.tag || '').trim().toLowerCase();
    const timestamp = Number(body?.timestamp || Date.now());

    if (!clipKey) {
      throw new HttpError(400, 'clipKey is required', 'clip_key_required');
    }

    await context.env.DB.batch([
      context.env.DB.prepare(
        `INSERT INTO liked_clips (user_id, clip_key)
         VALUES (?, ?)
         ON CONFLICT(user_id, clip_key) DO NOTHING`
      ).bind(user.id, clipKey),
      context.env.DB.prepare(
        'INSERT INTO user_events (id, user_id, event_type, payload) VALUES (?, ?, ?, ?)'
      ).bind(
        crypto.randomUUID(),
        user.id,
        'clip_like',
        JSON.stringify({ clipKey, tag, timestamp })
      ),
    ]);

    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestDelete(context) {
  try {
    const { user, error } = await requireUser(context);
    if (error) return error;

    const body = await readJson(context.request);
    const clipKey = String(body?.clipKey || '').trim();

    if (!clipKey) {
      throw new HttpError(400, 'clipKey is required', 'clip_key_required');
    }

    await context.env.DB.prepare(
      'DELETE FROM liked_clips WHERE user_id = ? AND clip_key = ?'
    ).bind(user.id, clipKey).run();

    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
