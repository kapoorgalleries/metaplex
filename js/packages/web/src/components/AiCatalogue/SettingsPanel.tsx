import React from 'react';
import { Button, Input, InputNumber, Radio } from 'antd';

import { AiSettings, ProviderId, ProviderSettings } from '../../ai/types';
import { PROVIDERS, PROVIDER_IDS } from '../../ai/providers';
import { configProblem, isProxyMode } from '../../ai/settings';

/**
 * The configuration form. Fully controlled: it never reads or writes
 * localStorage and holds no state of its own. index.tsx owns persistence, so
 * every edit here emits exactly one onChange carrying a completely rebuilt
 * AiSettings (the nested provider object rebuilt too).
 *
 * The copy below lives in string constants rather than JSX text so that no
 * formatter can silently reflow or re-punctuate it. The key warning in
 * particular is the whole security posture of this feature stated plainly to
 * the person whose key it is.
 */

const KEY_WARNING: string[] = [
  'Your API key is stored in this browser, in plain text.',
  "It is saved in this browser's local storage on this computer. Anything with access to this browser — another person using the machine, a browser extension, or anyone who can read your browser profile — can read it. It is never sent anywhere except directly to the provider from this page, and it is never included in this site's published code.",
  "Recommended: create a key used only for this app, cap its monthly spend in the provider's console, and rotate it if this machine is shared or lost.",
  'Do not put the key in packages/web/.env — that file is committed to git, and Create React App bakes its values into the published bundle. This storefront is deployed to Arweave, which is permanent: a key baked into a build can never be un-published, only rotated.',
];

const PROXY_NOTE =
  'Requests go to your proxy. Leave the key blank if the proxy supplies it — then no key is stored in this browser at all.';

const BASE_URL_HELP =
  'Point this at a proxy you control to keep the key off this machine. Gemini proxy must accept POST {base}/models/{model}:generateContent; OpenAI proxy must accept POST {base}/chat/completions.';

const MODEL_HELP =
  'Free text: any model id the provider accepts. The suggestions are a convenience only — provider catalogues change.';

const IMAGE_HELP =
  'Photographs are downscaled to this longest edge before they are sent. Smaller is cheaper and faster; larger preserves inscription detail.';

const TOKENS_HELP =
  'Ceiling on the response length. A record with a long inscription needs room — too low and the reply is cut off mid-JSON.';

const TIMEOUT_HELP =
  'Milliseconds before a request is abandoned. 120000 is two minutes.';

function copyProvider(p: ProviderSettings): ProviderSettings {
  return { apiKey: p.apiKey, model: p.model, baseUrl: p.baseUrl };
}

/** InputNumber hands back null when the box is cleared. */
function positive(raw: number, fallback: number): number {
  return typeof raw === 'number' && isFinite(raw) && raw > 0
    ? Math.round(raw)
    : fallback;
}

