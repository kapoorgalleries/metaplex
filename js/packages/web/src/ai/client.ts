/**
 * The driver: the ONLY module in this feature that touches the network.
 *
 * Isolating it is what keeps the UI free of HTTP and keeps every provider
 * shape (providers.ts) and every domain rule (validate.ts) pure and testable.
 * The `fetchImpl` option exists solely so the unit tests need no browser and
 * no network; nothing else in the app passes it.
 *
 * Two invariants this file is responsible for:
 *  - AT MOST ONE retry per run. Either the structured-output fallback OR
 *    provider.retryBody, never both, never twice.
 *  - Every AiError leaving here has had redactSecrets applied to its message,
 *    in ONE place, so no error path can bypass it.
 */

import {
  AiError,
  AiProvider,
  AiSettings,
  CatalogueRequest,
  CatalogueResult,
  GatewayProbe,
  HttpPlan,
  ProviderId,
  aiError,
  isAiError,
} from './types';
import {
  PROVIDERS,
  joinUrl,
  mapStatus,
  providerErrorMessage,
} from './providers';
import { auditRecord, parseCatalogueRecord } from './validate';
import { redactSecrets } from './settings';

/**
 * A 400 matching this is the endpoint rejecting the structured-output
 * directive itself (an older Gemini route, a proxy that strips it, a gateway
 * that has never heard of json_schema) rather than rejecting our content.
 *
 * Every alternative must name a schema token. A bare `not supported` or
 * `Unsupported value` would also match OpenAI's parameter-rejection 400
 * ("Unsupported value: 'temperature' does not support 0.2 with this model"),
 * sending it down this branch and leaving OPENAI.retryBody — written for
 * exactly that message — unreachable, so a reasoning-family model could never
 * succeed. Gemini's own rejection still matches here on `responseSchema`.
 */
const STRUCTURED_OUTPUT_REJECTED =
  /response_format|json_schema|responseSchema|response_schema|structured output/i;

const NETWORK_HINT =
  'A browser CORS block looks identical to a network failure — if this persists, set a proxy Base URL in AI settings.';

/** The gateway refuses an origin it does not admit BEFORE answering the CORS
 *  preflight, with a non-matching Access-Control-Allow-Origin, so a browser
 *  never sees its 403 body — the fetch simply rejects. Until this site is on
 *  the gateway's allowlist, every request to it looks exactly like this. */
const GATEWAY_ORIGIN_HINT =
  " For the Trimurti gateway this is also what an origin it does not admit looks like: this site's address must be on the gateway's origin allowlist.";

/** The gateway's code for a refusal it made BEFORE reserving usage. */
const GATEWAY_FREE_REFUSAL = 'trimurti_response_format_unsupported';

/**
 * Whether a 400 may be retried at all without paying twice.
 *
 * Every direct provider bills only for calls it actually ran, so a rejected
 * request costs nothing and a retry is free. The gallery's gateway is
 * different: it reserves a worst-case token allowance against a daily cap
 * BEFORE calling a provider, and never refunds it. Its own refusals happen
 * before that reservation and say so with a code; a provider's rejection
 * relayed through it arrives with the reservation already spent, and those
 * two are indistinguishable by message — both name response_format. Retrying
 * the second kind would spend a second reservation, roughly a fifth of the
 * day's allowance, for a request that was never going to differ.
 *
 * This gates BOTH retry branches, not just the schema fallback. A relayed
 * parameter-drift 400 is the worse case of the two: retryBody rewrites
 * max_tokens into max_completion_tokens and drops temperature, and the
 * gateway strips all three from the body before it calls the provider — so
 * the retry reaches the provider byte-identical, fails identically, and has
 * spent a second reservation to do it.
 */
function freeToRetry(e: AiError, providerId: ProviderId): boolean {
  return providerId !== 'trimurti' || e.code === GATEWAY_FREE_REFUSAL;
}

/** The dealer's ceiling, never below the endpoint's own. A stored setting
 *  from before this provider existed must not make the browser give up
 *  first; see AiProvider.minRequestTimeoutMs. */
function timeoutFor(provider: AiProvider, settings: AiSettings): number {
  return provider.minRequestTimeoutMs === undefined
    ? settings.requestTimeoutMs
    : Math.max(settings.requestTimeoutMs, provider.minRequestTimeoutMs);
}

function hostOf(u: string): string {
  try {
    return new URL(u).host;
  } catch (e) {
    return u;
  }
}

function networkError(providerId: ProviderId, url: string): AiError {
  return aiError(
    'network',
    'Could not reach ' +
      hostOf(url) +
      '. ' +
      NETWORK_HINT +
      (providerId === 'trimurti' ? GATEWAY_ORIGIN_HINT : ''),
    { providerId },
  );
}

