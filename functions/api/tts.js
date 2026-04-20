import { errorResponse, HttpError, noContent, readJson } from '../_lib/http.js';

const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
const DEFAULT_MODEL_ID = 'eleven_multilingual_v2';

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

async function handleTtsRequest(context, text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    throw new HttpError(400, 'text is required', 'tts_text_required');
  }

  const audio = await synthesizeWithElevenLabs(context.env, normalized);
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
    const text = new URL(context.request.url).searchParams.get('text');
    return await handleTtsRequest(context, text);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestPost(context) {
  try {
    const body = await readJson(context.request);
    return await handleTtsRequest(context, body?.text);
  } catch (error) {
    return errorResponse(error);
  }
}
