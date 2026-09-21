/**
 * Typed settings for the AI cataloguing layer, persisted as one versioned
 * localStorage entry.
 *
 * This deliberately does NOT use useLocalStorageState from '@oyster/common'
 * (packages/common/src/utils/utils.ts). That hook returns an untyped `any`
 * tuple — there is no `as const` on its return — so adopting it would erase
 * the types across this whole feature and defeat strict mode; and its
 * `state !== newState` identity guard is written for scalars, so it
 * misbehaves for object state like this.
 */

import { AiProvider, AiSettings, ProviderId, ProviderSettings } from './types';
import {
  BASE_URL_PLACEHOLDER,
  PROVIDERS,
  PROVIDER_IDS,
  trimTrailingSlash,
} from './providers';

export const AI_SETTINGS_KEY = 'kapoor.ai.settings.v1';

/** The slice of Storage this module uses, so a test can pass a plain object. */
export type SettingsStore = Pick<Storage, 'getItem' | 'setItem'>;

const REDACTED = '«redacted»';

/**
 * Bare key shapes, for the case where a provider echoes a submitted fragment
 * back inside a 400 body that we never configured ourselves. `sk-` covers
 * OpenAI and DeepSeek, `AIza` Gemini, and the gh* set GitHub's token
 * families. Azure keys are undelimited hex or base64 with no distinguishing
 * prefix, so there is nothing safe to match on: those are covered only by the
 * exact-value pass below, which is why that pass exists.
 */
const KEY_SHAPE = /(sk-|AIza|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{10,}/g;

/** Every provider starts unconfigured, at its own documented endpoint. Built
 *  from PROVIDER_IDS rather than written out, so adding a provider to the
 *  table is the only edit needed. */
function defaultProviders(): Record<ProviderId, ProviderSettings> {
  const out = {} as Record<ProviderId, ProviderSettings>;
  PROVIDER_IDS.forEach(id => {
    out[id] = {
      apiKey: '',
      model: PROVIDERS[id].defaultModel,
      baseUrl: PROVIDERS[id].defaultBaseUrl,
    };
  });
  return out;
}

export function defaultSettings(): AiSettings {
  return {
    activeProvider: 'gemini',
    providers: defaultProviders(),
    imageMaxEdgePx: 1600,
    maxOutputTokens: 8192,
    /* Above every endpoint's own ceiling, so the browser is never the first
     * to give up: the gallery's gateway abandons an upstream call at 140s
     * and then answers with its own explanation, which is worth waiting the
     * extra seconds for — giving up first loses the explanation AND the
     * budget reservation it already spent. client.ts raises a lower stored
     * value to provider.minRequestTimeoutMs for the same reason. */
    requestTimeoutMs: 150000,
  };
}

/* ------------------------------------------------------------------ */
/* Field-by-field coercion                                             */
/*                                                                     */
/* A stored blob may be corrupt, truncated, or written by an older     */
/* build. Every field is therefore read individually and falls back to */
/* its default; the parsed object is never spread wholesale, which is  */
/* what would let `undefined` reach a strict-typed field.              */
/* ------------------------------------------------------------------ */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function asPositive(value: unknown, fallback: number): number {
  return typeof value === 'number' && isFinite(value) && value > 0
    ? value
    : fallback;
}

function asProviderId(value: unknown, fallback: ProviderId): ProviderId {
  return PROVIDER_IDS.indexOf(value as ProviderId) === -1
    ? fallback
    : (value as ProviderId);
}

function mergeProvider(value: unknown, base: ProviderSettings) {
  const raw = asRecord(value);
  return {
    apiKey: asString(raw.apiKey, base.apiKey),
    model: asString(raw.model, base.model),
    baseUrl: asString(raw.baseUrl, base.baseUrl),
  };
}

function browserStore(): SettingsStore | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch (e) {
    // Some browsers throw on the property access itself when site data is
    // blocked, not merely on getItem.
    return null;
  }
}

/** Never throws. Every failure path degrades to defaultSettings(). */
export function loadSettings(store?: SettingsStore): AiSettings {
  const base = defaultSettings();
  const target = store || browserStore();
  if (!target) {
    return base;
  }

  let parsed: unknown;
  try {
    const raw = target.getItem(AI_SETTINGS_KEY);
    if (raw === null || raw === '') {
      return base;
    }
    parsed = JSON.parse(raw);
  } catch (e) {
    // Corrupt JSON, or a private-mode browser that throws on getItem.
    return base;
  }

  const top = asRecord(parsed);
  const stored = asRecord(top.providers);
  /* Rebuilt key by key from PROVIDER_IDS, never spread from `stored`: a blob
   * written before a provider existed simply has no entry for it, and a blob
   * written after one is removed must not resurrect it. */
  const providers = {} as Record<ProviderId, ProviderSettings>;
  PROVIDER_IDS.forEach(id => {
    providers[id] = mergeProvider(stored[id], base.providers[id]);
  });

  return {
    activeProvider: asProviderId(top.activeProvider, base.activeProvider),
    providers: providers,
    imageMaxEdgePx: asPositive(top.imageMaxEdgePx, base.imageMaxEdgePx),
    maxOutputTokens: asPositive(top.maxOutputTokens, base.maxOutputTokens),
    requestTimeoutMs: asPositive(top.requestTimeoutMs, base.requestTimeoutMs),
  };
}

