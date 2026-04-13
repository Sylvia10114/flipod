export function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Content-Type', 'application/json');
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, x-device-id, Authorization');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function noContent(init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, x-device-id, Authorization');
  return new Response(null, { status: 204, ...init, headers });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code || null;
  }
}

export function errorResponse(error, fallbackStatus = 500) {
  if (error instanceof HttpError) {
    return json(
      { error: error.message, code: error.code || null },
      { status: error.status }
    );
  }

  return json(
    { error: error?.message || 'Internal Server Error' },
    { status: fallbackStatus }
  );
}
