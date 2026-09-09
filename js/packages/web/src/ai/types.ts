/**
 * Shared types for the AI cataloguing layer.
 *
 * This file has NO imports, and nothing anywhere under src/ai imports from
 * '@oyster/common', 'antd' or 'react'. That is deliberate: it lets the whole
 * layer be typechecked and unit-tested without first building the common
 * package to dist/lib, and without tripping the duplicate @types/bn.js hoist.
 *
 * tsconfig facts that shaped this file (js/packages/web/tsconfig.json):
 * target "es5", strict true, isolatedModules true.
 *  - target es5 means `class X extends Error` silently breaks `instanceof`,
 *    so AiError is a branded plain object plus a type guard, not a class.
 *  - isolatedModules means any re-export of a type must use
 *    `export type { ... }`.
 */

export type ProviderId = 'gemini' | 'openai';

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'unable';

export type InscriptionPresence = 'yes' | 'no' | 'possible';

export type TranslationCompleteness =
  | 'complete'
  | 'partial'
  | 'illegible'
  | 'not-applicable';

/* ------------------------------------------------------------------ */
/* The catalogue record                                                */
/*                                                                     */
/* Every field is REQUIRED and non-nullable. Absence is modelled as     */
/* '' (string), [] (array), 0 (number) or a 'no' enum member. This is   */
/* forced by OpenAI strict json_schema, which requires every property   */
/* to appear in `required`, and it is also the only shape Gemini's      */
/* responseSchema accepts without special-casing.                       */
/* ------------------------------------------------------------------ */

export interface SubjectBlock {
  /** Generated FIRST: what is physically visible. Attributes held,
   *  mudra, asana, vahana, lakshanas, crown and jewellery type. */
  iconographicBasis: string;
  primaryIdentification: string;
  alternativeIdentifications: string[];
}

export interface CultureBlock {
  /** 'Nepal', 'Tibet', 'North India (Bihar)'. '' if undetermined. */
  region: string;
  /** 'Newar, Kathmandu Valley', 'Pala'. '' if undetermined. */
  schoolOrSubRegion: string;
  /** 'Vajrayana Buddhist', 'Shaiva'. '' if undetermined. */
  tradition: string;
}

export interface PeriodBlock {
  /** Generated FIRST: the style features that drive the date. */
  datingRationale: string;
  /** 'Malla period', 'circa 15th century'. '' if undetermined. */
  label: string;
  /** CE years. 0 means not determined. Negative values are BCE. */
  earliestYear: number;
  latestYear: number;
}

export interface MediumBlock {
  primaryMedium: string;
  materials: string[];
  surfaceAndDecoration: string[];
}

export interface DimensionsBlock {
  /** True ONLY if a ruler, scale bar or stated measurement is visible in
   *  a photograph, or measurements were supplied in dealerNotes. */
  scaleReferenceVisible: boolean;
  /** Centimetres. 0 means not determined. */
  heightCm: number;
  widthCm: number;
  depthCm: number;
  basisForMeasurement: string;
}

export interface ConditionBlock {
  summary: string;
  observations: string[];
}

export interface InscriptionSegment {
  /** 'front of lotus base', 'reverse, upper register'. */
  location: string;
  /** Script only, not language: 'Ranjana (Lantsa)', 'Uchen', 'Devanagari'. */
  script: string;
  language: string;
  /** Verbatim, in the original script. Illegible runs marked [illegible]. */
  transcription: string;
  /** IAST for Sanskrit/Devanagari, Wylie for Tibetan. */
  transliteration: string;
  /** Complete translation of THIS segment. Never empty for a segment that
   *  has a transcription: the validator rejects that. */
  translation: string;
  notes: string;
}

export interface InscriptionBlock {
  present: InscriptionPresence;
  /** Empty when present === 'no'. One entry per distinct inscription. */
  segments: InscriptionSegment[];
  completeness: TranslationCompleteness;
  untranslatedPortions: string;
}

export interface ConfidenceBlock {
  subject: ConfidenceLevel;
  culture: ConfidenceLevel;
  period: ConfidenceLevel;
  medium: ConfidenceLevel;
  inscription: ConfidenceLevel;
}

export interface CatalogueRecord {
  objectType: string;
  title: string;
  subject: SubjectBlock;
  culture: CultureBlock;
  period: PeriodBlock;
  medium: MediumBlock;
  dimensions: DimensionsBlock;
  condition: ConditionBlock;
  inscription: InscriptionBlock;
  catalogueDescription: string;
  /** Must equal NO_PROVENANCE_SENTINEL unless a label, inventory number or
   *  sticker is physically legible in a photograph. */
  provenanceNote: string;
  confidence: ConfidenceBlock;
  uncertainties: string[];
  /** Working notes for the dealer. Never written to NFT metadata. */
  recommendedExpertChecks: string[];
}

/* ------------------------------------------------------------------ */
/* Request / result                                                    */
/* ------------------------------------------------------------------ */

export interface InlineImagePart {
  kind: 'inline';
  mimeType: string;
  /** base64 body only, WITHOUT any `data:<mime>;base64,` prefix. */
  base64: string;
  label: string;
}

export interface RemoteImagePart {
  kind: 'remote';
  url: string;
  label: string;
}

export type ImagePart = InlineImagePart | RemoteImagePart;

