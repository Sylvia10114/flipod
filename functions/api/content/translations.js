import { errorResponse, HttpError, json, noContent, readJson } from '../../_lib/http.js';
import { getOrCreateContentTranslation, normalizeContentLocale } from '../../_lib/content-translations.js';

export async function onRequestOptions() {
  return noContent();
}

export async function onRequestPost(context) {
  try {
    const body = await readJson(context.request);
    const locale = normalizeContentLocale(body?.locale);
    const items = Array.isArray(body?.items) ? body.items : [];

    if (!items.length) {
      throw new HttpError(400, 'items are required', 'items_required');
    }

    const translations = {};
    for (const item of items) {
      const translation = await getOrCreateContentTranslation(context.env, locale, item);
      translations[translation.contentKey] = translation;
    }

    return json({ translations });
  } catch (error) {
    return errorResponse(error);
  }
}
