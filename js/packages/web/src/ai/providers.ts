/**
 * The provider table: the entire provider-specific surface of the feature.
 *
 * Everything here is pure. No fetch, no React, no storage — client.ts owns the
 * network and settings.ts owns persistence, so every request shape and every
 * response reading is directly assertable in a unit test with no browser.
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

/** Short names for error copy. Kept separate from AiProvider.label, which is
 *  the long form the settings form shows. */
const PROVIDER_LABELS: Record<ProviderId, string> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  github: 'GitHub Models',
  azure: 'Azure OpenAI',
};

/** Azure has no single hostname: every resource gets its own. The default
 *  Base URL therefore carries a placeholder, and settings.ts refuses a
 *  configuration that still contains it. */
export const BASE_URL_PLACEHOLDER = 'YOUR-RESOURCE';

/**
 * A truncated response carries a half-finished translation field. Surfacing it
 * as anything softer than a thrown error is exactly the silent partial
 * translation this feature exists to prevent, so every provider throws this.
 */
const TRUNCATED_MESSAGE =
  'The response was cut off before the translation finished, so nothing was applied. Raise "Max output tokens" in AI settings and run again.';

/** JSON mode alone does not tell a model which fields to return. */
const FALLBACK_SYSTEM_SUFFIX =
  '\n\nReturn a single JSON object conforming exactly to this JSON Schema:\n' +
  JSON.stringify(CATALOGUE_JSON_SCHEMA);

/** Lives here rather than in settings.ts because both request builders need it
 *  and settings.ts already imports this module — the other direction would be
 *  a cycle. A user-typed Base URL keeps its trailing slash in memory, so the
 *  URL builders must tolerate one rather than emit a double slash. */
export function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Appends a path to a Base URL, keeping any query string at the end where it
 * belongs. Azure's own documented endpoints carry `?api-version=...`, and a
 * dealer pasting one verbatim would otherwise get
 * `.../v1?api-version=preview/chat/completions` — a 404 whose cause is
 * invisible. Every provider's URL builder goes through here so the same paste
 * survives whichever provider it is pasted into.
 */
export function joinUrl(base: string, path: string): string {
  const cut = base.indexOf('?');
  const head = cut === -1 ? base : base.slice(0, cut);
  const query = cut === -1 ? '' : base.slice(cut);
  return trimTrailingSlash(head) + path + query;
}

/**
 * Shared HTTP status mapping for every provider, which is why it lives here
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

/** Every provider here reports failures as `{ error: { message } }`. */
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
        'Gemini cannot read an image from a URL. Upload the file instead, or switch to a provider that fetches URLs itself.',
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
    url: joinUrl(
      cfg.baseUrl,
      '/models/' + encodeURIComponent(cfg.model) + ':generateContent',
    ),
    method: 'POST',
    headers: geminiHeaders(cfg),
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text: withSchema
              ? CATALOGUE_SYSTEM_PROMPT
              : CATALOGUE_SYSTEM_PROMPT + FALLBACK_SYSTEM_SUFFIX,
          },
        ],
      },
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
  // Gemini 2.0 shut down on June 1, 2026. Keep the editable default on a
  // supported stable model with image input and structured output.
  defaultModel: 'gemini-2.5-flash',
  defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  modelSuggestions: [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-pro',
  ],
  supportsRemoteImageUrl: false,
  modelLabel: 'Model',
  keyLabel: 'API key',
  baseUrlHelp:
    'A proxy here must accept POST {base}/models/{model}:generateContent and forward the x-goog-api-key header.',
  note: '',

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
          '). Try another provider, or a different photograph.',
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
          '). Try another provider, or a different photograph.',
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
/* The OpenAI chat/completions dialect                                 */
/*                                                                     */
/* OpenAI, DeepSeek, GitHub Models and Azure OpenAI all speak it, so   */
/* they are one factory rather than four near-copies. What genuinely   */
/* differs between them is small and enumerated in OpenAiCompatible:   */
/* the auth header, how much of the structured-output directive the    */
/* endpoint tolerates, and the copy. Everything else — the content     */
/* parts, the image labelling, the choices reading, the parameter-     */
/* drift retry — is shared, so a fix to any of it lands in all four.   */
/* ------------------------------------------------------------------ */

type OpenAiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail: string } };

