/**
 * The provider table: the entire provider-specific surface of the feature.
 *
 * Everything here is pure. No fetch, no React, no storage — client.ts owns the
 * network and settings.ts owns persistence, so both request shapes and both
 * response readings are directly assertable in a unit test with no browser.
 */

import {
  AiError,
  AiProvider,
  CatalogueRequest,
  HttpPlan,
  ImagePart,
  ProviderId,
  ProviderSettings,
  aiError,
} from './types';
import {
  CATALOGUE_JSON_SCHEMA,
  CATALOGUE_SCHEMA_NAME,
  toGeminiSchema,
} from './schema';
import { CATALOGUE_SYSTEM_PROMPT, buildUserPrompt } from './prompt';

/* ------------------------------------------------------------------ */
/* Shared                                                              */
/* ------------------------------------------------------------------ */

const PROVIDER_LABELS: Record<ProviderId, string> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
};

/**
 * A truncated response carries a half-finished translation field. Surfacing it
 * as anything softer than a thrown error is exactly the silent partial
 * translation this feature exists to prevent, so both providers throw this.
 */
const TRUNCATED_MESSAGE =
  'The response was cut off before the translation finished, so nothing was applied. Raise "Max output tokens" in AI settings and run again.';

/** Lives here rather than in settings.ts because both request builders need it
 *  and settings.ts already imports this module — the other direction would be
 *  a cycle. A user-typed Base URL keeps its trailing slash in memory, so the
 *  URL builders must tolerate one rather than emit a double slash. */
export function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Shared HTTP status mapping for both providers, which is why it lives here
 * rather than in client.ts. It takes `model` because the 404 message names the
 * configured model — a wrong model id and a wrong base URL produce the same
 * status, and naming the model is what tells the two apart.
 *
 * It does NOT redact: client.ts passes every message through redactSecrets
 * before it reaches the UI.
 */
export function mapStatus(
  status: number,
  providerMessage: string,
  providerId: ProviderId,
  model: string,
): AiError {
  const label = PROVIDER_LABELS[providerId];
  const opts = { status: status, providerId: providerId };

  if (status === 400) {
    return aiError(
      'bad_request',
      providerMessage || 'The provider rejected the request.',
      opts,
    );
  }
  if (status === 401 || status === 403) {
    return aiError(
      'auth',
      label +
        ' rejected the API key (' +
        status +
        '). Check the key in AI settings, or the proxy base URL if you are using one.',
      opts,
    );
  }
  if (status === 404) {
    return aiError(
      'not_found',
      'Model "' +
        model +
        '" or endpoint not found. Change the model name or base URL in AI settings.',
      opts,
    );
  }
  if (status === 429) {
    return aiError(
      'rate_limit',
      'Rate limit or quota exceeded on your ' +
        label +
        ' account. Wait and retry, or switch provider.',
      opts,
    );
  }
  if (status >= 500 && status <= 599) {
    return aiError(
      'server',
      label +
        ' is having problems (' +
        status +
        '). Try again, or switch provider.',
      opts,
    );
  }
  return aiError('server', 'Unexpected status ' + status + '.', opts);
}

/** Both providers report failures as `{ error: { message } }`. */
function providerErrorMessage(body: unknown): string {
  const wrapper = body as { error?: { message?: unknown } } | null | undefined;
  const err = wrapper ? wrapper.error : undefined;
  return err && typeof err.message === 'string' ? err.message : '';
}

/**
 * The text part that precedes every image. Without it a multi-image response
 * conflates the views and cannot say which photograph an inscription came off.
 */
function labelFor(images: ImagePart[], i: number): string {
  return 'Image ' + (i + 1) + ' of ' + images.length + ' — ' + images[i].label;
}

/* ------------------------------------------------------------------ */
/* Gemini                                                              */
/* ------------------------------------------------------------------ */

type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

/**
 * Tantric, yab-yum and wrathful iconography is ordinary stock for this dealer
 * and the default thresholds refuse it far more often than you would expect.
 * A refusal still surfaces as kind 'blocked'.
 */
const GEMINI_SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
];

function geminiHeaders(cfg: ProviderSettings): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  // The key travels in a header, never in `?key=`, so it never lands in
  // browser history, a Referer or a proxy access log. An empty key means a
  // proxy at baseUrl injects it, so the header is omitted entirely.
  if (cfg.apiKey !== '') {
    headers['x-goog-api-key'] = cfg.apiKey;
  }
  return headers;
}

function geminiParts(req: CatalogueRequest): GeminiPart[] {
  const parts: GeminiPart[] = [{ text: buildUserPrompt(req) }];
  req.images.forEach((img, i) => {
    if (img.kind !== 'inline') {
      // Belt and braces: supportsRemoteImageUrl is false, so the driver
      // should already have fetched and inlined this.
      throw aiError(
        'image',
        'Gemini cannot read an image from a URL. Upload the file instead, or switch to OpenAI.',
        { providerId: 'gemini' },
      );
    }
    parts.push({ text: labelFor(req.images, i) });
    parts.push({
      inline_data: { mime_type: img.mimeType, data: img.base64 },
    });
  });
  return parts;
}