export function runCatalogue(
  providerId: ProviderId,
  settings: AiSettings,
  req: CatalogueRequest,
  opts: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<CatalogueResult> {
  const provider = PROVIDERS[providerId];
  const cfg = settings.providers[providerId];
  const started = Date.now();
  const timeoutMs = timeoutFor(provider, settings);

  /* window.fetch is bound lazily and explicitly: calling an unbound reference
   * throws "Illegal invocation" in browsers, and reading window.fetch eagerly
   * throws in jsdom, where it does not exist. */
  const doFetch: typeof fetch = opts.fetchImpl
    ? opts.fetchImpl
    : (input, init) => window.fetch(input, init);

  function redactErr(e: unknown): unknown {
    if (!isAiError(e)) {
      return e;
    }
    const carry: {
      status?: number;
      providerId?: ProviderId;
      code?: string;
    } = {};
    if (e.status !== null) {
      carry.status = e.status;
    }
    if (e.providerId !== null) {
      carry.providerId = e.providerId;
    }
    if (e.code !== null) {
      carry.code = e.code;
    }
    return aiError(e.kind, redactSecrets(e.message, settings), carry);
  }

  async function attempt(plan: HttpPlan): Promise<string> {
    /* Hand-composed rather than AbortSignal.any / AbortSignal.timeout: neither
     * is safe under this CRA 3.4.3 / target es5 build. The two flags are what
     * separates a user cancel (swallowed upstream) from a timeout. */
    const ctl = new AbortController();
    let timedOut = false;
    let cancelled = false;

    const onAbort = () => {
      cancelled = true;
      ctl.abort();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, timeoutMs);

    const signal = opts.signal;
    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort);
      }
    }

    /** The reason this attempt stopped, when it stopped for our own reasons. */
    const stoppedBy = (): AiError | null => {
      if (cancelled) {
        return aiError('aborted', '', { providerId });
      }
      if (timedOut) {
        const seconds = timeoutMs / 1000;
        return aiError('timeout', 'No response after ' + seconds + 's.', {
          providerId,
        });
      }
      return null;
    };

    try {
      let res: Response;
      try {
        res = await doFetch(plan.url, {
          method: plan.method,
          headers: plan.headers,
          body: plan.body,
          signal: ctl.signal,
        });
      } catch (e) {
        throw stoppedBy() || networkError(providerId, plan.url);
      }

      let body: unknown;
      try {
        body = await res.json();
      } catch (e) {
        /* An error status whose body is not JSON (a proxy's HTML 502, a
         * gateway timeout page) still carries a usable status: map it, rather
         * than reporting an auth or rate-limit failure as a parse error. The
         * provider message is dropped deliberately — an HTML body is not fit
         * to show the user. */
        throw (
          stoppedBy() ||
          (res.status !== 200
            ? mapStatus(res.status, '', providerId, cfg.model)
            : aiError(
                'parse',
                'The provider returned a response that was not JSON.',
                { providerId, status: res.status },
              ))
        );
      }

      return provider.extractText(res.status, body, cfg);
    } finally {
      clearTimeout(timer);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    }
  }

  async function run(): Promise<CatalogueResult> {
    let plan = provider.buildRequest(req, cfg);
    /* Seeded from the provider, not from whether a retry happened: DeepSeek
     * never asks the endpoint to enforce the schema, so without this the one
     * provider that is NEVER schema-constrained is the only one whose record
     * carries no "not schema-constrained" caveat in the review panel. */
    let usedFallback = !provider.structuredOutput;
    let text: string;

    try {
      text = await attempt(plan);
    } catch (e) {
      if (!isAiError(e) || e.kind !== 'bad_request') {
        throw e;
      }
      /* A second call through the gallery's gateway is a second charge, so
       * one that cannot be free is not made at all. */
      if (!freeToRetry(e, providerId)) {
        throw e;
      }
      /* Exactly one of these two branches runs, exactly once. Anything the
       * retry throws propagates as-is; there is never a second retry. */
      if (STRUCTURED_OUTPUT_REJECTED.test(redactSecrets(e.message, settings))) {
        plan = provider.buildFallbackRequest(req, cfg);
        usedFallback = true;
        text = await attempt(plan);
      } else if (provider.retryBody) {
        const next = provider.retryBody(JSON.parse(plan.body), e.message);
        if (next === null) {
          throw e;
        }
        plan = {
          url: plan.url,
          method: plan.method,
          headers: plan.headers,
          body: JSON.stringify(next),
        };
        text = await attempt(plan);
      } else {
        throw e;
      }
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw aiError('parse', 'The model did not return valid JSON.', {
        providerId,
      });
    }

    const record = parseCatalogueRecord(parsed);
    return {
      providerId,
      model: cfg.model,
      record,
      warnings: auditRecord(record),
      rawText: text,
      elapsedMs: Date.now() - started,
      usedFallback,
    };
  }

  return run().catch(e => {
    throw redactErr(e);
  });
}

/**
 * GET {base}/key on the gallery's trimurti-gateway: the same "Test
 * connection" the gateway's own page performs. It costs nothing (no provider
 * call, no budget reservation) and reports which provider keys the gateway
 * holds, so a missing secret is found here rather than as a 503 mid-run.
 * Only meaningful for the 'trimurti' provider; other providers have no such
 * endpoint and the caller does not offer it for them.
 */
