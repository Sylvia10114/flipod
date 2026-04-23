import { json, noContent } from '../_lib/http.js';

export async function onRequestOptions() {
  return noContent();
}

export async function onRequestGet(context) {
  const timestamp = new Date().toISOString();

  try {
    if (!context.env?.DB) {
      return json(
        {
          ok: false,
          service: 'flipod-api',
          database: 'missing',
          timestamp,
        },
        { status: 503 }
      );
    }

    await context.env.DB.prepare('SELECT 1 AS ok').first();

    return json({
      ok: true,
      service: 'flipod-api',
      database: 'ok',
      timestamp,
    });
  } catch (error) {
    console.error('[health] failed', error);
    return json(
      {
        ok: false,
        service: 'flipod-api',
        database: 'error',
        timestamp,
      },
      { status: 503 }
    );
  }
}