/** Never throws. Persistence is best-effort; losing it must not break a run. */
export function saveSettings(next: AiSettings, store?: SettingsStore): void {
  const target = store || browserStore();
  if (!target) {
    return;
  }

  const providers = {} as Record<ProviderId, ProviderSettings>;
  PROVIDER_IDS.forEach(id => {
    const cfg = next.providers[id];
    providers[id] = {
      /* A session-only secret is written as blank: the gateway's own page
       * never stores its access key, and this layer keeps that policy rather
       * than being the one place the passphrase lands on disk. */
      apiKey: PROVIDERS[id].persistKey ? cfg.apiKey : '',
      model: cfg.model,
      baseUrl: trimTrailingSlash(cfg.baseUrl),
    };
  });
  const normalised: AiSettings = { ...next, providers: providers };

  try {
    target.setItem(AI_SETTINGS_KEY, JSON.stringify(normalised));
  } catch (e) {
    // Private-mode browsers and full quotas throw here.
  }
}

/** origin + pathname, trailing slash removed. Falls back to the trimmed raw
 *  string when the URL does not parse, so an unparseable value still compares
 *  equal to itself and configProblem stays the one place that reports it. */
function canonicalEndpoint(url: string): string {
  try {
    const u = new URL(url);
    /* A fully-qualified name ending in a root dot resolves to the same host,
     * so `api.openai.com.` is still the provider itself — the per-provider
     * isOwnEndpoint tests already strip it, and this generic compare must
     * not be the one path that reads it as a proxy and waves a blank key
     * through to the real endpoint. */
    const host = u.hostname.replace(/\.$/, '');
    const port = u.port ? ':' + u.port : '';
    return trimTrailingSlash(u.protocol + '//' + host + port + u.pathname);
  } catch (e) {
    return trimTrailingSlash(url);
  }
}

/** A non-default Base URL means the request is routed somewhere the dealer
 *  controls, which is the only place a key may legitimately be absent. */
export function isProxyMode(
  cfg: ProviderSettings,
  provider: AiProvider,
): boolean {
  /* A provider that knows its own hostnames answers for itself. Azure does,
   * because its real endpoint is per-tenant and never equals the default —
   * without this, every genuine Azure configuration would read as proxy mode,
   * suppressing the stored-key warning and accepting a blank key on requests
   * going straight to Microsoft. */
  if (provider.isOwnEndpoint) {
    return !provider.isOwnEndpoint(cfg.baseUrl);
  }
  /* Otherwise compared by where the request actually LANDS — origin plus
   * path — not by whether the string is character-identical to the default.
   * A raw-string compare made `https://api.openai.com/v1?x=1` read as a
   * proxy, which accepts a blank key on a request going straight to the
   * provider. A trailing slash is still the default endpoint. */
  return (
    canonicalEndpoint(cfg.baseUrl) !==
    canonicalEndpoint(provider.defaultBaseUrl)
  );
}

/** '' when the configuration can be used as-is. */
export function configProblem(
  cfg: ProviderSettings,
  provider: AiProvider,
): string {
  if (cfg.model.trim() === '') {
    return 'Enter a ' + provider.modelLabel.toLowerCase() + '.';
  }
  try {
    new URL(cfg.baseUrl);
  } catch (e) {
    return 'Base URL is not a valid URL.';
  }
  /* Azure ships with a placeholder hostname because there is no shared one.
   * Left in place it produces a DNS failure reported as a network error,
   * which reads as "the feature is broken" rather than "finish the form".
   * Scoped to the provider whose default carries it: the token is otherwise
   * a legal path segment, and a proxy of the dealer's own may contain it. */
  if (
    provider.defaultBaseUrl.indexOf(BASE_URL_PLACEHOLDER) !== -1 &&
    cfg.baseUrl.indexOf(BASE_URL_PLACEHOLDER) !== -1
  ) {
    return (
      'Replace ' +
      BASE_URL_PLACEHOLDER +
      ' in the Base URL with your own resource name.'
    );
  }
  // A blank key against a CUSTOM Base URL is proxy mode: valid, and the only
  // configuration in which no secret exists in the browser at all.
  if (cfg.apiKey === '' && !isProxyMode(cfg, provider)) {
    // Named as the form labels it: "Enter an API key" on a panel whose field
    // says "Access key" sends the dealer looking for a field that is not there.
    return (
      'Enter the ' +
      provider.keyLabel +
      ', or point the Base URL at a proxy that holds it.'
    );
  }
  return '';
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Masks configured keys and bare key shapes. Provider 400 bodies sometimes
 * echo fragments of the submitted request, so every provider-authored string
 * passes through this before it reaches the UI, notify() or the console.
 */
export function redactSecrets(text: string, s: AiSettings): string {
  let out = text;
  PROVIDER_IDS.forEach(id => {
    const key = s.providers[id].apiKey;
    if (key !== '') {
      out = out.replace(new RegExp(escapeRegExp(key), 'g'), REDACTED);
    }
  });
  return out.replace(KEY_SHAPE, REDACTED);
}
