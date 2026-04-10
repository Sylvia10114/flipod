import { json, noContent, readJson } from '../_lib/http.js';
import { requireUser } from '../_lib/session.js';

export async function onRequestOptions() {
  return noContent();
}

export async function onRequestGet(context) {
  const { user, error } = await requireUser(context);
  if (error) return error;

  const profile = await context.env.DB.prepare(
    'SELECT level, interests, theme, onboarding_done AS onboardingDone, updated_at AS updatedAt FROM profiles WHERE user_id = ?'
  ).bind(user.id).first();

  return json({
    profile: {
      level: profile?.level || null,
      interests: profile?.interests ? JSON.parse(profile.interests) : [],
      theme: profile?.theme || 'dark',
      onboardingDone: Boolean(profile?.onboardingDone),
      updatedAt: profile?.updatedAt || null,
    },
  });
}

export async function onRequestPost(context) {
  const { user, error } = await requireUser(context);
  if (error) return error;

  const body = await readJson(context.request);
  const level = body?.level || null;
  const interests = Array.isArray(body?.interests) ? body.interests : [];
  const theme = body?.theme === 'light' ? 'light' : 'dark';
  const onboardingDone = body?.onboardingDone ? 1 : 0;

  await context.env.DB.prepare(
    `UPDATE profiles
     SET level = ?, interests = ?, theme = ?, onboarding_done = ?, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ?`
  ).bind(level, JSON.stringify(interests), theme, onboardingDone, user.id).run();

  return json({ ok: true });
}
