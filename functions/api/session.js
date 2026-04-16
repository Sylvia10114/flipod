import { json, noContent, readJson } from '../_lib/http.js';
import { ensureUser } from '../_lib/session.js';

export async function onRequestOptions() {
  return noContent();
}

export async function onRequestPost(context) {
  const body = await readJson(context.request);
  const deviceId = body?.deviceId;

  if (!deviceId) {
    return json({ error: 'deviceId is required' }, { status: 400 });
  }

  try {
    const user = await ensureUser(context.env, deviceId);
    const profile = await context.env.DB.prepare(
      `SELECT level, interests, native_language AS nativeLanguage, theme,
              onboarding_done AS onboardingDone, updated_at AS updatedAt
       FROM profiles WHERE user_id = ?`
    ).bind(user.id).first();

    return json({
      user: {
        id: user.id,
        deviceId: user.device_id,
      },
      profile: {
        level: profile?.level || null,
        interests: profile?.interests ? JSON.parse(profile.interests) : [],
        nativeLanguage: profile?.nativeLanguage || 'english',
        theme: profile?.theme || 'dark',
        onboardingDone: Boolean(profile?.onboardingDone),
        updatedAt: profile?.updatedAt || null,
      },
    });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
