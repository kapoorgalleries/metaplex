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
  huggingface: 'Hugging Face',
  azure: 'Azure OpenAI',
  trimurti: 'Trimurti',
};

/** What each provider calls its secret, for error copy. Telling a dealer the
 *  gateway "rejected the API key" sends them hunting for a key that does not
 *  exist — its secret is a passphrase. Hugging Face calls its secret a User
 *  Access Token. Kept in step with each entry's keyLabel below; test 46
 *  asserts the two agree. */
const SECRET_NAMES: Record<ProviderId, string> = {
  gemini: 'API key',
  openai: 'API key',
  deepseek: 'API key',
  github: 'GitHub token',
  huggingface: 'access token',
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

/** mapStatus writes its own advice straight after the endpoint's line, so a
 *  line with no closing punctuation would run into it ("Rate limited Wait
 *  and retry"). Applied wherever advice follows, whatever shape the line
 *  arrived in; a line that stands alone is passed through verbatim. */
function asSentence(line: string): string {
  const trimmed = line.trim();
  return trimmed === '' || /[.!?]$/.test(trimmed) ? trimmed : trimmed + '.';
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
  providerCode?: string,
): AiError {
  const label = PROVIDER_LABELS[providerId];
  const opts = {
    status: status,
    providerId: providerId,
    ...(providerCode ? { code: providerCode } : {}),
  };
  /** The endpoint's line, terminated, for the branches that follow it with
   *  advice of their own. */
  const detail = providerMessage ? ' ' + asSentence(providerMessage) : '';

  if (status === 400) {
    /* Hugging Face's router answers an unknown model, or one that no
     * provider the dealer has enabled serves, with a 400 coded
     * model_not_supported — never the 404 whose copy below names the model.
     * Its own line says which model; what it cannot say is where providers
     * are enabled. The added sentence names neither response_format nor a
     * drift token, so client.ts still makes no retry of it. */
    if (
      providerId === 'huggingface' &&
      providerCode === 'model_not_supported'
    ) {
      return aiError(
        'bad_request',
        (asSentence(providerMessage) ||
          'Model "' + model + '" is not served.') +
          ' Check the model id, or enable a provider that serves it under Inference Providers in your Hugging Face settings.',
        opts,
      );
    }
    return aiError(
      'bad_request',
      providerMessage || 'The provider rejected the request.',
      opts,
    );
  }
  if (status === 402 && providerId === 'huggingface') {
    /* The router's answer once the account's inference credit is spent —
     * $0.10 a month on a free account, $2 on PRO — after which every call is
     * refused until credit is bought or the month resets. Observed in dated
     * 2026 logs as {"error":"You have depleted your monthly included
     * credits. ..."}; Hugging Face does not document the status or the body.
     * Kind rate_limit because it is a budget refusal like a 429, and because
     * client.ts retries nothing but bad_request, so it is never repeated
     * automatically. Scoped to this provider: every other provider's 402
     * still maps exactly as before. */
    return aiError(
      'rate_limit',
      label +
        ' refused this request for lack of inference credit (402).' +
        detail +
        ' Add credit at huggingface.co/settings/billing, or wait for the monthly allowance to reset — until then every run fails the same way. Or switch provider.',
      opts,
    );
  }
  if (status === 422 && providerId === 'huggingface') {
    /* 422 is how TGI rejects a body it cannot validate (InferError::
     * ValidationError in text-generation-inference router/src/server.rs), and
     * Hugging Face's own client treats a 422 from a chat completion alongside
     * 400, 404 and 500. Read as the 400 it amounts to, so a refused
     * response_format reaches client.ts's single schema-in-prompt retry —
     * free, since the router bills only calls that succeed. Left to the
     * generic line below it would be kind server, which is never retried.
     * Scoped to this provider like the 402 above. */
    return aiError(
      'bad_request',
      providerMessage || label + ' could not process the request (422).',
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
          ' from the model provider:' +
          detail +
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
      (asSentence(providerMessage) ||
        'The endpoint refused the request as too large.') +
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

/**
 * The endpoint's own explanation of a failure, verbatim, or '' when it gave
 * none. Whatever shape it arrived in it is returned as written; mapStatus
 * terminates it where it appends advice of its own.
 *
 * Most bodies here are `{ error: { message } }`, the OpenAI shape, and that
 * shape is read first. Hugging Face's router writes the refusals it makes
 * itself as `{ error: "..." }` instead — a bad token (401), spent credit
 * (402), a token without the inference permission (403) — and so does TGI,
 * the engine behind older dedicated Inference Endpoints (ErrorResponse
 * { error, error_type }). Read only the first shape and those arrive with no
 * explanation at all, which for a 402 is the one line that says what to do.
 * The router also relays a downstream provider's body as that provider wrote
 * it, so a top-level `message` or `detail` string is read too, in the order
 * Hugging Face's own client reads them (@huggingface/inference 4.13.30,
 * src/utils/request.ts).
 *
 * The gateway is held to the first shape alone. Its own bodies and
 * everything it relays from a model provider use it, and mapStatus reads any
 * 401 or 403 line from it that is not the gateway's own as a model provider
 * refusing the key held ON the gateway. A platform error from whatever sits
 * in front of the function, in some other shape, would then be blamed on the
 * wrong secret; left unread it gets the plain "check the access key" line.
 */
export function providerErrorMessage(
  body: unknown,
  providerId: ProviderId,
): string {
  if (typeof body !== 'object' || body === null) {
    return '';
  }
  const wrapper = body as {
    error?: unknown;
    message?: unknown;
    detail?: unknown;
  };
  const err = wrapper.error;
  if (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { message?: unknown }).message === 'string'
  ) {
    return (err as { message: string }).message;
  }
  if (providerId === 'trimurti') {
    return '';
  }
  if (typeof err === 'string') {
    return err;
  }
  if (typeof wrapper.message === 'string') {
    return wrapper.message;
  }
  if (typeof wrapper.detail === 'string') {
    return wrapper.detail;
  }
  return '';
}

/** The endpoint's own machine-readable code, when it supplies one. The
 *  gallery's gateway does, and client.ts reads it to tell a refusal that cost
 *  nothing from one that already spent a budget reservation. Hugging Face's
 *  router does for an unserved model, and mapStatus reads that one. */
function providerErrorCode(body: unknown): string {
  const wrapper = body as { error?: { code?: unknown } } | null | undefined;
  const err = wrapper ? wrapper.error : undefined;
  return err && typeof err.code === 'string' ? err.code : '';
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
      throw mapStatus(
        status,
        providerErrorMessage(body, 'gemini'),
        'gemini',
        cfg.model,
      );
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
/* OpenAI, DeepSeek, GitHub Models, Hugging Face, Azure OpenAI and the */
/* gallery's own gateway all speak it, so they are one factory rather  */
/* than six near-copies. What genuinely differs between them is small  */
/* and enumerated in OpenAiCompatible: the auth header, how much of    */
/* the structured-output directive the endpoint tolerates, the path,   */
/* and the copy. Everything else — the content parts, the image        */
/* labelling, the choices reading, the parameter-drift retry — is      */
/* shared, so a fix to any of it lands in all of them.                 */
/* ------------------------------------------------------------------ */

type OpenAiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: string } };

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

function openaiContent(
  req: CatalogueRequest,
  imageDetail: boolean,
): OpenAiContentPart[] {
  const content: OpenAiContentPart[] = [
    { type: 'text', text: buildUserPrompt(req) },
  ];
  req.images.forEach((img, i) => {
    content.push({ type: 'text', text: labelFor(req.images, i) });
    content.push({
      type: 'image_url',
      image_url: imageDetail
        ? { url: openaiImageUrl(img), detail: OPENAI_IMAGE_DETAIL }
        : { url: openaiImageUrl(img) },
    });
  });
  return content;
}

/** The name of the reply-ceiling field. OpenAI itself accepts the current
 *  name on every chat-completions model, gpt-4o included, and its reasoning
 *  family rejects the old one, so OpenAI proper sends the current name up
 *  front and never pays the rename round-trip. The other dialects keep the
 *  old name (DeepSeek documents only max_tokens; the gallery's gateway ignores
 *  both) and rely on openaiRetryBody if a model of theirs renames it. */
type TokenParam = 'max_tokens' | 'max_completion_tokens';

/** The per-provider constants of the wire format, fixed once in the factory
 *  so the two request builders can never disagree about them. */
interface WireFormat {
  auth: AuthStyle;
  completionsPath: string;
  tokenParam: TokenParam;
  /** False to leave `detail` off every image part; see OpenAiCompatible. */
  imageDetail: boolean;
  /** True to state the schema in the system prompt beside a strict
   *  json_schema directive too; see OpenAiCompatible. */
  schemaInPrompt: boolean;
}

function openaiPlan(
  req: CatalogueRequest,
  cfg: ProviderSettings,
  mode: ResponseFormatMode,
  wire: WireFormat,
): HttpPlan {
  /* Key order is deliberate: response_format is emitted before `messages` so
   * that a provider echoing the head of a rejected body in its 400 shows the
   * directive it objected to. */
  const body: Record<string, unknown> = {
    model: cfg.model,
    temperature: req.temperature,
  };
  body[wire.tokenParam] = req.maxOutputTokens;
  /* Explicit, because the gallery's trimurti-gateway defaults to streaming
   * when the field is absent and would answer with an SSE stream this
   * driver cannot read. Every direct provider accepts it too. */
  body.stream = false;

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
   * shape — which parseCatalogueRecord then rejects, wasting the call. An
   * endpoint that may pass a strict directive on to a backend that silently
   * ignores it gets the schema in the prompt as well, for the same reason. */
  body.messages = [
    {
      role: 'system',
      content:
        mode === 'schema' && !wire.schemaInPrompt
          ? CATALOGUE_SYSTEM_PROMPT
          : CATALOGUE_SYSTEM_PROMPT + FALLBACK_SYSTEM_SUFFIX,
    },
    { role: 'user', content: openaiContent(req, wire.imageDetail) },
  ];

  return {
    url: joinUrl(cfg.baseUrl, wire.completionsPath),
    method: 'POST',
    headers: openaiHeaders(cfg, wire.auth),
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
 * The one concession to parameter drift, shared by every OpenAI-dialect entry
 * but one: reasoning-family models rename max_tokens and reject a non-default
 * temperature. OpenAI's gpt-5 family,
 * DeepSeek's reasoner and whatever either publisher ships next behind GitHub
 * Models or an Azure deployment all fail the same way, so they all get the
 * same single retry — at most once, on a 400 only. A body that already
 * carries the current name (OpenAI proper sends it up front) has nothing to
 * rename, so only its temperature can go; once that is gone too there is
 * nothing left to change and the answer is null, never a loop.
 *
 * Hugging Face is the entry that opts out (driftRetry: false): its spec has
 * no max_completion_tokens, so the rename would resend the request with a
 * field the router never defined and no reply ceiling it recognises, and
 * would report THAT call's answer in place of the real refusal — the drift
 * regexp is loose enough ("does not support") to match a 400 about image
 * input. Nothing documents a provider behind its router refusing a
 * temperature the spec allows, so there is nothing else for this retry to
 * fix there.
 */
function openaiRetryBody(body: unknown, message: string): unknown | null {
  const b = (body || {}) as Record<string, unknown>;
  const drift =
    /max_completion_tokens|Unsupported parameter|Unsupported value|does not support/i;
  if (!drift.test(message)) {
    return null;
  }
  if ('max_completion_tokens' in b && !('temperature' in b)) {
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
  /** Omit for the OpenAI dialect's own path, /chat/completions. */
  completionsPath?: string;
  /** Omit to send max_tokens; see TokenParam. */
  tokenParam?: TokenParam;
  /** A floor on the request timeout for an endpoint with a ceiling of its own. */
  minRequestTimeoutMs?: number;
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
  /** Omit to declare it from primaryMode: a strict directive up front means
   *  the endpoint enforces the schema. False for an endpoint that is SENT
   *  the strict directive but is not known to enforce it, so that every run
   *  is disclosed in the review panel as validated here rather than
   *  constrained upstream (see AiProvider.structuredOutput). */
  structuredOutput?: boolean;
  /** Omit to send image_url.detail 'high'. False for an endpoint whose
   *  documented image part is { url } alone, where `detail` is a field the
   *  endpoint never defined and might refuse. */
  imageDetail?: boolean;
  /** True for an endpoint that may forward a strict json_schema directive to
   *  a backend that silently ignores it: the schema is then stated in the
   *  system prompt as well, so the model knows the field names either way. */
  schemaInPrompt?: boolean;
  /** Omit for the shared parameter-drift retry (openaiRetryBody). False for
   *  an endpoint whose spec has no max_completion_tokens to rename into and
   *  no documented temperature refusal: its 400 is then reported as it
   *  arrived, never followed by a second call carrying an undefined field. */
  driftRetry?: boolean;
  isOwnEndpoint?(baseUrl: string): boolean;
}

/**
 * The isOwnEndpoint test for a provider whose first-party hostnames are
 * known: true when the Base URL's host is one of them, so the request goes
 * to the provider itself and a key is required. A fully-qualified name
 * ending in a root dot is the same host. An unparseable URL answers true —
 * it is configProblem's business, not this test's, and reading it as a
 * proxy would wave a blank key through.
 */
function ownEndpoint(hosts: RegExp): (baseUrl: string) => boolean {
  return baseUrl => {
    try {
      return hosts.test(new URL(baseUrl).hostname.replace(/\.$/, ''));
    } catch (e) {
      return true;
    }
  };
}

function openAiCompatible(spec: OpenAiCompatible): AiProvider {
  const shortLabel = PROVIDER_LABELS[spec.id];
  const supportsImages = spec.supportsImages !== false;
  const completionsPath = spec.completionsPath || '/chat/completions';
  const wire: WireFormat = {
    auth: spec.auth,
    completionsPath: completionsPath,
    tokenParam: spec.tokenParam || 'max_tokens',
    imageDetail: spec.imageDetail !== false,
    schemaInPrompt: spec.schemaInPrompt === true,
  };

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
    structuredOutput:
      spec.structuredOutput === undefined
        ? spec.primaryMode === 'schema'
        : spec.structuredOutput,
    completionsPath: completionsPath,
    persistKey: spec.persistKey !== false,
    modelLabel: spec.modelLabel,
    keyLabel: spec.keyLabel,
    baseUrlHelp: spec.baseUrlHelp,
    note: spec.note,

    buildRequest(req: CatalogueRequest, cfg: ProviderSettings): HttpPlan {
      requireImageSupport(req, cfg);
      return openaiPlan(req, cfg, spec.primaryMode, wire);
    },

    buildFallbackRequest(
      req: CatalogueRequest,
      cfg: ProviderSettings,
    ): HttpPlan {
      requireImageSupport(req, cfg);
      return openaiPlan(req, cfg, spec.fallbackMode, wire);
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
        throw mapStatus(
          status,
          providerErrorMessage(body, spec.id),
          spec.id,
          cfg.model,
          providerErrorCode(body),
        );
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
  };

  if (spec.driftRetry !== false) {
    provider.retryBody = openaiRetryBody;
  }
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
  if (spec.minRequestTimeoutMs !== undefined) {
    provider.minRequestTimeoutMs = spec.minRequestTimeoutMs;
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
  // reasoning family rejects a non-default temperature; openaiRetryBody
  // drops it on the first 400. Its rename of max_tokens never fires here
  // because tokenParam sends the current name up front.
  defaultModel: 'gpt-5.6-terra',
  tokenParam: 'max_completion_tokens',
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
/* Hugging Face Inference Providers                                    */
/* ------------------------------------------------------------------ */

/** Hugging Face's own hosts: the router and every other huggingface.co
 *  name, and dedicated Inference Endpoints, which live at
 *  <id>.<region>.<cloud>.endpoints.huggingface.cloud. A token sent to any of
 *  them goes to Hugging Face itself, so none is proxy mode — reading a
 *  dedicated endpoint as a proxy would accept a blank token and hide the
 *  stored-key warning, the trap Azure's per-tenant hosts already taught.
 *  Spaces (*.hf.space) are deliberately absent: a Space runs code its owner
 *  wrote, which is exactly what a dealer's own proxy is. */
const HUGGINGFACE_OWN_HOSTS =
  /(^|\.)(huggingface\.co|endpoints\.huggingface\.cloud)$/i;

/** Families the Hub tags text-generation rather than image-text-to-text
 *  (hub_repo_details, 2026-09-24): openai/gpt-oss, deepseek-ai's
 *  DeepSeek-V4-Pro and R1, Qwen/Qwen3-Coder, moonshotai/Kimi-K2-Instruct and
 *  zai-org/GLM-5.3. Their near-twins DO read images and must not match:
 *  GLM-5.3-Flash, DeepSeek-V4.1-Flash, Kimi-K2.5 and K3. A ':provider' or
 *  ':policy' suffix names the same model, so one may follow. Anchored on the
 *  publisher namespace exactly as the router takes the id, because the Model
 *  field does not always hold a Hub id: on a dedicated Inference Endpoint,
 *  or a proxy, it holds a name the dealer chose, and a bare 'glm-5.3' may
 *  well be serving a vision model — so a name without its namespace never
 *  matches. What the router does with a photograph sent to a text-only model
 *  — refuse the call, or drop the image and bill for a reading of nothing —
 *  is not confirmed, which is why the photograph is refused here instead. */
const HUGGINGFACE_TEXT_ONLY =
  /^(openai\/gpt-oss-|deepseek-ai\/DeepSeek-(V4-Pro|R1)|Qwen\/Qwen3-Coder|moonshotai\/Kimi-K2-Instruct|zai-org\/GLM-5\.3(?=:|$))/i;

/**
 * Hugging Face Inference Providers: one OpenAI-compatible router, POST
 * https://router.huggingface.co/v1/chat/completions, in front of many
 * inference companies (novita, deepinfra, together, fireworks-ai, …) serving
 * open-weight models, all paid for through one Hugging Face token. The facts
 * this entry rests on are stated here in full; their sourcing — Hugging
 * Face's docs (inference-providers: index, tasks/chat-completion, hub-api,
 * guides/structured-output, pricing; inference-endpoints: tutorials/chat_bot,
 * guides/autoscaling) and its own client code (@huggingface/inference
 * 4.13.30, @huggingface/tasks 0.21.48, huggingface_hub 2.0.0), read
 * 2026-09-24 — is laid out in research_notes/Hugging Face integration/
 * inference_providers.md. Where nothing confirmed a point, this says so.
 *
 *  - The model is the Hub repo id, sent verbatim. By default the router
 *    picks the fastest provider serving it (highest throughput); the dealer
 *    can switch that account-wide default to cheapest or to their own
 *    provider order at huggingface.co/settings/inference-providers, and a
 *    suffix on the id overrides it per request: ':<provider>' pins one (at
 *    the cost of automatic failover), ':fastest', ':cheapest' or
 *    ':preferred' names a policy. Nothing here parses or strips the suffix.
 *  - A strict json_schema response_format is in the router's documented
 *    request spec, but whether it is ENFORCED is per provider and per model:
 *    /v1/models reports supports_structured_output, and the docs' own example
 *    shows one provider false beside three true for the same model. What a
 *    provider without it does — refuse the directive or ignore it silently —
 *    is not confirmed. Two consequences. schemaInPrompt: the model is told
 *    the field names even if the directive goes nowhere, which costs the
 *    serialised schema — about 8,600 characters as of this writing, a couple
 *    of thousand prompt tokens — on EVERY run, paid for nothing on a
 *    provider that does enforce the directive; that is
 *    accepted here as correctness over cost, and no /models probe is made
 *    to find out which kind answered. structuredOutput false: the directive
 *    is sent, but since enforcement cannot be claimed the review panel
 *    discloses every run as validated here rather than constrained
 *    upstream, and parseCatalogueRecord checks the reply either way. A
 *    refusal naming response_format (a 400, or a 422, which mapStatus reads
 *    as a 400 here) is the single retry, with no directive at all —
 *    json_object support per provider is no better known.
 *  - max_tokens is the documented name for the reply ceiling;
 *    max_completion_tokens is not in Hugging Face's spec, and temperature is
 *    documented (0 to 2) with no provider recorded as refusing it. So the
 *    shared parameter-drift retry is off (driftRetry false): a 400 or 422 is
 *    reported as it arrived rather than resent with a field the spec never
 *    defined and no reply ceiling the router recognises.
 *  - Photographs go inline as base64 data URLs, as Hugging Face's own Python
 *    client sends local images. A remote URL is documented too, but whether
 *    every provider behind the router fetches one — an arweave original, at
 *    full size — is not, and an inlined image has been through this page's
 *    own downscale. image_url carries no `detail`: Hugging Face's spec
 *    defines it as { url } alone.
 *  - The router's own refusals are `{ error: "..." }` strings (401 bad token,
 *    402 spent credit, 403 token without the inference permission), and an
 *    unknown or unserved model is a 400 coded model_not_supported, never a
 *    404; providerErrorMessage and mapStatus read all of them.
 *  - CORS: Hugging Face's own guide builds a browser-only page that posts to
 *    this router with a token, and third-party pages post image data URLs to
 *    it the same way. Not observed from here: the router was unreachable from
 *    the session that researched it.
 *  - A dedicated Inference Endpoint speaks the same dialect at its own URL
 *    plus /v1, with the endpoint's NAME as the model, and bills compute time
 *    rather than per call. vLLM and SGLang are its recommended engines; one
 *    still on TGI (maintenance mode since 2025-12-11) takes response_format in
 *    TGI's own { type, value } shape (router/src/lib.rs, GrammarType), and
 *    how it answers the OpenAI shape sent here has not been observed. A
 *    scaled-to-zero endpoint answers 503 while its replica starts.
 */
export const HUGGINGFACE: AiProvider = openAiCompatible({
  id: 'huggingface',
  label: 'Hugging Face Inference Providers',
  // Pre-filled: a fine-grained token with the inference permission alone.
  keyUrl:
    'https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained',
  // Every id here reads images (Hub task image-text-to-text) and was served
  // live by at least two providers on 2026-09-24 (hub_repo_details). The
  // default is the non-thinking Instruct edition, so "Max output tokens"
  // goes to the record rather than to reasoning, and its card claims OCR in
  // 32 languages and better handling of rare and ancient characters. No card
  // read names Tibetan, Ranjana, Siddham or Newari script; that is untested.
  defaultModel: 'Qwen/Qwen3-VL-235B-A22B-Instruct',
  defaultBaseUrl: 'https://router.huggingface.co/v1',
  modelSuggestions: [
    'Qwen/Qwen3-VL-235B-A22B-Instruct',
    'google/gemma-4-31B-it',
    'Qwen/Qwen3.8-27B',
    'zai-org/GLM-5.3-Flash',
    'Qwen/Qwen2.5-VL-72B-Instruct',
    'Qwen/Qwen3.5-397B-A17B',
  ],
  supportsRemoteImageUrl: false,
  textOnlyModels: HUGGINGFACE_TEXT_ONLY,
  modelLabel: 'Model',
  keyLabel: 'Access token',
  baseUrlHelp:
    "A proxy here must accept POST {base}/chat/completions and forward the Authorization header. For a dedicated Inference Endpoint, use its URL plus /v1 (https://<id>.<region>.<cloud>.endpoints.huggingface.cloud/v1) and put the endpoint's name in Model, not a Hub model id; one that has scaled to zero answers 503 until its replica has started.",
  note: 'Needs a fine-grained Hugging Face access token with the "Make calls to Inference Providers" permission and nothing else: it is saved in this browser\'s local storage, and a read or write token would also open the account\'s repositories. Free accounts get $0.10 of inference credit a month and PRO accounts $2; once it is spent, every run fails with "depleted your monthly included credits" (402) until you buy credit or the month resets. By default Hugging Face routes each run to the fastest provider serving the model — changeable in your Inference Providers settings — unless the model id ends in :provider (for example :deepinfra), :fastest, :cheapest or :preferred. Whether the record shape is strictly enforced depends on the provider that answers, so pin one for steadier results; because that cannot be confirmed from here, the schema is also written into every request (a couple of thousand extra prompt tokens a run), the reply is checked here, and the review panel marks every run as validated here rather than enforced by the endpoint. Models that think by default, such as Qwen3.8 and GLM-5.3-Flash, spend part of "Max output tokens" thinking. A dedicated Inference Endpoint works too, by changing the Base URL.',
  auth: 'bearer',
  primaryMode: 'schema',
  fallbackMode: 'none',
  structuredOutput: false,
  imageDetail: false,
  schemaInPrompt: true,
  driftRetry: false,
  isOwnEndpoint: ownEndpoint(HUGGINGFACE_OWN_HOSTS),
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
  isOwnEndpoint: ownEndpoint(AZURE_OWN_HOSTS),
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
 * This entry posts to the gateway's CATALOGUING route, POST
 * {base}/catalogue/completions (kapoorgalleries/sb1-vuxiwzek #146), which
 * exists for exactly this feature. Its contract, as that source states it:
 *   - model ids are publisher-namespaced (google/…, openai/…, anthropic/…)
 *     and allowlisted server-side; deepseek/* is refused on this route
 *     because the gateway sends those models no photograph;
 *   - every provider gets an 8192-token reply ceiling; max_tokens and
 *     temperature are still dropped (OpenAI runs at reasoning_effort 'low',
 *     Claude Opus 5 and Sonnet 5 with thinking disabled);
 *   - OpenAI receives the photograph at detail 'high'; Gemini and Claude
 *     receive the full 1280px JPEG as they always did;
 *   - a strict json_schema response_format is FORWARDED for OpenAI (as
 *     response_format) and for Claude Opus 5, Sonnet 5 and Haiku 4.5 (mapped
 *     to Anthropic's output_config.format). Forwarded is all this layer may
 *     claim: the Anthropic mapping has not been exercised against the real
 *     API from here, so a reply of the wrong shape is still possible on
 *     those slots and is caught by the parse either way. Gemini — the
 *     DEFAULT model — and Sonnet 4.6 are refused a schema outright with a
 *     free 400 naming response_format (code
 *     trimurti_response_format_unsupported), which client.ts turns into the
 *     single schema-in-prompt retry, so usedFallback is true for them;
 *   - streaming is refused, so stream:false is required, not just sent;
 *   - images must be JPEG data URLs of at most 1280px on the longest edge,
 *     5 MB and four per request, inside an 8 MB body;
 *   - the gateway abandons an upstream call after 140 s, which is why this
 *     entry carries minRequestTimeoutMs: the browser waits 150 s whatever
 *     the stored setting says, so the gateway's own clean error arrives;
 *   - an origin it does not admit is refused before the CORS preflight, so
 *     a browser sees a failed fetch rather than the 403 body;
 *   - a gateway without the route answers 404 "No such endpoint", which
 *     mapStatus reports as not_found — never the chat limits in disguise;
 *   - its own page keeps the access key session-only, never in storage.
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
  outputTokenCap: 8192,
  completionsPath: '/catalogue/completions',
  /* The route abandons an upstream call at 140s; waiting 150 means the
   * gateway's own explanation arrives instead of a local timeout, and the
   * reservation it already spent buys something. */
  minRequestTimeoutMs: 150000,
  persistKey: false,
  modelLabel: 'Gateway model',
  keyLabel: 'Access key',
  baseUrlHelp:
    "Your trimurti-gateway function URL. Anything placed in front of it must forward the Authorization header and accept POST {base}/catalogue/completions, which is what this page uses, as well as GET {base}/key. Keep POST {base}/chat/completions working too: the gateway's own trimurti.html page still posts there.",
  note: "Routes through your own Trimurti gateway's cataloguing route, so no provider key for this route is kept in this browser — only the gateway access key, and that is held in this page's memory alone: never written to the browser, and gone after a reload or after leaving this step of the mint form. Limits the gateway itself imposes, whatever the Advanced settings below say: photographs are capped at 1,280 px and every reply at 8,192 tokens; DeepSeek models are refused because the gateway sends them no photograph; a slow provider is abandoned after 140 seconds, so this page waits at least 150 seconds for the gateway's own answer even if Request timeout is set lower. On Gemini — the model this provider starts on — the gateway does not accept a schema at all: the record shape is described in the prompt and checked here, and the run is marked as having used the fallback. The schema is passed on to the provider for GPT and for Claude Opus 5, Sonnet 5 and Haiku 4.5; a reply of the wrong shape is still checked here on those too. This site must be on the gateway's origin allowlist, or every request fails as if the network were down; a gateway without the cataloguing route answers \"endpoint not found\". Each run reserves roughly 46,000 of the 100,000 gateway tokens allowed per day from one address.",
  auth: 'bearer',
  // Strict json_schema first; the gateway's free 400 for the slots that
  // cannot enforce one is the single schema-in-prompt retry.
  primaryMode: 'schema',
  fallbackMode: 'none',
  isOwnEndpoint: ownEndpoint(TRIMURTI_OWN_HOSTS),
});

/* ------------------------------------------------------------------ */
/* The table                                                           */
/* ------------------------------------------------------------------ */

export const PROVIDERS: Record<ProviderId, AiProvider> = {
  gemini: GEMINI,
  openai: OPENAI,
  deepseek: DEEPSEEK,
  github: GITHUB,
  huggingface: HUGGINGFACE,
  azure: AZURE,
  trimurti: TRIMURTI,
};

/** Display order in the settings form. Every ProviderId appears exactly once;
 *  a test asserts that, because settings.ts rebuilds the whole stored record
 *  from this list and an omission would silently drop a provider's config.
 *  The two multi-publisher catalogues, GitHub Models and Hugging Face, sit
 *  together; the gallery's own gateway stays last. */
export const PROVIDER_IDS: ProviderId[] = [
  'gemini',
  'openai',
  'deepseek',
  'github',
  'huggingface',
  'azure',
  'trimurti',
];
