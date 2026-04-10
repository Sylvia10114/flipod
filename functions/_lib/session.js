import { json } from './http.js';

function randomId() {
  return crypto.randomUUID();
}

export async function ensureUser(env, deviceId) {
  if (!env?.DB) {
    throw new Error('D1 binding DB is not configured');
  }
  if (!deviceId) {
    throw new Error('deviceId is required');
  }

  const existing = await env.DB.prepare(
    'SELECT id, device_id, created_at, updated_at FROM users WHERE device_id = ?'
  ).bind(deviceId).first();

  if (existing) {
    await env.DB.prepare(
      'UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(existing.id).run();
    return existing;
  }

  const id = randomId();
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO users (id, device_id) VALUES (?, ?)'
    ).bind(id, deviceId),
    env.DB.prepare(
      'INSERT INTO profiles (user_id) VALUES (?)'
    ).bind(id),
  ]);

  return { id, device_id: deviceId };
}

export async function requireUser(context) {
  const deviceId = context.request.headers.get('x-device-id');
  if (!deviceId) {
    return { error: json({ error: 'Missing x-device-id header' }, { status: 401 }) };
  }

  try {
    const user = await ensureUser(context.env, deviceId);
    return { user };
  } catch (error) {
    return { error: json({ error: error.message }, { status: 500 }) };
  }
}
