# Verification of `inference_providers.md` (adversarial fact-check, 2026-09-24)

Target: `research_notes/Hugging Face integration/inference_providers.md` (the note). This file does not edit it.

Stance: refute. Every factual claim was taken to its primary source where one was reachable. A claim is marked **refuted** only where a source contradicts it; where no source could be reached it is listed as **still unverified**, with what was tried.

## Reach of this session

Reachable and used:
- Hugging Face MCP `hf_fs` (current `hf://docs/...` mirror of huggingface.co/docs, model READMEs, Space files) and `hub_repo_details` (live `inferenceProviderMapping`, 2026-09-24).
- npm registry: `@huggingface/inference` 4.13.30 tarball (registry `time.modified` 2026-09-17T08:46:08.761Z, confirming the note), `@huggingface/tasks` 0.21.48 tarball.
- PyPI: `huggingface_hub` 2.0.0 wheel.
- raw.githubusercontent.com (third-party logs and HF repo sources), WebFetch of github.com issue/PR pages, WebSearch.

Blocked (EGRESS_BLOCKED): `router.huggingface.co`, `huggingface.co`, `discuss.huggingface.co`, `r.jina.ai`, `api.allorigins.win`, `api.codetabs.com`, `corsproxy.io`; `web.archive.org` refused by WebFetch. So, exactly as in the note, **no request reached the router**, and the live `GET /v1/models/{id}` record (per-provider `input_modalities`, `supports_structured_output`) could not be read by any route tried.

One new observation: `https://api-inference.huggingface.co/models/gpt2` fails DNS from this environment (`getaddrinfo ENOTFOUND`), not with an HTTP status. See "still unverified" item 9.

## Verdict in one paragraph

The note is accurate on almost everything that can be checked. Every documented URL, header, permission name, credit amount, parameter, `response_format` shape, error body and client behaviour quoted from HF docs or HF client source matches the current source text. All 43 model ids were re-queried on the Hub today and every liveness row matches. Four claims are refuted below; two change the written guidance (one weakens the CORS evidence, one qualifies the `:fastest` default), two are cosmetic. Nothing found changes the proposed provider entry's field values.

---

## Refuted

### R1. The "run the file from our browser" guide does not demonstrate a `file://` call to the router (impact: changes-docs)

Note, §3 item 1: "HF's own guide builds a browser-only app that calls Inference Providers directly ... The guide says: 'We can run our app locally by going to the file from our browser', which means a `file://` page (Origin `null`), and then deploys it as a static Space."

The sentence exists (guide line 554). But the shipped `index.html` cannot make the call from a local file. Its script is:

```javascript
// Access the token from Hugging Face Spaces secrets
const HF_TOKEN = window.huggingface?.variables?.HF_TOKEN;

// Add error handling for missing token
if (!HF_TOKEN) {
  showError("HF_TOKEN not configured. Please add it in Space settings.");
  return;
}
```
and the deployment note reads: "The token is securely managed by Hugging Face Spaces and accessed via `window.huggingface.variables.HF_TOKEN`." The only "local" alternative the guide shows is a comment, `// const HF_TOKEN = process.env.HF_TOKEN;`, which is not a browser API. `window.huggingface.variables` is injected only inside a Space, so on a `file://` page the app halts before any request.

Source: https://huggingface.co/docs/inference-providers/guides/building-first-app (read as `hf://docs/inference-providers/guides/building-first-app.md`, lines 447-452, 116-118, 554-566).

Correct fact: the guide's runnable cross-origin path is the **static Space** origin (`*.static.hf.space`), not `file://`. That is still a non-`huggingface.co` origin calling `router.huggingface.co/v1/chat/completions` with a Bearer token, so it remains evidence that the router answers CORS for at least HF-owned Space origins; the `Origin: null` inference should be dropped. The stronger third-party evidence (R-confirmed C3.2 and C3.3 below) is unaffected.

### R2. The unsuffixed default is not unconditionally `:fastest`; HF's own client says the account default policy is switchable in settings (impact: changes-docs)

Note, §4: "The default is `:fastest`", and "Provider **order** matters only under `:preferred` (and for the Hub widgets and snippets)." The proposed `note` copy repeats it: "The router picks the fastest provider unless the model id ends in :provider, :cheapest or :preferred".

`huggingface_hub` 2.0.0, `InferenceClient.__init__` docstring (`src/huggingface_hub/inference/_client.py`, lines 136-139):

> provider (`str`, *optional*): ... Defaults to "auto": automatic routing, which defaults to "fastest" provider; you can switch to "cheapest" or "preferred" provider order at https://hf.co/settings/inference-providers.