/**
 * 'low' downsamples to 512px, which makes any inscription unreadable. This is
 * not a cost knob for this feature.
 */
const OPENAI_IMAGE_DETAIL = 'high';

/**
 * Bearer everywhere except Azure, which reads `api-key` and ignores
 * Authorization entirely — send the wrong one and it 401s with a message
 * about the key rather than about the header.
 */
type AuthStyle = 'bearer' | 'api-key';

/** How much of the structured-output directive an endpoint tolerates.
 *  'schema' = strict json_schema; 'json' = JSON mode with the schema moved
 *  into the system prompt; 'none' = no response_format at all. */
type ResponseFormatMode = 'schema' | 'json' | 'none';

function openaiHeaders(
  cfg: ProviderSettings,
  auth: AuthStyle,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  // An empty key means a proxy at baseUrl injects it, so no auth header is
  // sent at all rather than an empty one.
  if (cfg.apiKey !== '') {
    if (auth === 'api-key') {
      headers['api-key'] = cfg.apiKey;
    } else {
      headers.Authorization = 'Bearer ' + cfg.apiKey;
    }
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
  auth: AuthStyle,
  mode: ResponseFormatMode,
): HttpPlan {
  /* Key order is deliberate: response_format is emitted before `messages` so
   * that a provider echoing the head of a rejected body in its 400 shows the
   * directive it objected to. */
  const body: Record<string, unknown> = {
    model: cfg.model,
    temperature: req.temperature,
    max_tokens: req.maxOutputTokens,
  };

  if (mode === 'schema') {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: CATALOGUE_SCHEMA_NAME,
        strict: true,
        schema: CATALOGUE_JSON_SCHEMA,
      },
    };
  } else if (mode === 'json') {
    body.response_format = { type: 'json_object' };
  }

  /* Anything short of strict json_schema leaves the model free to invent its
   * own field names, so the schema moves into the system prompt. Dropping the
   * directive without doing this is how you get valid JSON of the wrong
   * shape — which parseCatalogueRecord then rejects, wasting the call. */
  body.messages = [
    {
      role: 'system',
      content:
        mode === 'schema'
          ? CATALOGUE_SYSTEM_PROMPT
          : CATALOGUE_SYSTEM_PROMPT + FALLBACK_SYSTEM_SUFFIX,
    },
    { role: 'user', content: openaiContent(req) },
  ];

  return {
    url: joinUrl(cfg.baseUrl, '/chat/completions'),
    method: 'POST',
    headers: openaiHeaders(cfg, auth),
    body: JSON.stringify(body),
  };
}

interface OpenAiChoice {
  finish_reason?: string;
  message?: { content?: unknown; refusal?: unknown };
}

interface OpenAiBody {
  choices?: OpenAiChoice[];
}

/**
 * The one concession to parameter drift, shared by all four: reasoning-family
 * models rename max_tokens and reject a non-default temperature. OpenAI's
 * gpt-5 family, DeepSeek's reasoner and whatever either publisher ships next
 * behind GitHub Models or an Azure deployment all fail the same way, so they
 * all get the same single retry — at most once, on a 400 only, and never to a
 * body that already carries the new name.
 */
function openaiRetryBody(body: unknown, message: string): unknown | null {
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
}

interface OpenAiCompatible {
  id: ProviderId;
  label: string;
  keyUrl: string;
  defaultModel: string;
  defaultBaseUrl: string;
  modelSuggestions: string[];
  supportsRemoteImageUrl: boolean;
  modelLabel: string;
  keyLabel: string;
  baseUrlHelp: string;
  note: string;
  auth: AuthStyle;
  /** The directive tried first, and the one tried after a 400 that names it. */
  primaryMode: ResponseFormatMode;
  fallbackMode: ResponseFormatMode;
  isOwnEndpoint?(baseUrl: string): boolean;
}

