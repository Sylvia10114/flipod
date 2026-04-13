import { errorResponse, HttpError, json, noContent, readJson } from '../_lib/http.js';
import { requireUser } from '../_lib/session.js';
import { getPracticeDataByUserId } from '../_lib/user-data.js';

export async function onRequestOptions() {
  return noContent();
}

export async function onRequestGet(context) {
  try {
    const { user, error } = await requireUser(context);
    if (error) return error;

    return json({
      practiceData: await getPracticeDataByUserId(context.env, user.id),
    });
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
    const record = body?.record && typeof body.record === 'object' ? body.record : null;

    if (!clipKey || !record) {
      throw new HttpError(400, 'clipKey and record are required', 'practice_payload_invalid');
    }

    await context.env.DB.prepare(
      `INSERT INTO practice_records (user_id, clip_key, done, words, hard, ts, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, clip_key)
       DO UPDATE SET done = excluded.done,
                     words = excluded.words,
                     hard = excluded.hard,
                     ts = excluded.ts,
                     updated_at = CURRENT_TIMESTAMP`
    ).bind(
      user.id,
      clipKey,
      record.done ? 1 : 0,
      Number(record.words || 0),
      Number(record.hard || 0),
      Number(record.ts || 0)
    ).run();

    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
