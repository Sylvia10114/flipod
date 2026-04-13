import { HttpError } from './http.js';

let appleKeysCache = {
  expiresAt: 0,
  keys: [],
};

function decodeBase64Url(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const text = atob(normalized + padding);
  return Uint8Array.from(text, char => char.charCodeAt(0));
}

function decodeJson(part) {
  const bytes = decodeBase64Url(part);
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function fetchAppleKeys() {
  if (appleKeysCache.expiresAt > Date.now() && appleKeysCache.keys.length > 0) {
    return appleKeysCache.keys;
  }

  const response = await fetch('https://appleid.apple.com/auth/keys');
  if (!response.ok) {
    throw new HttpError(502, 'Unable to fetch Apple public keys', 'apple_keys_unavailable');
  }

  const payload = await response.json();
  appleKeysCache = {
    keys: Array.isArray(payload.keys) ? payload.keys : [],
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
  return appleKeysCache.keys;
}

export async function verifyAppleIdentityToken(identityToken, audience) {
  if (!identityToken) {
    throw new HttpError(400, 'identityToken is required', 'apple_identity_token_required');
  }

  const parts = identityToken.split('.');
  if (parts.length !== 3) {
    throw new HttpError(400, 'Invalid Apple identity token', 'apple_token_invalid');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJson(encodedHeader);
  const payload = decodeJson(encodedPayload);

  if (payload.iss !== 'https://appleid.apple.com') {
    throw new HttpError(401, 'Invalid Apple issuer', 'apple_issuer_invalid');
  }

  if (payload.aud !== audience) {
    throw new HttpError(401, 'Apple audience mismatch', 'apple_audience_invalid');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= nowSeconds) {
    throw new HttpError(401, 'Apple identity token expired', 'apple_token_expired');
  }

  const keys = await fetchAppleKeys();
  const key = keys.find(item => item.kid === header.kid && item.alg === header.alg);
  if (!key) {
    throw new HttpError(401, 'Unable to match Apple signing key', 'apple_key_missing');
  }

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    key,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['verify']
  );

  const signature = decodeBase64Url(encodedSignature);
  const signedContent = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signature, signedContent);

  if (!valid) {
    throw new HttpError(401, 'Invalid Apple token signature', 'apple_signature_invalid');
  }

  return {
    sub: String(payload.sub || ''),
    email: payload.email ? String(payload.email) : '',
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
  };
}
