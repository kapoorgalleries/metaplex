# Hugging Face Inference Providers as a storefront cataloguing provider (as of 2026-09-24)

> Historical research, not setup instructions. Read this alongside `verification_inference_providers.md`; the implemented behavior and current restrictions are in `docs/hugging-face.md` at the repository root. Recommendations below may have been superseded.

Purpose: establish, with sources, every fact needed to add Hugging Face Inference Providers (the OpenAI-compatible "router") as a seventh entry in `js/packages/web/src/ai/providers.ts`, built by the existing `openAiCompatible` factory.

Confidence labels used below:
- **confirmed**: stated by a current Hugging Face primary source (docs read 2026-09-24 through the Hugging Face MCP `hf_fs` connector, or HF's own published client source).
- **strong evidence**: not stated by HF docs, but shown by HF's own client code, by HF-owned examples, or by several independent, dated, real-world observations.
- **unverified**: no primary source found. The note says what would settle it.

Source currency:
- HF docs were read via `hf://docs/...` (the MCP mirror of `https://huggingface.co/docs/...`) on 2026-09-24. The pages carry no "last updated" stamp. They mention 2026 models (DeepSeek-V4-Pro, GLM-5.3, Qwen3.8), so they are current to at least mid-2026.
- `@huggingface/inference` **4.13.30**. npm `time.modified` is 2026-09-17T08:46:08Z ([npm registry](https://registry.npmjs.org/@huggingface/inference)). The source was read from the npm tarball.
- `@huggingface/tasks` **0.21.48** (npm tarball) and `huggingface_hub` **2.0.0** (PyPI wheel).
- Model inference status comes from the Hugging Face MCP `hub_repo_details` tool, queried 2026-09-24. It returns each model's `inferenceProviderMapping` with a `live` or `error` status per provider.

Hard limit of this session: `router.huggingface.co`, `huggingface.co` and `discuss.huggingface.co` were blocked from both the shell and WebFetch. **No request was sent to the router.** In particular, the live `GET https://router.huggingface.co/v1/models` catalogue was not read. That catalogue carries per-provider `input_modalities` and `supports_structured_output`. Every point that depends on it is marked unverified, with the exact call that would settle it.

Relayed user request: the harness relayed the user text "for both claude and cable". No referent for it was identified within this research task, so nothing here depends on it.

---

## 1. Endpoint and auth

**Answer**
- Base URL: `https://router.huggingface.co/v1`. The chat path is `/chat/completions`, so the full URL is `https://router.huggingface.co/v1/chat/completions`. This matches the factory default `completionsPath`. **Confirmed.**
- Auth header: `Authorization: Bearer <HF token>`. **Confirmed.**
- Token type: a **fine-grained** User Access Token with the **"Make calls to Inference Providers"** permission. The internal permission key visible in the pre-filled URL is `inference.serverless.write`. **Confirmed.**
- Where to create it: `https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained` (pre-filled). The general token page is `https://huggingface.co/settings/tokens`. **Confirmed.**
- A classic `read` token also appears to be accepted for inference. The docs' Python quickstart says `hf auth login # get a read token`, and the token docs list "doing inference" under the `read` role. **Strong evidence.** A fine-grained token scoped only to inference is still the right recommendation: a leaked `read` or `write` token exposes repositories, while an inference-only token exposes only billable inference.
- A token without the permission gets HTTP 403 with body `{"error":"This authentication method does not have sufficient permissions to call Inference Providers on behalf of user <name>"}` (see section 8). **Strong evidence.**
- Per-provider pass-through routes also exist: `https://router.huggingface.co/{provider}/v1/chat/completions`. The structured-output guide uses `https://router.huggingface.co/cerebras/v1` with the provider-native model id `qwen-3-32b`, not the HF id. These routes take the provider's own model id and bypass server-side provider selection. **Confirmed.**
- Other auth routes, not relevant to a pasted token:
  - OAuth scope `inference-api` ("Make inference requests to Inference Providers on behalf of the user"), usable in any website, not only Spaces. **Confirmed.**
  - CI trusted-publisher tokens can carry `inference-api`. **Confirmed.**

**Sources**
- https://huggingface.co/docs/inference-providers/index ("Authentication": "generating a `fine-grained` token with `Make calls to Inference Providers` permissions"; code samples with `base_url="https://router.huggingface.co/v1"` and `API_URL = "https://router.huggingface.co/v1/chat/completions"`, `Authorization: Bearer ...`)
- https://huggingface.co/docs/inference-providers/tasks/chat-completion (request header table: "Authentication header in the form `'Bearer: hf_****'` when `hf_****` is a personal user access token with "Inference Providers" permission", link `settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained`)
- https://huggingface.co/docs/inference-providers/guides/responses-api ("A fine-grained Hugging Face token with “Make calls to Inference Providers” permission")
- https://huggingface.co/docs/hub/security-tokens (roles; "passed as a bearer token when calling Inference Providers")
- https://huggingface.co/docs/inference-providers/guides/structured-output (per-provider base URL `https://router.huggingface.co/cerebras/v1`)
- https://huggingface.co/docs/hub/spaces-oauth and https://huggingface.co/docs/hub/oauth (`inference-api` scope)
- `@huggingface/inference` 4.13.30 `src/config.ts`: `HF_ROUTER_URL = "https://router.huggingface.co"`, `HF_ROUTER_AUTO_ENDPOINT = \`${HF_ROUTER_URL}/v1\``; `src/providers/providerHelper.ts`: `BaseConversationalTask.makeRoute()` returns `"v1/chat/completions"`, `prepareHeaders` sets `Authorization: Bearer ${accessToken}`

---

## 2. Billing

**Answer**
- Monthly included credits. **Confirmed** from the pricing table:

  | Account | Monthly credits | Can be spent on | Pay-as-you-go |
  |---|---|---|---|
  | Free | **$0.10, "subject to change"** | Inference Providers | yes, "credits purchase required" |
  | PRO | **$2.00** | all HF compute services | yes |
  | Team/Enterprise org | **$2.00 per seat** (shared among members) | all HF compute services | yes |

- PRO, Team and Enterprise credits are general compute credits: they also pay for Inference Endpoints, Spaces hardware and Jobs. **Confirmed.**
- HF adds no markup: "same rates as the provider". **Confirmed.**
- If you store your own provider key in HF settings, the provider bills you directly and HF credits do not apply. **Confirmed.**
- When credits run out, the router answers **HTTP 402** with this body. The body is a **string-valued `error`, not an object**:
  ```json
  {"error":"You have depleted your monthly included credits. Purchase pre-paid credits to continue using Inference Providers. Alternatively, subscribe to PRO to get 20x more included usage."}
  ```
  **Strong evidence**: several independent, dated 2026 logs show the same text. HF docs do not document the status or the body.
  - The "20x" matches $0.10 → $2.00.
  - One report (July 2026) describes an account whose token authenticates and can list models, but where *every* inference call returns this 402. A dealer on a free account will therefore see the storefront fail on the first run of any month in which the $0.10 is already spent.
- Pay-as-you-go: "All users can continue using the API after exhausting their monthly credits by purchasing additional credits." For free accounts the table says "credits purchase required". Spending is tracked at `https://huggingface.co/settings/billing`, with a per-model and per-provider breakdown at `https://huggingface.co/settings/inference-providers/overview`. **Confirmed.**
- A single request is not billed until the provider reports its cost. A request whose cost never arrives within about 30 minutes is not charged. Only 2xx and 3xx requests are billed. **Confirmed** (provider-side billing contract).
- **Billing to an org**: yes, with the header `X-HF-Bill-To: <org-name>`. Enterprise orgs can instead pass a resource-group id.
  - The pricing page says Team & Enterprise orgs. The huggingface.js `billTo` doc says "an organization the user is a member of, and which has subscribed to Enterprise Hub". The two HF sources differ; the pricing page is the more specific.
  - Org admins can set a spending limit and disable providers.
  - **Confirmed.** Whether the router's CORS preflight allows the custom `X-HF-Bill-To` header from a browser is **unverified** (see section 3).

**Sources**
- https://huggingface.co/docs/inference-providers/pricing (table "Free Credits to Get Started"; "Pay-as-you-Go Details"; "Billing for Team and Enterprise organizations": `"X-HF-Bill-To: my-org-name"`)
- https://huggingface.co/docs/huggingface.js/inference/interfaces/Options#billto
- https://huggingface.co/docs/inference-providers/register-as-a-provider ("How billing works", "Timing and retries", "Which requests we ask about")
- `@huggingface/inference` 4.13.30 `src/config.ts`: `HF_HEADER_X_BILL_TO = "X-HF-Bill-To"`
- 402 body, observed:
  - https://github.com/bijoycodes/Ai-Voice-Control-device/blob/main/backend/api/error.log (entries dated 2026-06-03: `API Error - Status: 402, Response: {"error":"You have depleted your monthly included credits. ..."}`)
  - https://github.com/last-million/free-llm-hub/blob/main/providers.py (comment "PROBED 2026-07-24: 402 "You have depleted your monthly included credits"")
  - https://github.com/josephcrown920/Auroraglobal/blob/main/.agents/memory/hf-account-credit-block.md ("Observed July 2026 ... EVERY inference call returns 402")
  - https://github.com/shekhar871/Antigaurd-GYM-RL-/blob/main/out1.log (`Error code: 402 - {'error': 'You have depleted ...'}`)

---

## 3. Browser use (CORS)

**Answer**: **Strong evidence** that `router.huggingface.co` answers CORS for arbitrary origins, with an `Authorization` header, on `POST /v1/chat/completions`. It was not observed directly from this session, because the router is blocked here. In order of strength:

1. **HF's own guide builds a browser-only app that calls Inference Providers directly.** `guides/building-first-app` ships an `index.html` that runs, in the page:
   - `import { InferenceClient } from "https://esm.sh/@huggingface/inference"`
   - `client.chatCompletion({ model: "deepseek-ai/DeepSeek-R1-0528:fastest", ... }, { provider: "auto" })` with the token.

   For conversational requests with `provider: "auto"` the client posts straight to `https://router.huggingface.co/v1/chat/completions`, per `getInferenceProviderMapping.ts`: "Special case for auto + conversational ... Call directly the server-side auto router". The guide says: **"We can run our app locally by going to the file from our browser"**, which means a `file://` page (Origin `null`), and then deploys it as a static Space (origin `*.static.hf.space`). Neither origin is `huggingface.co`.
2. **A third party states it probed the preflight**: `tanmayagrawal21/worklog` `js/providers.js`, header comment: "Calling an API directly from a page needs that API to send CORS headers, and I probed each preflight: router.huggingface.co access-control-allow-origin: *". Its Hugging Face preset is marked `browser: 'direct'`. The file is undated; its repository id suggests 2026. Caveat: a wildcard `Access-Control-Allow-Origin` says nothing about `Access-Control-Allow-Headers`. Under the Fetch spec, `Authorization` must be listed explicitly; a `*` in Allow-Headers does not cover it. The comment does not quote Allow-Headers.
3. **Working client-side pages in the wild** send exactly the storefront's request shape from a browser: `fetch("https://router.huggingface.co/v1/chat/completions", { headers: { Authorization: "Bearer " + HF_TOKEN, "Content-Type": "application/json" }, body: {model, messages:[{role:"user", content:[{type:"text"}, {type:"image_url", image_url:{url:"data:"+file.type+";base64,..."}}]}]} })`. Example: `mvark/WebApps` `CloudSpotting/CloudSpotting.html`, a plain HTML page with a vision model and a base64 data-URL image (undated; it lists `google/gemma-4-31B-it` and `MiniMaxAI/MiniMax-M3`, so 2026). GitHub code search finds 56 HTML files calling that URL.
4. **HF's own static Spaces** (`huggingfacejs/streaming-text-generation`, served from `*.static.hf.space`) call HF inference from the browser with a user-typed token. That is older API usage, and the origin is HF-owned.
5. **Library intent**: the `@huggingface/inference` README says "If you need to protect it in front-end applications, we suggest setting up a proxy server that stores the access token". That is a key-exposure warning, not a CORS limitation. The library detects browsers (`isBrowser`, `isWebWorker`) and supports `credentials: "include"`.

Not evidence: the huggingface.js CI has a `browser` job that runs `test:browser` in headless Chrome with an HF token. However, `packages/inference/test/InferenceClient.spec.ts` is `describe.skip("InferenceClient", ...)`, so that job does not prove live CORS.

Implications for the storefront:
- Direct browser calls with the dealer's token should work. As with every direct provider in this table, the token then lives in the browser.
- Any extra custom header (`X-HF-Bill-To`) extends the preflight's `Access-Control-Request-Headers`; whether it is allowed is **unverified**.
- How to settle it: from any browser devtools console on a non-HF origin, run `fetch("https://router.huggingface.co/v1/chat/completions",{method:"POST",headers:{Authorization:"Bearer hf_x","Content-Type":"application/json"},body:"{}"})`. A 401 JSON body means CORS passed; a `TypeError: Failed to fetch` means it was blocked. It costs nothing, because a bogus token is rejected before any inference.

**Sources**
- https://huggingface.co/docs/inference-providers/guides/building-first-app (the `index.html` listing and "We can run our app locally by going to the file from our browser")
- `@huggingface/inference` 4.13.30 `src/lib/getInferenceProviderMapping.ts` lines ~133-138; `src/providers/providerHelper.ts` `AutoRouterConversationalTask` (base `https://router.huggingface.co`); `README.md`; `src/utils/isBackend.ts`
- https://raw.githubusercontent.com/tanmayagrawal21/worklog/main/js/providers.js
- https://raw.githubusercontent.com/mvark/WebApps/main/CloudSpotting/CloudSpotting.html
- https://huggingface.co/spaces/huggingfacejs/streaming-text-generation (`index.html`, read via `hf://spaces/...`)
- https://raw.githubusercontent.com/huggingface/huggingface.js/main/.github/workflows/test.yml (browser job) and https://raw.githubusercontent.com/huggingface/huggingface.js/main/packages/inference/test/InferenceClient.spec.ts (`describe.skip`)

---

## 4. Model id syntax and routing policies

**Answer** (**confirmed** unless noted)
- `org/model`, for example `Qwen/Qwen3-VL-235B-A22B-Instruct`: the router picks the provider. **The default is `:fastest`**: "By default, the fastest available provider is selected for the model (highest throughput in tokens per second). This is equivalent to appending `:fastest` to the model name."
- `org/model:provider` forces one provider, for example `openai/gpt-oss-120b:groq` or `...:fireworks-ai`. Provider slugs: baseten, cerebras, cohere, deepinfra, fal-ai, featherless-ai, fireworks-ai, groq, hf-inference, novita, nscale, ovhcloud, publicai, replicate, scaleway, together, wavespeed, zai-org (`INFERENCE_PROVIDERS` in `src/types.ts`; the partners table in the docs index).
- `:fastest` picks the highest throughput, `:cheapest` the "lowest price per output token", and `:preferred` "the first available provider sorted by your preference order in Inference Provider settings" (`https://hf.co/settings/inference-providers`).
- **HF's documents disagree on what "auto" means.**
  - The docs index and the Responses-API guide say the default equals `:fastest`.
  - The older `guides/first-api-call` page, the `@huggingface/inference` README, and a warning string in its source say `auto` selects "the first of the providers available for the model, sorted by the user's order".
  - For the OpenAI-compatible `/v1/chat/completions` endpoint this layer uses, the index is explicit that the server-side default is `:fastest`. Treat that as the answer. Use `:preferred` to make the user's settings order govern.
- How user settings affect routing:
  - Provider **order** matters only under `:preferred` (and for the Hub widgets and snippets). **Confirmed.**
  - Providers the user has not **enabled** are excluded. An unserved or not-enabled model gives HTTP 400 `model_not_supported` with the message "...is not supported by any provider you have enabled." **Strong evidence** (observed bodies, section 8).
  - A **custom provider key** set in settings makes that provider bill directly, and HF credits do not apply. **Confirmed.**
- Automatic failover: "requests are automatically routed to alternative providers if the primary provider is flagged as unavailable by our validation system". HF re-tests each mapping every 6 hours (hourly while failing) and removes failing ones from the active list. A pinned `:provider` loses that failover. **Confirmed.**
- Discovery:
  - `GET https://router.huggingface.co/v1/models` and `GET /v1/models/{org}/{model}` return, per provider: `status` (`live`/`error`), `context_length`, `pricing`, `supports_tools`, `supports_structured_output`, `first_token_latency_ms` and `throughput`, plus `architecture.input_modalities` for the model. The documented curl sends no Authorization header. **Confirmed.**
  - Also `https://huggingface.co/api/models/{id}?expand[]=inferenceProviderMapping`. **Confirmed.**

**Sources**
- https://huggingface.co/docs/inference-providers/index ("Alternative: OpenAI-Compatible Chat Completions Endpoint", "Provider Selection Policy", "Automatic Failover")
- https://huggingface.co/docs/inference-providers/guides/responses-api (the TIP on `<repo>:<provider>`, `:fastest`, `:cheapest`, `:preferred`)
- https://huggingface.co/docs/inference-providers/guides/first-api-call ("Understanding Provider Selection", the conflicting wording)
- https://huggingface.co/docs/inference-providers/hub-api ("List OpenAI-compatible models", the field table; "Get model providers")
- https://huggingface.co/docs/inference-providers/hub-integration ("User Settings")
- https://huggingface.co/docs/inference-providers/register-as-a-provider ("Automatic validation"; FAQ on default provider order)
- `@huggingface/inference` 4.13.30 `src/types.ts` (`INFERENCE_PROVIDERS`), `src/lib/getInferenceProviderMapping.ts` line ~185 (the "sorted by the user's order" warning)

---

## 5. Vision input

**Answer**
- Image parts use the OpenAI shape `{"type":"image_url","image_url":{"url": ...}}`. **Confirmed** in the chat-completion request spec.
- **Remote https URLs**: documented. HF's own generated snippet for every VLM provider uses `image_url.url = "https://cdn.britannica.com/61/93061-050-99147DCE/Statue-of-Liberty-Island-New-York-Bay.jpg"`, and the Responses-API guide uses a Wikimedia URL. **Confirmed.** Whether *every* provider fetches remote URLs (some block them or time out) is **unverified**.
- **Base64 `data:` URLs**: **strong evidence**.
  - HF's own Python `InferenceClient` turns local images into `data:{mime};base64,...` (`_as_url` in `inference/_common.py`).
  - HF's JS client orders `model` first in the body "so that a router/proxy can resolve the target provider from a small prefix of the request body instead of buffering the whole payload — `messages` can hold megabytes of base64-encoded images".
  - Third-party browser pages post `data:` URLs to the router (section 3).
  - HF docs do not show a data-URL chat example.
- **`detail` field**: the HF spec's `ChatCompletionInputUrl` has only `url`. The storefront sends `detail: "high"`. Whether each provider ignores it (most vLLM-based OpenAI servers accept it) or rejects it as unknown is **unverified**.
- **Size and count limits**: **none documented** for the router. **Unverified.**
  - History: the *retired* serverless API (`api-inference.huggingface.co`) returned 413 Payload Too Large for a base64 image in Nov 2024 (huggingface_hub issue #2654, closed). The router is a different service.
  - A third-party changelog says the old `api-inference.huggingface.co` host now returns HTTP 410; **unverified**.
  - The storefront's own ceilings (1600 px edge, 4 MB per image, JPEG re-encode when resizing) are conservative and should be kept.
- **Which models see images**: a model tagged `image-text-to-text` routes as task `conversational`. Whether a given *provider* for that model accepts image input is exposed only by `/v1/models` `architecture.input_modalities`, which could not be read (**unverified** per provider). What happens when an image goes to a text-only model (rejection or silent drop) is **unverified**.

**Sources**
- https://huggingface.co/docs/inference-providers/tasks/chat-completion (request table: `image_url*` → `url*`, `type` enum `image_url`)
- https://huggingface.co/docs/inference-providers/tasks/image-text-to-text
- https://huggingface.co/docs/inference-providers/guides/responses-api ("Multimodal inputs")
- `@huggingface/tasks` 0.21.48 `src/snippets/inputs.ts` lines 56-58 (the remote URL) and `src/tasks/chat-completion/spec/input.json` (`ChatCompletionInputUrl` = `{url}` only)
- `@huggingface/inference` 4.13.30 `src/providers/providerHelper.ts` (`BaseConversationalTask.preparePayload` comment)
- `huggingface_hub` 2.0.0 `src/huggingface_hub/inference/_common.py` (`_as_url` → `data:{mime_type};base64,...`)
- https://github.com/huggingface/huggingface_hub/issues/2654 (legacy 413; closed)
- https://github.com/ferro-labs/ai-gateway/blob/main/docs/changelog/v1.1.md (third-party: legacy host returns 410)

---

## 6. Structured outputs

**Answer**
- `response_format` is part of the router's chat-completion spec, with three shapes: `{type:"text"}`, `{type:"json_schema", json_schema:{name, description?, schema, strict?}}`, and `{type:"json_object"}`. **Confirmed.** So the storefront's exact `{type:'json_schema', json_schema:{name, strict:true, schema}}` is a documented shape.
  - HF's structured-output guide uses exactly `"type":"json_schema","json_schema":{"name":...,"schema":...,"strict":True}`.
  - The gpt-oss guide sends `json_schema` through `https://router.huggingface.co/v1` with `openai/gpt-oss-120b:fireworks-ai`.
  - In 2024 the HF spec used a TGI grammar shape (`{type, value}`); issue #932 (open) records the divergence. The current spec is OpenAI-shaped.
- **Which providers honour it**: this is per provider and per model. It is published in `/v1/models` as `supports_structured_output`. **Confirmed that the field exists.** The docs' own example, for DeepSeek-V4-Pro, shows:
  - together: true
  - fireworks-ai: true
  - deepinfra: true
  - **novita: false**
  - featherless-ai: field absent

  So support differs between providers of one model. HF runs a periodic "Structured output support" behavioural test on LLM mappings (register-as-a-provider, "Automatic validation"). The values for the vision models in section 9 are **unverified** (router blocked).
- HF's own advice: "Structured outputs are a good use case for selecting a specific provider and model because you want to avoid incompatibility issues between the model, provider and the schema." That is, **pin `:provider`** when relying on a schema. **Confirmed.**
- **Behaviour on a provider that does not support it**: **unverified**. Possibilities include a 400 or 422 naming `response_format`, silent ignoring, or the router avoiding that provider.
  - HF's Python client appends the raw response text to every 422 on a known task, which suggests schema and validation errors can surface as 422.
  - The router rewrites nothing documented. HF's JS client itself rewrites `json_schema` into Together's native `{type:"json_schema", schema}` when calling Together's pass-through route, which shows provider dialects differ.
  - The Responses-API guide notes that `openai/gpt-oss-120b:groq` "may emit markdown even when a schema is provided" unless told to return JSON. That is at least one documented case of a schema not being strictly enforced.
- **`json_object`**: in the spec. **Confirmed.** Per-provider support is **unverified**.

Consequences for the entry:
- A 422 currently maps to `mapStatus`'s generic "Unexpected status 422" (kind `server`). That kind is never retried. So a schema rejection arriving as 422 would **not** reach the schema-in-prompt fallback. See the recommended code changes.
- Silent ignoring would return JSON of the wrong shape, or prose, with the schema only in `response_format`. `parseCatalogueRecord` would reject it and the call is wasted. Prefer a pinned provider known to report `supports_structured_output: true`.

**Sources**
- https://huggingface.co/docs/inference-providers/tasks/chat-completion (request table `response_format` #1/#2/#3)
- https://huggingface.co/docs/inference-providers/guides/structured-output (payload and the pinning TIP)
- https://huggingface.co/docs/inference-providers/guides/gpt-oss ("force the model to return a valid JSON object using the `response_format` parameter. We use the Fireworks AI provider.")
- https://huggingface.co/docs/inference-providers/guides/responses-api (the NOTE on gpt-oss:groq)
- https://huggingface.co/docs/inference-providers/hub-api (`supports_structured_output` per provider, with the example values)
- https://huggingface.co/docs/inference-providers/register-as-a-provider ("Structured output support" validation test)
- `@huggingface/tasks` 0.21.48 `src/tasks/chat-completion/spec/input.json` (`ChatCompletionInputGrammarType` oneOf text / json_schema / json_object)
- `@huggingface/inference` 4.13.30 `src/providers/together.ts` (`TogetherConversationalTask.preparePayload`)
- `huggingface_hub` 2.0.0 `src/huggingface_hub/inference/_client.py` (422 handling)
- https://github.com/huggingface/huggingface.js/issues/932

---

## 7. Parameters

**Answer**
- `max_tokens`: documented ("The maximum number of tokens that can be generated in the chat completion"). The spec default is `1024`, but that default comes from the TGI-derived spec, and the effective default when omitted varies by provider (**unverified**). **Confirmed** as the name to send.
- `max_completion_tokens`: **not in the HF spec**. Whether the router or providers accept it is **unverified**. Send `max_tokens`. The existing `openaiRetryBody` rename covers any provider that demands the newer name.
- `temperature`: documented, "between 0 and 2". **Confirmed.**
- `stream`: documented as boolean. "If `stream` is `false` (default), the response will be a JSON object". **Confirmed.** The storefront sends `stream:false` explicitly anyway.
- `reasoning_effort`: documented ("Common values: none, minimal, low, medium, high, xhigh. Support and defaults are provider and model-dependent"). **Confirmed.** This matters because several candidate VLMs **think by default**:
  - Qwen3.8-27B: "Thinking mode is on by default".
  - GLM-5.3-Flash: `reasoning_effort` "defaults to `max`".
  - Gemma 4: "configurable thinking modes".

  Reasoning tokens count against `max_tokens`, so the 8192 default can truncate the JSON. The storefront does not send `reasoning_effort` today.
- Other documented fields: `top_p`, `seed`, `stop`, `frequency_penalty`, `presence_penalty`, `logprobs`, `top_logprobs`, `tools`, `tool_choice`, `stream_options`, `response_format`. **Confirmed.**
- Non-streaming timeout: HF's Python client adds this note to a **504** on non-streamed conversational calls: "the request timed out before the model finished generating. If you are generating long outputs (e.g. long reasoning traces), pass `stream=True`". So the router enforces a gateway timeout on non-streaming requests. **Confirmed that it exists.** Its length is **unverified**; no source found.
- 503: HF's JS client retries every 503 by default (`retry_on_error`). **Confirmed** as client behaviour. That implies 503s are expected and transient.

**Sources**
- https://huggingface.co/docs/inference-providers/tasks/chat-completion (payload table; "Response ... If `stream` is `false` (default)")
- `@huggingface/tasks` 0.21.48 `src/tasks/chat-completion/spec/input.json` (property list; `max_tokens.default = "1024"`; no `max_completion_tokens`)
- `huggingface_hub` 2.0.0 `src/huggingface_hub/inference/_client.py` (504 note)
- `@huggingface/inference` 4.13.30 `src/utils/request.ts` (503 retry)
- Model cards: `hf://models/Qwen/Qwen3.8-27B/README.md`, `hf://models/zai-org/GLM-5.3-Flash/README.md`, `hf://models/google/gemma-4-31B-it/README.md`

---

## 8. Error body shapes

**Answer**: the router uses **at least two body shapes**. The storefront's `providerErrorMessage` reads only `body.error.message`, so it currently **drops the message for 401, 402 and 403**. Observed and documented examples:

| Status | Body | Label and source |
|---|---|---|
| 400 (unknown model, or no enabled provider serves it) | `{"error":{"message":"The requested model 'google/gemma-7b-it' is not supported by any provider you have enabled.","type":"invalid_request_error","param":"model","code":"model_not_supported"}}` | strong evidence; several 2026 observations. **Note: 400, not 404.** |
| 401 (bad token) | `{"error":"Invalid credentials in Authorization header"}` | strong evidence (2025 observations, incl. router URLs) |
| 402 (credits exhausted) | `{"error":"You have depleted your monthly included credits. Purchase pre-paid credits to continue using Inference Providers. Alternatively, subscribe to PRO to get 20x more included usage."}` | strong evidence (2026) |
| 403 (token lacks permission) | `{"error":"This authentication method does not have sufficient permissions to call Inference Providers on behalf of user <name>"}` | strong evidence (2026-02-18, router `hf-inference` route) |
| 404 | no router example found for `/v1/chat/completions` (an unknown model gives 400, above) | unverified |
| 413 | none found for the router | unverified |
| 422 | not documented; HF's Python client appends raw response text on 422, so it occurs with a text or JSON body | unverified shape |
| 429 | no router body found | unverified |
| 503 | retried by HF's JS client; shape unknown | unverified |
| 504 | exists for long non-streaming generations (section 7). HF's front proxy has served **HTML** 504 pages on `huggingface.co` APIs (huggingface_hub #2581), so a 5xx body may be non-JSON. `client.ts` already maps non-JSON error bodies by status alone. | strong evidence (existence); shape unverified |

- Relayed provider errors can take any of these shapes. HF's own JS client checks them in this order:
  1. On 400/404/422/500 during chat completion, `JSON.stringify(output.error)`.
  2. `output.error` as a string, `output.detail` as a string, or `output.message` as a string.
  3. In the streaming path, also `output.error.message` ("OpenAI errors").

  It accepts `Content-Type` `application/json` and `application/problem+json`, and reads `text/plain;` bodies as text. The request id is in the `x-request-id` response header. **Confirmed** as client code; this is the best available statement of what the router can return.
- Conflicting source: a third-party doc (`agentilab-huggingface` `mcp/docs/05-error-handling.md`) claims the router always returns the object shape and the Hub always the string shape. The dated router logs above contradict that for 401, 402 and 403. Discount it.

**Sources**
- `@huggingface/inference` 4.13.30 `src/utils/request.ts` (`innerRequest` / `innerStreamingRequest` error branches) and `src/errors.ts`
- `huggingface_hub` 2.0.0 `src/huggingface_hub/utils/_http.py` (`_format`: `{'error': str}`, `{'error': [..]}`, `{'error','error_description'}`, `{'errors':[{message}]}`, `X-Error-Message` header)
- 400 `model_not_supported`:
  - https://github.com/sdmcetminor-pixel/Career-guidance/blob/main/hf-error.txt
  - https://github.com/DealAppSeo/repid-engine/blob/main/reports/2026-08-01/KEY_AUDIT_VERIFIED.md
  - https://github.com/jenil2803/Agentic_bug_hunter/blob/main/docs/run_report_20260217_145532.md
- 401:
  - https://github.com/het004/ODOUR_SOURCE_DETECTION/blob/main/logs/app.log (`401 - {"error":"Invalid credentials in Authorization header"}`, 2025-06-20)
  - https://github.com/Zakaria-Elouali/DocBrain/blob/main/DocBrain%20AI/pdf_service.log (router URL, 2025-05-20)
- 402: section 2 sources
- 403: https://github.com/Prasanth-1402/interview-buddy/blob/main/server-debug.log (2026-02-18); https://github.com/AdityaAneNenu/Inavra/blob/main/docs/troubleshooting/FIX_403_ERROR.md
- 504: `huggingface_hub` `_client.py`; https://github.com/huggingface/huggingface_hub/issues/2581 (HTML 504 page)
- Conflicting third-party claim: https://raw.githubusercontent.com/simonpierreboucher02/agentilab-huggingface/main/mcp/docs/05-error-handling.md

---

## 9. Image-reading chat models live on at least one provider (2026-09-24)

Method: `hub_repo_details` on each candidate. It returns the Hub's `inferenceProviderMapping` with per-provider status. "live" below means `live` there on 2026-09-24. **Confirmed** per the Hub mapping.

Not verified for any row, because `/v1/models` was unreachable:
- per-provider acceptance of image input (`input_modalities`);
- `supports_structured_output`;
- any claim of Tibetan, Ranjana/Lantsa, Siddham, Newari or Nastaliq reading. **No model card read here names those scripts.**

| Model (`pipeline_tag` image-text-to-text) | Live providers | Thinking default / notes | Multilingual/OCR claim (model card) |
|---|---|---|---|
| **Qwen/Qwen3-VL-235B-A22B-Instruct** | novita, deepinfra | Instruct (non-thinking) edition; a separate `-Thinking` repo exists | "Expanded OCR: Supports 32 languages ... better with rare/ancient characters and jargon" |
| Qwen/Qwen3-VL-235B-A22B-Thinking | novita, featherless-ai | thinking | as above |
| Qwen/Qwen3-VL-30B-A3B-Instruct | novita, featherless-ai, deepinfra | non-thinking | Qwen3-VL family |
| Qwen/Qwen3-VL-32B-Instruct | featherless-ai | non-thinking | Qwen3-VL family |
| Qwen/Qwen3-VL-8B-Instruct | featherless-ai (novita: error) | non-thinking | Qwen3-VL family |
| **Qwen/Qwen3.8-27B** | novita, ovhcloud, deepinfra (cerebras, featherless-ai: error) | "Thinking mode is on by default and can be disabled per request" | "Native support for image and video understanding ... documents" |
| Qwen/Qwen3.8-Flash-Next | featherless-ai | not read | not read |
| **Qwen/Qwen3.5-397B-A17B** | novita, featherless-ai, scaleway, ovhcloud, deepinfra | not read | not read |
| Qwen/Qwen3.5-122B-A10B | novita, deepinfra | not read | not read |
| Qwen/Qwen3.5-27B | novita, featherless-ai, deepinfra | not read | not read |
| Qwen/Qwen3.5-9B | together, featherless-ai, ovhcloud, deepinfra | not read | not read |
| Qwen/Qwen3.6-35B-A3B | featherless-ai, scaleway, deepinfra | not read | not read |
| **Qwen/Qwen2.5-VL-72B-Instruct** | featherless-ai, ovhcloud | non-thinking | Qwen2.5-VL (model-card language list not read) |
| Qwen/Qwen2.5-VL-32B-Instruct, Qwen/Qwen2.5-VL-7B-Instruct | featherless-ai | non-thinking | |
| **google/gemma-4-31B-it** | novita, featherless-ai, deepinfra (together: error) | "configurable thinking modes" | "multilingual support in over 140 languages" |
| google/gemma-4-26B-A4B-it | novita, featherless-ai, scaleway, deepinfra | as Gemma 4 | as Gemma 4 |
| google/gemma-3-27b-it, gemma-3-12b-it, gemma-3-4b-it | featherless-ai, deepinfra | non-thinking | Gemma 3 |
| **zai-org/GLM-5.3-Flash** | novita, together, fireworks-ai, featherless-ai, zai-org, baseten, deepinfra (7 providers) | `reasoning_effort` "defaults to `max`" | card languages en, zh |
| zai-org/GLM-4.5V | novita, zai-org | reasoning VLM | en, zh |
| zai-org/GLM-4.6V | zai-org | | en, zh |
| moonshotai/Kimi-K3 | together, fireworks-ai, featherless-ai, baseten, deepinfra | not read | not read |
| moonshotai/Kimi-K2.5 | novita, featherless-ai, deepinfra | not read | not read |
| MiniMaxAI/MiniMax-M3 | novita, together, fireworks-ai, featherless-ai, deepinfra | not read | not read |
| meta-llama/Llama-4-Scout-17B-16E-Instruct (gated) | novita, nscale, deepinfra (groq: error) | non-thinking | card languages include hi |
| CohereLabs/aya-vision-32b (gated, CC-BY-NC-4.0) | cohere | | 23 languages incl. hi, fa |
| CohereLabs/command-a-vision-07-2025 (gated, CC-BY-NC-4.0) | cohere | | en, fr, de, es, it, pt |
| swiss-ai/Apertus-v1.5-70B (gated) | featherless-ai, publicai | | "multilingual" |
| deepseek-ai/DeepSeek-V4.1-Flash | novita, fireworks-ai, featherless-ai, baseten, deepinfra | tagged both text-generation and image-text-to-text; whether providers accept images is unverified | |

Checked and **not live** (no provider, or error only):
- meta-llama/Llama-4-Maverick-17B-128E-Instruct
- meta-llama/Llama-3.2-90B-Vision-Instruct and Llama-3.2-11B-Vision-Instruct
- mistralai/Mistral-Small-3.2-24B-Instruct-2506 and mistralai/Pixtral-12B-2409
- moonshotai/Kimi-VL-A3B-Thinking-2506
- Qwen/Qwen3-VL-235B-A22B-Instruct-FP8
- deepseek-ai/DeepSeek-OCR (novita: error)
- `zai-org/GLM-5V` does not exist

Verified **text-only** (`pipeline_tag` text-generation), relevant to `textOnlyModels`:
- openai/gpt-oss-120b
- deepseek-ai/DeepSeek-V4-Pro (the docs' `/v1/models` example also shows `input_modalities: ["text"]`)
- zai-org/GLM-5.3 (the non-Flash one)
- moonshotai/Kimi-K2-Instruct-0905
- Qwen/Qwen3-Coder-480B-A35B-Instruct
- deepseek-ai/DeepSeek-R1

Watch the near-identical names: GLM-5.3 is text-only while GLM-5.3-Flash sees images, and DeepSeek-V4-Pro is text-only while DeepSeek-V4.1-Flash is tagged image-text-to-text.

**Recommendation**
- **Default: `Qwen/Qwen3-VL-235B-A22B-Instruct`.**
  - It is image-native.
  - It is the non-thinking *Instruct* edition, so token use is predictable and the 8192-token ceiling goes to the record, not to reasoning.
  - Its card specifically claims OCR over 32 languages and "rare/ancient characters".
  - It is live on two providers (deepinfra, novita). Both have multi-model structured-output records in the docs' example: deepinfra true, novita false for DeepSeek-V4-Pro. The values *for this model* are unverified.
  - To remove structured-output ambiguity, pin **`Qwen/Qwen3-VL-235B-A22B-Instruct:deepinfra`** once `GET https://router.huggingface.co/v1/models/Qwen/Qwen3-VL-235B-A22B-Instruct` shows `deepinfra.supports_structured_output: true` and `"image"` in `input_modalities`. Pinning trades away automatic failover.
- Suggestions (the `modelSuggestions` datalist, never a closed list):
  1. `google/gemma-4-31B-it`: broadest stated language coverage (140+), three live providers.
  2. `Qwen/Qwen3.8-27B`: newest Qwen VLM, three live providers. It thinks by default, so expect token pressure.
  3. `zai-org/GLM-5.3-Flash`: most providers (7), so the best failover. It reasons at `max` by default, so a real truncation risk at 8192.
  4. `Qwen/Qwen2.5-VL-72B-Instruct`: non-thinking, long-standing OCR workhorse, two providers. It is the model a third-party browser page already sends data-URL images to.
  5. `Qwen/Qwen3.5-397B-A17B`: five live providers.
- For Persian/Urdu or Devanagari-heavy pieces, `CohereLabs/aya-vision-32b` (fa, hi) is live on cohere only and licensed CC-BY-NC. Check Cohere's terms before commercial use.
- None of these models' script coverage for Tibetan (Uchen/Umê), Ranjana/Lantsa, Siddham or Newari is documented on the cards read. Test against a small gallery reference set of known inscriptions before trusting any of them.

**Sources**
- `hub_repo_details` (Hugging Face MCP) on every model named in the table, 2026-09-24; model pages `https://huggingface.co/<id>`
- Model cards: `hf://models/Qwen/Qwen3-VL-235B-A22B-Instruct/README.md`, `hf://models/Qwen/Qwen3.8-27B/README.md`, `hf://models/google/gemma-4-31B-it/README.md`, `hf://models/zai-org/GLM-5.3-Flash/README.md`
- https://huggingface.co/docs/inference-providers/tasks/image-text-to-text (docs VLM mapping: DeepSeek-V4.1-Flash, Qwen3.8-27B, aya-vision-32b, Qwen3.8-Flash-Next, Llama-4-Scout, Apertus-v1.5-70B, Qwen3.6-35B-A3B, GLM-5.3-Flash)
- https://huggingface.co/docs/inference-providers/hub-api (`/v1/models` example with `input_modalities`, `supports_structured_output`)

---

## 10. Dedicated Inference Endpoints

**Answer**
- Hostname pattern: `https://<id>.<region>.<cloud>.endpoints.huggingface.cloud`. Docs examples:
  - `https://your-endpoint-name.endpoints.huggingface.cloud/v1/`
  - `https://jpj7k2q4j805b727.us-east-1.aws.endpoints.huggingface.cloud`

  **Confirmed.**
- OpenAI-compatible path: base `<endpoint-url>/v1/`, chat at `<endpoint-url>/v1/chat/completions`. "The model and engine you deploy on Inference Endpoints uses the OpenAI Chat Completions format". The `model` field is **the endpoint name** (for example `qwen3-1-7b-xll`), not the Hub repo id. **Confirmed.** vLLM and SGLang are the recommended engines; TGI has been in maintenance mode since 2025-12-11.
- Auth: the same HF user token as a Bearer. The endpoint's own "Authentication" setting decides who may call it. **Confirmed.**
  - Private (default): "Accessible only to you, or members of your Hugging Face organization, using a personal HF access token."
  - Authenticated: any HF account token.
  - Public: no auth.
  - The fine-grained permission name needed for a private endpoint is **unverified**. The OAuth equivalent is `read-endpoints`.
- Scale-to-zero: "the proxy will respond with the status code `503` while the new replica is initializing". The header `X-Scale-Up-Timeout: 600` makes the proxy hold the request instead. **Confirmed.** Browser use of that custom header needs CORS allowance (**unverified**). CORS on `*.endpoints.huggingface.cloud` generally is **unverified**.
- Billing: compute time on your own instance. PRO, Team and Enterprise monthly credits can be spent on it. **Confirmed.**
- **Should one storefront entry serve both?** Mechanically, yes: the same dialect, same Bearer header, same `/chat/completions` suffix after a `/v1` Base URL, and the dealer puts the endpoint name in Model. Three things must follow:
  1. `isOwnEndpoint` must treat `*.endpoints.huggingface.cloud` as first-party, as well as `router.huggingface.co`. Otherwise a dedicated endpoint reads as "proxy mode" and suppresses the stored-key warning and blank-key refusal. This is the same trap already documented for Azure.
  2. Router-only copy (credits, `:provider` suffixes, the 402 advice) does not apply there. Structured output then depends on the engine: vLLM and SGLang implement `json_schema` guided decoding, per their own docs; that was not re-verified here.
  3. Cold starts return 503 for minutes, so the note should say so.

  A second entry is not necessary; a sentence in `baseUrlHelp` is enough.

**Sources**
- https://huggingface.co/docs/inference-endpoints/tutorials/chat_bot ("Get your Inference Endpoint details": base URL `https://<id>.<region>.<cloud>.endpoints.huggingface.cloud/v1/`, endpoint name as `model`, `API_URL = "<endpoint-url>/v1/chat/completions"`, `Authorization: Bearer ...`)
- https://huggingface.co/docs/inference-endpoints/tutorials/embedding (`ENDPOINT_URL = "https://your-endpoint-name.endpoints.huggingface.cloud/v1/"`)
- https://huggingface.co/docs/inference-endpoints/tutorials/transcription (`https://your-qwen-endpoint.endpoints.huggingface.cloud/v1/chat/completions`)
- https://huggingface.co/docs/inference-endpoints/guides/configuration ("Authentication")
- https://huggingface.co/docs/inference-endpoints/guides/autoscaling ("Scale to Zero": 503, `X-Scale-Up-Timeout`)
- https://huggingface.co/docs/inference-endpoints/engines/tgi (maintenance mode) and https://huggingface.co/docs/inference-endpoints/engines/vllm
- https://huggingface.co/docs/huggingface_hub/guides/inference_endpoints (example URL `https://jpj7k2q4j805b727.us-east-1.aws.endpoints.huggingface.cloud`)
- https://huggingface.co/docs/inference-providers/pricing (credits usable on Inference Endpoints)

---

## 11. Content moderation

**Answer**: **unverified.**
- HF documents no router-level content filter, no moderation response shape, and no `finish_reason: "content_filter"` behaviour for Inference Providers.
- The providers serve open-weight models. A refusal from those is most likely the model's own prose in `message.content`, which is not JSON, so it would surface as `parse` ("did not return valid JSON") rather than `blocked`. That is inference, not a sourced fact.
- The existing OpenAI-dialect handlers already cover all three standard arrival shapes if a provider does use them: `finish_reason === 'content_filter'`, a non-empty `message.refusal`, and a 400 whose `error.code` or `error.message` names a content filter.
- HF states it does not store request bodies or responses when routing, and keeps logs up to 30 days without user data or tokens. **Confirmed.** Relevant to sending photographs of consignor property.
- To settle this: one run with a known tantric or yab-yum image on the chosen default model and provider, recording `finish_reason`, `message.content` and any `refusal` field.

**Sources**
- https://huggingface.co/docs/inference-providers/security
- https://huggingface.co/docs/inference-providers/tasks/chat-completion (response table lists `finish_reason` as a string, no enumerated values)
- `js/packages/web/src/ai/providers.ts` (`isContentFilter`, `extractText` in `openAiCompatible`)

---

## Recommended provider entry

Proposed id `'huggingface'` (add it to `ProviderId`, `PROVIDER_LABELS`, `SECRET_NAMES`, `PROVIDERS` and `PROVIDER_IDS`; `settings.ts` rebuilds from `PROVIDER_IDS`). Values:

| Field | Value | Basis |
|---|---|---|
| `id` | `'huggingface'` | |
| `label` | `'Hugging Face Inference Providers'` | |
| `PROVIDER_LABELS` | `'Hugging Face'` | |
| `keyUrl` | `'https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained'` | §1, confirmed |
| `keyLabel` / `SECRET_NAMES` | `'Hugging Face token'` (both must agree; test 46) | §1 |
| `modelLabel` | `'Model'` (it accepts `org/model[:provider or :policy]`; on a dedicated endpoint, the endpoint name) | §4, §10 |
| `defaultBaseUrl` | `'https://router.huggingface.co/v1'` | §1, confirmed |
| `completionsPath` | omit (factory default `'/chat/completions'`) | §1, confirmed |
| `auth` | `'bearer'` | §1, confirmed |
| `tokenParam` | omit (`'max_tokens'`) | §7: `max_tokens` confirmed, `max_completion_tokens` not in spec |
| `defaultModel` | `'Qwen/Qwen3-VL-235B-A22B-Instruct'`. Change to `'...:deepinfra'` once `/v1/models` confirms structured-output support there. | §9 |
| `modelSuggestions` | `['Qwen/Qwen3-VL-235B-A22B-Instruct', 'google/gemma-4-31B-it', 'Qwen/Qwen3.8-27B', 'zai-org/GLM-5.3-Flash', 'Qwen/Qwen2.5-VL-72B-Instruct', 'Qwen/Qwen3.5-397B-A17B']` | §9, live 2026-09-24 |
| `supportsRemoteImageUrl` | `true` | §5: remote URL is HF's own documented VLM example; per-provider fetching unverified |
| `supportsImages` | omit (true) | §5, §9 |
| `textOnlyModels` | `/(^|\/)(gpt-oss-|DeepSeek-(V4-Pro|R1)|Qwen3-Coder|Kimi-K2-Instruct|GLM-5\.3(?=:|$))/i` covers only families verified text-only in §9. Tested with node against 15 ids: it matches gpt-oss-120b(:groq), DeepSeek-V4-Pro, DeepSeek-R1-0528:fastest, GLM-5.3(:together), Kimi-K2-Instruct-0905 and Qwen3-Coder. It does not match DeepSeek-V4.1-Flash, GLM-5.3-Flash(:zai-org), Kimi-K2.5, Kimi-K3, Qwen3-VL or gemma-4. R1's dated revisions are assumed to share R1's text-only tag. The robust version is a settings-time lookup of `/v1/models/{id}` `input_modalities` (GET, documented without auth). | §9 |
| `maxImageEdgePx` | omit (no router cap documented; the dealer's 1600 px setting stands) | §5, unverified |
| `requiresJpeg` | omit (JPEG-only is not documented; the image pipeline already emits JPEG when it resizes) | §5, unverified |
| `outputTokenCap` | omit (no router-imposed reply cap documented) | §7 |
| `minRequestTimeoutMs` | omit. The router has a non-streaming 504 of undocumented length; the default 150 s timeout stands. Revisit if 504s appear. | §7, unverified |
| `persistKey` | `true`, like the other direct-key providers, **only because** the note tells the dealer to use an inference-only fine-grained token. A leaked `write` token would expose the gallery's HF repos. HF also offers a public revoke endpoint for leaked tokens (`POST https://huggingface.co/api/credentials/revoke`). | §1; https://huggingface.co/docs/hub/security-tokens |
| `primaryMode` | `'schema'` | §6: `json_schema` confirmed in spec |
| `fallbackMode` | `'none'`. The schema moves into the system prompt, which cannot be refused. `json_object` support per provider is unverified, and there is only one retry. | §6 |
| `isOwnEndpoint` | `(u) => /(^|\.)(router\.huggingface\.co|endpoints\.huggingface\.cloud)$/i.test(new URL(u).hostname.replace(/\.$/, ''))`, returning `true` on an unparseable URL as Azure does | §10 |
| `baseUrlHelp` | "A proxy here must accept POST {base}/chat/completions and forward the Authorization header. A dedicated Inference Endpoint also works: use its URL plus /v1 (https://<id>.<region>.<cloud>.endpoints.huggingface.cloud/v1) and put the endpoint's name in Model." | §10 |
| `note` | "Needs a fine-grained Hugging Face token with only the “Make calls to Inference Providers” permission — never a write token. Free accounts get $0.10 of inference credit a month (PRO $2); when it is spent every run fails with “depleted your monthly included credits” (HTTP 402) until you buy credits or the month resets. The router picks the fastest provider unless the model id ends in :provider, :cheapest or :preferred; schema enforcement differs by provider, so pin one (e.g. :deepinfra) for dependable structured output. Models that think by default (Qwen3.8, GLM-5.3-Flash) spend part of “Max output tokens” on reasoning. A dedicated endpoint that has scaled to zero answers 503 for several minutes while it starts." | §2, §4, §6, §7, §10 |

Code changes the entry depends on. These are observed failure modes, not style:
1. **`providerErrorMessage`** must also read `error` as a string, plus top-level `message` and `detail`, matching HF's own client. Otherwise the router's 401, 402 and 403 bodies (section 8) reach the dealer with no explanation.
2. **`mapStatus`** has no 402 or 422 case. Today 402 becomes "Unexpected status 402." with the message dropped, and 422 becomes kind `server`, which blocks the schema fallback.
   - Suggested 402: a dedicated message naming credits. It needs a new `AiErrorKind` such as `'quota'`, or `'rate_limit'` with credit-specific copy.
   - Suggested 422: treat as `bad_request` so `STRUCTURED_OUTPUT_REJECTED` and `retryBody` can act.
3. An unknown model comes back as **400 `model_not_supported`**, not 404. The provider's own message ("...not supported by any provider you have enabled.") is clear and passes through the existing 400 branch. Nothing is needed beyond (1), but the 404 "model or endpoint not found" copy will not appear for this provider.
4. Optional:
   - send `reasoning_effort: 'low'` (in HF's spec) for thinking-by-default models to protect the 8192-token budget;
   - add a settings-time probe of `GET {base}/models/{model}` (like `GatewayProbe`) to show live providers, `input_modalities` and `supports_structured_output` before a paid run.

---

## Successful queries

- `hf_fs ls hf://docs/inference-providers` and `.../guides`, `.../tasks`, `.../providers`
- `hf_fs cat`:
  - docs pages: `hf://docs/inference-providers/index.md` (two parts), `pricing.md`, `hub-api.md`, `hub-integration.md`, `security.md`, `register-as-a-provider.md`
  - guides: `guides/structured-output.md`, `guides/responses-api.md`, `guides/gpt-oss.md`, `guides/building-first-app.md` (offset 9000)
  - task pages: `tasks/chat-completion.md`, `tasks/image-text-to-text.md`
  - `providers/novita.md`
  - Hub and endpoint docs: `hf://docs/hub/security-tokens.md`, `hf://docs/hub/spaces-oauth.md`, `hf://docs/inference-endpoints/tutorials/chat_bot.md`, `.../guides/configuration.md`, `.../engines/vllm.md`, `.../engines/tgi.md`
  - Spaces: `hf://spaces/huggingfacejs/streaming-text-generation/index.html`, `hf://spaces/huggingfacejs/inference-request/index.html`
  - model cards: `hf://models/Qwen/Qwen3.8-27B/README.md`, `Qwen/Qwen3-VL-235B-A22B-Instruct/README.md`, `google/gemma-4-31B-it/README.md`, `zai-org/GLM-5.3-Flash/README.md`
- `hf_fs search`:
  - "CORS router.huggingface.co browser"
  - "Inference Providers browser front-end access token"
  - "OAuth inference-api scope static Space"
  - "You have exceeded your monthly included credits for Inference Providers"
  - "fine-grained token Make calls to Inference Providers permission"
  - "OpenAI compatible chat completions endpoint url /v1/ bearer token"
  - "security level protected public private authentication token"
  - "endpoints.huggingface.cloud v1/chat/completions"
  - "scale to zero 503 cold start"
  - "billTo X-HF-Bill-To header"
  - "response_format json_object not supported error provider"
  - "504 timeout non-streaming"
  - "enable disable providers settings inference-providers preference order routing"
  - "router selects provider that supports structured output"
  - "image input supported providers vision router input_modalities"
- `hub_repo_search` with filter `image-text-to-text`, sort `trendingScore`, limit 50
- `hub_repo_details` (4 batches) on 36 model ids (section 9)
- npm: `npm view @huggingface/inference`; `npm pack @huggingface/inference` (4.13.30) and `@huggingface/tasks` (0.21.48)
- PyPI: `pip download huggingface_hub` (2.0.0)
- raw.githubusercontent.com:
  - `huggingface/huggingface.js` `.github/workflows/test.yml`, `packages/inference/vitest.config.mts`, `packages/inference/test/InferenceClient.spec.ts`, `e2e/svelte/src/routes/+page.svelte`, `e2e/ts/src/index.ts`
  - `mvark/WebApps` `CloudSpotting/CloudSpotting.html`
  - `tanmayagrawal21/worklog` `js/providers.js`
  - `yadnyeshkolte/ai-storage-optimizer` `python/storopt_ai/hf.py`
  - `fmegahed/chatisa` `web/scripts/check-proposed.ts`
  - `simonpierreboucher02/agentilab-huggingface` `mcp/docs/05-error-handling.md`
- GitHub MCP `search_code`:
  - `"depleted your monthly included credits"`
  - `"router.huggingface.co" "Invalid credentials in Authorization header"`
  - `"is not supported by any provider you have enabled"`
  - `"does not have sufficient permissions to call Inference Providers" "error"`
  - `"router.huggingface.co" "access-control-allow-origin"`
  - `"router.huggingface.co/v1/chat/completions" fetch Authorization extension:html`
  - `"router.huggingface.co" "json_schema" "not supported"`
  - `"does not support structured output" huggingface router`
- GitHub MCP `search_issues`: huggingface/huggingface.js "CORS router ... browser" (found #932); huggingface/huggingface_hub "504 ... stream=True" (found #2654, #2581)

## Exhausted leads

- `router.huggingface.co`: blocked from Bash (per environment facts, not retried). WebFetch of `https://router.huggingface.co/v1/models` returned `EGRESS_BLOCKED`. **So the live per-provider `input_modalities` and `supports_structured_output` values for any vision model were not read.** Run `GET https://router.huggingface.co/v1/models/<id>` from an unrestricted machine.
- `huggingface.co` via WebFetch (`/api/models?inference_provider=all&pipeline_tag=image-text-to-text`): `EGRESS_BLOCKED`. The MCP connector was used instead.
- `discuss.huggingface.co` ("CORS Error When Using HF Interface API with gemma-2-9b-it", thread 146317): `EGRESS_BLOCKED`. The thread's content is unknown.
- `cors-test.codehappy.dev` (to observe the router's preflight headers): `EGRESS_BLOCKED`.
- WebSearch "router.huggingface.co CORS ..." (two phrasings): only generic CORS pages, no router-specific statement.
- GitHub `search_issues` for router CORS problems (across GitHub, and in huggingface.js): no results.
- `huggingface/huggingface.js` `packages/inference/test/vcr.ts` and `test/tapes.json` on raw.githubusercontent.com: 404 (moved or removed). The recorded router responses they once held were not available.
- huggingface.js browser CI as proof of CORS: rejected, because the live suite is `describe.skip`.
- Dating `mvark/WebApps` `CloudSpotting.html` via GitHub MCP `list_commits`: refused ("repository ... is not configured for this session"; only `kapoorgalleries/metaplex` is allowed).
- Router non-streaming timeout length: no doc, issue or code states the seconds.
- Router 404, 413, 422, 429 and 5xx body examples: none authoritative found (third-party docs only, one of them contradicted by observations).
- Content-filter or moderation behaviour through the router (`finish_reason content_filter`, refusal fields): no source found.
- Fine-grained token permission name for calling a *private dedicated Inference Endpoint*: not found in `hf://docs/inference-endpoints`.
- Script coverage (Tibetan Uchen/Umê, Ranjana/Lantsa, Siddham, Newari, Nastaliq) in model cards: not stated on the cards read. The Qwen3-VL "32 languages" list itself is not in the card.
- Not live on any provider: `meta-llama/Llama-4-Maverick-17B-128E-Instruct`, `meta-llama/Llama-3.2-90B-Vision-Instruct`, `meta-llama/Llama-3.2-11B-Vision-Instruct`, `mistralai/Mistral-Small-3.2-24B-Instruct-2506`, `mistralai/Pixtral-12B-2409`, `moonshotai/Kimi-VL-A3B-Thinking-2506`, `Qwen/Qwen3-VL-235B-A22B-Instruct-FP8`. Error only: `deepseek-ai/DeepSeek-OCR` (novita). Not found: `zai-org/GLM-5V`.
