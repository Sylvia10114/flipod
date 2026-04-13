import { errorResponse, HttpError, json, noContent, readJson } from '../_lib/http.js';
import { requireUser } from '../_lib/session.js';
import { getKnownWordsByUserId } from '../_lib/user-data.js';

export async function onRequestOptions() {
  return noContent();
}

export async function onRequestGet(context) {
  try {
    const { user, error } = await requireUser(context);
    if (error) return error;

    return json({
      knownWords: await getKnownWordsByUserId(context.env, user.id),
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
    const word = String(body?.word || '').trim().toLowerCase();
    if (!word) {
      throw new HttpError(400, 'word is required', 'known_word_required');
    }

    await context.env.DB.prepare(
      `INSERT INTO known_words (user_id, word)
       VALUES (?, ?)
       ON CONFLICT(user_id, word) DO NOTHING`
    ).bind(user.id, word).run();

    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
