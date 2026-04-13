import { HttpError } from './http.js';

function percentEncode(value) {
  return encodeURIComponent(value)
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~');
}

function toBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function normalizePhoneNumber(phoneNumber) {
  const digits = String(phoneNumber || '').replace(/\D/g, '');
  if (!digits) {
    throw new HttpError(400, '手机号不能为空', 'phone_required');
  }

  if (digits.length === 11 && digits.startsWith('1')) {
    return `+86${digits}`;
  }

  if (digits.length === 13 && digits.startsWith('86')) {
    return `+${digits}`;
  }

  if (phoneNumber.startsWith('+86') && digits.length === 13) {
    return `+${digits}`;
  }

  throw new HttpError(400, '仅支持中国大陆手机号', 'phone_invalid');
}

export function generateSmsCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function isTruthy(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

export function getSmsEnvConfig(env) {
  return {
    deliveryEnabled: isTruthy(env.SMS_DELIVERY_ENABLED, true),
    region: String(env.SMS_REGION || 'cn-hangzhou').trim() || 'cn-hangzhou',
    accessKeyId: env.SMS_ACCESS_KEY_ID || env.ALIYUN_SMS_ACCESS_KEY_ID || '',
    accessKeySecret: env.SMS_ACCESS_KEY_SECRET || env.ALIYUN_SMS_ACCESS_KEY_SECRET || '',
    signName: env.SMS_SIGN_NAME || env.ALIYUN_SMS_SIGN_NAME || '',
    templateCode: env.SMS_TEMPLATE_CODE || env.ALIYUN_SMS_TEMPLATE_CODE || '',
    testPhoneNumbers: parseCsv(env.SMS_TEST_PHONE_NUMBERS).map(item => normalizePhoneNumber(item)),
    testCode: String(env.SMS_TEST_CODE || '123456').trim() || '123456',
  };
}

export function shouldUseTestCode(env, phoneNumber) {
  const config = getSmsEnvConfig(env);
  if (!config.deliveryEnabled) return true;
  return config.testPhoneNumbers.includes(phoneNumber);
}

export function resolveSmsCode(env, phoneNumber) {
  if (shouldUseTestCode(env, phoneNumber)) {
    return getSmsEnvConfig(env).testCode;
  }
  return generateSmsCode();
}

async function signAliyunParams(secret, params) {
  const sorted = Object.keys(params)
    .sort()
    .map(key => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join('&');

  const stringToSign = `POST&%2F&${percentEncode(sorted)}`;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${secret}&`),
    {
      name: 'HMAC',
      hash: 'SHA-1',
    },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    new TextEncoder().encode(stringToSign)
  );
  return toBase64(signature);
}

export async function sendAliyunSms(env, phoneNumber, code) {
  const {
    deliveryEnabled,
    region,
    accessKeyId,
    accessKeySecret,
    signName,
    templateCode,
    testPhoneNumbers,
  } = getSmsEnvConfig(env);

  if (!deliveryEnabled || testPhoneNumbers.includes(phoneNumber)) {
    return { Code: 'OK', Message: 'Test delivery skipped', mock: true };
  }

  if (!accessKeyId || !accessKeySecret || !signName || !templateCode) {
    throw new HttpError(500, 'Aliyun SMS credentials are not configured', 'aliyun_sms_missing_config');
  }

  const params = {
    AccessKeyId: accessKeyId,
    Action: 'SendSms',
    Format: 'JSON',
    PhoneNumbers: phoneNumber.replace(/^\+86/, ''),
    RegionId: region,
    SignName: signName,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: '1.0',
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify({ code }),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: '2017-05-25',
  };

  params.Signature = await signAliyunParams(accessKeySecret, params);

  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    body.set(key, value);
  }

  const response = await fetch('https://dysmsapi.aliyuncs.com/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.Code !== 'OK') {
    throw new HttpError(
      502,
      payload?.Message || text || 'Aliyun SMS request failed',
      payload?.Code || 'aliyun_sms_failed'
    );
  }

  return payload;
}
