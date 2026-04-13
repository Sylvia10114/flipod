import { errorResponse, HttpError, json, noContent, readJson } from '../../_lib/http.js';
import {
  bindDeviceToUser,
  buildAuthBootstrap,
  ensureAuthSchema,
  findUserByDeviceId,
  mergeAnonymousUserIntoAccount,
  requireUser,
} from '../../_lib/session.js';
import {
  appendLikeEvents,
  getBootstrapData,
  mergeBookmarks,
  mergeLikeEvents,
  mergePracticeData,
  mergeProfiles,
  mergeStringSet,
  mergeVocab,
  saveProfileByUserId,
  upsertBookmarks,
  upsertKnownWords,
  upsertLikedClips,
  upsertPracticeData,
  upsertVocabEntries,
} from '../../_lib/user-data.js';

export async function onRequestOptions() {
  return noContent();
}

export async function onRequestPost(context) {
  try {
    await ensureAuthSchema(context.env);
    const { user, error } = await requireUser(context, { allowDeviceFallback: false });
    if (error) return error;

    const body = await readJson(context.request);
    const deviceId = String(body?.deviceId || '').trim();
    if (!deviceId) {
      throw new HttpError(400, 'deviceId is required', 'device_id_required');
    }

    const localSnapshot = {
      profile: body?.profile || null,
      bookmarks: Array.isArray(body?.bookmarks) ? body.bookmarks : [],
      vocab: Array.isArray(body?.vocab) ? body.vocab : [],
      practiceData: body?.practiceData && typeof body.practiceData === 'object' ? body.practiceData : {},
      knownWords: Array.isArray(body?.knownWords) ? body.knownWords : [],
      likedClipKeys: Array.isArray(body?.likedClipKeys) ? body.likedClipKeys : [],
      likeEvents: Array.isArray(body?.likeEvents) ? body.likeEvents : [],
    };

    const deviceUser = await findUserByDeviceId(context.env, deviceId);
    if (deviceUser && deviceUser.id !== user.id) {
      await mergeAnonymousUserIntoAccount(context.env, deviceUser.id, user.id);
    }
    await bindDeviceToUser(context.env, deviceId, user.id);

    const remote = await getBootstrapData(context.env, user.id);
    const mergedProfile = mergeProfiles(remote.profile, localSnapshot.profile);
    const mergedBookmarks = mergeBookmarks(remote.bookmarks, localSnapshot.bookmarks);
    const mergedVocab = mergeVocab(remote.vocab, localSnapshot.vocab);
    const mergedPractice = mergePracticeData(remote.practiceData, localSnapshot.practiceData);
    const mergedKnownWords = mergeStringSet(remote.knownWords, localSnapshot.knownWords);
    const mergedLikedClips = mergeStringSet(remote.likedClipKeys, localSnapshot.likedClipKeys, { lowercase: false });
    const mergedLikeEvents = mergeLikeEvents(remote.likeEvents, localSnapshot.likeEvents);

    await saveProfileByUserId(context.env, user.id, mergedProfile);
    await upsertBookmarks(context.env, user.id, mergedBookmarks);
    await upsertVocabEntries(context.env, user.id, mergedVocab);
    await upsertPracticeData(context.env, user.id, mergedPractice);
    await upsertKnownWords(context.env, user.id, mergedKnownWords);
    await upsertLikedClips(context.env, user.id, mergedLikedClips);

    const existingLikeKeys = new Set(remote.likeEvents.map(item => `${item.tag}:${item.timestamp}`));
    const missingLikeEvents = mergedLikeEvents.filter(item => !existingLikeKeys.has(`${item.tag}:${item.timestamp}`));
    await appendLikeEvents(context.env, user.id, missingLikeEvents);

    return json(await buildAuthBootstrap(context.env, user, null));
  } catch (error) {
    return errorResponse(error);
  }
}
