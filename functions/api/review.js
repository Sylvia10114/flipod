import { json, noContent, readJson } from '../_lib/http.js';
import { requireUser } from '../_lib/session.js';

export async function onRequestOptions() {
  return noContent();
}

export async function onRequestGet(context) {
  const { user, error } = await requireUser(context);
  if (error) return error;

  const result = await context.env.DB.prepare(
    'SELECT word, next_review_at AS nextReviewAt, interval_days AS intervalDays, updated_at AS updatedAt FROM review_items WHERE user_id = ? ORDER BY next_review_at ASC'
  ).bind(user.id).all();

  return json({ review: result.results || [] });
}

export async function onRequestPost(context) {
  const { user, error } = await requireUser(context);
  if (error) return error;

  const body = await readJson(context.request);
  const word = String(body?.word || '').trim().toLowerCase();
  const nextReviewAt = body?.nextReviewAt;
  const intervalDays = Number.isFinite(body?.intervalDays) ? Math.max(1, Math.round(body.intervalDays)) : 3;

  if (!word || !nextReviewAt) {
    return json({ error: 'word and nextReviewAt are required' }, { status: 400 });
  }

  await context.env.DB.prepare(
    `INSERT INTO review_items (user_id, word, next_review_at, interval_days)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, word)
     DO UPDATE SET next_review_at = excluded.next_review_at, interval_days = excluded.interval_days, updated_at = CURRENT_TIMESTAMP`
  ).bind(user.id, word, nextReviewAt, intervalDays).run();

  return json({ ok: true });
}
