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
  AiSettings,
  CatalogueRequest,
  CatalogueResult,
  HttpPlan,
  ProviderId,
  aiError,
  isAiError,
} from './types';
import { PROVIDERS } from './providers';
import { auditRecord, parseCatalogueRecord } from './validate';
import { redactSecrets } from './settings';

/**
 * A 400 matching this is the endpoint rejecting the structured-output
 * directive itself (an older Gemini route, a proxy that strips it, a gateway
 * that has never heard of json_schema) rather than rejecting our content.
 */
const STRUCTURED_OUTPUT_REJECTED =
  /response_format|json_schema|responseSchema|response_schema|not supported|Unknown name/i;

const NETWORK_HINT =
  'A browser CORS block looks identical to a network failure — if this persists, set a proxy Base URL in AI settings.';

function hostOf(u: string): string {
  try {
    return new URL(u).host;
  } catch (e) {
    return u;
  }
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
    const carry: { status?: number; providerId?: ProviderId } = {};
    if (e.status !== null) {
      carry.status = e.status;
    }
    if (e.providerId !== null) {
      carry.providerId = e.providerId;
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
    }, settings.requestTimeoutMs);

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
        const seconds = settings.requestTimeoutMs / 1000;
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
        throw (
          stoppedBy() ||
          aiError(
            'network',
            'Could not reach ' + hostOf(plan.url) + '. ' + NETWORK_HINT,
            { providerId },
          )
        );
      }

      let body: unknown;
      try {
        body = await res.json();
      } catch (e) {
        throw (
          stoppedBy() ||
          aiError(
            'parse',
            'The provider returned a response that was not JSON.',
            { providerId, status: res.status },
          )
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
    let usedFallback = false;
    let text: string;

    try {
      text = await attempt(plan);
    } catch (e) {
      if (!isAiError(e) || e.kind !== 'bad_request') {
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
