import { errorResponse, HttpError, noContent, readJson } from '../_lib/http.js';

const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
const DEFAULT_MODEL_ID = 'eleven_multilingual_v2';
const DEFAULT_MINIMAX_ENDPOINT = 'https://api.minimax.io/v1/t2a_v2';
const DEFAULT_MINIMAX_MODEL_ID = 'speech-02-turbo';
const DEFAULT_MINIMAX_VOICE_ID = 'female-tianmei';

function corsHeaders(contentType = 'audio/mpeg') {
  return {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-device-id, Authorization',
    'Cache-Control': 'public, max-age=31536000, immutable',
  };
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isChineseLocale(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'simplified_chinese'
    || normalized === 'traditional_chinese'
    || normalized === 'zh'
    || normalized.startsWith('zh-');
}

function hexToArrayBuffer(value) {
  const hex = String(value || '').trim().replace(/^0x/i, '');
  if (!hex || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    throw new HttpError(502, 'MiniMax TTS returned invalid audio', 'tts_provider_failed');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes.buffer;
}

async function synthesizeWithElevenLabs(env, text) {
  const apiKey = normalizeText(env?.ELEVENLABS_API_KEY);
  const voiceId = normalizeText(env?.ELEVENLABS_VOICE_ID) || DEFAULT_VOICE_ID;
  const modelId = normalizeText(env?.ELEVENLABS_MODEL_ID) || DEFAULT_MODEL_ID;

  if (!apiKey) {
    throw new HttpError(503, 'ELEVENLABS_API_KEY is not configured', 'tts_missing_config');
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        language_code: 'en',
        voice_settings: {
          stability: 0.42,
          similarity_boost: 0.82,
        },
      }),
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new HttpError(502, `ElevenLabs TTS failed: ${detail.slice(0, 200)}`, 'tts_provider_failed');
  }

  return response.arrayBuffer();
}

async function synthesizeWithMiniMax(env, text) {
  const apiKey = normalizeText(env?.MINIMAX_API_KEY);
  const endpoint = normalizeText(env?.MINIMAX_TTS_ENDPOINT) || DEFAULT_MINIMAX_ENDPOINT;
  const modelId = normalizeText(env?.MINIMAX_TTS_MODEL_ID) || DEFAULT_MINIMAX_MODEL_ID;
  const voiceId = normalizeText(env?.MINIMAX_TTS_VOICE_ID) || DEFAULT_MINIMAX_VOICE_ID;

  if (!apiKey) {
    throw new HttpError(503, 'MINIMAX_API_KEY is not configured', 'tts_missing_config');
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      text,
      stream: false,
      language_boost: 'Chinese',
      output_format: 'hex',
      voice_setting: {
        voice_id: voiceId,
        speed: 1,
        vol: 1,
        pitch: 0,
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: 'mp3',
        channel: 1,
      },
    }),
  });

  const detail = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(detail);
  } catch {
  }

  if (!response.ok) {
    throw new HttpError(502, `MiniMax TTS failed: ${detail.slice(0, 200)}`, 'tts_provider_failed');
  }
  if (parsed?.base_resp?.status_code && parsed.base_resp.status_code !== 0) {
    throw new HttpError(
      502,
      `MiniMax TTS failed: ${parsed.base_resp.status_msg || parsed.base_resp.status_code}`,
      'tts_provider_failed'
    );
  }

  const audioHex = parsed?.data?.audio;
  if (!audioHex) {
    throw new HttpError(502, 'MiniMax TTS returned no audio', 'tts_provider_failed');
  }

  return hexToArrayBuffer(audioHex);
}

async function handleTtsRequest(context, text, options = {}) {
  const normalized = normalizeText(text);
  if (!normalized) {
    throw new HttpError(400, 'text is required', 'tts_text_required');
  }

  const audio = isChineseLocale(options.locale)
    ? await synthesizeWithMiniMax(context.env, normalized)
    : await synthesizeWithElevenLabs(context.env, normalized);
  return new Response(audio, {
    status: 200,
    headers: corsHeaders(),
  });
}

export async function onRequestOptions() {
  return noContent();
}

export async function onRequestGet(context) {
  try {
    const searchParams = new URL(context.request.url).searchParams;
    return await handleTtsRequest(context, searchParams.get('text'), {
      locale: searchParams.get('locale'),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestPost(context) {
  try {
    const body = await readJson(context.request);
    return await handleTtsRequest(context, body?.text, {
      locale: body?.locale,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