function openAiCompatible(spec: OpenAiCompatible): AiProvider {
  const shortLabel = PROVIDER_LABELS[spec.id];

  const provider: AiProvider = {
    id: spec.id,
    label: spec.label,
    keyUrl: spec.keyUrl,
    defaultModel: spec.defaultModel,
    defaultBaseUrl: spec.defaultBaseUrl,
    modelSuggestions: spec.modelSuggestions,
    supportsRemoteImageUrl: spec.supportsRemoteImageUrl,
    modelLabel: spec.modelLabel,
    keyLabel: spec.keyLabel,
    baseUrlHelp: spec.baseUrlHelp,
    note: spec.note,

    buildRequest(req: CatalogueRequest, cfg: ProviderSettings): HttpPlan {
      return openaiPlan(req, cfg, spec.auth, spec.primaryMode);
    },

    buildFallbackRequest(
      req: CatalogueRequest,
      cfg: ProviderSettings,
    ): HttpPlan {
      return openaiPlan(req, cfg, spec.auth, spec.fallbackMode);
    },

    extractText(status: number, body: unknown, cfg: ProviderSettings): string {
      if (status !== 200) {
        throw mapStatus(status, providerErrorMessage(body), spec.id, cfg.model);
      }

      const parsed = (body || {}) as OpenAiBody;
      const choices = parsed.choices;
      const choice = choices && choices.length > 0 ? choices[0] : undefined;
      if (!choice) {
        throw aiError('server', shortLabel + ' returned no choice.', {
          providerId: spec.id,
        });
      }

      const refusal = choice.message ? choice.message.refusal : undefined;
      if (typeof refusal === 'string' && refusal !== '') {
        throw aiError('blocked', shortLabel + ' refused: ' + refusal, {
          providerId: spec.id,
        });
      }
      if (choice.finish_reason === 'content_filter') {
        throw aiError(
          'blocked',
          shortLabel +
            ' blocked this image on its content filter. Try another provider, or a different photograph.',
          { providerId: spec.id },
        );
      }
      if (choice.finish_reason === 'length') {
        throw aiError('truncated', TRUNCATED_MESSAGE, { providerId: spec.id });
      }

      const text = choice.message ? choice.message.content : undefined;
      if (typeof text !== 'string' || text === '') {
        throw aiError('parse', shortLabel + ' returned an empty response.', {
          providerId: spec.id,
        });
      }
      return text;
    },

    retryBody: openaiRetryBody,
  };

  if (spec.isOwnEndpoint) {
    provider.isOwnEndpoint = spec.isOwnEndpoint;
  }
  return provider;
}

/* ------------------------------------------------------------------ */
/* OpenAI (ChatGPT)                                                    */
/* ------------------------------------------------------------------ */

export const OPENAI: AiProvider = openAiCompatible({
  id: 'openai',
  label: 'OpenAI (ChatGPT)',
  keyUrl: 'https://platform.openai.com/api-keys',
  // Not a gpt-5-family id on purpose: those reject a non-default temperature
  // and reject max_tokens, so such a default would 400 on the first call.
  // openaiRetryBody is what lets one be typed into the settings field.
  defaultModel: 'gpt-4o',
  defaultBaseUrl: 'https://api.openai.com/v1',
  modelSuggestions: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-5'],
  supportsRemoteImageUrl: true,
  modelLabel: 'Model',
  keyLabel: 'API key',
  baseUrlHelp:
    'A proxy here must accept POST {base}/chat/completions and forward the Authorization header.',
  note: '',
  auth: 'bearer',
  primaryMode: 'schema',
  fallbackMode: 'json',
});

/* ------------------------------------------------------------------ */
/* DeepSeek                                                            */
/* ------------------------------------------------------------------ */

export const DEEPSEEK: AiProvider = openAiCompatible({
  id: 'deepseek',
  label: 'DeepSeek',
  keyUrl: 'https://platform.deepseek.com/api_keys',
  // deepseek-chat and deepseek-reasoner were retired as aliases on
  // 2026-07-24; deepseek-flash is the current general model and the only
  // suggestion here that reads photographs.
  defaultModel: 'deepseek-flash',
  defaultBaseUrl: 'https://api.deepseek.com/v1',
  modelSuggestions: ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-pro'],
  supportsRemoteImageUrl: true,
  modelLabel: 'Model',
  keyLabel: 'API key',
  baseUrlHelp:
    'A proxy here must accept POST {base}/chat/completions and forward the Authorization header.',
  // Stated rather than silently worked around: strict json_schema is a beta
  // endpoint on DeepSeek, so this provider asks for JSON mode and puts the
  // schema in the system prompt instead. That is the same path the other
  // providers fall back to, and parseCatalogueRecord rejects a wrong shape
  // either way — but a mis-shaped reply costs a call rather than being
  // refused by the endpoint up front.
  note: 'DeepSeek is asked for JSON mode rather than a strict schema, so a reply of the wrong shape is caught here rather than refused by the endpoint. Reasoner-family models do not read images — keep this on deepseek-flash for photographs.',
  auth: 'bearer',
  primaryMode: 'json',
  fallbackMode: 'none',
});