export const SettingsPanel = (props: {
  value: AiSettings;
  onChange: (next: AiSettings) => void;
}) => {
  const value = props.value;
  const activeId = value.activeProvider;
  const provider = PROVIDERS[activeId];
  const cfg = value.providers[activeId];

  const proxyMode = isProxyMode(cfg, provider);
  const problem = configProblem(cfg, provider);
  const datalistId = 'ai-model-suggestions-' + activeId;

  // Nothing to type a key into when a proxy holds it and none is stored.
  const showKeyInput = !(proxyMode && cfg.apiKey === '');
  const anyKeyStored =
    value.providers.gemini.apiKey !== '' ||
    value.providers.openai.apiKey !== '';

  const emit = (patch: {
    activeProvider?: ProviderId;
    gemini?: ProviderSettings;
    openai?: ProviderSettings;
    imageMaxEdgePx?: number;
    maxOutputTokens?: number;
    requestTimeoutMs?: number;
  }) => {
    props.onChange({
      activeProvider:
        patch.activeProvider === undefined
          ? value.activeProvider
          : patch.activeProvider,
      providers: {
        gemini:
          patch.gemini === undefined
            ? copyProvider(value.providers.gemini)
            : patch.gemini,
        openai:
          patch.openai === undefined
            ? copyProvider(value.providers.openai)
            : patch.openai,
      },
      imageMaxEdgePx:
        patch.imageMaxEdgePx === undefined
          ? value.imageMaxEdgePx
          : patch.imageMaxEdgePx,
      maxOutputTokens:
        patch.maxOutputTokens === undefined
          ? value.maxOutputTokens
          : patch.maxOutputTokens,
      requestTimeoutMs:
        patch.requestTimeoutMs === undefined
          ? value.requestTimeoutMs
          : patch.requestTimeoutMs,
    });
  };

  const editActive = (patch: {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  }) => {
    const next: ProviderSettings = {
      apiKey: patch.apiKey === undefined ? cfg.apiKey : patch.apiKey,
      model: patch.model === undefined ? cfg.model : patch.model,
      baseUrl: patch.baseUrl === undefined ? cfg.baseUrl : patch.baseUrl,
    };
    emit(activeId === 'gemini' ? { gemini: next } : { openai: next });
  };

  const clearKeys = () => {
    emit({
      gemini: {
        apiKey: '',
        model: value.providers.gemini.model,
        baseUrl: value.providers.gemini.baseUrl,
      },
      openai: {
        apiKey: '',
        model: value.providers.openai.model,
        baseUrl: value.providers.openai.baseUrl,
      },
    });
  };

  return (
    <div style={{ width: '100%', textAlign: 'left' }}>
      <label className="action-field">
        <span className="field-title">Provider</span>
        <Radio.Group
          value={activeId}
          onChange={e => emit({ activeProvider: e.target.value as ProviderId })}
        >
          {PROVIDER_IDS.map(id => (
            <Radio.Button key={id} value={id}>
              {PROVIDERS[id].label}
            </Radio.Button>
          ))}
        </Radio.Group>
      </label>

      {proxyMode ? (
        <div className="ai-proxy-note">{PROXY_NOTE}</div>
      ) : (
        <div className="ai-key-warning">
          {KEY_WARNING.map((paragraph, i) => (
            <p key={i} style={{ marginBottom: 0 }}>
              {paragraph}
            </p>
          ))}
        </div>
      )}

      <label className="action-field">
        <span className="field-title">Model</span>
        <Input
          className="input"
          list={datalistId}
          placeholder={provider.defaultModel}
          value={cfg.model}
          onChange={info => editActive({ model: info.target.value })}
        />
        <datalist id={datalistId}>
          {provider.modelSuggestions.map(m => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <span className="field-info">{MODEL_HELP}</span>
      </label>

      <label className="action-field">
        <span className="field-title">Base URL</span>
        <Input
          className="input"
          placeholder={provider.defaultBaseUrl}
          value={cfg.baseUrl}
          onChange={info => editActive({ baseUrl: info.target.value })}
        />
        <span className="field-info">{BASE_URL_HELP}</span>
      </label>

      {showKeyInput || anyKeyStored ? (
        <div className="action-field">
          {showKeyInput ? (
            <React.Fragment>
              <span className="field-title">API key</span>
              <Input.Password
                className="input"
                placeholder={
                  proxyMode
                    ? 'Leave blank if the proxy supplies the key'
                    : provider.label + ' API key'
                }
                value={cfg.apiKey}
                onChange={info => editActive({ apiKey: info.target.value })}
              />
              <span className="field-info">
                <a
                  href={provider.keyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Where to get a {provider.label} key
                </a>
              </span>
            </React.Fragment>
          ) : null}
          {anyKeyStored ? (
            <div>
              <Button
                type="link"
                style={{ paddingLeft: 0 }}
                onClick={clearKeys}
              >
                Clear stored keys
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="ai-review-section">
        <span className="ai-review-label">Advanced</span>

        <label className="action-field">
          <span className="field-title">Image max edge (px)</span>
          <InputNumber
            className="royalties-input"
            min={256}
            step={100}
            placeholder="1600"
            value={value.imageMaxEdgePx}
            onChange={(val: number) =>
              emit({ imageMaxEdgePx: positive(val, value.imageMaxEdgePx) })
            }
          />
          <span className="field-info">{IMAGE_HELP}</span>
        </label>

        <label className="action-field">
          <span className="field-title">Max output tokens</span>
          <InputNumber
            className="royalties-input"
            min={1024}
            step={1024}
            placeholder="8192"
            value={value.maxOutputTokens}
            onChange={(val: number) =>
              emit({ maxOutputTokens: positive(val, value.maxOutputTokens) })
            }
          />
          <span className="field-info">{TOKENS_HELP}</span>
        </label>

        <label className="action-field">
          <span className="field-title">Request timeout (ms)</span>
          <InputNumber
            className="royalties-input"
            min={5000}
            step={5000}
            placeholder="120000"
            value={value.requestTimeoutMs}
            onChange={(val: number) =>
              emit({ requestTimeoutMs: positive(val, value.requestTimeoutMs) })
            }
          />
          <span className="field-info">{TIMEOUT_HELP}</span>
        </label>
      </div>

      {problem === '' ? null : (
        <div style={{ color: '#ff7875', fontSize: 13 }}>{problem}</div>
      )}
    </div>
  );
};