function geminiPlan(
  req: CatalogueRequest,
  cfg: ProviderSettings,
  withSchema: boolean,
): HttpPlan {
  const generationConfig: Record<string, unknown> = {
    temperature: req.temperature,
    topP: 0.95,
    maxOutputTokens: req.maxOutputTokens,
    responseMimeType: 'application/json',
  };
  if (withSchema) {
    generationConfig.responseSchema = toGeminiSchema(CATALOGUE_JSON_SCHEMA);
  }

  return {
    url:
      trimTrailingSlash(cfg.baseUrl) +
      '/models/' +
      encodeURIComponent(cfg.model) +
      ':generateContent',
    method: 'POST',
    headers: geminiHeaders(cfg),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: CATALOGUE_SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: geminiParts(req) }],
      generationConfig: generationConfig,
      safetySettings: GEMINI_SAFETY_SETTINGS,
    }),
  };
}

interface GeminiCandidate {
  finishReason?: string;
  content?: { parts?: { text?: unknown }[] };
}

interface GeminiBody {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
}

export const GEMINI: AiProvider = {
  id: 'gemini',
  label: 'Google Gemini',
  keyUrl: 'https://aistudio.google.com/apikey',
  defaultModel: 'gemini-2.0-flash',
  defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  modelSuggestions: [
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
  ],
  supportsRemoteImageUrl: false,

  buildRequest(req: CatalogueRequest, cfg: ProviderSettings): HttpPlan {
    return geminiPlan(req, cfg, true);
  },

  buildFallbackRequest(req: CatalogueRequest, cfg: ProviderSettings): HttpPlan {
    return geminiPlan(req, cfg, false);
  },

  extractText(status: number, body: unknown, cfg: ProviderSettings): string {
    if (status !== 200) {
      throw mapStatus(status, providerErrorMessage(body), 'gemini', cfg.model);
    }

    const parsed = (body || {}) as GeminiBody;
    const candidates = parsed.candidates;
    const blockReason = parsed.promptFeedback
      ? parsed.promptFeedback.blockReason
      : undefined;

    if (blockReason && (!candidates || candidates.length === 0)) {
      throw aiError(
        'blocked',
        'Gemini declined to describe this image (' +
          blockReason +
          '). Try the other provider, or a different photograph.',
        { providerId: 'gemini' },
      );
    }

    const cand =
      candidates && candidates.length > 0 ? candidates[0] : undefined;
    if (!cand) {
      throw aiError('server', 'Gemini returned no candidate.', {
        providerId: 'gemini',
      });
    }

    if (cand.finishReason === 'MAX_TOKENS') {
      throw aiError('truncated', TRUNCATED_MESSAGE, { providerId: 'gemini' });
    }
    if (cand.finishReason === 'SAFETY' || cand.finishReason === 'RECITATION') {
      throw aiError(
        'blocked',
        'Gemini stopped generating this description (' +
          cand.finishReason +
          '). Try the other provider, or a different photograph.',
        { providerId: 'gemini' },
      );
    }

    const parts = (cand.content && cand.content.parts) || [];
    let text = '';
    parts.forEach(part => {
      if (typeof part.text === 'string') {
        text += part.text;
      }
    });
    if (text === '') {
      throw aiError('parse', 'Gemini returned an empty response.', {
        providerId: 'gemini',
      });
    }
    return text;
  },
};

/* ------------------------------------------------------------------ */
/* OpenAI                                                              */
/* ------------------------------------------------------------------ */

type OpenAiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail: string } };

/**
 * 'low' downsamples to 512px, which makes any inscription unreadable. This is
 * not a cost knob for this feature.
 */
const OPENAI_IMAGE_DETAIL = 'high';

const OPENAI_FALLBACK_SYSTEM_SUFFIX =
  '\n\nReturn a single JSON object conforming exactly to this JSON Schema:\n' +
  JSON.stringify(CATALOGUE_JSON_SCHEMA);

function openaiHeaders(cfg: ProviderSettings): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (cfg.apiKey !== '') {
    headers.Authorization = 'Bearer ' + cfg.apiKey;
  }
  return headers;
}

/** Remote URLs pass through verbatim: OpenAI fetches them itself. */
function openaiImageUrl(img: ImagePart): string {
  return img.kind === 'inline'
    ? 'data:' + img.mimeType + ';base64,' + img.base64
    : img.url;
}