/* ------------------------------------------------------------------ */
/* GitHub Models                                                       */
/* ------------------------------------------------------------------ */

export const GITHUB: AiProvider = openAiCompatible({
  id: 'github',
  label: 'GitHub Models',
  keyUrl: 'https://github.com/settings/personal-access-tokens',
  // Model ids here are publisher-namespaced, unlike every other provider in
  // this table: a bare 'gpt-4o' 404s.
  defaultModel: 'openai/gpt-4o',
  defaultBaseUrl: 'https://models.github.ai/inference',
  modelSuggestions: [
    'openai/gpt-4o',
    'openai/gpt-4o-mini',
    'microsoft/Phi-4-multimodal-instruct',
    'meta/Llama-3.2-90B-Vision-Instruct',
  ],
  supportsRemoteImageUrl: true,
  modelLabel: 'Model',
  keyLabel: 'GitHub token',
  baseUrlHelp:
    'A proxy here must accept POST {base}/chat/completions and forward the Authorization header.',
  note: 'Needs a fine-grained personal access token with the Models (models:read) permission — not an API key. Rate limits are low and shared across the whole catalogue, so a 429 here is routine rather than a fault.',
  auth: 'bearer',
  primaryMode: 'schema',
  fallbackMode: 'json',
});

/* ------------------------------------------------------------------ */
/* Azure OpenAI (Microsoft Foundry)                                    */
/* ------------------------------------------------------------------ */

/** Microsoft's two first-party hostnames for this API. Any other host means
 *  the dealer has pointed the Base URL at something of their own. */
const AZURE_OWN_HOSTS = /(^|\.)(openai\.azure\.com|services\.ai\.azure\.com)$/i;

export const AZURE: AiProvider = openAiCompatible({
  id: 'azure',
  label: 'Microsoft Azure OpenAI',
  keyUrl: 'https://ai.azure.com/',
  // On Azure the "model" is the name YOU gave a deployment in your own
  // resource, so there is no correct default and no meaningful suggestion
  // list — the two below are only the conventional names people use.
  defaultModel: 'gpt-4o',
  defaultBaseUrl:
    'https://' + BASE_URL_PLACEHOLDER + '.openai.azure.com/openai/v1',
  modelSuggestions: ['gpt-4o', 'gpt-4o-mini'],
  supportsRemoteImageUrl: true,
  modelLabel: 'Deployment name',
  keyLabel: 'API key',
  baseUrlHelp:
    'Your own resource endpoint plus /openai/v1 — the v1 path takes the deployment name in the body, so one Base URL serves every deployment. A query string such as ?api-version=... is preserved and re-attached after /chat/completions.',
  note: 'The Deployment name above is what you called the deployment in your Azure resource, not a published model id. Azure reads the key from an api-key header, so a proxy in front of it must forward that header rather than Authorization.',
  auth: 'api-key',
  primaryMode: 'schema',
  fallbackMode: 'json',
  isOwnEndpoint(baseUrl: string): boolean {
    try {
      return AZURE_OWN_HOSTS.test(new URL(baseUrl).hostname);
    } catch (e) {
      // An unparseable URL is configProblem's business, not this test's.
      return true;
    }
  },
});

/* ------------------------------------------------------------------ */
/* The table                                                           */
/* ------------------------------------------------------------------ */

export const PROVIDERS: Record<ProviderId, AiProvider> = {
  gemini: GEMINI,
  openai: OPENAI,
  deepseek: DEEPSEEK,
  github: GITHUB,
  azure: AZURE,
};

/** Display order in the settings form. Every ProviderId appears exactly once;
 *  a test asserts that, because settings.ts rebuilds the whole stored record
 *  from this list and an omission would silently drop a provider's config. */
export const PROVIDER_IDS: ProviderId[] = [
  'gemini',
  'openai',
  'deepseek',
  'github',
  'azure',
];
