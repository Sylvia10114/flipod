import { json, noContent, readJson } from '../_lib/http.js';
import { CLIP_MANIFEST, CLIP_MANIFEST_CLIPS } from '../_lib/clip-manifest.js';
import { buildStarterFeed } from '../_lib/feed-ranking.js';

export async function onRequestOptions() {
  return noContent();
}

export async function onRequestPost(context) {
  const body = await readJson(context.request);
  const payload = body && typeof body === 'object' ? body : {};
  const feed = buildStarterFeed(CLIP_MANIFEST_CLIPS, payload);

  return json({
    feed,
    clip_count: CLIP_MANIFEST_CLIPS.length,
    algorithm: 'rules-v1',
    generatedAt: CLIP_MANIFEST.generatedAt,
  });
}
