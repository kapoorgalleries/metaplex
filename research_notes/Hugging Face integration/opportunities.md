# What else Hugging Face offers the gallery, and whether to use it (as of 2026-09-25)

Scope: everything HF ships beyond what is already integrated (the `huggingface` storefront provider, the vendored skills, the MCP server, the `hf` CLI in `ops/network`). Each candidate gets: what it is, verified facts with sources, value for Kapoor Galleries, cost, risk, effort, and a verdict.

Verdicts: **DO NOW** (small, safe, clearly useful), **PROPOSE** (needs Sanjay's decision: spend, privacy or scope), **SKIP** (with reason).

How this was verified: HF docs were read through the HF MCP `hf_fs` mirror of `https://huggingface.co/docs/...`; model, dataset and Space facts through `hub_repo_details`, `hub_repo_search` and `hf_fs ls/cat`; package facts from the npm registry and the `@huggingface/transformers@4.3.0` tarball; bundler facts from this repo's `js/node_modules`. `huggingface.co`, `cdn.jsdelivr.net` and `datasets-server.huggingface.co` are unreachable from this sandbox (curl returned no connection), so nothing below was run against a live endpoint. Anything not settled by a primary source is marked *unverified*.

Gallery constraints applied throughout: Indian, Himalayan and South Asian art; one technical owner; a React 16 / CRA 3.4.3 / webpack 4.42 / TypeScript 4.1 / `target: es5` storefront published to Arweave and Cloudflare; API keys in the browser's `localStorage`; inscriptions translated in full; nothing unreviewed reaches NFT metadata; gallery photographs, client records, inventory and valuations never go to the Hub; no spend without an explicit yes.

## Summary

| # | Candidate | Value | Cost | Risk | Effort | Verdict |
|---|---|---|---|---|---|---|
| 1a | Transformers.js: in-browser background removal (BiRefNet_lite, MIT) | Medium | $0 (client CPU/GPU; ~115 MB model on first use) | Low privacy (photo never leaves the browser); build risk: cannot be bundled by webpack 4, must be loaded from a CDN at runtime | Medium (1–2 days incl. worker + review UI) | PROPOSE |
| 1b | Transformers.js: OCR of Devanagari / Tibetan inscriptions | None today | — | — | — | SKIP: no Transformers.js model exists for either script; the only serious Tibetan OCR (BDRC, 814M params) needs a GPU server |
| 1c | Transformers.js: CLIP image embeddings for "similar works in the collection" | Low now | $0 | Index has nowhere durable to live in a static storefront | High | SKIP for now (revisit if a collection index service exists) |
| 1d | Transformers.js: zero-shot object-type / region classification (CLIP) | Low | $0 | Duplicates what the VLM already returns, with lower accuracy | Low | SKIP |
| 2a | Inference Providers: image-segmentation / background removal (`briaai/RMBG-2.0` on fal-ai) | Low | Per call, fal-ai rate | RMBG-2.0 is gated with a non-commercial "other" licence; different wire format; photo goes to fal.ai | Medium | SKIP (licence + privacy); in-browser BiRefNet covers the need |
| 2b | Inference Providers: translation task (Sanskrit/Tibetan/Hindi/Persian) | None | — | — | — | SKIP: the task is served only by `hf-inference` with `google-t5/t5-small`; NLLB-200 is not live on any provider. Translation stays inside the VLM chat call |
| 2c | Inference Providers: feature-extraction (text embeddings) | Low now | Fractions of a cent per call | None material | Low | PROPOSE later, only with a place to store an index |
| 2d | Inference Providers: text-to-image / image-to-image | None | Per image | Brand and provenance risk; not a gallery need | — | SKIP |
| 3 | HF MCP Space tools (background removal, OCR, upscaling) | Low–Medium | Free within ZeroGPU quota (5 min/day free, 40 min/day PRO, then $1 per 10 min on PRO) | Photos leave the machine to a community-owned container; quota | Low (settings page) | PROPOSE: only `hf-applications/background-removal` (HF's own org, BiRefNet, MIT) and only for photographs already public on the storefront |
| 4 | Hub datasets for comparables (Met, Cleveland, Met SigLIP2 embeddings) | High (research), Medium (tooling) | $0 | Dataset Viewer timed out on every Met query today; 393 GB parquet cannot be downloaded | Low to document; Medium to build a comparables index | DO NOW (document + use via the `huggingface-datasets` skill); PROPOSE the SigLIP2 comparables index |
| 5 | Hub storage (private repos / buckets) for gallery assets | None | Free 100 GB private; PRO 1 TB then $18/TB/mo | Violates the no-upload rule for everything of value | — | SKIP |
| 6a | HF Jobs (batch compute) | Low | cpu-basic $0.01/hr; a10g-small ≈ $1/hr, billed per minute | Needs positive credit; anything mounted goes to HF infra | Low | PROPOSE only for public-data jobs (e.g. building the Met comparables index) |
| 6b | Dedicated Inference Endpoint (private VLM) | Low–Medium | T4 $0.50/hr … L40S $1.80/hr, per-minute; scale-to-zero | ≈ $580/mo for an always-on L4; cold starts of minutes | Low (storefront already accepts the URL) | PROPOSE only if Sanjay wants photographs off third-party providers |
| 6c | Private Gradio cataloguing Space | None | Needs PRO to run a Gradio Space; ZeroGPU quota | Duplicates the storefront without its review/apply guardrails; photos to HF infra | Medium | SKIP |
| 7 | Papers on iconography / cultural-heritage VLMs / Tibetan & Sanskrit OCR | Medium (reading) | $0 | None | Low | DO NOW: reading list below; nothing to integrate |
| 8 | Agent traces on the Hub (upload Claude Code / Codex sessions) | None | $0 | High: sessions contain client names, valuations, paths, secrets | — | SKIP, and forbid it explicitly |
| 9a | Local vision model on the LAN (llama.cpp + Qwen3-VL-8B GGUF) | Medium (private first pass) | $0 software; hardware unrecorded in `ops/network/inventory.csv` | 8B-class VLMs are far weaker than the 235B default, and unverified on Tibetan/Ranjana | Medium | PROPOSE (confirm hardware first) |
| 9b | Pi / OpenClaw / Hermes / OpenCode / llama-agent local coding agents | Low | $0 | Another agent to maintain | Low | SKIP for now (Claude Code + Codex already cover it) |
| 9c | HF Sandboxes, tiny-agents SDK, AI Sheets | None | Sandboxes are billed VMs | — | — | SKIP |

## DO NOW list

Small, safe and useful. None of these spend money or touch the Hub.

1. **Forbid uploading agent sessions.** Add to `AGENTS.md` (owned by the tooling agents): "Never run `hf upload` or `hf buckets sync` on `~/.claude/projects`, `~/.codex/sessions` or `~/.pi/agent/sessions`; these are agent traces and contain client names, valuations, local paths and secrets." Add a `deny` rule in `.claude/settings.json` alongside the existing `hf auth token` deny, for `Bash(hf upload*~/.claude*)`, `Bash(hf upload*.claude/projects*)`, `Bash(hf buckets sync*~/.claude*)`, `Bash(hf upload*~/.codex*)`, `Bash(hf buckets sync*~/.codex*)`. Mirror it in `.codex/config.toml` if Codex gains a command-deny mechanism (*unverified* whether 0.156 has one; the `hf_jobs`/`create_repo` tool removal already exists). Source for what traces contain: <https://huggingface.co/docs/hub/agent-traces> ("Trace files can include prompts, tool inputs, command output, local paths, screenshots, secrets, private code, and personal data").
2. **Document the comparables sources** in `docs/hugging-face.md` (owned by the docs agent), under a "Research sources" heading, so the vendored `huggingface-datasets` skill has targets:
   - `metmuseum/openaccess` (The Met's own org, CC0, 259.9K rows, 58 columns, 393.5 GB parquet with images: query it through the Dataset Viewer API, never download).
   - `metmuseum/openaccess-embeddings-siglip2` (CC0, 1.1 GB, `objectID` + 1152-d L2-normalised `google/siglip2-so400m-patch14-384` embedding per public-domain object).
   - `nyuuzyou/ClevelandMuseumArt` (community mirror of Cleveland's CC0 open-access CSV, 67.9K rows, 44 columns, one 39.9 MB parquet file).
   - `BDRC/tibetan-ocr-benchmark` (CC0, 472 hand-transcribed pages) and `openpecha/OCR-Tibetan_line_to_text_benchmark`, for testing any inscription OCR.
   - Note: the Met and Cleveland collections are also served by the museums' own APIs (`collectionapi.metmuseum.org`, `openaccess-api.clevelandart.org`), which need no HF account; the HF copies add parquet + the Viewer's `/search` and `/filter`.
3. **Add the reading list** (section 7) to the same doc. The `huggingface-papers` skill reads them by arXiv id.
4. **HF account MCP settings** (Sanjay, browser, <https://huggingface.co/settings/mcp>): keep "Dynamic Spaces" off (already recommended); add no Space tools until the decision in section 3.

Everything storefront-side is PROPOSE, not DO NOW, because the bundler constraint in section 1 makes even the smallest Transformers.js feature a CDN-loading decision, and `js/` is being edited by other agents.

---

## 1. Transformers.js in the storefront

### The bundler verdict (settles 1a–1d)

`@huggingface/transformers` is at **4.3.0** (npm `time.modified` 2026-09-16; v4 released 2026-02-09 per <https://huggingface.co/blog/transformersjs-v4>). It depends on `onnxruntime-web 1.31.0-dev.20260914`. Facts from the tarball and this repo's `js/node_modules`:

- The package is `"type": "module"` with an `exports` map: `node` → `dist/transformers.node.{mjs,cjs}`, `default` → `dist/transformers.web.js`. `main` is `./dist/transformers.node.cjs`; there is no `browser` or `module` field. **webpack 4 does not read `exports`** (added in webpack 5), so `import '@huggingface/transformers'` in this build resolves to the Node build, which pulls `onnxruntime-node` and `sharp`. That fails.
- Even aliased to `dist/transformers.web.js`, that file contains `import.meta.url` three times and `import.meta` once. webpack 4.42.0 (`js/node_modules/webpack`) has no `import.meta` support (no `ImportMeta` plugin under `lib/`; webpack 5 added it). Result: "Module parse failed".
- Optional chaining and `??` (63 and 295 lines in the web build) are not a problem: CRA 3.4.3 runs `node_modules` through `babel-preset-react-app/dependencies` with `@babel/preset-env 7.14.4`, which transpiles both.
- `@xenova/transformers` 2.17.2 (2024, onnxruntime-web 1.14) is no better (`main` is ESM source with the same `import.meta` pattern) and is unmaintained.

**The only way to use Transformers.js in this storefront without replacing the bundler is to load it at runtime from a CDN.** webpack 4.42's `ImportParserPlugin` returns early on `/* webpackIgnore: true */` ("Do not instrument `import()` if `webpackIgnore` is `true`", `lib/dependencies/ImportParserPlugin.js` line ~65), so a native browser `import()` survives the build. Pattern:

```ts
// Keep the specifier in a variable: TS 4.1 then types the result as Promise<any>
// and does not try to resolve it as a module.
const TJS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0';
const tjs = await import(/* webpackIgnore: true */ TJS_URL);
```

Consequences: the dealer's browser must reach `cdn.jsdelivr.net` (library, 450 KB minified web build + the ONNX Runtime WASM files it fetches from the same CDN; WASM size *unverified*) and `huggingface.co` (model weights, no token needed for public models; Transformers.js caches them in the browser Cache API). Nothing is added to the Arweave/Cloudflare bundle. HF's own docs show this CDN import as the supported no-bundler route (<https://huggingface.co/docs/transformers.js/installation>). Alternative: a separate Vite-built page or Web Worker shipped as a static file, which is more work and adds MBs to the Arweave upload.

Devices: WASM is the default and works everywhere; WebGPU is opt-in (`device: 'webgpu'`) and HF's guide says global support is "around 85%" as of March 2026, with Safari version-dependent (<https://huggingface.co/docs/transformers.js/guides/webgpu>). Quantised `q8` is the WASM default (<https://huggingface.co/docs/transformers.js/index>).

### 1a. Background removal — PROPOSE

Models with `library: transformers.js`, sizes from `hf_fs ls`:

| Model | Licence | Files (browser) | Fit |
|---|---|---|---|
| `onnx-community/BiRefNet_lite-ONNX` | MIT | `model_fp16.onnx` 114.5 MB, `model.onnx` 224 MB | General objects: the right one for bronzes, thangkas on a table, manuscripts. The same BiRefNet family runs HF's own Space (section 3) |
| `briaai/RMBG-1.4` | "other" (BRIA; tags carry "legal liability") | quantized 44 MB | Best quality per MB, but BRIA's licence is non-commercial without an agreement: **not for a business** |
| `Xenova/modnet` | Apache-2.0 | quantized 6.6 MB | Portrait matting; wrong domain |

Value: medium. Catalogue photographs are usually shot on seamless backgrounds already; the win is quick cut-outs for the storefront thumbnail and social posts, done on the dealer's machine so unpublished photographs never leave it. Risk: a cut-out is an edit to the artwork image, so it must be a separate optional output reviewed by the dealer, never a silent replacement of the mint image; and the first use downloads ~115 MB. Effort: a Web Worker (the model blocks the main thread otherwise), a "Cut out background" button in the mint flow, a side-by-side review, and a note in `docs/hugging-face.md`. Files: new `js/packages/web/src/ai/browser/` module (pure, testable like the rest of `src/ai`) plus a small worker file under `public/`. Decision for Sanjay: is the feature worth a CDN dependency at runtime.

### 1b. OCR of inscriptions — SKIP

- No Transformers.js model reads Devanagari, Tibetan, Ranjana, Newari or Nastaliq. `onnx-community/Florence-2-base-ft` (MIT) and TrOCR do English/Latin OCR in the browser.
- **Tibetan:** `BDRC/tibetan-ocr` ("Yigdzin 1", Buddhist Digital Resource Center, Apache-2.0, released 2026-08-17, 96K downloads) is the serious model: PaddleOCR-VL-1.6 fine-tune, 814M parameters, median page CER ≈ 1.4% on a 1,070-page held-out benchmark, covers uchen and u-med, woodblock and manuscript. It needs `transformers ≥ 5.15` or `vLLM ≥ 0.26`, a GPU, and a special "sequential" position regime; it is not on any Inference Provider and has no ONNX. BDRC runs it at <https://ocr.bdrc.io> and ships a desktop app (`buda-base/tibetan-ocr-app`). Source: `hf://models/BDRC/tibetan-ocr/README.md`. It is trained on pecha pages, not on inscriptions cast into bronze or painted on thangka borders; *unverified* on those.
- **Devanagari:** `PaddlePaddle/devanagari_PP-OCRv5_mobile_rec_onnx` (Apache-2.0) exists as an ONNX recogniser, but it is a PaddleOCR component (needs the detector and Paddle pre/post-processing), not a Transformers.js model. `snskrt/qwen2-5-vl-sanskrit-ocr` and `snskrt/gemma-3-4b-it-sanskrit-ocr` (GGUF via mradermacher) are Sanskrit OCR fine-tunes for local llama.cpp use; quality *unverified*.
- The storefront's inscription block already comes from the VLM call. The realistic OCR upgrade is a local or hosted VLM/OCR server (sections 6b, 9a), not the browser.

### 1c. Image embeddings for "similar works in the collection" — SKIP for now

`Xenova/clip-vit-base-patch32` (vision `q8` 89 MB, text `q8` 64 MB) or `Xenova/clip-vit-base-patch16` run in the browser and produce embeddings. The blocker is not the model: a static storefront on Arweave has no server to hold an index of the collection's embeddings, `localStorage` is far too small, and IndexedDB is per-browser. Also, to match against the Met's SigLIP2 vectors (section 4) the same model (`google/siglip2-so400m-patch14-384`, 1.14B parameters) is needed; no Transformers.js conversion of it was found (`hf_fs search` returned nothing). Revisit if a collection index service (Supabase, which the gallery already uses, has pgvector) is decided on.

### 1d. Zero-shot classification — SKIP

`Xenova/clip-vit-base-patch32` with `zero-shot-image-classification` (documented pipeline: <https://huggingface.co/docs/transformers.js/api/pipelines#zeroshotimageclassificationpipeline>) can label "thangka / bronze / miniature painting / manuscript". `CatalogueRecord.objectType`, `culture.region` and `schoolOrSubRegion` already come from the VLM with an iconographic rationale and a confidence level; CLIP-base would add a weaker second opinion and nothing on region. Not worth the download.

## 2. Inference Providers beyond chat

The task list at `hf://docs/inference-providers/tasks/` is: audio-classification, automatic-speech-recognition, chat-completion, feature-extraction, fill-mask, image-classification, image-segmentation, image-text-to-text, image-to-image, object-detection, question-answering, summarization, table-question-answering, text-classification, text-generation, text-to-image, text-to-video, token-classification, translation, zero-shot-classification. There is **no `image-to-text` page** (the manifest returns not-found) and no image-feature-extraction: captioning is a chat-completion call to an `image-text-to-text` model, which the storefront already makes.

- **2a. image-segmentation.** Documented provider mapping: `fal-ai` → `briaai/RMBG-2.0`, `hf-inference` → `jonathandinu/face-parsing` (<https://huggingface.co/docs/inference-providers/tasks/image-segmentation>). Wire format differs from chat: `inputs` is a base64 string (or raw bytes), the response is an array of `{label, mask (base64 PNG), score}`. `briaai/RMBG-2.0` is gated, licence "other" (BRIA), live on fal-ai only. Verdict SKIP: non-commercial licence, the photo goes to fal.ai, and section 1a does the job locally with an MIT model.
- **2b. translation.** The task page's only mapping is `hf-inference` → `google-t5/t5-small`; the recommended model is `google-t5/t5-base` (English↔German/French/Romanian). `facebook/nllb-200-distilled-600M` (covers `bo`, `sa`, `hi`, `pes`, `npi`, `ur`) is CC-BY-NC-4.0 and shows no live provider in `hub_repo_details`. No Sanskrit or Tibetan translation model was found live on any provider. Verdict SKIP: the full inscription translation stays in the VLM call, where the prompt and validator already enforce completeness.
- **2c. feature-extraction.** Text embeddings: `deepinfra` → `Qwen/Qwen3-Embedding-0.6B`, `scaleway` → `Qwen/Qwen3-Embedding-8B`, `hf-inference` → `BAAI/bge-small-en-v1.5` (<https://huggingface.co/docs/inference-providers/tasks/feature-extraction>). Useful only once there is somewhere to store vectors (see 1c). PROPOSE later.
- **2d. text-to-image / image-to-image.** FLUX, Qwen-Image, Krea on fal-ai, replicate, nscale, wavespeed; image-to-image is editing (FLUX.2-klein), not upscaling. A gallery selling attributed antiquities should not publish generated imagery of its stock. SKIP.

## 3. HF MCP server: Gradio Space tools — PROPOSE (narrowly)

Facts (<https://huggingface.co/docs/hub/agents-mcp>, <https://huggingface.co/docs/hub/spaces-mcp-servers>): any public Space with the MCP badge can be added at <https://huggingface.co/settings/mcp> with one click; the extra built-in tool sets are Contribute Repos, Sandboxes, Run and Manage Jobs; "Dynamic Spaces" lets the assistant call any MCP Space at runtime. ZeroGPU quota: 5 minutes/day for a free account, 40 minutes/day for PRO, 2 minutes unauthenticated (<https://huggingface.co/docs/hub/spaces-api-endpoints#zerogpu-spaces>); PRO/Team/Enterprise overflow is billed at $1 per 10 GPU-minutes (<https://huggingface.co/docs/hub/spaces-zerogpu#extending-quota-with-credits>).

Candidates found with `hf_fs search hf://spaces --kind mcp`:

| Space | What it runs | Hardware | Notes |
|---|---|---|---|
| `hf-applications/background-removal` | `ZhengPeng7/BiRefNet` (MIT), `@spaces.GPU` | ZeroGPU | HF's own org; same code as `not-lain/background-removal` (2,954 likes, MIT) |
| `prithivMLmods/Multimodal-OCR` | Nanonets-OCR2-3B, olmOCR-7B, RolmOCR-7B, Aya-Vision-8B, Qwen2-VL-OCR-2B | ZeroGPU | Latin-script document OCR; Aya-Vision adds Hindi/Persian (CC-BY-NC); nothing for Tibetan or Ranjana |
| `mudderhugger/PaddleOCR-VL-1.6-Demo` | PaddleOCR-VL-1.6 | ZeroGPU | Community demo, 0 likes; the base of BDRC's model but not the Tibetan fine-tune |
| `StarDoc-AI/navidc-ocr-demo` | NaviDC-OCR, documents → Markdown | *unverified* | 50 likes; document parsing, not inscriptions |
| `prithivMLmods/PiD-Image-Upscaler` | Pixel Diffusion Decoder | *unverified* | Generative upscaling invents detail: unsuitable for condition-relevant photographs |

No Space runs `BDRC/tibetan-ocr` with MCP; BDRC's own `tibetan-ocr-leaderboard` is a static Space.

Privacy: a call sends the image to the Space author's container. Under the owner's rule that is the same as uploading a gallery photograph, except for images that are already public on the storefront (Arweave/Cloudflare), which have nothing left to protect. Recommendation: if Sanjay wants agent-side cut-outs, add only `hf-applications/background-removal`, use it only on already-published images, keep Dynamic Spaces off, and note that the storefront's own in-browser route (1a) is the private one. Everything else: SKIP.

## 4. Datasets for comparables and provenance — DO NOW (document) / PROPOSE (index)

Found with `hub_repo_search` (semantic `hf_fs search` returned nothing for "Metropolitan" or "Cleveland"; keyword search did):

| Dataset | Owner | Licence | Size | Use |
|---|---|---|---|---|
| `metmuseum/openaccess` | The Met (official org) | CC0-1.0 | 259.9K rows, 58 columns, 52 parquet files, **393.5 GB** (images embedded), updated 2026-04-30 | Comparables by department/culture/object; only through the Dataset Viewer API |
| `metmuseum/openaccess-embeddings-siglip2` | The Met | CC0-1.0 | 259.6K rows, 4 columns (`objectID`, `embedding` 1152-d L2-normalised, `model`, `dim`), 1.1 GB | Visual nearest-neighbour search against the Met; sister sets exist for OpenCLIP ViT-bigG-14, DINOv2-giant, MobileCLIP and SigLIP2-naflex |
| `nyuuzyou/ClevelandMuseumArt` | community mirror | CC0-1.0 | 67.9K rows, 44 columns, one 39.9 MB parquet | Cleveland comparables; trivially downloadable |
| `Mitsua/art-museums-pd-440k` | Mitsua | CC-BY-4.0 (images CC0/PD) | est. 293.7K rows, 5 GB webdataset; columns Author/Title/URL/captionEn/source | Public-domain museum images with captions |
| `Asttrid/Museum-65-v1.0` | paper dataset (2412.01370) | CC-BY-NC-4.0 | — | Research only |
| `Carolyn-Jiang/Metadata-Inference` | Appear2Meaning benchmark | MIT | <1K rows; Viewer generation failed | Research only |

Not on the Hub: Rubin Museum / Himalayan Art Resources, LACMA, Asian Art Museum, Wikimedia Commons art dumps ("himalayan art thangka", "wikimedia commons artwork" → no results).

Can the `huggingface-datasets` skill query these without downloading? Yes by design: `datasets-server.huggingface.co` `/rows`, `/search`, `/filter` (100 rows per page), plus `/parquet` URLs, as the vendored `SKILL.md` documents. Two caveats observed today: the Met dataset's Viewer timed out on both a structure and a preview request through `hub_repo_details`, and `datasets-server.huggingface.co` is unreachable from cloud sessions of this repo (curl got no connection), so this only works from a gallery machine. The museums' own APIs remain the primary sources.

PROPOSE: a comparables index. Download the 1.1 GB SigLIP2 parquet once to the studio Mac, embed a gallery photograph locally with `google/siglip2-so400m-patch14-384` (Apache-2.0, 1.14B parameters; ~2.3 GB in fp16, CPU is fine for single images), cosine-search the Met vectors, and resolve `objectID` through the Met API. The photograph never leaves the machine. Python on one machine, half a day; no spend. A HF Job could do the same for cents but would mean sending the photograph to HF infra, so run it locally.

## 5. Hub storage for gallery assets — SKIP

Facts: free accounts get 100 GB of private storage and "best-effort" public storage; PRO includes 1 TB private, then $18/TB/month pay-as-you-go (<https://huggingface.co/docs/hub/storage-limits>, <https://huggingface.co/docs/hub/billing>). Storage Buckets are S3-like, mutable, unversioned, AES-256 at rest, can be private, and have "a free storage allowance" with pricing at hf.co/storage (page not readable here) (<https://huggingface.co/docs/hub/storage-buckets>, `storage-buckets-security.md`).

Applying the owner's rule: photographs, client records, inventory and valuations are excluded, the code lives on GitHub, research notes live in this repo, and model weights are already on the Hub. Nothing of value remains to store there. Google Drive and Supabase stay.

## 6. Jobs, Inference Endpoints, Spaces for a private gallery tool

- **6a. Jobs.** Billed per minute of hardware, "available to any user or organization with a positive credit balance"; `cpu-basic` $0.01/hr, `cpu-upgrade` $0.03/hr, `a10g-small` ≈ $0.17 per 10 minutes, `l40sx8` $23.50/hr (<https://huggingface.co/docs/hub/jobs-pricing>, <https://huggingface.co/docs/hub/jobs-configuration#hardware-flavor>). Inputs come from Hub repos, buckets or a local directory mounted with `-v ./dir:/data`, all of which put the data on HF infra. PROPOSE only for public-data work such as re-embedding Met/Cleveland images; never for gallery photographs. Codex and Gemini already have `hf_jobs` removed; Claude Code asks.
- **6b. Dedicated Inference Endpoint.** Per-minute billing of running or initialising replicas; AWS T4 $0.50/hr, L4 $0.80/hr, A10G $1.00/hr, L40S $1.80/hr (<https://huggingface.co/docs/inference-endpoints/support/pricing>); scale-to-zero answers 503 for minutes while starting (`inference_providers.md` §10). An always-on L4 is ≈ $580/month; a `Qwen3-VL-8B` or `BDRC/tibetan-ocr` endpoint would fit one. The storefront provider already accepts an endpoint URL. The only reason to pay: keeping photographs off third-party providers (an endpoint is HF-run infra, single tenant). PROPOSE, only if that privacy line matters more than the cost; otherwise SKIP.
- **6c. Private Gradio Space.** "Creating a Space that runs on compute (Gradio or Docker) requires a paid plan"; PRO can host up to 10 ZeroGPU Spaces (<https://huggingface.co/docs/hub/spaces-overview#hardware-resources>, <https://huggingface.co/docs/hub/pro>). A cataloguing app with the storefront's prompt would duplicate `src/ai` without its validator, warning codes, review panel or apply-to-metadata gate, and would send photographs to HF infra. SKIP.

## 7. Papers — DO NOW (reading list)

Found via `hf_fs search hf://papers`. Read with the vendored `huggingface-papers` skill.

| arXiv | Title | Why it matters here |
|---|---|---|
| 2604.07338 | Appear2Meaning: cross-cultural benchmark for structured cultural metadata inference from images (ACM MM 2026) | Shows VLMs infer creator/origin/period inconsistently across cultures; supports the storefront's confidence levels, `uncertainties` and review gate |
| 2412.01370 | Understanding Museum Exhibits using Vision-Language Reasoning (Museum-65: 65M images, 200M QA pairs) | Fine-tuned VLMs beat general ones on historical-context questions; the dataset is CC-BY-NC |
| 2507.21917 | ArtSeek: multimodal in-context reasoning and late-interaction retrieval for artwork understanding | A retrieval-augmented cataloguing design, close to section 4's comparables idea |
| 2607.16321 | Art Beyond Semantics (CANVAS): multi-relational artwork embeddings | Relation-aware embeddings (style, period, iconography) rather than plain CLIP |
| 1810.02569 | Weakly supervised object detection in artworks | Iconographic-element detection with image-level labels |
| 2211.01226 | DEArt: dataset of European art | Object detection / pose in cultural heritage; European, but the method transfers |
| 2607.18907 | SynGallery: instance-level artwork recognition | Recognising a specific work from gallery-condition photographs |
| 2508.01408 | Can VLMs judge the hand or the machine behind the canvas? | VLMs are poor at attribution; a caution for any "attributed to" field |
| 2602.21042 | OmniOCR: generalist OCR for ethnic-minority scripts (evaluated on TibetanMNIST among others) | Tibetan OCR method; code on GitHub |
| 2605.26601 | FTibSuite: resource suite for Tibetan vision-language modelling | Tibetan VLM datasets and baseline |
| 2211.07980 | Post-OCR text correction in Sanskrit | Relevant if inscription OCR is ever automated |
| 2305.14004 | Sāmayik: English–Sanskrit translation benchmark | Translation-quality baselines for Sanskrit |

Also relevant, not papers: `BDRC/tibetan-ocr` model card (benchmark method, CER figures) and the `BDRC/tibetan-ocr-leaderboard` Space.

## 8. Agent traces — SKIP, and forbid

Facts (<https://huggingface.co/docs/hub/agent-traces>): the Hub renders raw JSONL sessions from Claude Code (`~/.claude/projects`), Codex (`~/.codex/sessions`) and Pi (`~/.pi/agent/sessions`) in a trace viewer after `hf upload … --repo-type dataset` or `hf buckets sync`; the docs say traces "can include prompts, tool inputs, command output, local paths, screenshots, secrets, private code, and personal data" and to keep them private "if you are not sure what is inside". The docs do not state whether a new dataset defaults to private.

For this gallery the sessions include Gmail drafts, invoices, wire reconciliation, client and consignor names, valuations and inventory (see the `kapoor-*` skills). A private repo still puts that on HF infrastructure under an account whose read token sits in `HF_TOKEN` on several LAN machines. No redaction tooling exists for Claude Code or Codex traces (HF names `pi-share-hf` for Pi only). Verdict: never upload, and encode it (DO NOW item 1).

## 9. Other things HF ships for coding agents in 2026

- **9a. Local vision model on the LAN — PROPOSE.** HF's local-agents page (<https://huggingface.co/docs/hub/agents-local>) standardises on `llama-server -hf <repo>:<quant>` (OpenAI-compatible on `localhost:8080/v1`) and shows vision enabled in Pi with `"input": ["text", "image"]`, using `unsloth/Qwen3.6-35B-A3B-GGUF:Q4_K_XL` as the example. Candidate files (`hf_fs ls`): `Qwen/Qwen3-VL-8B-Instruct-GGUF` Q4_K_M 5.03 GB + `mmproj` Q8_0 0.75 GB (Apache-2.0); `ggml-org/gemma-4-26b-a4b-it-GGUF` Q4_0 14.6 GB + mmproj Q8_0 0.81 GB. Rough memory need: ≈ 7 GB for Qwen3-VL-8B Q4 with a 4k context, ≈ 17 GB for Gemma 4 26B-A4B Q4 (weights plus projector; KV cache extra; use the vendored `hf-mem` skill for exact numbers: `uvx hf-mem --model-id Qwen/Qwen3-VL-8B-Instruct-GGUF --gguf-file Qwen3VL-8B-Instruct-Q4_K_M.gguf --experimental`). `ops/network/inventory.csv` records no hardware for `gallery-desk` (Windows), `studio-mac` (macOS) or the two new PCs, and HF's new Hardware profile (<https://huggingface.co/docs/hub/hardware>) is public by default, so do not fill it in without turning "Publicly Visible" off. Honest expectation: an 8B VLM gives a private first pass (object type, condition notes, obvious iconography) but is markedly weaker than the 235B default for inscriptions, and none of these models is verified on Tibetan, Ranjana or Newari. The storefront can already point the `huggingface` provider's Base URL at `http://studio-mac:8080/v1` with a blank key (proxy mode); whether `llama-server` sends the CORS headers a browser on another origin needs is *unverified* (check `llama-server --help` for a CORS flag before relying on it). Decision for Sanjay: confirm which machine has ≥ 16 GB unified memory or a ≥ 12 GB NVIDIA GPU, then run one evaluation on a known set of inscribed pieces.
- **9b. Local coding agents.** Pi (`npm install -g --ignore-scripts @earendil-works/pi-coding-agent`, config `~/.pi/agent/models.json`), OpenClaw, Hermes Agent, OpenCode and `llama-agent` (single C++ binary, in-process tools, MCP support). All documented on the same page. SKIP for now: Claude Code and Codex are installed and configured everywhere; a third agent adds maintenance without a new capability.
- **9c. Sandboxes** (`hf sandbox create`, pools; billed VMs, <https://huggingface.co/docs/huggingface_hub/guides/sandbox>) are already removed from Codex/Gemini tool lists; **tiny-agents SDK** (`@huggingface/tiny-agents`, `huggingface_hub[mcp]`) builds agents on Inference Providers; **AI Sheets** (no-code dataset enrichment) would mean uploading data. SKIP all three.
- **9d. Skills.** HF's skills page lists 11 skills (<https://huggingface.co/docs/hub/agents-skills>); the repo already vendors 18 from `huggingface/skills`, so nothing is missing.

## Queries run

- `hf_fs cat`: `docs/transformers.js/{index,installation}.md`, `docs/transformers.js/guides/webgpu.md`; `docs/inference-providers/tasks/{image-segmentation,translation,feature-extraction,text-to-image,image-to-image}.md` (and `image-to-text.md`, not found); `docs/hub/{agent-traces,agents-mcp,agents-local,agents-overview,agents-skills,agents-sdk,hardware,storage-buckets,spaces-zerogpu,spaces-mcp-servers,spaces-gpus,jobs-configuration,gguf-llamacpp}.md`; `docs/inference-endpoints/support/pricing.md`; model cards `BDRC/tibetan-ocr`, `PaddlePaddle/devanagari_PP-OCRv5_mobile_rec_onnx`; Space files `not-lain/background-removal/{README.md,app.py}`, `hf-applications/background-removal/README.md`, `prithivMLmods/Multimodal-OCR/app.py`; papers `2604.07338`, `2412.01370`, `2602.21042`.
- `hf_fs ls`: `docs/inference-providers/tasks`, `docs/transformers.js`; `onnx/` folders of `Xenova/modnet`, `onnx-community/BiRefNet_lite-ONNX`, `briaai/RMBG-1.4`, `Xenova/clip-vit-base-patch16`, `Xenova/clip-vit-base-patch32`, `Xenova/nllb-200-distilled-600M`; `Qwen/Qwen3-VL-8B-Instruct-GGUF`; `ggml-org/gemma-4-26b-a4b-it-GGUF`.
- `hf_fs search`: docs (agent traces, buckets, storage limits, jobs pricing, spaces pricing, endpoints pricing, llama.cpp vision, Pi, AI Sheets, sandboxes, PRO); spaces `--kind mcp` (background removal, OCR, upscale, image caption, PaddleOCR-VL) and plain (Tibetan OCR); datasets (Met, Cleveland, wikiart, museum open access); papers (iconography, Buddhist art/thangka, cultural-heritage VLMs, Tibetan OCR, Indian miniature painting, Tibetan, Sanskrit manuscript); models (Tibetan OCR, Devanagari OCR, Sanskrit translation, Tibetan translation, background removal, CLIP ONNX, SigLIP2 ONNX, Florence-2 ONNX, Monlam, Dharmamitra).
- `hub_repo_search`: datasets "met museum", "museum", "cleveland", "wikimedia commons artwork", "indian painting"; models "tibetan", "sanskrit", "Qwen3-VL-8B-Instruct GGUF"; "himalayan art thangka".
- `hub_repo_details`: models `briaai/RMBG-2.0`, `briaai/RMBG-1.4`, `ZhengPeng7/BiRefNet`, `onnx-community/BiRefNet_lite-ONNX`, `Xenova/modnet`, `facebook/nllb-200-distilled-600M`, `Xenova/nllb-200-distilled-600M`, `openai/clip-vit-large-patch14`, `Xenova/clip-vit-base-patch16`, `google/siglip2-so400m-patch14-384`, `BDRC/tibetan-ocr`, `PaddlePaddle/PaddleOCR-VL-1.6`, `Qwen/Qwen3-VL-8B-Instruct-GGUF`, `onnx-community/Florence-2-base-ft`, `deepseek-ai/DeepSeek-OCR-2`; spaces (six MCP candidates); datasets `metmuseum/openaccess` (structure + preview, both timed out on rows), `metmuseum/openaccess-embeddings-siglip2`, `Carolyn-Jiang/Metadata-Inference`, `nyuuzyou/ClevelandMuseumArt`, `Mitsua/art-museums-pd-440k`.
- npm: `npm view` on `@huggingface/transformers`, `@xenova/transformers`, `onnxruntime-web`, `@huggingface/inference`, `@huggingface/hub`, `@imgly/background-removal`; `npm pack @huggingface/transformers@4.3.0` and inspection of `package.json` and `dist/`.
- Repo: `js/packages/web/{package.json,tsconfig.json,craco.config.js,public/index.html}`, `js/node_modules/{webpack,acorn,babel-preset-react-app,@babel/preset-env,react-scripts}` versions, `webpack/lib/Parser.js` (`ecmaVersion: 11`), `webpack/lib/dependencies/ImportParserPlugin.js` (`webpackIgnore`), `react-scripts/config/webpack.config.js` (dependencies preset), `ops/network/{inventory.csv,status.md,README.md}`.
- WebFetch: `raw.githubusercontent.com` copies of `transformers.js/README.md`, `hub-docs/docs/hub/agent-traces.md`, `hub-docs/docs/hub/storage-limits.md`. WebSearch: Transformers.js v4 release, agent traces.

## Exhausted leads

- `huggingface.co`, `cdn.jsdelivr.net`, `datasets-server.huggingface.co`: unreachable from this sandbox, so no live Viewer query, CDN fetch or CORS check was made.
- Met Dataset Viewer rows: two timeouts through the MCP tool; the 58 column names were not read (the Met's CSV columns, e.g. Department, Culture, Object Name, are known from the Met's own open-access CSV but were not verified here).
- ONNX Runtime WASM download size for `onnxruntime-web 1.31.0-dev`: not measured.
- `llama-server` CORS behaviour for a browser on another origin: not verified.
- Any Transformers.js (ONNX) conversion of `google/siglip2-so400m-patch14-384`: none found.
- Rubin Museum / Himalayan Art Resources, LACMA, Asian Art Museum, Wikimedia Commons datasets on the Hub: none found.
- Bucket pricing (hf.co/storage) and the PRO monthly price: pages not in the docs mirror; not stated here.
- Codex per-command deny rules (to mirror the Claude Code trace-upload deny): not verified for Codex 0.156.