export interface CatalogueRequest {
  /** images[0] is the primary artwork image; the rest are detail shots. */
  images: ImagePart[];
  /** Free text the dealer already knows. Treated as authoritative. */
  dealerNotes: string;
  maxOutputTokens: number;
  temperature: number;
}

export type WarningCode =
  | 'partial-translation'
  | 'unscaled-dimensions'
  | 'inverted-date-range'
  | 'implausible-date-range'
  | 'no-uncertainties-declared'
  | 'provenance-asserted'
  | 'low-confidence-subject';

export interface RecordWarning {
  code: WarningCode;
  /** 'block' pre-unchecks the affected section in the review panel and
   *  requires an explicit override tick before it can be applied. */
  severity: 'block' | 'warn';
  message: string;
}

export interface CatalogueResult {
  providerId: ProviderId;
  model: string;
  record: CatalogueRecord;
  warnings: RecordWarning[];
  /** The model's raw JSON text, for the "show raw response" toggle. Never
   *  contains the request or any header. */
  rawText: string;
  elapsedMs: number;
  /** True when the structured-output request was rejected and the driver
   *  fell back to a looser shape. Surfaced in the review panel. */
  usedFallback: boolean;
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

/** Everything needed to issue one call, produced purely so the exact wire
 *  format is assertable in a test with no network. */
export interface HttpPlan {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  /** Already JSON.stringify'd. */
  body: string;
}

export interface AiProvider {
  id: ProviderId;
  label: string;
  /** Where the user gets a key; rendered as a link in the settings form. */
  keyUrl: string;
  defaultModel: string;
  defaultBaseUrl: string;
  /** Model ids offered as a datalist convenience in the settings form.
   *  Never a closed list: provider catalogues change. */
  modelSuggestions: string[];
  /** False for Gemini: it cannot fetch a remote image URL itself. */
  supportsRemoteImageUrl: boolean;
  /** Pure. */
  buildRequest(req: CatalogueRequest, cfg: ProviderSettings): HttpPlan;
  /** Pure. Same shape as buildRequest but without the structured-output
   *  directive, for endpoints that reject it. */
  buildFallbackRequest(req: CatalogueRequest, cfg: ProviderSettings): HttpPlan;
  /** Pure. HTTP status + parsed JSON body -> the model's raw JSON text.
   *  Throws an AiError for every non-success outcome. */
  extractText(status: number, body: unknown, cfg: ProviderSettings): string;
  /** Pure, optional. Given the rejected request body (already parsed) and
   *  the provider's 400 message, return an adapted body to retry once, or
   *  null to give up. */
  retryBody?(body: unknown, message: string): unknown | null;
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export interface ProviderSettings {
  /** '' means "a proxy at baseUrl holds the key"; no auth header is sent. */
  apiKey: string;
  model: string;
  /** No trailing slash. Override to route through a self-hosted proxy. */
  baseUrl: string;
}

export interface AiSettings {
  activeProvider: ProviderId;
  providers: { gemini: ProviderSettings; openai: ProviderSettings };
  imageMaxEdgePx: number;
  maxOutputTokens: number;
  requestTimeoutMs: number;
}

/* ------------------------------------------------------------------ */
/* Traits and apply                                                    */
/* ------------------------------------------------------------------ */

/** Mirrors the field added to IMetadataExtension in @oyster/common. It is
 *  re-declared here so src/ai stays free of that import. */
export interface MetadataAttribute {
  trait_type: string;
  value: string;
}

export type TraitKey =
  | 'Object Type'
  | 'Subject'
  | 'Region'
  | 'School'
  | 'Tradition'
  | 'Period'
  | 'Date Range'
  | 'Medium'
  | 'Materials'
  | 'Dimensions'
  | 'Condition'
  | 'Inscription Script'
  | 'Inscription Language'
  | 'Attribution Confidence'
  | 'Catalogued By';

export interface ApplySelection {
  title: boolean;
  description: boolean;
  traits: boolean;
  /** Appends the full inscription block to the description. */
  includeInscription: boolean;
  /** Which trait rows survive into metadata. */
  traitKeys: TraitKey[];
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export type AiErrorKind =
  | 'config'
  | 'image'
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'auth'
  | 'rate_limit'
  | 'bad_request'
  | 'not_found'
  | 'server'
  | 'blocked'
  | 'truncated'
  | 'parse'
  | 'schema';

/** NOT an Error subclass: web tsconfig targets es5, where
 *  `class X extends Error` breaks `instanceof`. Branded plain object plus a
 *  type guard instead. */
export interface AiError {
  readonly __aiError: true;
  kind: AiErrorKind;
  message: string;
  status: number | null;
  providerId: ProviderId | null;
}

export function aiError(
  kind: AiErrorKind,
  message: string,
  opts: { status?: number; providerId?: ProviderId } = {},
): AiError {
  return {
    __aiError: true,
    kind,
    message,
    status: opts.status === undefined ? null : opts.status,
    providerId: opts.providerId === undefined ? null : opts.providerId,
  };
}

export function isAiError(e: unknown): e is AiError {
  return (
    typeof e === 'object' && e !== null && (e as AiError).__aiError === true
  );
}

export function errorMessage(e: unknown): string {
  if (isAiError(e)) {
    return e.message;
  }
  if (e instanceof Error) {
    return e.message;
  }
  return String(e);
}