/** Publisher prefix of a gateway model id → the field of /key's `providers`
 *  that says whether the gateway holds that provider's secret. */
const GATEWAY_KEY_FIELD: Record<string, string> = {
  google: 'gemini',
  openai: 'gpt',
  anthropic: 'claude',
  deepseek: 'deepseek',
};

export function probeGateway(
  settings: AiSettings,
  opts: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<GatewayProbe> {
  const cfg = settings.providers.trimurti;
  const doFetch: typeof fetch = opts.fetchImpl
    ? opts.fetchImpl
    : (input, init) => window.fetch(input, init);
  const headers: Record<string, string> = {};
  if (cfg.apiKey !== '') {
    headers.Authorization = 'Bearer ' + cfg.apiKey;
  }

  /* The same hand-composed timeout as attempt(): a /key that never answers
   * (a proxy that swallows the request, a sleeping function) would otherwise
   * leave the settings panel on "Testing…" until the tab is closed.
   *
   * Deliberately the stored setting, NOT timeoutFor(): minRequestTimeoutMs is
   * a floor for calls the gateway abandons upstream at 140s and then explains.
   * /key calls no provider and answers at once, so the floor buys nothing here
   * and would only hold the panel on "Testing…" thirty seconds longer when the
   * Base URL points somewhere that never replies. */
  const ctl = new AbortController();
  let timedOut = false;
  let cancelled = false;
  const onAbort = () => {
    cancelled = true;
    ctl.abort();
  };
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, settings.requestTimeoutMs);
  const signal = opts.signal;
  if (signal) {
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort);
    }
  }
  const release = () => {
    clearTimeout(timer);
    if (signal) {
      signal.removeEventListener('abort', onAbort);
    }
  };
  const stoppedBy = (): AiError | null => {
    if (cancelled) {
      return aiError('aborted', '', { providerId: 'trimurti' });
    }
    if (timedOut) {
      return aiError(
        'timeout',
        'No response after ' + settings.requestTimeoutMs / 1000 + 's.',
        { providerId: 'trimurti' },
      );
    }
    return null;
  };

  /* Refused before any request leaves: a Base URL that does not parse would
   * make fetch resolve it against the page's own origin and send the access
   * key there, and a signal already aborted has nothing to probe. The form
   * disables the button on a configuration problem too; this is the layer
   * that must hold whatever the form does. */
  let url: string;
  try {
    new URL(cfg.baseUrl);
    url = joinUrl(cfg.baseUrl, '/key');
  } catch (e) {
    release();
    return Promise.reject(
      aiError('bad_request', 'Base URL is not a valid URL.', {
        providerId: 'trimurti',
      }),
    );
  }
  const early = stoppedBy();
  if (early) {
    release();
    return Promise.reject(early);
  }

  return doFetch(url, {
    method: 'GET',
    headers: headers,
    signal: ctl.signal,
  })
    .catch(() => {
      throw stoppedBy() || networkError('trimurti', cfg.baseUrl);
    })
    .then(res =>
      res
        .json()
        .catch(() => {
          /* A timeout or cancel that lands during the body read must not
           * masquerade as "answered, but not like a gateway". */
          const stop = stoppedBy();
          if (stop) {
            throw stop;
          }
          return null;
        })
        .then((body: unknown) => {
          if (res.status !== 200) {
            /* The same reader a run uses, so /key and a run can never
             * disagree about which of the gateway's lines reach the dealer. */
            throw mapStatus(
              res.status,
              providerErrorMessage(body, 'trimurti'),
              'trimurti',
              cfg.model,
            );
          }
          const data =
            (body as {
              data?: { label?: unknown; providers?: unknown };
            } | null) || {};
          const probe = data.data;
          if (!probe || typeof probe.label !== 'string') {
            throw aiError(
              'parse',
              'That URL answered, but not like a Trimurti gateway.',
              { providerId: 'trimurti' },
            );
          }
          const providers =
            probe.providers && typeof probe.providers === 'object'
              ? (probe.providers as Record<string, boolean>)
              : {};
          /* "Connected" alone answered the wrong question: the gateway can
           * hold three keys and still 503 the one model the dealer chose. */
          const field = GATEWAY_KEY_FIELD[cfg.model.split('/')[0]];
          const held = field === undefined ? undefined : providers[field];
          const keyForModel: GatewayProbe['keyForModel'] =
            typeof held !== 'boolean'
              ? 'unknown'
              : held
              ? 'present'
              : 'missing';
          return { label: probe.label, providers: providers, keyForModel };
        }),
    )
    .then(
      value => {
        release();
        return value;
      },
      e => {
        release();
        if (isAiError(e)) {
          throw aiError(e.kind, redactSecrets(e.message, settings), {
            providerId: 'trimurti',
          });
        }
        throw e;
      },
    );
}
