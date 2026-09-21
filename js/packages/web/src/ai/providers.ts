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
  trimurti: 'Trimurti',
};

/** What each provider calls its secret, for error copy. Telling a dealer the
 *  gateway "rejected the API key" sends them hunting for a key that does not
 *  exist — its secret is a passphrase. Kept in step with each entry's
 *  keyLabel below; test 46 asserts the two agree. */
const SECRET_NAMES: Record<ProviderId, string> = {
  gemini: 'API key',
  openai: 'API key',
  deepseek: 'API key',
  github: 'GitHub token',
  azure: 'API key',
  trimurti: 'access key',
};

/** The two 401/403 bodies the gateway writes itself. Any other 401/403 from
 *  it is a model provider's, relayed verbatim (OpenAI and DeepSeek bodies
 *  pass through untouched; Anthropic's message with its status) — which
 *  means the key held ON the gateway was rejected, not the access key here. */
const GATEWAY_OWN_AUTH =
  /^(Invalid access key\.|Browser origin is not allowed\.)$/;

/** Azure has no single hostname: every resource gets its own. The default
 *  Base URL therefore carries a placeholder, and settings.ts refuses a
 *  configuration that still contains it. */
export const BASE_URL_PLACEHOLDER = 'YOUR-RESOURCE';

/**
 * A truncated response carries a half-finished translation field. Surfacing it
 * as anything softer than a thrown error is exactly the silent partial
 * translation this feature exists to prevent, so every provider throws this.
 *
 * The advice depends on who set the ceiling. A direct provider honours the
 * dealer's "Max output tokens", so raising it is the fix. The gallery's
 * gateway ignores max_tokens and caps every reply itself, so the same advice
 * there would send the dealer to a control that does nothing.
 */
function truncatedError(providerId: ProviderId, cap?: number): AiError {
  const advice =
    cap === undefined
      ? 'Raise "Max output tokens" in AI settings and run again.'
      : PROVIDER_LABELS[providerId] +
        ' caps every reply at ' +
        cap +
        ' tokens and ignores "Max output tokens" — the cap is on the reply, so a shorter request does not help. Use a direct provider for this piece.';
  return aiError(
    'truncated',
    'The response was cut off before the translation finished, so nothing was applied. ' +
      advice,
    { providerId: providerId },
  );
}

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
    const secret = SECRET_NAMES[providerId];
    /* A model provider's 401/403 relayed through the gateway is about the
     * provider key the gateway holds, and "check the access key" would send
     * the dealer to the wrong secret. */
    if (
      providerId === 'trimurti' &&
      providerMessage !== '' &&
      !GATEWAY_OWN_AUTH.test(providerMessage)
    ) {
      return aiError(
        'auth',
        label +
          ' relayed a ' +
          status +
          ' from the model provider: ' +
          providerMessage +
          ' That is the provider key held on the gateway, not the access key in these settings.',
        opts,
      );
    }
    /* The endpoint's own line is kept: the gateway says "Invalid access
     * key." for a 401 and "Browser origin is not allowed." for a 403. In a
     * browser the second is rarely seen as a body — the gateway sends it
     * before answering the CORS preflight, so the fetch simply fails and
     * client.ts names the allowlist in its network error instead. Anything
     * in front of the gateway that forwards the body lands here. */
    const detail = providerMessage ? ' ' + providerMessage : '';
    return aiError(
      'auth',
      label +
        ' refused this request (' +
        status +
        ').' +
        detail +
        ' Check the ' +
        secret +
        ' in AI settings, or the proxy base URL if you are using one.',
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
  if (status === 413) {
    /* The gateway caps the whole body at 8 MB; four detail photographs at
     * the storefront's own 4 MB-per-image ceiling can exceed it. */
    return aiError(
      'bad_request',
      (providerMessage || 'The endpoint refused the request as too large.') +
        ' Lower "Image max edge" in AI settings, or send fewer detail photographs.',
      opts,
    );
  }
  if (status === 429) {
    /* The gateway's own 429 is its usage budget rather than a provider
     * quota, and its body says so ("...was not sent to the model
     * provider"); a provider's quota 429 is relayed with the provider's own
     * line. Either way the line is the difference between waiting and
     * knowing which budget needs raising. */
    const detail = providerMessage ? ' ' + providerMessage : '';
    return aiError(
      'rate_limit',
      label +
        ' refused this request as over its rate limit or usage budget (429).' +
        detail +
        ' Wait and retry, or switch provider.',
      opts,
    );
  }
  if (status >= 500 && status <= 599) {
    /* A 5xx from the gallery's gateway names its cause ("The selected
     * provider is not configured", "The usage guard is unavailable",
     * "TRIMURTI_ACCESS_KEY is not configured on the Supabase project");
     * hiding that behind a generic line sends the dealer to the wrong fix.
     * client.ts passes '' for a body that was not JSON, so an HTML error
     * page never lands here. */
    const detail = providerMessage ? ' ' + providerMessage : '';
    return aiError(
      'server',
      label +
        ' is having problems (' +
        status +
        ').' +
        detail +
        ' Try again, or switch provider.',
      opts,
    );
  }
  return aiError('server', 'Unexpected status ' + status + '.', opts);
}

