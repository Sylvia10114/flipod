import { json, noContent, readJson } from '../_lib/http.js';
import { requireUser } from '../_lib/session.js';

export async function onRequestOptions() {
  return noContent();
}

export async function onRequestGet(context) {
  const { user, error } = await requireUser(context);
  if (error) return error;

  const result = await context.env.DB.prepare(
    'SELECT id, clip_key AS clipKey, title, source, tag, created_at AS createdAt FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(user.id).all();

  return json({ bookmarks: result.results || [] });
}

export async function onRequestPost(context) {
  const { user, error } = await requireUser(context);
  if (error) return error;

  const body = await readJson(context.request);
  const clipKey = body?.clipKey;

  if (!clipKey) {
    return json({ error: 'clipKey is required' }, { status: 400 });
  }

  const id = body?.id || crypto.randomUUID();
  const title = body?.title || '';
  const source = body?.source || '';
  const tag = body?.tag || '';

  await context.env.DB.prepare(
    `INSERT INTO bookmarks (id, user_id, clip_key, title, source, tag)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, clip_key)
     DO UPDATE SET title = excluded.title, source = excluded.source, tag = excluded.tag, created_at = CURRENT_TIMESTAMP`
  ).bind(id, user.id, clipKey, title, source, tag).run();

  return json({ ok: true, id });
}

export async function onRequestDelete(context) {
  const { user, error } = await requireUser(context);
  if (error) return error;

  const body = await readJson(context.request);
  const clipKey = body?.clipKey;

  if (!clipKey) {
    return json({ error: 'clipKey is required' }, { status: 400 });
  }

  await context.env.DB.prepare(
    'DELETE FROM bookmarks WHERE user_id = ? AND clip_key = ?'
  ).bind(user.id, clipKey).run();

  return json({ ok: true });
}