function openaiContent(req: CatalogueRequest): OpenAiContentPart[] {
  const content: OpenAiContentPart[] = [
    { type: 'text', text: buildUserPrompt(req) },
  ];
  req.images.forEach((img, i) => {
    content.push({ type: 'text', text: labelFor(req.images, i) });
    content.push({
      type: 'image_url',
      image_url: { url: openaiImageUrl(img), detail: OPENAI_IMAGE_DETAIL },
    });
  });
  return content;
}

function openaiPlan(
  req: CatalogueRequest,
  cfg: ProviderSettings,
  withSchema: boolean,
): HttpPlan {
  const responseFormat = withSchema
    ? {
        type: 'json_schema',
        json_schema: {
          name: CATALOGUE_SCHEMA_NAME,
          strict: true,
          schema: CATALOGUE_JSON_SCHEMA,
        },
      }
    : { type: 'json_object' };

  const systemPrompt = withSchema
    ? CATALOGUE_SYSTEM_PROMPT
    : CATALOGUE_SYSTEM_PROMPT + OPENAI_FALLBACK_SYSTEM_SUFFIX;

  return {
    url: trimTrailingSlash(cfg.baseUrl) + '/chat/completions',
    method: 'POST',
    headers: openaiHeaders(cfg),
    body: JSON.stringify({
      model: cfg.model,
      temperature: req.temperature,
      max_tokens: req.maxOutputTokens,
      response_format: responseFormat,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: openaiContent(req) },
      ],
    }),
  };
}

interface OpenAiChoice {
  finish_reason?: string;
  message?: { content?: unknown; refusal?: unknown };
}

interface OpenAiBody {
  choices?: OpenAiChoice[];
}

export const OPENAI: AiProvider = {
  id: 'openai',
  label: 'OpenAI (ChatGPT)',
  keyUrl: 'https://platform.openai.com/api-keys',
  // Not a gpt-5-family id on purpose: those reject a non-default temperature
  // and reject max_tokens, so such a default would 400 on the first call.
  // retryBody below is what lets one be typed into the settings field.
  defaultModel: 'gpt-4o',
  defaultBaseUrl: 'https://api.openai.com/v1',
  modelSuggestions: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-5'],
  supportsRemoteImageUrl: true,

  buildRequest(req: CatalogueRequest, cfg: ProviderSettings): HttpPlan {
    return openaiPlan(req, cfg, true);
  },

  buildFallbackRequest(req: CatalogueRequest, cfg: ProviderSettings): HttpPlan {
    return openaiPlan(req, cfg, false);
  },

  extractText(status: number, body: unknown, cfg: ProviderSettings): string {
    if (status !== 200) {
      throw mapStatus(status, providerErrorMessage(body), 'openai', cfg.model);
    }

    const parsed = (body || {}) as OpenAiBody;
    const choices = parsed.choices;
    const choice = choices && choices.length > 0 ? choices[0] : undefined;
    if (!choice) {
      throw aiError('server', 'OpenAI returned no choice.', {
        providerId: 'openai',
      });
    }

    const refusal = choice.message ? choice.message.refusal : undefined;
    if (typeof refusal === 'string' && refusal !== '') {
      throw aiError('blocked', 'OpenAI refused: ' + refusal, {
        providerId: 'openai',
      });
    }
    if (choice.finish_reason === 'content_filter') {
      throw aiError(
        'blocked',
        'OpenAI blocked this image on its content filter. Try the other provider, or a different photograph.',
        { providerId: 'openai' },
      );
    }
    if (choice.finish_reason === 'length') {
      throw aiError('truncated', TRUNCATED_MESSAGE, { providerId: 'openai' });
    }

    const text = choice.message ? choice.message.content : undefined;
    if (typeof text !== 'string' || text === '') {
      throw aiError('parse', 'OpenAI returned an empty response.', {
        providerId: 'openai',
      });
    }
    return text;
  },

  /**
   * The one concession to parameter drift: reasoning-family models rename
   * max_tokens and reject a non-default temperature. Applied at most once, on
   * a 400 only, and never to a body that already carries the new name.
   */
  retryBody(body: unknown, message: string): unknown | null {
    const b = (body || {}) as Record<string, unknown>;
    const drift =
      /max_completion_tokens|Unsupported parameter|Unsupported value|does not support/i;
    if (!drift.test(message)) {
      return null;
    }
    if ('max_completion_tokens' in b) {
      return null;
    }
    const next: Record<string, unknown> = { ...b };
    if ('max_tokens' in next) {
      next.max_completion_tokens = next.max_tokens;
      delete next.max_tokens;
    }
    delete next.temperature;
    return next;
  },
};

/* ------------------------------------------------------------------ */
/* The table                                                           */
/* ------------------------------------------------------------------ */

export const PROVIDERS: { gemini: AiProvider; openai: AiProvider } = {
  gemini: GEMINI,
  openai: OPENAI,
};

export const PROVIDER_IDS: ProviderId[] = ['gemini', 'openai'];