/** Azure and GitHub Models report a filtered prompt as a 400 carrying this
 *  code, where OpenAI reports it as finish_reason 'content_filter' on a 200.
 *  Same outcome, two arrival shapes; this is what lets both read alike.
 *  Tantric and wrathful iconography is ordinary stock here, so the
 *  distinction between "blocked" and "malformed request" is not academic. */
function isContentFilter(body: unknown): boolean {
  const wrapper = body as
    | { error?: { code?: unknown; message?: unknown } }
    | null
    | undefined;
  const err = wrapper ? wrapper.error : undefined;
  if (!err) {
    return false;
  }
  if (typeof err.code === 'string' && /content[_ ]?filter/i.test(err.code)) {
    return true;
  }
  return (
    typeof err.message === 'string' &&
    /content management policy|content[_ ]?filter|responsible ai/i.test(
      err.message,
    )
  );
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
  // gemini-3.5-flash-lite is the id the gallery's deployed trimurti-gateway
  // sends to Google in production (through Google's Interactions API rather
  // than the generateContent route used here, but the model id is the same);
  // 3.8-flash and 3.1-pro are the ids its staged Gemini bridge (PR #138)
  // lists. 2.5-flash is kept last as the previous generation, not confirmed
  // live either way.
  defaultModel: 'gemini-3.5-flash-lite',
  defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  modelSuggestions: [
    'gemini-3.5-flash-lite',
    'gemini-3.8-flash',
    'gemini-3.1-pro',
    'gemini-2.5-flash',
  ],
  supportsRemoteImageUrl: false,
  supportsImages: true,
  structuredOutput: true,
  persistKey: true,
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
      throw truncatedError('gemini');
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
    /* Explicit, because the gallery's trimurti-gateway defaults to streaming
     * when the field is absent and would answer with an SSE stream this
     * driver cannot read. Every direct provider accepts it too. */
    stream: false,
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
  /** Omit for a provider that reads photographs; false for a text-only one. */
  supportsImages?: boolean;
  /** Models that cannot see a photograph even though the provider can. */
  textOnlyModels?: RegExp;
  maxImageEdgePx?: number;
  requiresJpeg?: boolean;
  /** A reply ceiling the endpoint imposes itself and max_tokens cannot raise. */
  outputTokenCap?: number;
  /** Omit to persist the key; false keeps it in memory for the session. */
  persistKey?: boolean;
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
  const supportsImages = spec.supportsImages !== false;

  /** A text-only model must refuse the photographs rather than post them:
   *  the gallery's trimurti-gateway flattens them to "[photo attached — not
   *  visible to this model]" for such models, so a run that looked like it
   *  worked would describe an artwork the model never saw. The check is per
   *  MODEL, not per provider, because one entry can hold both kinds: every
   *  deepseek/* slot on the gateway is flattened while its Gemini, Claude
   *  and GPT slots see the photograph. */
  function requireImageSupport(
    req: CatalogueRequest,
    cfg: ProviderSettings,
  ): void {
    if (req.images.length === 0) {
      return;
    }
    const textOnly =
      !supportsImages ||
      (spec.textOnlyModels !== undefined &&
        spec.textOnlyModels.test(cfg.model));
    if (textOnly) {
      throw aiError(
        'image',
        shortLabel +
          ' model "' +
          cfg.model +
          '" cannot read photographs — an image sent to it is dropped before the model sees it. Choose an image-reading model, or switch provider.',
        { providerId: spec.id },
      );
    }
  }

  const provider: AiProvider = {
    id: spec.id,
    label: spec.label,
    keyUrl: spec.keyUrl,
    defaultModel: spec.defaultModel,
    defaultBaseUrl: spec.defaultBaseUrl,
    modelSuggestions: spec.modelSuggestions,
    supportsRemoteImageUrl: spec.supportsRemoteImageUrl,
    supportsImages: supportsImages,
    structuredOutput: spec.primaryMode === 'schema',
    persistKey: spec.persistKey !== false,
    modelLabel: spec.modelLabel,
    keyLabel: spec.keyLabel,
    baseUrlHelp: spec.baseUrlHelp,
    note: spec.note,

    buildRequest(req: CatalogueRequest, cfg: ProviderSettings): HttpPlan {
      requireImageSupport(req, cfg);
      return openaiPlan(req, cfg, spec.auth, spec.primaryMode);
    },

    buildFallbackRequest(
      req: CatalogueRequest,
      cfg: ProviderSettings,
    ): HttpPlan {
      requireImageSupport(req, cfg);
      return openaiPlan(req, cfg, spec.auth, spec.fallbackMode);
    },

    extractText(status: number, body: unknown, cfg: ProviderSettings): string {
      if (status !== 200) {
        if (status === 400 && isContentFilter(body)) {
          throw aiError(
            'blocked',
            shortLabel +
              ' blocked this image on its content filter. Try another provider, or a different photograph.',
            { providerId: spec.id, status: status },
          );
        }
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
        throw truncatedError(spec.id, spec.outputTokenCap);
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
  if (spec.textOnlyModels) {
    provider.textOnlyModels = spec.textOnlyModels;
  }
  if (spec.maxImageEdgePx !== undefined) {
    provider.maxImageEdgePx = spec.maxImageEdgePx;
  }
  if (spec.requiresJpeg) {
    provider.requiresJpeg = true;
  }
  if (spec.outputTokenCap !== undefined) {
    provider.outputTokenCap = spec.outputTokenCap;
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
  // Ids taken from the model allowlist the gallery's own trimurti-gateway
  // runs against this API (sb1-vuxiwzek, supabase/functions/trimurti-gateway),
  // where gpt-4o and gpt-5 are recorded as legacy ALIASES of these. The
  // reasoning family rejects a non-default temperature and renames
  // max_tokens; openaiRetryBody is what absorbs that on the first 400.
  defaultModel: 'gpt-5.6-terra',
  defaultBaseUrl: 'https://api.openai.com/v1',
  modelSuggestions: ['gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-4o'],
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
  // Ids and endpoint from the gallery's trimurti-gateway as DEPLOYED — the
  // Supabase function's own source (version 12, 12 Sept 2026), read from the
  // project rather than from any branch. It posts deepseek-v4-flash and
  // deepseek-v4-pro to api.deepseek.com/chat/completions, aliases
  // deepseek-chat to v4-flash, and sends every DeepSeek model text only.
  // An unmerged update to that gateway (sb1-vuxiwzek #132 and its
  // successors) renames the Flash id to deepseek-flash and gives it
  // low-detail vision; until it is deployed that is a proposal, and an
  // earlier commit here that followed it was wrong to. The direct endpoint
  // has never been called from this code, so neither id is confirmed live.
  defaultModel: 'deepseek-v4-flash',
  defaultBaseUrl: 'https://api.deepseek.com',
  modelSuggestions: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  supportsRemoteImageUrl: false,
  // Both the deployed gateway and its unmerged successor agree that the
  // Pro / reasoner family cannot see a photograph, so it is refused here.
  // Whether a Flash model can is exactly where the two disagree, and this
  // code has no evidence of its own; it is left to DeepSeek's endpoint,
  // which refuses an image part it cannot read rather than dropping it.
  textOnlyModels: /pro|reasoner/i,
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
  note: "DeepSeek V4 Pro and the reasoner family cannot read photographs and are refused one here. Whether a Flash model can is not confirmed by the gallery's own gateway, which sends DeepSeek text only — expect a request it cannot read to fail, and nothing is applied from a failed run. DeepSeek is asked for JSON mode rather than a strict schema, so a reply of the wrong shape is caught here rather than refused by the endpoint.",
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

/** Microsoft's first-party hostnames for this API, across the commercial and
 *  sovereign clouds. Any other host means the dealer has pointed the Base URL
 *  at something of their own. Getting this list short is not a cosmetic
 *  problem: a first-party host missing from it reads as proxy mode, which
 *  suppresses the stored-key warning and accepts a blank key on a request
 *  that goes straight to Microsoft. */
const AZURE_OWN_HOSTS =
  /(^|\.)(openai\.azure\.(com|us|cn)|(services\.ai|cognitiveservices)\.azure\.(com|us|cn))$/i;

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
      // A fully-qualified name ending in a root dot is the same host.
      return AZURE_OWN_HOSTS.test(new URL(baseUrl).hostname.replace(/\.$/, ''));
    } catch (e) {
      // An unparseable URL is configProblem's business, not this test's.
      return true;
    }
  },
});

/* ------------------------------------------------------------------ */
/* Trimurti — the gallery's own gateway                                */
/* ------------------------------------------------------------------ */

/** The gallery's Supabase project, as its own site addresses it. Any other
 *  host is something the dealer put in front of the gateway. */
const TRIMURTI_OWN_HOSTS = /(^|\.)supabase\.co$/i;

/**
 * trimurti-gateway (kapoorgalleries/sb1-vuxiwzek, supabase/functions/
 * trimurti-gateway) is a Supabase Edge Function that holds the Anthropic,
 * OpenAI, DeepSeek and Gemini keys as server-side secrets and exposes one
 * OpenAI-dialect POST {base}/chat/completions to the browser, gated by an
 * access passphrase. Routing this feature through it is the only
 * configuration in which no provider key exists in this browser at all.
 *
 * The contract below is the DEPLOYED function's (its source as read from
 * the Supabase project: version 12, 12 Sept 2026), which is the code on the
 * repository's claude/kapoor-galleries-redesign-ku77v6 branch — not the
 * unmerged codex/* chain, whose DeepSeek changes an earlier commit here
 * mistook for live. This entry therefore mirrors:
 *   - model ids are publisher-namespaced (google/…, openai/…, anthropic/…,
 *     deepseek/…) and allowlisted server-side;
 *   - it honours only model, messages and stream — response_format,
 *     temperature and max_tokens are dropped, every reply is capped at
 *     4096 tokens (OpenAI models run at reasoning_effort 'low' and their
 *     reasoning counts inside that cap; Claude Opus 5 and Sonnet 5 run with
 *     thinking disabled), and only OpenAI images are forced to detail:'low'
 *     (Gemini and Claude receive the full 1280px JPEG);
 *   - every deepseek/* model is sent text only — the photograph is replaced
 *     by a placeholder before the model sees it;
 *   - images must be JPEG data URLs of at most 1280px on the longest edge,
 *     5 MB and four per request, inside an 8 MB body;
 *   - it streams unless stream:false is sent explicitly, and abandons an
 *     upstream call after 90 s (Gemini 120 s) whatever the timeout here;
 *   - an origin it does not admit is refused before the CORS preflight, so
 *     a browser sees a failed fetch rather than the 403 body;
 *   - its own page keeps the access key session-only, never in storage.
 * The low-detail rule and the 4096-token ceiling are the gateway's cost
 * controls; for inscription-heavy work they cost legibility, and the note
 * says so rather than hiding it.
 */
export const TRIMURTI: AiProvider = openAiCompatible({
  id: 'trimurti',
  label: 'Trimurti gateway',
  keyUrl:
    'https://github.com/kapoorgalleries/sb1-vuxiwzek/blob/main/TRIMURTI.md',
  defaultModel: 'google/gemini-3.5-flash-lite',
  defaultBaseUrl:
    'https://lbiabcdeojolvxezytkw.supabase.co/functions/v1/trimurti-gateway',
  // The image-reading entries of the deployed gateway's allowlist; its GET
  // /models endpoint is the live source. Its two DeepSeek slots are left
  // out on purpose: the gateway sends them no photograph and every run here
  // carries one, so offering them would offer a dead end.
  modelSuggestions: [
    'google/gemini-3.5-flash-lite',
    'openai/gpt-5.6-terra',
    'openai/gpt-5.6-sol',
    'openai/gpt-5.6-luna',
    'anthropic/claude-sonnet-5',
    'anthropic/claude-opus-5',
    'anthropic/claude-sonnet-4-6',
    'anthropic/claude-haiku-4-5',
  ],
  supportsRemoteImageUrl: false,
  // The gateway flattens images to a placeholder for EVERY deepseek/* model
  // (its textOf, under the comment "DeepSeek is text-only"); local/* slots
  // exist only in its unmerged successor and would be flattened there too.
  textOnlyModels: /^(deepseek\/|local\/)/i,
  maxImageEdgePx: 1280,
  requiresJpeg: true,
  outputTokenCap: 4096,
  persistKey: false,
  modelLabel: 'Gateway model',
  keyLabel: 'Access key',
  baseUrlHelp:
    'Your trimurti-gateway function URL. Anything placed in front of it must accept POST {base}/chat/completions and GET {base}/key and forward the Authorization header.',
  note: "Routes through your own Trimurti gateway, so no provider key for this route is kept in this browser — only the gateway access key, and that is held in this page's memory alone: never written to the browser, and gone after a reload or after leaving this step of the mint form. Limits the gateway itself imposes, whatever the Advanced settings below say: photographs are capped at 1,280 px; OpenAI models receive them at low detail (Gemini and Claude receive the full image); every reply is capped at 4,096 tokens; DeepSeek models receive no photograph at all; a slow provider is abandoned after 90 seconds. This site must also be on the gateway's origin allowlist, or every request fails as if the network were down. Use a direct provider for inscription-heavy pieces until the gateway has a cataloguing path. The record shape is checked here, not enforced by the model.",
  auth: 'bearer',
  // The gateway drops response_format, so the schema travels in the prompt.
  primaryMode: 'none',
  fallbackMode: 'none',
  isOwnEndpoint(baseUrl: string): boolean {
    try {
      return TRIMURTI_OWN_HOSTS.test(
        new URL(baseUrl).hostname.replace(/\.$/, ''),
      );
    } catch (e) {
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
  trimurti: TRIMURTI,
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
  'trimurti',
];
