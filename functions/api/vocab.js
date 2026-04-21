import { json, noContent, readJson } from '../_lib/http.js';
import { requireUser } from '../_lib/session.js';

export async function onRequestOptions() {
  return noContent();
}

export async function onRequestGet(context) {
  const { user, error } = await requireUser(context);
  if (error) return error;

  const result = await context.env.DB.prepare(
    `SELECT id, word, cefr, phonetic, definition_zh AS definitionZh, context, context_zh AS contextZh,
            content_key AS contentKey, line_index AS lineIndex, known,
            created_at AS createdAt, updated_at AS updatedAt
     FROM vocab_entries WHERE user_id = ? ORDER BY updated_at DESC`
  ).bind(user.id).all();

  return json({
    vocab: (result.results || []).map(item => ({
      ...item,
      known: Boolean(item.known),
    })),
  });
}

export async function onRequestPost(context) {
  const { user, error } = await requireUser(context);
  if (error) return error;

  const body = await readJson(context.request);
  const word = String(body?.word || '').trim().toLowerCase();

  if (!word) {
    return json({ error: 'word is required' }, { status: 400 });
  }

  const id = body?.id || crypto.randomUUID();
  const cefr = body?.cefr || '';
  const phonetic = body?.phonetic || '';
  const definitionZh = body?.definitionZh || '';
  const contextText = body?.context || '';
  const contextZh = body?.contextZh || '';
  const contentKey = body?.contentKey || '';
  const lineIndex = Number.isInteger(body?.lineIndex) ? body.lineIndex : null;
  const known = body?.known ? 1 : 0;

  await context.env.DB.prepare(
    `INSERT INTO vocab_entries (id, user_id, word, cefr, phonetic, definition_zh, context, context_zh, content_key, line_index, known)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, word)
     DO UPDATE SET
       cefr = excluded.cefr,
       phonetic = excluded.phonetic,
       definition_zh = excluded.definition_zh,
       context = excluded.context,
       context_zh = excluded.context_zh,
       content_key = COALESCE(excluded.content_key, vocab_entries.content_key),
       line_index = COALESCE(excluded.line_index, vocab_entries.line_index),
       known = excluded.known,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(id, user.id, word, cefr, phonetic, definitionZh, contextText, contextZh, contentKey, lineIndex, known).run();

  return json({ ok: true, id });
}

export async function onRequestDelete(context) {
  const { user, error } = await requireUser(context);
  if (error) return error;

  const body = await readJson(context.request);
  const word = String(body?.word || '').trim().toLowerCase();

  if (!word) {
    return json({ error: 'word is required' }, { status: 400 });
  }

  await context.env.DB.prepare(
    'DELETE FROM vocab_entries WHERE user_id = ? AND word = ?'
  ).bind(user.id, word).run();

  return json({ ok: true });
}