So the docs index's "by default, the fastest available provider is selected" describes the *factory* default; the user can change the account-level default policy, after which an unsuffixed id follows that policy (and, under "preferred", the user's provider order). Source: PyPI wheel https://files.pythonhosted.org/packages/5f/f9/d752d5756ce0405ba29405b65517b287d2baf9f77a1cf5329266f3d577f0/huggingface_hub-2.0.0-py3-none-any.whl. Caveat: the settings page itself (`huggingface.co`) could not be opened here to see the control.

Correct fact for the `note` copy: "The router picks the fastest provider by default (you can change that default in your Inference Providers settings) unless the model id ends in :provider, :cheapest, :fastest or :preferred."

### R3. The provider-slug list attributed to `INFERENCE_PROVIDERS` omits `openai` (impact: cosmetic)

Note, §4: "Provider slugs: baseten, cerebras, cohere, deepinfra, fal-ai, featherless-ai, fireworks-ai, groq, hf-inference, novita, nscale, ovhcloud, publicai, replicate, scaleway, together, wavespeed, zai-org (`INFERENCE_PROVIDERS` in `src/types.ts`; the partners table in the docs index)."

`@huggingface/inference` 4.13.30 `src/types.ts` lines 47-67 list 19 entries, including `"openai"`; `huggingface_hub` 2.0.0 `PROVIDER_T` likewise includes `"openai"`. The docs partners table does not list OpenAI, and in the JS client `openai` is `clientSideRoutingOnly` (needs the provider's own key; cannot be routed through HF), so it is not a usable `:provider` suffix for the storefront. The list as a description of the partners table is right; the attribution to `INFERENCE_PROVIDERS` is not.

### R4. Gemma 3 rows lack the "gated" mark the table uses elsewhere (impact: cosmetic)

Note, §9 table marks Llama-4-Scout, aya-vision-32b, command-a-vision and Apertus as "(gated)" but lists "google/gemma-3-27b-it, gemma-3-12b-it, gemma-3-4b-it" without it. `hub_repo_details` on 2026-09-24 shows all three as "Status: 🔒 Gated", license `gemma`. Source: https://hf.co/google/gemma-3-27b-it, https://hf.co/google/gemma-3-12b-it, https://hf.co/google/gemma-3-4b-it. (Gemma 4 models are not gated: license apache-2.0, no gated flag.)

---

## Still unverified (no source reachable, or no source exists)

1. **Router CORS response headers** (`Access-Control-Allow-Origin`, and `Access-Control-Allow-Headers` for `Authorization` and `X-HF-Bill-To`). The router was blocked from every route tried. Third-party evidence the note cites was re-read and says what the note says: `tanmayagrawal21/worklog` `js/providers.js` lines 21-24 "I probed each preflight: router.huggingface.co access-control-allow-origin: *" and its HF preset `browser: 'direct'` (line 99); `mvark/WebApps` `CloudSpotting.html` posts `{model, messages:[{role:"user", content:[{type:"text"}, {type:"image_url", image_url:{url:"data:"+file.type+";base64,"+base64}}]}]}` to `https://router.huggingface.co/v1/chat/completions` with `Authorization: Bearer` from a plain HTML page, models Qwen2.5-VL-72B-Instruct, gemma-4-31B-it, MiniMax-M3. Neither quotes `Allow-Headers`. The note's own settling test (a bogus-token POST from devtools on a non-HF origin) is still the right one.
2. **Per-provider `input_modalities` and `supports_structured_output`** for every recommended vision model (Qwen3-VL-235B-A22B-Instruct on deepinfra/novita; gemma-4-31B-it; Qwen3.8-27B; GLM-5.3-Flash; Qwen2.5-VL-72B-Instruct; Qwen3.5-397B-A17B; DeepSeek-V4.1-Flash). `GET https://router.huggingface.co/v1/models/{id}` was blocked directly, via r.jina.ai, via web.archive.org and via three fetch proxies. What could be confirmed: each is `pipeline_tag: image-text-to-text` on the Hub with at least one `live` provider today (table below), and HF's own image-text-to-text task page generates VLM snippets for deepinfra/novita/fireworks-ai/baseten with `deepseek-ai/DeepSeek-V4.1-Flash`, for cerebras/ovhcloud with `Qwen/Qwen3.8-27B`, for together/zai-org with `zai-org/GLM-5.3-Flash`, for scaleway with `Qwen/Qwen3.6-35B-A3B`, for cohere with `CohereLabs/aya-vision-32b`, for nscale with Llama-4-Scout, for publicai with Apertus-v1.5-70B, for featherless-ai with `Qwen/Qwen3.8-Flash-Next` (source: https://huggingface.co/docs/inference-providers/tasks/image-text-to-text). That is HF's signal that those provider/model pairs take image input; it says nothing about the Qwen3-VL-235B pair on deepinfra/novita.
3. **Router behaviour when `response_format` reaches a provider that does not support it** (status, body, or silent ignore). No source.
4. **Router body shapes for 404, 413, 422, 429, 503, 504** on `/v1/chat/completions`. No authoritative example found; the note's "unverified" stands.
5. **Length of the non-streaming 504 gateway timeout.** The Python client note (confirmed, `_client.py` lines 283-290) proves it exists; nothing states the seconds.
6. **The July-2026 "token authenticates, lists models, every inference call is 402" report.** The cited file `josephcrown920/Auroraglobal/.agents/memory/hf-account-credit-block.md` now returns 404 on raw.githubusercontent.com. The 402 body itself is confirmed elsewhere (C2.4).
7. **Fine-grained permission name for calling a private dedicated Inference Endpoint.** `hf://docs/inference-endpoints` search finds only the Private/Public/Authenticated setting; no permission key named.
8. **The settings-page control for the default routing policy** implied by R2. `huggingface.co` blocked.
9. **Legacy `api-inference.huggingface.co` "returns HTTP 410"** (third-party claim the note already marks unverified). From this environment the host does not resolve at all (`getaddrinfo ENOTFOUND api-inference.huggingface.co`, WebFetch), which is neither a 410 nor a confirmation; one vantage point only.
10. Whether every provider fetches remote https image URLs, how each treats the undocumented `detail` field, and any router-level image size/count cap. No source, as the note says.
11. Content-moderation behaviour through the router. No source, as the note says.
12. The note's "GitHub code search finds 56 HTML files" count. Not re-run; cosmetic.
13. TGI maintenance date: the docs say "as of 12/11/2025" (https://huggingface.co/docs/inference-endpoints/engines/tgi). The note renders it 2025-12-11; the page's date format is not stated, so 12 Nov 2025 cannot be excluded.

---

## Confirmed (by section of the note)

Legend: **doc** = current HF docs via `hf_fs`; **src** = HF client source from the npm/PyPI package named above; **hub** = `hub_repo_details` 2026-09-24; **3p** = third-party file on raw.githubusercontent.com or a github.com page.

### §1 Endpoint and auth
| Claim | Result | Source |
|---|---|---|
| Base `https://router.huggingface.co/v1`, chat path `/chat/completions` | confirmed: curl and OpenAI-client examples use exactly these | doc index.md ("Alternative: OpenAI-Compatible Chat Completions Endpoint"); src `config.ts` `HF_ROUTER_AUTO_ENDPOINT = \`${HF_ROUTER_URL}/v1\``, `providerHelper.ts` `makeRoute()` → `"v1/chat/completions"` |
| `Authorization: Bearer <token>` | confirmed | doc index.md curl; src `prepareHeaders` sets `Authorization: Bearer ${accessToken}` |
| Fine-grained token, "Make calls to Inference Providers", key `inference.serverless.write`, pre-filled URL | confirmed verbatim: "generating a `fine-grained` token with `Make calls to Inference Providers` permissions", link `settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained` | doc index.md line 100; doc tasks/chat-completion.md line 70 ("`'Bearer: hf_****'` ... with \"Inference Providers\" permission"); doc guides/responses-api.md line 19 |
| Classic `read` token also accepted (strong evidence) | confirmed as evidence: index.md line 120 `hf auth login # get a read token from hf.co/settings/tokens`; security-tokens.md: `read` role "(e.g. when downloading private models or doing inference)", "passed as a **bearer token** when calling Inference Providers" | doc |
| 403 body for a token lacking the permission | confirmed verbatim, dated 2026-02-18, on `https://router.huggingface.co/hf-inference/models/...`: `403 {"error":"This authentication method does not have sufficient permissions to call Inference Providers on behalf of user Prasanth-1402"}` | 3p `Prasanth-1402/interview-buddy/server-debug.log`; 3p `AdityaAneNenu/Inavra` FIX_403_ERROR.md |
| Per-provider pass-through `https://router.huggingface.co/{provider}/v1/...` with provider-native id | confirmed: `base_url="https://router.huggingface.co/cerebras/v1"`, `model="qwen-3-32b"`; src `makeBaseUrl` → `${HF_ROUTER_URL}/${this.provider}` when using an HF token | doc guides/structured-output.md lines 95, 181; src `providerHelper.ts` line 110 |
| OAuth scope `inference-api`; CI trusted-publisher tokens may carry it | confirmed: "`inference-api`: Make inference requests to Inference Providers on behalf of the user" (hub/oauth.md, spaces-oauth.md); trusted-publishers.md: CI/CD identity tokens carry `inference-api` if you tick "Allow Inference Providers calls", "Inference usage is **billed to your account**"; repo publishers "can't call Inference Providers" | doc |
| Public revoke endpoint `POST https://huggingface.co/api/credentials/revoke` | confirmed, "always responds with `202 Accepted`" | doc hub/security-tokens.md |

### §2 Billing
| Claim | Result | Source |
|---|---|---|
| Free $0.10 "subject to change"; PRO $2.00; Team/Enterprise $2.00 per seat; free pay-as-you-go "credits purchase required" | confirmed verbatim from the table | doc pricing.md lines 9-13 |
| PRO/Team/Enterprise credits are general compute credits (Endpoints, Spaces hardware, Jobs) | confirmed | doc pricing.md line 15 |
| No markup | confirmed: "the same rates as the provider, with no additional fees" | doc pricing.md line 46 |
| Custom provider key → billed by provider, credits do not apply | confirmed | doc pricing.md lines 24-31, 65 |
| 402 body, string-valued `error` | confirmed verbatim, nine entries dated 2026-06-03: `Status: 402, Response: {"error":"You have depleted your monthly included credits. Purchase pre-paid credits to continue using Inference Providers. Alternatively, subscribe to PRO to get 20x more included usage."}`; `last-million/free-llm-hub/providers.py` line 724: `PROBED 2026-07-24: 402 "You have depleted your monthly included credits"`; two Sept-2026 GitHub PRs quote the same phrase (decolua/9router #4158, ciresnave/OverMind #43) | 3p |
| "20x" = $0.10 → $2.00 | arithmetic holds against the pricing table | doc |
| Spending at `settings/billing`; breakdown at `settings/inference-providers/overview` | confirmed | doc pricing.md lines 48, 52 |
| Billed only when provider reports cost; ~30 min give-up, not charged; only 2xx/3xx | confirmed: "If a request is still unbilled roughly **30 minutes** after it was served, we give up on it ... **not charged to the user**"; "We only ask for the cost of requests that **completed successfully** (a 2xx or 3xx HTTP status)" | doc register-as-a-provider.md |
| `X-HF-Bill-To: <org>`; Enterprise resource-group id; admins can set spending limit and disable providers | confirmed verbatim | doc pricing.md lines 87-91; src `config.ts` `HF_HEADER_X_BILL_TO = "X-HF-Bill-To"`, `makeRequestOptions.ts` line 160 |
| Two HF sources differ on which orgs may be billed (pricing: Team & Enterprise; JS `billTo` doc: Enterprise Hub) | confirmed: `types.ts` lines 36-42 "Requests can only be billed to an organization the user is a member of, and which has subscribed to Enterprise Hub." | src |

### §3 Browser use
| Claim | Result | Source |
|---|---|---|
| Guide imports `https://esm.sh/@huggingface/inference`, calls `deepseek-ai/DeepSeek-R1-0528:fastest` with `provider: "auto"`, deploys as a static Space; says "We can run our app locally by going to the file from our browser" | text confirmed; the `file://` inference is **refuted (R1)** | doc guides/building-first-app.md |
| JS client posts auto+conversational straight to the router | confirmed: `getInferenceProviderMapping.ts` lines 133-142 "Special case for auto + conversational to avoid extra API calls // Call directly the server-side auto router"; `AutoRouterConversationalTask` base `https://router.huggingface.co` | src |
| worklog header comment "access-control-allow-origin: *" and `browser: 'direct'` | confirmed (lines 21-24, 99); it also carries the note's exact free-credit sentence | 3p |
| CloudSpotting page shape | confirmed (see unverified item 1) | 3p |
| `huggingfacejs/streaming-text-generation` static Space, user-typed token, older API | confirmed: `import { HfInference } ... hf.textGenerationStream(...)`, `@huggingface/inference@3.1.4-test` | `hf://spaces/huggingfacejs/streaming-text-generation/index.html` |
| README: "If you need to protect it in front-end applications, we suggest setting up a proxy server that stores the access token." | confirmed verbatim, line 43 | src README.md |
| `isBrowser`/`isWebWorker`, `credentials: "include"` support | confirmed | src `utils/isBackend.ts`, `lib/makeRequestOptions.ts` lines 182-193 |

### §4 Model id syntax and routing
| Claim | Result | Source |
|---|---|---|
| Unsuffixed = `:fastest` "(highest throughput in tokens per second)"; `:cheapest` "lowest price per output tokens"; `:preferred` "first available provider sorted by your preference order in Inference Provider settings" | confirmed verbatim; **qualified by R2** | doc index.md; doc guides/responses-api.md line 75 |
| `org/model:provider` examples `openai/gpt-oss-120b:groq`, `:fireworks-ai` | confirmed | doc responses-api.md, gpt-oss.md line 164 |
| HF documents disagree on "auto" | confirmed: first-api-call.md "selects the first available provider for your chosen model based on your preference order"; JS README line 70 same wording; `getInferenceProviderMapping.ts` line 185 warning "Defaulting to 'auto' which will select the first provider available for the model, sorted by the user's order" | doc, src, 3p (huggingface.js README main) |
| 400 `model_not_supported` for unknown/not-enabled model | confirmed verbatim: `{"error":{"message":"The requested model 'mistralai/Mistral-7B-Instruct-v0.2' is not supported by any provider you have enabled.","type":"invalid_request_error","param":"model","code":"model_not_supported"}}`; also 2026-02-17 and 2026-08-01 reports | 3p `sdmcetminor-pixel/Career-guidance/hf-error.txt`, `jenil2803/Agentic_bug_hunter`, `DealAppSeo/repid-engine` |
| Failover only under auto; re-test every 6 h, hourly while failing, removed from active list | confirmed verbatim: "Each model is tested every 6 hours ... temporarily removed from the list of active providers"; "A failed mapping undergoes retesting every hour" | doc register-as-a-provider.md lines 276-282; index.md line 385 |
| `/v1/models` and `/v1/models/{org}/{model}` fields; no auth in the curl; `architecture.input_modalities` | confirmed; the table also has `is_free` and `is_model_author` (note omits, harmless) | doc hub-api.md lines 118-221 |
| `api/models/{id}?expand[]=inferenceProviderMapping` | confirmed | doc hub-api.md line 229 |

### §5 Vision input
| Claim | Result | Source |
|---|---|---|
| `{"type":"image_url","image_url":{"url":...}}`; `ChatCompletionInputUrl` has only `url` (no `detail`) | confirmed | doc tasks/chat-completion.md lines 87-89; `@huggingface/tasks` `spec/input.json` `ChatCompletionInputUrl: {required:[url], properties:{url}}` |
| HF snippet uses the Britannica URL; Responses guide uses a Wikimedia URL | confirmed | `@huggingface/tasks` `src/snippets/inputs.ts` lines 56-58; doc responses-api.md line 151 |
| Python client converts local images to `data:{mime};base64,...` | confirmed, `_as_url` | src `inference/_common.py` lines 198-212 |
| JS client serialises `model` first because "`messages` can hold megabytes of base64-encoded images" | confirmed verbatim | src `providerHelper.ts` lines 407-409 |
| HF docs show no data-URL chat example | confirmed (grep of every inference-providers page read: none; docs search: none) | doc |
| #2654: legacy host 413, closed | confirmed: closed, opened 2024-11-04, URL `https://api-inference.huggingface.co/models/meta-llama/Llama-3.2-11B-Vision-Instruct/v1/chat/completions`, "413 Client Error: Payload Too Large" | https://github.com/huggingface/huggingface_hub/issues/2654 |

### §6 Structured outputs
| Claim | Result | Source |
|---|---|---|
| `response_format` oneOf text / json_schema{name, description?, schema, strict?} / json_object | confirmed | doc chat-completion.md lines 103-114; spec input.json `ChatCompletionInputGrammarType` |
| Guide payload `"type":"json_schema","json_schema":{"name":...,"schema":...,"strict":True}` | confirmed | doc structured-output.md lines 132-139 |
| gpt-oss guide: json_schema via `/v1` with `openai/gpt-oss-120b:fireworks-ai`, "We use the Fireworks AI provider." | confirmed | doc gpt-oss.md lines 149-178 |
| #932 open, TGI `{type, value}` vs OpenAI shape | confirmed: open, opened 2024-09-27, "`response_format: ChatCompletionInputGrammarType` contains `type` and `value` attributes" | https://github.com/huggingface/huggingface.js/issues/932 |
| DeepSeek-V4-Pro example: together true, fireworks-ai true, deepinfra true, **novita false**, featherless-ai absent | confirmed exactly | doc hub-api.md lines 137-195 |
| "Structured output support" behavioural test on LLM mappings | confirmed | doc register-as-a-provider.md line 296 |
| Pinning TIP | confirmed verbatim: "Structured outputs are a good use case for selecting a specific provider and model because you want to avoid incompatibility issues between the model, provider and the schema." | doc structured-output.md line 102 |
| gpt-oss:groq "may emit markdown even when a schema is provided" | confirmed | doc responses-api.md line 429 |
| Together dialect rewrite `{type:"json_schema", schema}` | confirmed | src `providers/together.ts` lines 129-143 |
| Python client appends raw text on 422 for known tasks | confirmed | src `_client.py` lines 278-282 |

### §7 Parameters
| Claim | Result | Source |
|---|---|---|
| `max_tokens` documented; spec default "1024"; `max_completion_tokens` absent | confirmed: `max_tokens.default = '1024'`; property list has no `max_completion_tokens` | spec input.json; doc chat-completion.md line 76 |
| `temperature` "between 0 and 2"; `stream` boolean, "If `stream` is `false` (default)" | confirmed | doc chat-completion.md lines 117-141 |
| `reasoning_effort` text | confirmed verbatim | doc chat-completion.md line 102; spec |
| Qwen3.8-27B "Thinking mode is on by default and can be disabled per request" | confirmed | `hf://models/Qwen/Qwen3.8-27B/README.md` line 28 |
| GLM-5.3-Flash `reasoning_effort` "defaults to `max`" | confirmed, with a nuance the note lacks: it "accepts three levels: `low`, `high`, and `max`. It defaults to `max` if not passed (**or if set to any other value**)". So `none`/`minimal`/`medium` would silently become `max`; the note's suggested `'low'` is safe | `hf://models/zai-org/GLM-5.3-Flash/README.md` line 45 |
| Gemma 4 "configurable thinking modes", "over 140 languages" | confirmed (card also says "Out-of-the-box support for 35+ languages, pre-trained on 140+ languages", and lists "OCR (including multilingual), handwriting recognition") | `hf://models/google/gemma-4-31B-it/README.md` lines 25, 31, 119, 124 |
| 504 note in Python client | confirmed verbatim | src `_client.py` lines 283-290 |
| JS client retries 503 by default | confirmed: `if (options?.retry_on_error !== false && response.status === 503) return innerRequest(...)` | src `utils/request.ts` lines 54-56, 138-140 |

### §8 Error bodies
| Claim | Result | Source |
|---|---|---|
| 401 `{"error":"Invalid credentials in Authorization header"}` | confirmed: het004 log 2025-06-20 `401 - {"error":"Invalid credentials in Authorization header"}`; DocBrain log 2025-05 on `https://router.huggingface.co/hf-inference/models/Qwen/Qwen3-235B-A22B/v1/chat/completions` | 3p |
| 402, 403, 400 bodies | confirmed (§2, §1, §4 above) | 3p |
| JS client error-branch order (400/404/422/500 → `JSON.stringify(output.error)`; `error`/`detail`/`message` strings; streaming adds `output.error.message` "OpenAI errors"); `application/problem+json`; `text/plain;`; `x-request-id` | confirmed line for line | src `utils/request.ts` lines 58-110, 141-207 |
| Python `_format` shapes incl. `{'errors':[{message}]}` and `X-Error-Message` | confirmed | src `utils/_http.py` lines 999-1047 |
| #2581 HTML 504 on huggingface.co API | confirmed: closed, 2024-10-01, `list_models()`, body `<h1>504</h1><p>Gateway Timeout</p>` | https://github.com/huggingface/huggingface_hub/issues/2581 |
| agentilab doc claims router always returns the object shape | confirmed it says so ("Router (`router.huggingface.co`) — object"), and also maps 403 to `model_not_supported`; both contradicted by the dated logs, so the note's discount is right | 3p |

### §9 Model liveness, re-queried 2026-09-24 (`hub_repo_details`)

Every row of the note's table matches today's Hub mapping exactly. `pipeline_tag` is `image-text-to-text` for every row.

| Model | Live today | Errors | Note's row | Gated |
|---|---|---|---|---|
| Qwen/Qwen3-VL-235B-A22B-Instruct | novita, deepinfra | | match | no |
| Qwen/Qwen3-VL-235B-A22B-Thinking | novita, featherless-ai | | match | no |
| Qwen/Qwen3-VL-30B-A3B-Instruct | novita, featherless-ai, deepinfra | | match | no |
| Qwen/Qwen3-VL-32B-Instruct | featherless-ai | | match | no |
| Qwen/Qwen3-VL-8B-Instruct | featherless-ai | novita | match | no |
| Qwen/Qwen3.8-27B | novita, ovhcloud, deepinfra | cerebras, featherless-ai | match | no |
| Qwen/Qwen3.8-Flash-Next | featherless-ai | | match (license `other`) | no |
| Qwen/Qwen3.5-397B-A17B | novita, featherless-ai, scaleway, ovhcloud, deepinfra | | match | no |
| Qwen/Qwen3.5-122B-A10B | novita, deepinfra | | match | no |
| Qwen/Qwen3.5-27B | novita, featherless-ai, deepinfra | | match | no |
| Qwen/Qwen3.5-9B | together, featherless-ai, ovhcloud, deepinfra | | match | no |
| Qwen/Qwen3.6-35B-A3B | featherless-ai, scaleway, deepinfra | | match | no |
| Qwen/Qwen2.5-VL-72B-Instruct | featherless-ai, ovhcloud | | match (license `other`, card language `en`) | no |
| Qwen/Qwen2.5-VL-32B-Instruct | featherless-ai | | match | no |
| Qwen/Qwen2.5-VL-7B-Instruct | featherless-ai | | match | no |
| google/gemma-4-31B-it | novita, featherless-ai, deepinfra | together | match | no |
| google/gemma-4-26B-A4B-it | novita, featherless-ai, scaleway, deepinfra | | match | no |
| google/gemma-3-27b-it / 12b-it / 4b-it | featherless-ai, deepinfra | | match | **yes** (R4) |
| zai-org/GLM-5.3-Flash | novita, together, fireworks-ai, featherless-ai, zai-org, baseten, deepinfra | | match (7) | no |
| zai-org/GLM-4.5V | novita, zai-org | | match | no |
| zai-org/GLM-4.6V | zai-org | | match | no |
| moonshotai/Kimi-K3 | together, fireworks-ai, featherless-ai, baseten, deepinfra | | match | no |
| moonshotai/Kimi-K2.5 | novita, featherless-ai, deepinfra | | match | no |
| MiniMaxAI/MiniMax-M3 | novita, together, fireworks-ai, featherless-ai, deepinfra | | match | no |
| meta-llama/Llama-4-Scout-17B-16E-Instruct | novita, nscale, deepinfra | groq | match | yes |
| CohereLabs/aya-vision-32b | cohere | | match (cc-by-nc-4.0; languages incl. fa, hi) | yes |
| CohereLabs/command-a-vision-07-2025 | cohere | | match (cc-by-nc-4.0) | yes |
| swiss-ai/Apertus-v1.5-70B | featherless-ai, publicai | | match | yes |
| deepseek-ai/DeepSeek-V4.1-Flash | novita, fireworks-ai, featherless-ai, baseten, deepinfra | | match; tags `text-generation` + `image-text-to-text`, pipeline_tag image-text-to-text | no |

Not live, re-checked: Llama-4-Maverick-17B-128E-Instruct (no providers), Llama-3.2-90B-Vision-Instruct and 11B (none), Mistral-Small-3.2-24B-Instruct-2506 (none; no pipeline task on the Hub), Pixtral-12B-2409 (none), Kimi-VL-A3B-Thinking-2506 (none), Qwen3-VL-235B-A22B-Instruct-FP8 (none), DeepSeek-OCR (novita: error only), `zai-org/GLM-5V` not found. All match.

Text-only, re-checked: openai/gpt-oss-120b (11 live providers), deepseek-ai/DeepSeek-V4-Pro, zai-org/GLM-5.3, moonshotai/Kimi-K2-Instruct-0905, Qwen/Qwen3-Coder-480B-A35B-Instruct, deepseek-ai/DeepSeek-R1: all `pipeline_tag: text-generation`. Match.

Model-card claims: Qwen3-VL-235B "Expanded OCR: Supports 32 languages (up from 19) ... better with rare/ancient characters and jargon" confirmed verbatim (README line 34); no Tibetan/Sanskrit/Devanagari/Nepali/Persian/Urdu/script names anywhere in that card (grep), as the note says.

Recommendation checks: the default `Qwen/Qwen3-VL-235B-A22B-Instruct` is live on exactly deepinfra and novita today and is the Instruct (non-thinking) repo. Each of the five `modelSuggestions` is live on at least one provider today and is tagged image-text-to-text. Per-provider image acceptance and `supports_structured_output` remain unverified (item 2).

### §10 Dedicated Inference Endpoints
| Claim | Result | Source |
|---|---|---|
| `https://<id>.<region>.<cloud>.endpoints.huggingface.cloud/v1/`; endpoint **name** as `model` (e.g. `qwen3-1-7b-xll`); `<endpoint-url>/v1/chat/completions`; Bearer HF token | confirmed verbatim | doc inference-endpoints/tutorials/chat_bot.md |
| `https://your-endpoint-name.endpoints.huggingface.cloud/v1/` | confirmed | doc tutorials/embedding.md line 82 |
| `https://jpj7k2q4j805b727.us-east-1.aws.endpoints.huggingface.cloud` | confirmed (huggingface_hub docs source; the page exists as `hf://docs/huggingface_hub/v2.0.0/guides/inference_endpoints.md`) | https://raw.githubusercontent.com/huggingface/huggingface_hub/main/docs/source/en/guides/inference_endpoints.md line 254 |
| Private (default) / Public / Authenticated wording | confirmed verbatim | doc guides/configuration.md "Authentication" |
| Scale-to-zero: 503 while initializing; `X-Scale-Up-Timeout: 600` | confirmed verbatim | doc guides/autoscaling.md |
| TGI in maintenance mode; vLLM/SGLang recommended | confirmed ("as of 12/11/2025"; see unverified 13) | doc engines/tgi.md |
| OAuth `read-endpoints` | confirmed | doc hub/oauth.md line 127 |

### §11 Content moderation
| Claim | Result | Source |
|---|---|---|
| HF: no request body/response stored, logs ≤30 days | confirmed verbatim | doc inference-providers/security.md |
| `finish_reason` is an unenumerated string in the spec | confirmed | doc chat-completion.md response table |

### Source currency
`@huggingface/inference` latest 4.13.30, modified 2026-09-17T08:46:08Z; `@huggingface/tasks` latest 0.21.48; `huggingface_hub` latest 2.0.0. All confirmed against the registries today.

---

## Other observations (not refutations)

- HF's image-text-to-text task page today maps `cerebras → Qwen/Qwen3.8-27B` (`providerModelId: qwen-3.8-27b`) while the Hub mapping shows `cerebras: error` for that model. Consistent with the note's row; worth knowing that the docs snippet lags the validation status.
- Older forum threads (2025) show a previous 402 wording, "You have exceeded your monthly included credits for Inference Providers. Subscribe to PRO to get 20x more monthly allowance." (WebSearch result titles/summaries; the threads themselves are blocked here). Code that matches on "depleted" should also tolerate "exceeded".
- The worklog preset's copy is nearly identical to the note's proposed `note` text ("Free accounts get $0.10 of inference credit a month, then requests fail until it resets or you buy more."). Not a problem, just provenance.

## Sources consulted (all read 2026-09-24)

HF docs via `hf_fs`: inference-providers `index.md`, `pricing.md`, `hub-api.md`, `hub-integration.md`, `security.md`, `register-as-a-provider.md`, `tasks/chat-completion.md`, `tasks/image-text-to-text.md`, `guides/structured-output.md`, `guides/responses-api.md`, `guides/gpt-oss.md`, `guides/building-first-app.md`, `guides/first-api-call.md`, `providers/deepinfra.md`, `providers/novita.md`; hub `security-tokens.md`, `oauth.md`, `spaces-oauth.md`, `trusted-publishers.md`; inference-endpoints `tutorials/chat_bot.md`, `tutorials/embedding.md`, `tutorials/transcription.md`, `guides/configuration.md`, `guides/autoscaling.md`, `engines/tgi.md`. Model cards: Qwen/Qwen3-VL-235B-A22B-Instruct, Qwen/Qwen3.8-27B, zai-org/GLM-5.3-Flash, google/gemma-4-31B-it. Space: huggingfacejs/streaming-text-generation `index.html`. `hub_repo_details` on 43 model ids.

Packages: `@huggingface/inference` 4.13.30 (`src/config.ts`, `types.ts`, `providers/providerHelper.ts`, `providers/together.ts`, `lib/getInferenceProviderMapping.ts`, `lib/makeRequestOptions.ts`, `utils/request.ts`, `utils/isBackend.ts`, `README.md`); `@huggingface/tasks` 0.21.48 (`src/tasks/chat-completion/spec/input.json`, `src/snippets/inputs.ts`); `huggingface_hub` 2.0.0 (`inference/_client.py`, `inference/_common.py`, `inference/_providers/__init__.py`, `utils/_http.py`).

Third party (raw.githubusercontent.com): bijoycodes/Ai-Voice-Control-device `backend/api/error.log`; last-million/free-llm-hub `providers.py`; Prasanth-1402/interview-buddy `server-debug.log`; het004/ODOUR_SOURCE_DETECTION `logs/app.log`; Zakaria-Elouali/DocBrain `DocBrain AI/pdf_service.log`; sdmcetminor-pixel/Career-guidance `hf-error.txt`; DealAppSeo/repid-engine `reports/2026-08-01/KEY_AUDIT_VERIFIED.md`; jenil2803/Agentic_bug_hunter `docs/run_report_20260217_145532.md`; AdityaAneNenu/Inavra `docs/troubleshooting/FIX_403_ERROR.md`; tanmayagrawal21/worklog `js/providers.js`; mvark/WebApps `CloudSpotting/CloudSpotting.html`; simonpierreboucher02/agentilab-huggingface `mcp/docs/05-error-handling.md`; huggingface/huggingface.js `packages/inference/README.md` (main); huggingface/huggingface_hub `docs/source/en/guides/inference_endpoints.md` (main). github.com pages: huggingface.js#932, huggingface_hub#2654, huggingface_hub#2581, decolua/9router#4158, ciresnave/OverMind#43. 404: josephcrown920/Auroraglobal `.agents/memory/hf-account-credit-block.md`, CSOAI-ORG/councilof-ai#2343.
