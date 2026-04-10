import { json, noContent, readJson } from '../_lib/http.js';
import { requireUser } from '../_lib/session.js';

export async function onRequestOptions() {
  return noContent();
}

export async function onRequestPost(context) {
  const { user, error } = await requireUser(context);
  if (error) return error;

  const body = await readJson(context.request);
  const eventType = String(body?.eventType || '').trim();
  const clipId = Number.isInteger(body?.clipId) ? body.clipId : null;
  const payload = body?.payload && typeof body.payload === 'object' ? body.payload : {};

  if (!eventType) {
    return json({ error: 'eventType is required' }, { status: 400 });
  }

  const id = crypto.randomUUID();
  await context.env.DB.prepare(
    'INSERT INTO user_events (id, user_id, event_type, clip_id, payload) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, user.id, eventType, clipId, JSON.stringify(payload)).run();

  return json({ ok: true, id });
}
