/**
 * The first test suite in this repository. Before it existed `craco test` in
 * packages/web exited 1 with "No tests found"; react-scripts 3.4.3 already
 * matches src/**\/__tests__/**\/*.ts, so nothing was added to jest config.
 *
 * It imports ONLY from ../*, never the .tsx panels, '@oyster/common', antd or
 * @solana/web3.js — that is what lets it run without first building the common
 * package to dist/lib. Every impure entry point (runCatalogue, the settings
 * store) takes an injectable dependency, so there is no jest.mock here and no
 * network.
 */

import {
  AiError,
  AiErrorKind,
  AiProvider,
  AiSettings,
  ApplySelection,
  CatalogueRecord,
  CatalogueRequest,
  HttpPlan,
  ProviderId,
  ProviderSettings,
  TraitKey,
  isAiError,
} from '../types';
import {
  CATALOGUE_JSON_SCHEMA,
  CATALOGUE_SCHEMA_NAME,
  JsonSchemaNode,
  toGeminiSchema,
} from '../schema';
import { NO_PROVENANCE_SENTINEL } from '../prompt';
import { auditRecord, parseCatalogueRecord } from '../validate';
import {
  AZURE,
  BASE_URL_PLACEHOLDER,
  DEEPSEEK,
  GEMINI,
  GITHUB,
  OPENAI,
  PROVIDERS,
  PROVIDER_IDS,
  TRIMURTI,
  joinUrl,
} from '../providers';
import {
  base64ByteLength,
  bytesToBase64,
  isDataUrl,
  splitDataUrl,
} from '../image';
import {
  SettingsStore,
  configProblem,
  defaultSettings,
  isProxyMode,
  loadSettings,
  redactSecrets,
  saveSettings,
} from '../settings';
import { probeGateway, runCatalogue } from '../client';
import {
  MAX_NAME_BYTES,
  TRAIT_VOCABULARY,
  buildPatch,
  composeDescription,
  recordToTraits,
  truncateUtf8Bytes,
  utf8ByteLength,
} from '../apply';

/* ------------------------------------------------------------------ */
/* Assertion helpers                                                   */
/* ------------------------------------------------------------------ */

type RawNode = Record<string, unknown>;

/** AiError is a branded plain object, not an Error subclass (target es5), so
 *  `toThrow` and `instanceof` are both useless on it. */
function thrownAiError(run: () => void): AiError {
  let caught: unknown = null;
  let threw = false;
  try {
    run();
  } catch (e) {
    threw = true;
    caught = e;
  }
  if (!threw) {
    throw new Error('expected a throw, but the call returned normally');
  }
  if (!isAiError(caught)) {
    throw new Error('expected an AiError, got ' + String(caught));
  }
  return caught;
}

async function rejectedAiError(p: Promise<unknown>): Promise<AiError> {
  let caught: unknown = null;
  let rejected = false;
  try {
    await p;
  } catch (e) {
    rejected = true;
    caught = e;
  }
  if (!rejected) {
    throw new Error('expected a rejection, but the promise resolved');
  }
  if (!isAiError(caught)) {
    throw new Error('expected an AiError, got ' + String(caught));
  }
  return caught;
}

function deepFreeze<T>(value: T): T {
  const target = value as unknown as RawNode;
  Object.keys(target).forEach(key => {
    const child = target[key];
    if (child !== null && typeof child === 'object') {
      deepFreeze(child);
    }
  });
  Object.freeze(value);
  return value;
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const SAMPLE_DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ==';

const META: { providerId: ProviderId; model: string } = {
  providerId: 'gemini',
  model: 'gemini-2.0-flash',
};

/** Structurally valid, and deliberately audit-clean: every auditRecord case
 *  below mutates one field and expects exactly the warning that field earns. */
function recordFixture(): CatalogueRecord {
  return {
    objectType: 'Figure of Padmapani',
    title: 'Gilt copper figure of Padmapani, Nepal',
    subject: {
      iconographicBasis:
        'Standing figure in tribhanga, right hand in varada mudra, left holding the stem of a lotus rising to the shoulder.',
      primaryIdentification: 'Padmapani Lokeshvara',
      alternativeIdentifications: ['Avalokiteshvara', 'Maitreya'],
    },
    culture: {
      region: 'Nepal',
      schoolOrSubRegion: 'Newar, Kathmandu Valley',
      tradition: 'Vajrayana Buddhist',
    },
    period: {
      datingRationale:
        'Slim proportions, the beaded lower edge of the lotus base and the treatment of the dhoti hem.',
      label: 'Malla period, circa 15th century',
      earliestYear: 1400,
      latestYear: 1500,
    },
    medium: {
      primaryMedium: 'Gilt copper alloy',
      materials: ['copper alloy', 'gilding', 'turquoise'],
      surfaceAndDecoration: ['cold gold', 'inlay'],
    },
    dimensions: {
      scaleReferenceVisible: false,
      heightCm: 0,
      widthCm: 0,
      depthCm: 0,
      basisForMeasurement: '',
    },
    condition: {
      summary: 'Good overall, with wear to the gilding at the high points.',
      observations: ['wear to gilding', 'minor losses to the beading'],
    },
    inscription: {
      present: 'yes',
      segments: [
        {
          location: 'front of lotus base',
          script: 'Ranjana (Lantsa)',
          language: 'Sanskrit',
          transcription: 'ye dharma hetu prabhava hetun tesan tathagato',
          transliteration: 'ye dharmā hetuprabhavā hetuṃ teṣāṃ tathāgato',
          translation:
            'Of those phenomena which arise from a cause, the Tathagata has stated the cause.',
          notes: 'The ye dharma hetu verse.',
        },
      ],
      completeness: 'complete',
      untranslatedPortions: '',
    },
    catalogueDescription:
      'The figure stands in a gentle tribhanga on a double lotus base, the weight carried on the right leg. The dhoti is incised with a floral repeat and secured by a beaded girdle.',
    provenanceNote: NO_PROVENANCE_SENTINEL,
    confidence: {
      subject: 'high',
      culture: 'high',
      period: 'medium',
      medium: 'medium',
      inscription: 'high',
    },
    uncertainties: [
      'Alloy composition cannot be determined from a photograph.',
    ],
    recommendedExpertChecks: ['Examine the base sealing plate in the hand.'],
  };
}

/** The same record as untyped JSON, so a test can delete or corrupt a key. */
function rawFixture(): RawNode {
  return JSON.parse(JSON.stringify(recordFixture())) as RawNode;
}

function child(raw: RawNode, key: string): RawNode {
  return raw[key] as RawNode;
}

function withTranslation(translation: string): RawNode {
  const raw = rawFixture();
  const segments = child(raw, 'inscription').segments as RawNode[];
  segments[0].translation = translation;
  return raw;
}

function sparseRecord(): CatalogueRecord {
  const r = recordFixture();
  r.culture = { region: '', schoolOrSubRegion: '', tradition: '' };
  r.period = {
    datingRationale: '',
    label: '',
    earliestYear: 0,
    latestYear: 0,
  };
  r.medium = { primaryMedium: '', materials: [], surfaceAndDecoration: [] };
  r.condition = { summary: '', observations: [] };
  r.inscription = {
    present: 'no',
    segments: [],
    completeness: 'not-applicable',
    untranslatedPortions: '',
  };
  return r;
}

function measuredRecord(): CatalogueRecord {
  const r = recordFixture();
  r.dimensions = {
    scaleReferenceVisible: true,
    heightCm: 18.5,
    widthCm: 7,
    depthCm: 0,
    basisForMeasurement: 'Supplied in the dealer notes.',
  };
  return r;
}

const JPEG_BASE64 = '/9j/4AAQSkZJRgABAQAAAQ==';

function twoInlineImages(): CatalogueRequest {
  return {
    images: [
      {
        kind: 'inline',
        mimeType: 'image/jpeg',
        base64: JPEG_BASE64,
        label: 'front',
      },
      {
        kind: 'inline',
        mimeType: 'image/jpeg',
        base64: JPEG_BASE64,
        label: 'reverse',
      },
    ],
    dealerNotes: 'Height 18 cm, measured against a rule.',
    maxOutputTokens: 4096,
    temperature: 0.2,
  };
}

function inlineAndRemoteImages(): CatalogueRequest {
  return {
    images: [
      {
        kind: 'inline',
        mimeType: 'image/jpeg',
        base64: JPEG_BASE64,
        label: 'front',
      },
      { kind: 'remote', url: 'https://arweave.net/abc123', label: 'reverse' },
    ],
    dealerNotes: '',
    maxOutputTokens: 4096,
    temperature: 0.2,
  };
}

function dataUrlRequest(): CatalogueRequest {
  const split = splitDataUrl(SAMPLE_DATA_URL);
  return {
    images: [
      {
        kind: 'inline',
        mimeType: split.mimeType,
        base64: split.base64,
        label: 'front',
      },
    ],
    dealerNotes: '',
    maxOutputTokens: 4096,
    temperature: 0.2,
  };
}

function geminiCfg(apiKey: string): ProviderSettings {
  return {
    apiKey,
    model: GEMINI.defaultModel,
    baseUrl: GEMINI.defaultBaseUrl,
  };
}

function openaiCfg(apiKey: string): ProviderSettings {
  return {
    apiKey,
    model: OPENAI.defaultModel,
    baseUrl: OPENAI.defaultBaseUrl,
  };
}

/* ------------------------------------------------------------------ */
/* Wire-body views. JSON.parse returns `any`; naming the shapes keeps   */
/* every assertion below type-checked.                                 */
/* ------------------------------------------------------------------ */

interface ParsedGeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

interface ParsedGeminiBody {
  systemInstruction: { parts: { text: string }[] };
  contents: { role: string; parts: ParsedGeminiPart[] }[];
  generationConfig: RawNode;
  safetySettings: unknown[];
}

interface ParsedOpenAiPart {
  type: string;
  text?: string;
  image_url?: { url: string; detail: string };
}

interface ParsedOpenAiBody {
  model: string;
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  response_format: {
    type: string;
    json_schema?: { name: string; strict: boolean; schema: unknown };
  };
  messages: { role: string; content: string | ParsedOpenAiPart[] }[];
}

function geminiBody(plan: HttpPlan): ParsedGeminiBody {
  return JSON.parse(plan.body) as ParsedGeminiBody;
}

function openaiBody(plan: HttpPlan): ParsedOpenAiBody {
  return JSON.parse(plan.body) as ParsedOpenAiBody;
}

function systemText(body: ParsedOpenAiBody): string {
  const content = body.messages[0].content;
  return typeof content === 'string' ? content : '';
}

function userParts(body: ParsedOpenAiBody): ParsedOpenAiPart[] {
  const content = body.messages[1].content;
  return typeof content === 'string' ? [] : content;
}

/* ------------------------------------------------------------------ */
/* schema                                                              */
/* ------------------------------------------------------------------ */

function eachSchemaNode(
  node: JsonSchemaNode,
  path: string,
  visit: (n: JsonSchemaNode, p: string) => void,
): void {
  visit(node, path);
  const properties = node.properties;
  if (properties) {
    Object.keys(properties).forEach(key => {
      eachSchemaNode(properties[key], path + '.' + key, visit);
    });
  }
  const items = node.items;
  if (items) {
    eachSchemaNode(items, path + '[]', visit);
  }
}

/** Walks the canonical node and its Gemini translation in lockstep, so a
 *  mismatch can be reported against the path that produced it. */
function eachSchemaPair(
  source: JsonSchemaNode,
  gemini: RawNode,
  path: string,
  visit: (s: JsonSchemaNode, g: RawNode, p: string) => void,
): void {
  visit(source, gemini, path);
  const properties = source.properties;
  const geminiProperties = gemini.properties as
    | Record<string, RawNode>
    | undefined;
  if (properties && geminiProperties) {
    Object.keys(properties).forEach(key => {
      const target = geminiProperties[key];
      if (target) {
        eachSchemaPair(properties[key], target, path + '.' + key, visit);
      }
    });
  }
  const items = source.items;
  const geminiItems = gemini.items as RawNode | undefined;
  if (items && geminiItems) {
    eachSchemaPair(items, geminiItems, path + '[]', visit);
  }
}

function geminiChild(node: RawNode, key: string): RawNode {
  return (node.properties as Record<string, RawNode>)[key];
}

function ordering(node: RawNode): string[] {
  return (node.propertyOrdering as string[]) || [];
}

/** Every one of these is silently accepted by a schema linter and rejected by
 *  OpenAI strict mode at request time. */
const UNSUPPORTED_KEYWORDS = [
  'minItems',
  'maxItems',
  'nullable',
  'format',
  'pattern',
  'oneOf',
  'anyOf',
  'allOf',
  '$ref',
];

describe('schema', () => {
  it('1. every object node is closed and requires all of its properties', () => {
    const objects: string[] = [];
    const notClosed: string[] = [];
    const badRequired: string[] = [];

    eachSchemaNode(CATALOGUE_JSON_SCHEMA, 'root', (node, path) => {
      if (node.type !== 'object') {
        return;
      }
      objects.push(path);
      if (node.additionalProperties !== false) {
        notClosed.push(path);
      }
      const keys = Object.keys(node.properties || {});
      if ((node.required || []).join('|') !== keys.join('|')) {
        badRequired.push(path);
      }
    });

    expect(notClosed).toEqual([]);
    expect(badRequired).toEqual([]);
    expect(objects.length).toBeGreaterThan(5);
  });

  it('2. carries no JSON Schema keyword OpenAI strict mode rejects', () => {
    const offences: string[] = [];

    eachSchemaNode(CATALOGUE_JSON_SCHEMA, 'root', (node, path) => {
      const raw = node as unknown as RawNode;
      UNSUPPORTED_KEYWORDS.forEach(keyword => {
        if (keyword in raw) {
          offences.push(path + ' carries ' + keyword);
        }
      });
      if (Array.isArray(raw.type)) {
        offences.push(path + ' has a union type');
      }
    });

    expect(offences).toEqual([]);
  });

  it('3. toGeminiSchema uppercases types, drops additionalProperties and orders properties', () => {
    const gemini = toGeminiSchema(CATALOGUE_JSON_SCHEMA) as RawNode;
    const offences: string[] = [];

    eachSchemaPair(CATALOGUE_JSON_SCHEMA, gemini, 'root', (src, out, path) => {
      if ('additionalProperties' in out) {
        offences.push(path + ' still carries additionalProperties');
      }
      if (out.type !== src.type.toUpperCase()) {
        offences.push(path + ' has type ' + String(out.type));
      }
      if (
        (src.enum || []).join('|') !== ((out.enum as string[]) || []).join('|')
      ) {
        offences.push(path + ' lost its enum');
      }
      if (
        (src.required || []).join('|') !==
        ((out.required as string[]) || []).join('|')
      ) {
        offences.push(path + ' lost its required list');
      }
      if (src.type === 'object') {
        const keys = Object.keys(src.properties || {});
        if (ordering(out).join('|') !== keys.join('|')) {
          offences.push(path + ' has no matching propertyOrdering');
        }
      }
    });

    expect(offences).toEqual([]);

    expect(ordering(gemini).slice(0, 3)).toEqual([
      'objectType',
      'title',
      'subject',
    ]);
    expect(ordering(geminiChild(gemini, 'subject'))[0]).toBe(
      'iconographicBasis',
    );
    expect(ordering(geminiChild(gemini, 'period'))[0]).toBe('datingRationale');

    const segment = geminiChild(geminiChild(gemini, 'inscription'), 'segments')
      .items as RawNode;
    const segmentOrder = ordering(segment);
    expect(segmentOrder.indexOf('transcription')).toBeLessThan(
      segmentOrder.indexOf('transliteration'),
    );
    expect(segmentOrder.indexOf('transliteration')).toBeLessThan(
      segmentOrder.indexOf('translation'),
    );
  });

  it('4. the schema name is a legal OpenAI json_schema name', () => {
    expect(CATALOGUE_SCHEMA_NAME).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
  });
});

/* ------------------------------------------------------------------ */
/* validate                                                            */
/* ------------------------------------------------------------------ */

describe('validate', () => {
  it('5. parses a valid record and round-trips it field for field', () => {
    expect(parseCatalogueRecord(rawFixture())).toEqual(recordFixture());
  });

  it('6. rejects a record with no inscription block', () => {
    const raw = rawFixture();
    delete raw.inscription;
    const err = thrownAiError(() => parseCatalogueRecord(raw));
    expect(err.kind).toBe('schema');
    expect(err.message).toContain('inscription');
  });

  it('7. rejects an unknown completeness value', () => {
    const raw = rawFixture();
    child(raw, 'inscription').completeness = 'banana';
    expect(thrownAiError(() => parseCatalogueRecord(raw)).kind).toBe('schema');
  });

  it('8. rejects present "yes" with no segments', () => {
    const raw = rawFixture();
    const inscription = child(raw, 'inscription');
    inscription.present = 'yes';
    inscription.segments = [];
    inscription.completeness = 'not-applicable';
    expect(thrownAiError(() => parseCatalogueRecord(raw)).kind).toBe('schema');
  });

  it('9. rejects a transcription with an empty translation', () => {
    const raw = withTranslation('   ');
    const err = thrownAiError(() => parseCatalogueRecord(raw));
    expect(err.kind).toBe('schema');
    expect(err.message).toContain('translation');
  });

  it('10. rejects every abridged translation marker', () => {
    const abridged = [
      'Of those phenomena which arise from a cause...',
      'Of those phenomena which arise from a cause…',
      'Of those phenomena [...] the great sage has said.',
      'Of those phenomena [truncated] the great sage has said.',
      'Of those phenomena [remainder omitted] the great sage has said.',
      'Of those phenomena [ REMAINDER OMITTED ].',
    ];
    abridged.forEach(translation => {
      const err = thrownAiError(() =>
        parseCatalogueRecord(withTranslation(translation)),
      );
      expect(err.kind).toBe('schema');
    });
  });

  it('11. rejects completeness "complete" alongside untranslated portions', () => {
    const raw = rawFixture();
    child(raw, 'inscription').untranslatedPortions =
      'the reverse of the base is not legible';
    expect(thrownAiError(() => parseCatalogueRecord(raw)).kind).toBe('schema');
  });

  it('12. audits a structurally valid record', () => {
    expect(auditRecord(recordFixture())).toEqual([]);

    const partial = recordFixture();
    partial.inscription.completeness = 'partial';
    partial.inscription.untranslatedPortions = 'the reverse register';
    const partialWarnings = auditRecord(partial).filter(
      w => w.code === 'partial-translation',
    );
    expect(partialWarnings).toHaveLength(1);
    expect(partialWarnings[0].severity).toBe('block');

    const unscaled = recordFixture();
    unscaled.dimensions.heightCm = 18;
    const unscaledWarnings = auditRecord(unscaled).filter(
      w => w.code === 'unscaled-dimensions',
    );
    expect(unscaledWarnings).toHaveLength(1);
    expect(unscaledWarnings[0].severity).toBe('block');

    const inverted = recordFixture();
    inverted.period.earliestYear = 1600;
    inverted.period.latestYear = 1200;
    expect(auditRecord(inverted).map(w => w.code)).toContain(
      'inverted-date-range',
    );

    const wide = recordFixture();
    wide.period.earliestYear = 600;
    wide.period.latestYear = 2000;
    expect(auditRecord(wide).map(w => w.code)).toContain(
      'implausible-date-range',
    );

    const certain = recordFixture();
    certain.uncertainties = [];
    expect(auditRecord(certain).map(w => w.code)).toContain(
      'no-uncertainties-declared',
    );

    const provenance = recordFixture();
    provenance.provenanceNote =
      'Formerly in the collection of a Swiss gentleman.';
    const provenanceWarnings = auditRecord(provenance).filter(
      w => w.code === 'provenance-asserted',
    );
    expect(provenanceWarnings).toHaveLength(1);
    expect(provenanceWarnings[0].severity).toBe('block');

    const sentinel = recordFixture();
    sentinel.provenanceNote = NO_PROVENANCE_SENTINEL;
    expect(auditRecord(sentinel).map(w => w.code)).not.toContain(
      'provenance-asserted',
    );
  });
});

/* ------------------------------------------------------------------ */
/* providers                                                           */
/* ------------------------------------------------------------------ */

function statusKind(
  provider: AiProvider,
  status: number,
  cfg: ProviderSettings,
): AiErrorKind {
  return thrownAiError(() =>
    provider.extractText(status, { error: { message: 'upstream' } }, cfg),
  ).kind;
}

describe('providers', () => {
  const GEMINI_KEY = 'AIzaSyTESTKEY0123456789abcdefgh';
  const OPENAI_KEY = 'sk-TESTKEY0123456789abcdefgh';

  it('13. Gemini builds a keyed, schema-constrained, image-labelled request', () => {
    const plan = GEMINI.buildRequest(twoInlineImages(), geminiCfg(GEMINI_KEY));

    expect(plan.url.indexOf(GEMINI.defaultBaseUrl)).toBe(0);
    expect(/:generateContent$/.test(plan.url)).toBe(true);
    expect(plan.headers['x-goog-api-key']).toBe(GEMINI_KEY);
    // Regression guard: the key must never drift back into a ?key= query
    // parameter, where browser history and proxy logs would capture it.
    expect(plan.url).not.toContain(GEMINI_KEY);

    const body = geminiBody(plan);
    const responseSchema = body.generationConfig.responseSchema as RawNode;
    expect(responseSchema.type).toBe('OBJECT');
    expect(body.generationConfig.maxOutputTokens).toBe(4096);
    expect(body.safetySettings).toHaveLength(4);

    const parts = body.contents[0].parts;
    const inlineIndexes: number[] = [];
    parts.forEach((part, i) => {
      if (part.inline_data) {
        inlineIndexes.push(i);
      }
    });
    expect(inlineIndexes).toHaveLength(2);
    inlineIndexes.forEach((index, n) => {
      expect(String(parts[index - 1].text)).toContain(
        'Image ' + (n + 1) + ' of 2',
      );
    });
  });

  it('14. Gemini omits the key header entirely in proxy mode', () => {
    const plan = GEMINI.buildRequest(twoInlineImages(), geminiCfg(''));
    expect('x-goog-api-key' in plan.headers).toBe(false);
  });

  it('15. Gemini refuses a remote image URL', () => {
    const err = thrownAiError(() => {
      GEMINI.buildRequest(inlineAndRemoteImages(), geminiCfg(GEMINI_KEY));
    });
    expect(err.kind).toBe('image');
  });

  it('16. OpenAI builds a strict json_schema request with high-detail images', () => {
    const plan = OPENAI.buildRequest(
      inlineAndRemoteImages(),
      openaiCfg(OPENAI_KEY),
    );
    expect(plan.headers.Authorization).toBe('Bearer ' + OPENAI_KEY);

    const body = openaiBody(plan);
    expect(body.response_format.type).toBe('json_schema');
    const jsonSchema = body.response_format.json_schema;
    expect(jsonSchema && jsonSchema.strict).toBe(true);
    expect(jsonSchema && jsonSchema.name).toBe('catalogue_record');

    const images = userParts(body).filter(part => part.type === 'image_url');
    expect(images).toHaveLength(2);

    const inline = images[0].image_url;
    expect(inline && inline.url.indexOf('data:image/jpeg;base64,')).toBe(0);
    expect(inline && inline.detail).toBe('high');

    const remote = images[1].image_url;
    expect(remote && remote.url).toBe('https://arweave.net/abc123');
    expect(String(remote && remote.url).indexOf('data:')).toBe(-1);
  });

  it('17. OpenAI omits Authorization entirely in proxy mode', () => {
    const plan = OPENAI.buildRequest(inlineAndRemoteImages(), openaiCfg(''));
    expect('Authorization' in plan.headers).toBe(false);
  });

  it('18. both fallbacks drop the structured directive but retain the complete schema in the prompt', () => {
    const gemini = geminiBody(
      GEMINI.buildFallbackRequest(twoInlineImages(), geminiCfg(GEMINI_KEY)),
    );
    expect('responseSchema' in gemini.generationConfig).toBe(false);
    expect(gemini.generationConfig.responseMimeType).toBe('application/json');
    const serialised = JSON.stringify(CATALOGUE_JSON_SCHEMA);
    const geminiSystem = gemini.systemInstruction.parts
      .map(part => part.text)
      .join('');
    expect(geminiSystem.slice(-serialised.length)).toBe(serialised);

    const openai = openaiBody(
      OPENAI.buildFallbackRequest(
        inlineAndRemoteImages(),
        openaiCfg(OPENAI_KEY),
      ),
    );
    expect(openai.response_format).toEqual({ type: 'json_object' });
    const system = systemText(openai);
    expect(system.slice(-serialised.length)).toBe(serialised);
  });

  it('19. Gemini extractText reads every documented outcome', () => {
    const cfg = geminiCfg(GEMINI_KEY);

    expect(
      GEMINI.extractText(
        200,
        {
          candidates: [
            {
              finishReason: 'STOP',
              content: { parts: [{ text: '{"a":' }, { text: '1}' }] },
            },
          ],
        },
        cfg,
      ),
    ).toBe('{"a":1}');

    const truncated = thrownAiError(() =>
      GEMINI.extractText(
        200,
        {
          candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }],
        },
        cfg,
      ),
    );
    expect(truncated.kind).toBe('truncated');

    const safety = thrownAiError(() =>
      GEMINI.extractText(
        200,
        { candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] },
        cfg,
      ),
    );
    expect(safety.kind).toBe('blocked');

    const prompt = thrownAiError(() =>
      GEMINI.extractText(
        200,
        { promptFeedback: { blockReason: 'SAFETY' } },
        cfg,
      ),
    );
    expect(prompt.kind).toBe('blocked');

    expect(statusKind(GEMINI, 401, cfg)).toBe('auth');
    expect(statusKind(GEMINI, 429, cfg)).toBe('rate_limit');
    expect(statusKind(GEMINI, 404, cfg)).toBe('not_found');
    expect(statusKind(GEMINI, 500, cfg)).toBe('server');
  });

  it('20. OpenAI extractText reads every documented outcome', () => {
    const cfg = openaiCfg(OPENAI_KEY);

    expect(
      OPENAI.extractText(
        200,
        {
          choices: [{ finish_reason: 'stop', message: { content: '{"a":1}' } }],
        },
        cfg,
      ),
    ).toBe('{"a":1}');

    const truncated = thrownAiError(() =>
      OPENAI.extractText(
        200,
        {
          choices: [{ finish_reason: 'length', message: { content: '{"a"' } }],
        },
        cfg,
      ),
    );
    expect(truncated.kind).toBe('truncated');

    const refusal = thrownAiError(() =>
      OPENAI.extractText(
        200,
        {
          choices: [
            { finish_reason: 'stop', message: { refusal: 'I cannot help.' } },
          ],
        },
        cfg,
      ),
    );
    expect(refusal.kind).toBe('blocked');

    const filtered = thrownAiError(() =>
      OPENAI.extractText(
        200,
        {
          choices: [
            { finish_reason: 'content_filter', message: { content: '' } },
          ],
        },
        cfg,
      ),
    );
    expect(filtered.kind).toBe('blocked');

    expect(statusKind(OPENAI, 401, cfg)).toBe('auth');
    expect(statusKind(OPENAI, 429, cfg)).toBe('rate_limit');
    expect(statusKind(OPENAI, 404, cfg)).toBe('not_found');
    expect(statusKind(OPENAI, 500, cfg)).toBe('server');
  });

  it('21. OpenAI retryBody adapts a drifted parameter exactly once', () => {
    const retryBody = OPENAI.retryBody;
    if (!retryBody) {
      throw new Error('OPENAI.retryBody is required by client.ts');
    }
    const drift =
      "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead.";

    const adapted = retryBody(
      { model: 'gpt-5', temperature: 0.2, max_tokens: 4096, messages: [] },
      drift,
    ) as RawNode;
    expect(adapted.max_completion_tokens).toBe(4096);
    expect('max_tokens' in adapted).toBe(false);
    expect('temperature' in adapted).toBe(false);

    expect(
      retryBody(
        { model: 'gpt-4o', temperature: 0.2, max_tokens: 4096 },
        'Invalid image data in messages[0].',
      ),
    ).toBeNull();

    // Already adapted: retrying would loop forever.
    expect(
      retryBody({ model: 'gpt-5', max_completion_tokens: 4096 }, drift),
    ).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* image                                                               */
/*                                                                     */
/* Pure parts only: downscaleDataUrl and resolveImage's File branch     */
/* need a canvas, which jsdom does not have.                           */
/* ------------------------------------------------------------------ */

describe('image', () => {
  it('22. splits a base64 data URL and rejects everything else', () => {
    expect(isDataUrl(SAMPLE_DATA_URL)).toBe(true);
    expect(splitDataUrl(SAMPLE_DATA_URL)).toEqual({
      mimeType: 'image/jpeg',
      base64: JPEG_BASE64,
    });

    expect(isDataUrl('data:image/png,not-base64')).toBe(false);
    expect(
      thrownAiError(() => splitDataUrl('data:image/png,not-base64')).kind,
    ).toBe('image');

    expect(isDataUrl('https://arweave.net/abc123')).toBe(false);
    expect(
      thrownAiError(() => splitDataUrl('https://arweave.net/abc123')).kind,
    ).toBe('image');
  });

  it('23. bytesToBase64 round-trips 100 KB through the multi-chunk path', () => {
    const bytes = new Uint8Array(100 * 1024);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = (i * 7 + 13) % 256;
    }

    const decoded = atob(bytesToBase64(bytes));
    expect(decoded.length).toBe(bytes.length);

    let firstMismatch = -1;
    for (let i = 0; i < bytes.length; i++) {
      if (decoded.charCodeAt(i) !== bytes[i]) {
        firstMismatch = i;
        break;
      }
    }
    expect(firstMismatch).toBe(-1);
  });

  it('24. base64ByteLength is accurate to within a padding group', () => {
    const bytes = new Uint8Array(1000);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = i % 256;
    }
    const encoded = bytesToBase64(bytes);
    expect(
      Math.abs(base64ByteLength(encoded) - bytes.length),
    ).toBeLessThanOrEqual(3);
  });
});

/* ------------------------------------------------------------------ */
/* settings                                                            */
/* ------------------------------------------------------------------ */

interface FakeStore extends SettingsStore {
  value: string | null;
}

function fakeStore(initial: string | null): FakeStore {
  const store: FakeStore = {
    value: initial,
    getItem: () => store.value,
    setItem: (key: string, next: string) => {
      store.value = next;
    },
  };
  return store;
}

describe('settings', () => {
  it('25. degrades to defaults for an absent, corrupt or partial blob', () => {
    expect(loadSettings(fakeStore(null))).toEqual(defaultSettings());
    expect(loadSettings(fakeStore('{'))).toEqual(defaultSettings());

    const partial = loadSettings(fakeStore('{"activeProvider":"openai"}'));
    const expected = defaultSettings();
    expected.activeProvider = 'openai';
    expect(partial).toEqual(expected);
  });

  it('26. round-trips through a store', () => {
    const store = fakeStore(null);
    const next = defaultSettings();
    next.providers.openai.apiKey = 'sk-roundtrip-0123456789';

    saveSettings(next, store);
    expect(String(store.value)).toContain('sk-roundtrip-0123456789');
    expect(loadSettings(store)).toEqual(next);
  });

  it('27. treats a blank key against a custom Base URL as proxy mode', () => {
    expect(configProblem(geminiCfg(''), GEMINI)).not.toBe('');

    const proxied: ProviderSettings = {
      apiKey: '',
      model: GEMINI.defaultModel,
      baseUrl: 'https://proxy.kapoor.example/gemini',
    };
    expect(configProblem(proxied, GEMINI)).toBe('');

    const malformed: ProviderSettings = {
      apiKey: 'AIzaSyTESTKEY0123456789',
      model: GEMINI.defaultModel,
      baseUrl: 'not a url',
    };
    expect(configProblem(malformed, GEMINI)).not.toBe('');

    const noModel: ProviderSettings = {
      apiKey: 'AIzaSyTESTKEY0123456789',
      model: '   ',
      baseUrl: GEMINI.defaultBaseUrl,
    };
    expect(configProblem(noModel, GEMINI)).not.toBe('');
  });

  it('28. masks configured keys and bare key shapes', () => {
    const settings = defaultSettings();
    settings.providers.openai.apiKey = 'zzz-house-proxy-token-42';

    const masked = redactSecrets(
      'sent zzz-house-proxy-token-42 with sk-ABCDEFGHIJKLMNOP and AIzaABCDEFGHIJKLMNOP',
      settings,
    );
    expect(masked).not.toContain('zzz-house-proxy-token-42');
    expect(masked).not.toContain('sk-ABCDEFGHIJKLMNOP');
    expect(masked).not.toContain('AIzaABCDEFGHIJKLMNOP');
    expect(masked).toContain('«redacted»');
  });
});

/* ------------------------------------------------------------------ */
/* client                                                              */
/* ------------------------------------------------------------------ */

interface StubResponse {
  status: number;
  body?: unknown;
  reject?: unknown;
}

interface FetchStub {
  impl: typeof fetch;
  calls: { url: string; init: RequestInit }[];
}

/** Responses are consumed in order; the last one repeats, so an unexpected
 *  extra call shows up as a call-count failure rather than as a network error
 *  that would mask the real assertion. */
function stubFetch(responses: StubResponse[]): FetchStub {
  const calls: { url: string; init: RequestInit }[] = [];
  let index = 0;

  const impl: typeof fetch = (input, init) => {
    calls.push({ url: String(input), init: init || {} });
    const next = responses[Math.min(index, responses.length - 1)];
    index++;
    if (next.reject !== undefined) {
      return Promise.reject(next.reject);
    }
    const response = {
      status: next.status,
      ok: next.status >= 200 && next.status < 300,
      json: () => Promise.resolve(next.body),
    };
    return Promise.resolve(response as unknown as Response);
  };

  return { impl, calls };
}

function settingsFixture(providerId: ProviderId, apiKey: string): AiSettings {
  const settings = defaultSettings();
  settings.activeProvider = providerId;
  settings.providers[providerId].apiKey = apiKey;
  return settings;
}

function geminiOk(text: string): unknown {
  return {
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }],
  };
}

function openaiOk(text: string): unknown {
  return { choices: [{ finish_reason: 'stop', message: { content: text } }] };
}

function providerError(message: string): unknown {
  return { error: { message } };
}

describe('client', () => {
  it('29. drives a successful Gemini run from a data-URL image', async () => {
    const record = recordFixture();
    const stub = stubFetch([
      { status: 200, body: geminiOk(JSON.stringify(record)) },
    ]);

    const result = await runCatalogue(
      'gemini',
      settingsFixture('gemini', 'AIzaSyTESTKEY0123456789'),
      dataUrlRequest(),
      { fetchImpl: stub.impl },
    );

    expect(result.providerId).toBe('gemini');
    expect(result.record).toEqual(record);
    expect(result.usedFallback).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(stub.calls).toHaveLength(1);
  });

  it('30. reports an opaque fetch rejection as a network error naming the host', async () => {
    const stub = stubFetch([
      { status: 0, reject: new TypeError('Failed to fetch') },
    ]);

    const err = await rejectedAiError(
      runCatalogue(
        'gemini',
        settingsFixture('gemini', 'AIzaSyTESTKEY0123456789'),
        dataUrlRequest(),
        { fetchImpl: stub.impl },
      ),
    );

    expect(err.kind).toBe('network');
    expect(err.message).toContain('generativelanguage.googleapis.com');
    expect(err.message).toContain('CORS');
  });

  it('31. retries a drifted parameter exactly once', async () => {
    const stub = stubFetch([
      {
        status: 400,
        body: providerError(
          "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead.",
        ),
      },
      { status: 200, body: openaiOk(JSON.stringify(recordFixture())) },
    ]);

    const result = await runCatalogue(
      'openai',
      settingsFixture('openai', 'sk-TESTKEY0123456789'),
      dataUrlRequest(),
      { fetchImpl: stub.impl },
    );

    expect(stub.calls).toHaveLength(2);
    const retried = JSON.parse(
      String(stub.calls[1].init.body),
    ) as ParsedOpenAiBody;
    expect(retried.max_completion_tokens).toBe(4096);
    expect('max_tokens' in retried).toBe(false);
    expect('temperature' in retried).toBe(false);
    expect(result.usedFallback).toBe(false);
  });

  it('32. falls back once when structured output is rejected', async () => {
    const stub = stubFetch([
      {
        status: 400,
        body: providerError(
          "Invalid parameter: 'response_format' of type 'json_schema' is unavailable for this model.",
        ),
      },
      { status: 200, body: openaiOk(JSON.stringify(recordFixture())) },
    ]);

    const result = await runCatalogue(
      'openai',
      settingsFixture('openai', 'sk-TESTKEY0123456789'),
      dataUrlRequest(),
      { fetchImpl: stub.impl },
    );

    expect(result.usedFallback).toBe(true);
    expect(stub.calls).toHaveLength(2);
    const second = JSON.parse(
      String(stub.calls[1].init.body),
    ) as ParsedOpenAiBody;
    expect(second.response_format).toEqual({ type: 'json_object' });
  });

  it('33. never retries a 400 that matches neither drift pattern', async () => {
    const stub = stubFetch([
      {
        status: 400,
        body: providerError('Invalid image data in messages[0].'),
      },
    ]);

    const err = await rejectedAiError(
      runCatalogue(
        'openai',
        settingsFixture('openai', 'sk-TESTKEY0123456789'),
        dataUrlRequest(),
        { fetchImpl: stub.impl },
      ),
    );

    expect(err.kind).toBe('bad_request');
    expect(stub.calls).toHaveLength(1);
  });

  it('34. reports non-JSON model text as a parse error', async () => {
    const stub = stubFetch([
      {
        status: 200,
        body: geminiOk('Certainly! Here is the catalogue entry.'),
      },
    ]);

    const err = await rejectedAiError(
      runCatalogue(
        'gemini',
        settingsFixture('gemini', 'AIzaSyTESTKEY0123456789'),
        dataUrlRequest(),
        { fetchImpl: stub.impl },
      ),
    );

    expect(err.kind).toBe('parse');
  });

  it('35. redacts a configured key echoed back inside a provider message', async () => {
    const key = 'zzz-house-proxy-token-42';
    const stub = stubFetch([
      {
        status: 400,
        body: providerError('Incorrect API key provided: ' + key + '.'),
      },
    ]);

    const err = await rejectedAiError(
      runCatalogue('openai', settingsFixture('openai', key), dataUrlRequest(), {
        fetchImpl: stub.impl,
      }),
    );

    expect(err.message).not.toContain(key);
    expect(err.message).toContain('«redacted»');
  });
});

/* ------------------------------------------------------------------ */
/* apply                                                               */
/* ------------------------------------------------------------------ */

describe('apply', () => {
  it('36. never invents a trait_type outside the vocabulary', () => {
    [recordFixture(), sparseRecord(), measuredRecord()].forEach(record => {
      recordToTraits(record, META).forEach(attribute => {
        expect(TRAIT_VOCABULARY).toContain(attribute.trait_type);
      });
    });
  });

  it('37. omits empty, unscaled and half-known trait rows', () => {
    const sparse = recordToTraits(sparseRecord(), META);
    expect(sparse.filter(a => a.value === '')).toEqual([]);
    expect(sparse.map(a => a.trait_type)).not.toContain('Region');

    const measured = recordToTraits(measuredRecord(), META);
    expect(measured.map(a => a.trait_type)).toContain('Dimensions');

    const unscaled = measuredRecord();
    unscaled.dimensions.scaleReferenceVisible = false;
    expect(recordToTraits(unscaled, META).map(a => a.trait_type)).not.toContain(
      'Dimensions',
    );

    const halfDated = recordFixture();
    halfDated.period.latestYear = 0;
    expect(
      recordToTraits(halfDated, META).map(a => a.trait_type),
    ).not.toContain('Date Range');
  });

  it('38. composes a description that never hides an incomplete translation', () => {
    const partial = recordFixture();
    partial.inscription.completeness = 'partial';
    partial.inscription.untranslatedPortions = 'the reverse register';
    expect(composeDescription(partial, true)).toContain(
      '[TRANSLATION INCOMPLETE',
    );

    const none = recordFixture();
    none.inscription.present = 'no';
    none.inscription.segments = [];
    none.inscription.completeness = 'not-applicable';
    expect(composeDescription(none, true)).toBe(
      none.catalogueDescription.trim(),
    );

    const two = recordFixture();
    two.inscription.segments = [
      two.inscription.segments[0],
      {
        location: 'reverse of the base',
        script: 'Uchen',
        language: 'Classical Tibetan',
        transcription: 'bkra shis bde legs',
        transliteration: 'bkra shis bde legs',
        translation: 'Auspiciousness and well-being.',
        notes: '',
      },
    ];
    const composed = composeDescription(two, true);
    expect(composed).toContain('Inscription 1');
    expect(composed).toContain('Inscription 2');
  });

  it('39. builds a patch that omits, filters, truncates and mutates nothing', () => {
    const record = deepFreeze(recordFixture());
    const selection: ApplySelection = {
      title: true,
      description: true,
      traits: true,
      includeInscription: true,
      traitKeys: ['Object Type', 'Region'],
    };

    expect(() => buildPatch(record, selection, META)).not.toThrow();
    const patch = buildPatch(record, selection, META);
    expect((patch.attributes || []).map(a => a.trait_type)).toEqual([
      'Object Type',
      'Region',
    ]);

    const titleOnly = buildPatch(
      record,
      {
        title: true,
        description: false,
        traits: false,
        includeInscription: false,
        traitKeys: [],
      },
      META,
    );
    expect('description' in titleOnly).toBe(false);
    expect('attributes' in titleOnly).toBe(false);

    const longTitle = recordFixture();
    longTitle.title =
      'Gilt copper alloy figure of Padmapani Lokeshvara, Newar, Kathmandu Valley, Malla period';
    const truncated = buildPatch(
      longTitle,
      {
        title: true,
        description: false,
        traits: false,
        includeInscription: false,
        traitKeys: [],
      },
      META,
    );
    expect(String(truncated.name).length).toBeLessThanOrEqual(MAX_NAME_BYTES);
  });

  it('40. never emits a name longer than the on-chain byte limit', () => {
    const utf8 = (s: string) => Buffer.byteLength(s, 'utf8');
    const sel = {
      title: true,
      description: false,
      traits: false,
      includeInscription: false,
      traitKeys: [] as TraitKey[],
    };

    // The token-metadata program rejects name.len() > 32 BYTES with
    // NameTooLong, so an ASCII-character count is not the check that matters:
    // IAST diacritics and Devanagari cost two and three bytes each.
    const titles = [
      'Gilt copper alloy figure of Padmapani Lokeshvara, Malla period',
      'Śākyamuni, gilt copper alloy, Newar, Kathmandu Valley, 15th century',
      'पद्मपाणि लोकेश्वर की गिल्ट ताम्र मूर्ति, मल्ल काल',
      'Phurba',
      '',
    ];
    titles.forEach(title => {
      const record = recordFixture();
      record.title = title;
      const patch = buildPatch(record, sel, META);
      expect(utf8(String(patch.name))).toBeLessThanOrEqual(MAX_NAME_BYTES);
    });

    // Truncation must not split a multi-byte character into invalid UTF-8.
    const devanagari = recordFixture();
    devanagari.title = 'पद्मपाणि लोकेश्वर की गिल्ट ताम्र मूर्ति, मल्ल काल';
    const name = String(buildPatch(devanagari, sel, META).name);
    expect(name).toBe(Buffer.from(name, 'utf8').toString('utf8'));
    expect(name.indexOf('�')).toBe(-1);

    // A short title is passed through untouched.
    const short = recordFixture();
    short.title = 'Phurba';
    expect(buildPatch(short, sel, META).name).toBe('Phurba');
  });

  it('41. treats untranslatedPortions as an admission whatever completeness says', () => {
    // An incoherent pair — a populated untranslatedPortions alongside a
    // completeness that is not an admission — must not read as a full
    // translation anywhere in the chain.
    const record = recordFixture();
    record.inscription.present = 'yes';
    record.inscription.completeness = 'not-applicable';
    record.inscription.untranslatedPortions =
      'the lower two lines are worn and were not translated';

    const warnings = auditRecord(record);
    const partial = warnings.filter(w => w.code === 'partial-translation');
    expect(partial.length).toBe(1);
    expect(partial[0].severity).toBe('block');

    expect(composeDescription(record, true)).toContain(
      '[TRANSLATION INCOMPLETE',
    );

    // A piece with no inscription at all must not trip it.
    const none = recordFixture();
    none.inscription.present = 'no';
    none.inscription.segments = [];
    none.inscription.completeness = 'not-applicable';
    none.inscription.untranslatedPortions = 'None.';
    expect(
      auditRecord(none).filter(w => w.code === 'partial-translation').length,
    ).toBe(0);
  });

  it('42. rejects an elided translation behind closing punctuation', () => {
    const quoted = [
      '"Of those phenomena which arise from a cause..."',
      '(…the remainder is a standard dedication…)',
      'Homage to the Blessed One…]',
      "'the merit is shared...'",
    ];
    quoted.forEach(translation => {
      const record = recordFixture();
      record.inscription.segments[0].translation = translation;
      expect(() =>
        parseCatalogueRecord(JSON.parse(JSON.stringify(record))),
      ).toThrow();
    });

    // Still no false positive on an ellipsis inside a real sentence.
    const legitimate = recordFixture();
    legitimate.inscription.segments[0].translation =
      'He said "... and then departed" before the donor formula begins here.';
    expect(() =>
      parseCatalogueRecord(JSON.parse(JSON.stringify(legitimate))),
    ).not.toThrow();
  });

  it('43. routes a parameter-drift 400 to retryBody, not the schema fallback', () => {
    // OpenAI's real drift message contains "is not supported", which must no
    // longer claim the structured-output branch — retryBody is written for
    // exactly this message, and a reasoning-family model depends on it.
    const drift =
      "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.";
    const next = OPENAI.retryBody
      ? OPENAI.retryBody(
          { model: 'gpt-5', max_tokens: 4096, temperature: 0.2 },
          drift,
        )
      : null;
    expect(next).not.toBe(null);
    const body = next as Record<string, unknown>;
    expect(body.max_completion_tokens).toBe(4096);
    expect('max_tokens' in body).toBe(false);
    expect('temperature' in body).toBe(false);
  });

  it('44. reads a trailing slash on the default Base URL as the default, not a proxy', () => {
    const cfg = {
      apiKey: '',
      model: GEMINI.defaultModel,
      baseUrl: GEMINI.defaultBaseUrl + '/',
    };
    expect(isProxyMode(cfg, GEMINI)).toBe(false);
    // ...so a blank key is still reported as a problem rather than silently
    // accepted as proxy mode against the real provider endpoint.
    expect(configProblem(cfg, GEMINI)).not.toBe('');
    // ...and the request URL carries no double slash.
    const plan = GEMINI.buildRequest(
      {
        images: [
          { kind: 'inline', mimeType: 'image/jpeg', base64: 'AA', label: 'p' },
        ],
        dealerNotes: '',
        maxOutputTokens: 1024,
        temperature: 0.2,
      },
      { ...cfg, apiKey: 'k' },
    );
    expect(plan.url.indexOf('v1beta//')).toBe(-1);
  });

  it('45. counts UTF-8 bytes the way the on-chain limit does', () => {
    // One helper now feeds the mint form's counter, the review panel's
    // counter and truncateUtf8Bytes. Pin it against Buffer, the reference
    // implementation, across every byte width the field produces.
    const cases = [
      'Phurba',
      'Śākyamuni',
      'पद्मपाणि लोकेश्वर',
      'བཀྲ་ཤིས་',
      'Figure of Padmapani \u{1F4FF}',
      '',
    ];
    cases.forEach(s => {
      expect(utf8ByteLength(s)).toBe(Buffer.byteLength(s, 'utf8'));
    });

    // The truncation and the counter must agree: whatever truncateUtf8Bytes
    // returns for a limit, the counter must measure at or under that limit.
    const long = 'Śākyamuni, gilt copper alloy, Newar, Kathmandu Valley';
    for (let limit = 0; limit <= 40; limit++) {
      expect(
        utf8ByteLength(truncateUtf8Bytes(long, limit)),
      ).toBeLessThanOrEqual(limit);
    }
  });
});

/* ------------------------------------------------------------------ */
/* The three providers added alongside Gemini and OpenAI               */
/*                                                                     */
/* DeepSeek, GitHub Models and Azure OpenAI are built by one factory,  */
/* so these tests pin the things the factory is parameterised on — the */
/* auth header, the response_format mode, the URL — rather than        */
/* re-asserting the shared body for each one.                          */
/* ------------------------------------------------------------------ */

function cfgFor(provider: AiProvider, apiKey: string): ProviderSettings {
  return {
    apiKey,
    model: provider.defaultModel,
    baseUrl: provider.defaultBaseUrl,
  };
}

/** The OpenAI-dialect providers, which is every one except Gemini. */
const OPENAI_DIALECT: AiProvider[] = [
  OPENAI,
  DEEPSEEK,
  GITHUB,
  AZURE,
  TRIMURTI,
];

/** Every one of them accepts a photograph on its default model. A filter on
 *  supportsImages once lived here and had become a no-op; the per-model
 *  refusals are what the table actually expresses, and tests 57 and 64
 *  cover those. */
const VISION_DIALECT: AiProvider[] = OPENAI_DIALECT;

/** What a text-only provider is limited to: the dealer's own notes. */
function notesOnlyRequest(): CatalogueRequest {
  return {
    images: [],
    dealerNotes: 'Gilt copper alloy, Newar, acquired 1998.',
    maxOutputTokens: 4096,
    temperature: 0.2,
  };
}

describe('providers — the wider table', () => {
  it('46. PROVIDER_IDS lists every provider in the table exactly once', () => {
    const tableIds = Object.keys(PROVIDERS) as ProviderId[];
    expect(PROVIDER_IDS.slice().sort()).toEqual(tableIds.slice().sort());
    expect(PROVIDER_IDS.length).toBe(tableIds.length);

    // Each entry answers to its own key: a copy-paste in the table would
    // otherwise route one provider's requests through another's builder.
    PROVIDER_IDS.forEach(id => {
      expect(PROVIDERS[id].id).toBe(id);
      expect(PROVIDERS[id].label).not.toBe('');
      expect(PROVIDERS[id].modelLabel).not.toBe('');
      expect(PROVIDERS[id].keyLabel).not.toBe('');
      expect(PROVIDERS[id].baseUrlHelp).not.toBe('');
      // The 401 copy names the secret the way the form labels it, so a
      // dealer told to "check the access key" finds a field called that.
      const refused = thrownAiError(() =>
        PROVIDERS[id].extractText(401, null, cfgFor(PROVIDERS[id], 'k')),
      );
      expect(refused.message.toLowerCase()).toContain(
        PROVIDERS[id].keyLabel.toLowerCase(),
      );
    });
  });

  it('47. joinUrl re-attaches a query string after the appended path', () => {
    expect(joinUrl('https://h/openai/v1', '/chat/completions')).toBe(
      'https://h/openai/v1/chat/completions',
    );
    // The paste this exists for: Azure's documented endpoints carry one.
    expect(
      joinUrl('https://h/openai/v1?api-version=preview', '/chat/completions'),
    ).toBe('https://h/openai/v1/chat/completions?api-version=preview');
    // A trailing slash BEFORE the query must not survive either.
    expect(
      joinUrl('https://h/openai/v1/?api-version=preview', '/chat/completions'),
    ).toBe('https://h/openai/v1/chat/completions?api-version=preview');
    expect(joinUrl('https://h/v1//', '/chat/completions')).toBe(
      'https://h/v1/chat/completions',
    );
  });

  it('48. every image-reading provider posts to {base}/chat/completions', () => {
    VISION_DIALECT.forEach(provider => {
      const plan = provider.buildRequest(
        twoInlineImages(),
        cfgFor(provider, 'k'),
      );
      expect(plan.method).toBe('POST');
      // /chat/completions for every direct provider; the gateway's own
      // cataloguing route for the gateway.
      const path =
        provider.id === 'trimurti'
          ? '/catalogue/completions'
          : '/chat/completions';
      expect(provider.completionsPath).toBe(path);
      expect(plan.url.indexOf(path)).toBeGreaterThan(0);
      expect(plan.url.indexOf('/chat/completions')).toBe(
        provider.id === 'trimurti' ? -1 : plan.url.indexOf(path),
      );
      expect(plan.headers['Content-Type']).toBe('application/json');

      // The shared body: the model, the ceiling, and one labelled part per
      // image ahead of the image itself.
      const body = openaiBody(plan);
      expect(body.model).toBe(provider.defaultModel);
      expect(body.max_tokens).toBe(4096);
      const parts = userParts(body);
      expect(parts.filter(p => p.type === 'image_url').length).toBe(2);
      expect(parts[1].text).toBe('Image 1 of 2 — front');
      expect(parts[3].text).toBe('Image 2 of 2 — reverse');
    });
  });

  it('49. Azure authenticates with api-key, never Authorization', () => {
    const plan = AZURE.buildRequest(twoInlineImages(), cfgFor(AZURE, 'azkey'));
    expect(plan.headers['api-key']).toBe('azkey');
    expect(plan.headers.Authorization).toBeUndefined();

    // The deployment name travels in the body, so one Base URL serves every
    // deployment in the resource.
    const cfg: ProviderSettings = {
      apiKey: 'azkey',
      model: 'kapoor-gpt4o',
      baseUrl: 'https://kapoor.openai.azure.com/openai/v1?api-version=preview',
    };
    const deployed = AZURE.buildRequest(twoInlineImages(), cfg);
    expect(deployed.url).toBe(
      'https://kapoor.openai.azure.com/openai/v1/chat/completions?api-version=preview',
    );
    expect(openaiBody(deployed).model).toBe('kapoor-gpt4o');

    // Proxy mode still means no header at all.
    expect(
      AZURE.buildRequest(twoInlineImages(), cfgFor(AZURE, '')).headers[
        'api-key'
      ],
    ).toBeUndefined();
  });

  it('50. GitHub Models sends a bearer token and a namespaced model', () => {
    const plan = GITHUB.buildRequest(
      twoInlineImages(),
      cfgFor(GITHUB, 'ghp_exampletoken1234567890'),
    );
    expect(plan.headers.Authorization).toBe(
      'Bearer ghp_exampletoken1234567890',
    );
    expect(plan.headers['api-key']).toBeUndefined();
    expect(plan.url).toBe(
      'https://models.github.ai/inference/chat/completions',
    );
    // A bare 'gpt-4o' 404s on this endpoint; the default must carry the
    // publisher prefix, and so must every suggestion.
    expect(GITHUB.defaultModel.indexOf('/')).toBeGreaterThan(0);
    GITHUB.modelSuggestions.forEach(m => {
      expect(m.indexOf('/')).toBeGreaterThan(0);
    });
  });

  it('51. DeepSeek asks for JSON mode and degrades to no directive at all', () => {
    const cfg = cfgFor(DEEPSEEK, 'sk-deepseekexamplekey1234');
    const primary = openaiBody(DEEPSEEK.buildRequest(notesOnlyRequest(), cfg));
    expect(primary.response_format.type).toBe('json_object');
    expect(primary.response_format.json_schema).toBeUndefined();

    // Without a strict schema the model is told the field names instead, or
    // it returns valid JSON of a shape parseCatalogueRecord rejects.
    expect(systemText(primary)).toContain(
      JSON.stringify(CATALOGUE_JSON_SCHEMA),
    );

    const fallback = JSON.parse(
      DEEPSEEK.buildFallbackRequest(notesOnlyRequest(), cfg).body,
    ) as RawNode;
    expect(fallback.response_format).toBeUndefined();
    const messages = fallback.messages as { content: string }[];
    expect(messages[0].content).toContain(
      JSON.stringify(CATALOGUE_JSON_SCHEMA),
    );
  });

  it('52. every OpenAI-dialect provider shares the one parameter-drift retry', () => {
    OPENAI_DIALECT.forEach(provider => {
      const retry = provider.retryBody;
      expect(retry).toBeDefined();
      if (!retry) {
        return;
      }
      const adapted = retry(
        { model: 'm', temperature: 0.2, max_tokens: 4096 },
        "Unsupported parameter: 'max_tokens'",
      ) as RawNode | null;
      /* Asserted through a non-null local rather than inside `if (adapted)`:
       * a truthiness guard here silently skips all three assertions on the
       * exact regression they exist to catch. */
      if (adapted === null) {
        throw new Error(provider.id + ': retryBody refused a drift message');
      }
      const next: RawNode = adapted;
      expect(next.max_completion_tokens).toBe(4096);
      expect(next.max_tokens).toBeUndefined();
      expect(next.temperature).toBeUndefined();
      // Never twice, and never for an unrelated 400.
      expect(
        retry({ model: 'm', max_completion_tokens: 4096 }, 'Unsupported value'),
      ).toBeNull();
      expect(retry({ model: 'm', max_tokens: 4096 }, 'content too large')).toBe(
        null,
      );
    });
  });

  it('53. Azure reads its own per-tenant hosts as the provider, not a proxy', () => {
    const own = (host: string) => ({
      apiKey: 'k',
      model: 'gpt-4o',
      baseUrl: 'https://' + host + '/openai/v1',
    });
    expect(isProxyMode(own('kapoor.openai.azure.com'), AZURE)).toBe(false);
    expect(isProxyMode(own('kapoor.services.ai.azure.com'), AZURE)).toBe(false);
    expect(isProxyMode(own('kapoor.cognitiveservices.azure.com'), AZURE)).toBe(
      false,
    );
    expect(isProxyMode(own('kapoor.openai.azure.us'), AZURE)).toBe(false);
    expect(isProxyMode(own('kapoor.openai.azure.cn'), AZURE)).toBe(false);
    // A fully-qualified trailing dot is the same host.
    expect(isProxyMode(own('kapoor.openai.azure.com.'), AZURE)).toBe(false);
    expect(
      isProxyMode(own('notcognitiveservices.azure.com.example.net'), AZURE),
    ).toBe(true);
    // A lookalike suffix is not Microsoft.
    expect(isProxyMode(own('notopenai.azure.com.example.net'), AZURE)).toBe(
      true,
    );
    expect(isProxyMode(own('gateway.kapoors.com'), AZURE)).toBe(true);

    // And because a real Azure endpoint is NOT proxy mode, a blank key there
    // is still refused rather than read as "the proxy holds it".
    expect(
      configProblem(
        {
          apiKey: '',
          model: 'gpt-4o',
          baseUrl: own('a.openai.azure.com').baseUrl,
        },
        AZURE,
      ),
    ).not.toBe('');
  });

  it('54. refuses the Azure Base URL placeholder before it becomes a DNS error', () => {
    const problem = configProblem(cfgFor(AZURE, 'k'), AZURE);
    expect(AZURE.defaultBaseUrl).toContain(BASE_URL_PLACEHOLDER);
    expect(problem).toContain(BASE_URL_PLACEHOLDER);
    // A finished configuration passes.
    expect(
      configProblem(
        {
          apiKey: 'k',
          model: 'gpt-4o',
          baseUrl: 'https://kapoor.openai.azure.com/openai/v1',
        },
        AZURE,
      ),
    ).toBe('');
  });

  it('55. settings round-trip and redact every provider, not just two', () => {
    const store = fakeStore(null);
    const next = defaultSettings();
    PROVIDER_IDS.forEach((id, i) => {
      next.providers[id] = {
        apiKey: 'key-for-' + id,
        model: 'model-' + i,
        baseUrl: 'https://proxy.kapoors.com/' + id + '/',
      };
    });
    next.activeProvider = 'deepseek';
    saveSettings(next, store);

    const back = loadSettings(store);
    expect(back.activeProvider).toBe('deepseek');
    PROVIDER_IDS.forEach((id, i) => {
      // A session-only secret comes back blank by design (test 65).
      expect(back.providers[id].apiKey).toBe(
        PROVIDERS[id].persistKey ? 'key-for-' + id : '',
      );
      expect(back.providers[id].model).toBe('model-' + i);
      // Trailing slash normalised on save, for every provider.
      expect(back.providers[id].baseUrl).toBe(
        'https://proxy.kapoors.com/' + id,
      );
    });

    // Every configured key is masked, whichever provider holds it.
    const echoed = PROVIDER_IDS.map(id => 'key-for-' + id).join(' and ');
    const masked = redactSecrets(echoed, next);
    PROVIDER_IDS.forEach(id => {
      expect(masked).not.toContain('key-for-' + id);
    });

    // And a GitHub token shape is masked even when it was never configured.
    expect(
      redactSecrets('token ghp_A1b2C3d4E5f6G7h8 leaked', defaultSettings()),
    ).not.toContain('ghp_A1b2C3d4E5f6G7h8');
    expect(
      redactSecrets(
        'token github_pat_11ABCDEFG0abcdefghij leaked',
        defaultSettings(),
      ),
    ).not.toContain('github_pat_11ABCDEFG0abcdefghij');
  });

  it('56. a stored blob written before these providers existed still loads', () => {
    // Exactly what v1 of this feature wrote: two providers, nothing else.
    const store = fakeStore(
      JSON.stringify({
        activeProvider: 'openai',
        providers: {
          gemini: {
            apiKey: 'g',
            model: 'gemini-2.5-flash',
            baseUrl: 'https://g',
          },
          openai: { apiKey: 'o', model: 'gpt-4o', baseUrl: 'https://o' },
        },
        imageMaxEdgePx: 1600,
        maxOutputTokens: 8192,
        requestTimeoutMs: 120000,
      }),
    );

    const loaded = loadSettings(store);
    expect(loaded.providers.gemini.apiKey).toBe('g');
    expect(loaded.providers.openai.apiKey).toBe('o');
    // The three that were absent come back at their defaults, fully formed,
    // rather than undefined — which is what would crash the settings form.
    ([DEEPSEEK, GITHUB, AZURE, TRIMURTI] as AiProvider[]).forEach(provider => {
      const cfg = loaded.providers[provider.id];
      expect(cfg).toBeDefined();
      expect(cfg.apiKey).toBe('');
      expect(cfg.model).toBe(provider.defaultModel);
      expect(cfg.baseUrl).toBe(provider.defaultBaseUrl);
    });
  });
});

/* ------------------------------------------------------------------ */
/* Corrections found by coordinating with the gallery's own            */
/* trimurti-gateway (kapoorgalleries/sb1-vuxiwzek), which calls these  */
/* same APIs in production, and by the adversarial review of 3f2e9f4.  */
/* ------------------------------------------------------------------ */

describe('providers — corrections', () => {
  it('57. DeepSeek refuses photographs only for its text-only models', () => {
    // The deployed gateway sends every DeepSeek model text only; its
    // unmerged successor gives V4.1 Flash low-detail vision. The two agree
    // that the Pro / reasoner family cannot see a photograph, so that family
    // is refused here; whether Flash can is left to DeepSeek's endpoint,
    // which rejects an image part it cannot read rather than dropping it.
    expect(DEEPSEEK.supportsImages).toBe(true);
    const flash = cfgFor(DEEPSEEK, 'sk-x');
    expect(flash.model).toBe('deepseek-v4-flash');
    expect(DEEPSEEK.buildRequest(twoInlineImages(), flash).url).toContain(
      '/chat/completions',
    );

    const pro: ProviderSettings = { ...flash, model: 'deepseek-v4-pro' };
    const refused = thrownAiError(() =>
      DEEPSEEK.buildRequest(twoInlineImages(), pro),
    );
    expect(refused.kind).toBe('image');
    expect(refused.message).toContain('deepseek-v4-pro');
    expect(
      thrownAiError(() => DEEPSEEK.buildFallbackRequest(twoInlineImages(), pro))
        .kind,
    ).toBe('image');
    // Text-only work on Pro still goes through.
    expect(DEEPSEEK.buildRequest(notesOnlyRequest(), pro).url).toContain(
      '/chat/completions',
    );
    // The reasoner half of the family is refused too — a regexp narrowed to
    // Pro alone would let a photograph through to a model that drops it.
    expect(
      thrownAiError(() =>
        DEEPSEEK.buildRequest(twoInlineImages(), {
          ...flash,
          model: 'deepseek-reasoner',
        }),
      ).kind,
    ).toBe('image');

    PROVIDER_IDS.forEach(id => {
      expect(PROVIDERS[id].supportsImages).toBe(true);
    });
  });

  it('58. structuredOutput is declared per provider (test 72 covers what it seeds)', () => {
    // DeepSeek asks for JSON mode and is never schema-constrained. The
    // gateway's cataloguing route enforces the schema on GPT and the Claude
    // 5 family and refuses it for free elsewhere, so it is declared true
    // and the per-run fallback decides the rest.
    expect(DEEPSEEK.structuredOutput).toBe(false);
    PROVIDER_IDS.filter(id => id !== 'deepseek').forEach(id => {
      expect(PROVIDERS[id].structuredOutput).toBe(true);
    });
  });

  it('59. a prompt filtered as a 400 reads as blocked, not as a bad request', () => {
    // Azure and GitHub report a filtered prompt this way; OpenAI reports the
    // same outcome as finish_reason on a 200. Wrathful and yab-yum
    // iconography is ordinary stock here, so the two must read alike.
    const byCode = thrownAiError(() =>
      AZURE.extractText(
        400,
        { error: { code: 'content_filter', message: 'blocked' } },
        cfgFor(AZURE, 'k'),
      ),
    );
    expect(byCode.kind).toBe('blocked');

    const byMessage = thrownAiError(() =>
      GITHUB.extractText(
        400,
        {
          error: {
            message:
              'The response was filtered due to the prompt triggering our content management policy.',
          },
        },
        cfgFor(GITHUB, 'k'),
      ),
    );
    expect(byMessage.kind).toBe('blocked');

    // An ordinary 400 is still a bad request — otherwise client.ts could
    // never reach the structured-output fallback.
    expect(
      thrownAiError(() =>
        AZURE.extractText(
          400,
          { error: { message: "Unknown parameter: 'response_format'." } },
          cfgFor(AZURE, 'k'),
        ),
      ).kind,
    ).toBe('bad_request');
  });

  it('60. a query string on a default Base URL is not proxy mode', () => {
    // Compared by where the request lands, not by string identity: the raw
    // compare accepted a blank key on a request going straight to OpenAI.
    PROVIDER_IDS.filter(id => id !== 'azure').forEach(id => {
      const provider = PROVIDERS[id];
      const withQuery: ProviderSettings = {
        apiKey: '',
        model: provider.defaultModel,
        baseUrl: provider.defaultBaseUrl + '?x=1',
      };
      expect(isProxyMode(withQuery, provider)).toBe(false);
      expect(configProblem(withQuery, provider)).not.toBe('');

      // A genuinely different host is still proxy mode.
      expect(
        isProxyMode(
          { apiKey: '', model: 'm', baseUrl: 'https://gateway.kapoors.com/v1' },
          provider,
        ),
      ).toBe(true);
    });
  });

  it('61. the Base URL placeholder is only checked for the provider that has one', () => {
    // 'YOUR-RESOURCE' is a legal path segment; only Azure's default carries it.
    expect(
      configProblem(
        {
          apiKey: 'k',
          model: 'gpt-5.6-terra',
          baseUrl: 'https://proxy.kapoors.com/YOUR-RESOURCE/v1',
        },
        OPENAI,
      ),
    ).toBe('');
    expect(configProblem(cfgFor(AZURE, 'k'), AZURE)).toContain(
      BASE_URL_PLACEHOLDER,
    );
  });
});

/* ------------------------------------------------------------------ */
/* Coordinating with the gallery's trimurti-gateway                    */
/*                                                                     */
/* Every assertion here mirrors a line of the gateway's contract AS     */
/* DEPLOYED — the Supabase function's own source (version 12, 12 Sept  */
/* 2026), which is kapoorgalleries/sb1-vuxiwzek PR #130's code and not  */
/* its unmerged codex/* chain: what it honours, what it drops, and what */
/* its own page does with the access key.                              */
/* ------------------------------------------------------------------ */

describe('providers — trimurti gateway', () => {
  it('62. sends exactly what the gateway honours: namespaced model, messages, stream:false', () => {
    const cfg = cfgFor(TRIMURTI, 'a-passphrase-of-at-least-32-characters!!');
    const plan = TRIMURTI.buildRequest(twoInlineImages(), cfg);
    expect(plan.url).toBe(
      'https://lbiabcdeojolvxezytkw.supabase.co/functions/v1/trimurti-gateway/catalogue/completions',
    );
    expect(plan.headers.Authorization).toBe(
      'Bearer a-passphrase-of-at-least-32-characters!!',
    );
    expect(plan.headers['api-key']).toBeUndefined();

    const body = JSON.parse(plan.body) as RawNode;
    expect(body.model).toBe('google/gemini-3.5-flash-lite');
    expect(body.stream).toBe(false);
    // The cataloguing route takes a strict schema, so it is sent first and
    // the system prompt does not repeat it; the gateway's free 400 for the
    // slots that cannot enforce it triggers the schema-in-prompt retry.
    expect((body.response_format as RawNode).type).toBe('json_schema');
    const messages = body.messages as { role: string; content: unknown }[];
    expect(messages[0].role).toBe('system');
    expect(String(messages[0].content)).not.toContain(
      JSON.stringify(CATALOGUE_JSON_SCHEMA),
    );
    const retry = JSON.parse(
      TRIMURTI.buildFallbackRequest(twoInlineImages(), cfg).body,
    ) as RawNode;
    expect(retry.response_format).toBeUndefined();
    expect(
      String((retry.messages as { content: unknown }[])[0].content),
    ).toContain(JSON.stringify(CATALOGUE_JSON_SCHEMA));
    // Every suggested model carries a publisher prefix; a bare id 400s.
    TRIMURTI.modelSuggestions.forEach(m => {
      expect(m.indexOf('/')).toBeGreaterThan(0);
    });
    expect(TRIMURTI.defaultModel.indexOf('/')).toBeGreaterThan(0);
  });

  it('63. every OpenAI-dialect provider now sends stream:false explicitly', () => {
    OPENAI_DIALECT.forEach(provider => {
      const req =
        provider.textOnlyModels &&
        provider.textOnlyModels.test(provider.defaultModel)
          ? notesOnlyRequest()
          : twoInlineImages();
      const body = JSON.parse(
        provider.buildRequest(req, cfgFor(provider, 'k')).body,
      ) as RawNode;
      expect(body.stream).toBe(false);
    });
  });

  it('64. declares the gateway image limits and refuses its text-only slots', () => {
    expect(TRIMURTI.supportsRemoteImageUrl).toBe(false);
    expect(TRIMURTI.requiresJpeg).toBe(true);
    expect(TRIMURTI.maxImageEdgePx).toBe(1280);

    // Models the deployed gateway flattens images for — EVERY deepseek/*
    // slot, under its comment "DeepSeek is text-only" — are refused
    // photographs here rather than sent ones the model never sees. local/*
    // is not a deployed slot at all (the deployed gateway 400s it as not
    // allowed); it exists only in the unmerged chain, flattened there too,
    // so refusing it costs nothing either way.
    const cfg = cfgFor(TRIMURTI, 'k');
    [
      'deepseek/deepseek-v4-flash',
      'deepseek/deepseek-v4-pro',
      'deepseek/deepseek-chat',
      'local/llama3.3-70b',
    ].forEach(model => {
      const refused = thrownAiError(() =>
        TRIMURTI.buildRequest(twoInlineImages(), { ...cfg, model: model }),
      );
      expect(refused.kind).toBe('image');
      expect(refused.message).toContain(model);
    });
    // The gateway's image-reading slots take them, on the cataloguing route.
    [
      'google/gemini-3.5-flash-lite',
      'openai/gpt-5.6-terra',
      'anthropic/claude-sonnet-5',
    ].forEach(model => {
      expect(
        TRIMURTI.buildRequest(twoInlineImages(), { ...cfg, model: model }).url,
      ).toContain('/catalogue/completions');
    });
  });

  it('65. the access key is session-only: never written, always required', () => {
    expect(TRIMURTI.persistKey).toBe(false);
    PROVIDER_IDS.filter(id => id !== 'trimurti').forEach(id => {
      expect(PROVIDERS[id].persistKey).toBe(true);
    });

    const store = fakeStore(null);
    const next = defaultSettings();
    next.providers.trimurti.apiKey = 'a-passphrase-of-at-least-32-characters!!';
    next.providers.openai.apiKey = 'sk-persisted';
    saveSettings(next, store);
    expect(store.value).not.toContain('a-passphrase-of-at-least-32');
    const back = loadSettings(store);
    expect(back.providers.trimurti.apiKey).toBe('');
    expect(back.providers.openai.apiKey).toBe('sk-persisted');

    // The gateway host is the provider's own, so a blank key is refused
    // rather than read as "a proxy holds it".
    expect(isProxyMode(defaultSettings().providers.trimurti, TRIMURTI)).toBe(
      false,
    );
    expect(
      configProblem(defaultSettings().providers.trimurti, TRIMURTI),
    ).not.toBe('');
    expect(
      isProxyMode(
        { apiKey: '', model: 'm', baseUrl: 'https://gateway.kapoors.com/v1' },
        TRIMURTI,
      ),
    ).toBe(true);
  });

  it('66. a 503 from the gateway keeps its own explanation', () => {
    const err = thrownAiError(() =>
      TRIMURTI.extractText(
        503,
        { error: { message: 'The selected provider is not configured.' } },
        cfgFor(TRIMURTI, 'k'),
      ),
    );
    expect(err.kind).toBe('server');
    expect(err.message).toContain('The selected provider is not configured.');
    // A bare 5xx still reads as before.
    expect(
      thrownAiError(() =>
        TRIMURTI.extractText(502, null, cfgFor(TRIMURTI, 'k')),
      ).message,
    ).toContain('Try again');
  });

  it('67. probeGateway reads /key without spending anything, and maps failures', async () => {
    const settings = defaultSettings();
    settings.providers.trimurti.apiKey =
      'a-passphrase-of-at-least-32-characters!!';
    const seen: { url: string; method: string; auth: string }[] = [];
    const fetchImpl = ((input: RequestInfo, init?: RequestInit) => {
      const headers = (init && (init.headers as Record<string, string>)) || {};
      seen.push({
        url: String(input),
        method: (init && init.method) || 'GET',
        auth: headers.Authorization || '',
      });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              label:
                'Trimurti gateway · keys: Claude, GPT, Gemini · missing: TRIMURTI_DEEPSEEK_API_KEY',
              providers: {
                claude: true,
                gpt: true,
                deepseek: false,
                gemini: true,
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    }) as typeof fetch;

    const probe = await probeGateway(settings, { fetchImpl });
    expect(seen).toEqual([
      {
        url: 'https://lbiabcdeojolvxezytkw.supabase.co/functions/v1/trimurti-gateway/key',
        method: 'GET',
        auth: 'Bearer a-passphrase-of-at-least-32-characters!!',
      },
    ]);
    expect(probe.providers.gemini).toBe(true);
    expect(probe.providers.deepseek).toBe(false);
    expect(probe.label).toContain('Gemini');
    // The default model is Gemini's, and the gateway holds that key.
    expect(probe.keyForModel).toBe('present');

    // The same gateway with the configured model moved to the one provider
    // it holds no key for: "connected" alone would hide the 503 a run ends in.
    settings.providers.trimurti.model = 'deepseek/deepseek-v4-flash';
    expect((await probeGateway(settings, { fetchImpl })).keyForModel).toBe(
      'missing',
    );
    settings.providers.trimurti.model = 'local/llama3.3-70b';
    expect((await probeGateway(settings, { fetchImpl })).keyForModel).toBe(
      'unknown',
    );
    settings.providers.trimurti.model = TRIMURTI.defaultModel;

    // A rejected passphrase is an auth error naming the gateway's own
    // reason, and the passphrase itself is redacted even when echoed back.
    const rejecting = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              message:
                'Invalid access key. a-passphrase-of-at-least-32-characters!!',
            },
          }),
          { status: 401 },
        ),
      )) as typeof fetch;
    const auth = await rejectedAiError(
      probeGateway(settings, { fetchImpl: rejecting }),
    );
    expect(auth.kind).toBe('auth');
    expect(auth.providerId).toBe('trimurti');
    expect(auth.message).toContain('Invalid access key.');
    expect(auth.message).toContain('access key');
    expect(auth.message).not.toContain('API key');
    expect(auth.message).not.toContain('at-least-32');

    // A 200 that is not a gateway (a proxy's landing page, say).
    const notGateway = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ hello: 'world' }), { status: 200 }),
      )) as typeof fetch;
    expect(
      (await rejectedAiError(probeGateway(settings, { fetchImpl: notGateway })))
        .kind,
    ).toBe('parse');

    // Unreachable: the same network error, naming the host, as a run gives.
    const unreachable = (() =>
      Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;
    const net = await rejectedAiError(
      probeGateway(settings, { fetchImpl: unreachable }),
    );
    expect(net.kind).toBe('network');
    expect(net.message).toContain('lbiabcdeojolvxezytkw.supabase.co');
    // The deployed gateway refuses an unadmitted origin BEFORE the CORS
    // preflight, so from a browser the allowlist looks exactly like this —
    // the one hint the dealer needs is named here, and only for the gateway.
    expect(net.message).toContain('origin allowlist');
    const direct = await rejectedAiError(
      runCatalogue(
        'openai',
        settingsFixture('openai', 'sk-test0123456789'),
        dataUrlRequest(),
        { fetchImpl: unreachable },
      ),
    );
    expect(direct.kind).toBe('network');
    expect(direct.message).not.toContain('origin allowlist');

    // A /key that never answers is a timeout, not a panel stuck on
    // "Testing…" — the probe carries the same ceiling as a run.
    settings.requestTimeoutMs = 20;
    const hanging = ((_input: RequestInfo, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init ? init.signal : undefined;
        if (signal) {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }
      })) as typeof fetch;
    const late = await rejectedAiError(
      probeGateway(settings, { fetchImpl: hanging }),
    );
    expect(late.kind).toBe('timeout');

    // A caller's own abort reads as aborted, not as a timeout or a failure.
    const ctl = new AbortController();
    const pending = rejectedAiError(
      probeGateway(settings, { fetchImpl: hanging, signal: ctl.signal }),
    );
    ctl.abort();
    expect((await pending).kind).toBe('aborted');

    // A signal already aborted, and a Base URL that does not parse, never
    // reach fetch at all — the second would resolve against the page's own
    // origin and carry the access key there.
    const spy = stubFetch([{ status: 200, body: {} }]);
    const gone = new AbortController();
    gone.abort();
    expect(
      (
        await rejectedAiError(
          probeGateway(settings, { fetchImpl: spy.impl, signal: gone.signal }),
        )
      ).kind,
    ).toBe('aborted');
    settings.providers.trimurti.baseUrl = 'trimurti-gateway';
    const bad = await rejectedAiError(
      probeGateway(settings, { fetchImpl: spy.impl }),
    );
    expect(bad.kind).toBe('bad_request');
    expect(bad.message).toContain('not a valid URL');
    expect(spy.calls).toHaveLength(0);
    settings.providers.trimurti.baseUrl = TRIMURTI.defaultBaseUrl;

    // A timeout that lands while the BODY is being read is still a timeout,
    // not "answered, but not like a gateway".
    const slowBody = ((_input: RequestInfo, init?: RequestInit) =>
      Promise.resolve({
        status: 200,
        ok: true,
        json: () =>
          new Promise<unknown>((_resolve, reject) => {
            const s = init ? init.signal : undefined;
            if (s) {
              s.addEventListener('abort', () => reject(new Error('aborted')));
            }
          }),
      } as unknown as Response)) as typeof fetch;
    expect(
      (await rejectedAiError(probeGateway(settings, { fetchImpl: slowBody })))
        .kind,
    ).toBe('timeout');

    // A blank key sends no Authorization header at all (proxy mode).
    settings.requestTimeoutMs = 120000;
    settings.providers.trimurti.apiKey = '';
    seen.length = 0;
    await probeGateway(settings, { fetchImpl });
    expect(seen[0].auth).toBe('');
  });

  it('68. Gemini, DeepSeek and gateway defaults are the ids the DEPLOYED gateway runs', () => {
    // Ground truth is the Supabase function's own source (version 12, 12
    // Sept 2026), not any branch of its repository: the unmerged codex/*
    // chain renames DeepSeek's Flash id, and an earlier commit here followed
    // that chain by mistake.
    expect(GEMINI.defaultModel).toBe('gemini-3.5-flash-lite');
    expect(GEMINI.modelSuggestions).toContain('gemini-3.5-flash-lite');
    expect(DEEPSEEK.defaultModel).toBe('deepseek-v4-flash');
    expect(DEEPSEEK.modelSuggestions).toContain('deepseek-v4-pro');
    expect(DEEPSEEK.defaultBaseUrl).toBe('https://api.deepseek.com');

    expect(TRIMURTI.defaultModel).toBe('google/gemini-3.5-flash-lite');
    // The gateway's DeepSeek slots are text-only and every run here carries a
    // photograph, so the suggestions offer no dead end — and no id that
    // exists only on the unmerged chain.
    expect(TRIMURTI.modelSuggestions.some(m => /^deepseek\//.test(m))).toBe(
      false,
    );
    expect(TRIMURTI.modelSuggestions).not.toContain('deepseek/deepseek-flash');
    expect(DEEPSEEK.modelSuggestions).not.toContain('deepseek-flash');
    expect(TRIMURTI.outputTokenCap).toBe(8192);
    PROVIDER_IDS.filter(id => id !== 'trimurti').forEach(id => {
      expect(PROVIDERS[id].outputTokenCap).toBeUndefined();
    });
  });

  it('69. a reply the gateway cut off names the gateway cap, not a setting it ignores', () => {
    const cutOff = {
      choices: [{ finish_reason: 'length', message: { content: '{' } }],
    };
    const viaGateway = thrownAiError(() =>
      TRIMURTI.extractText(200, cutOff, cfgFor(TRIMURTI, 'k')),
    );
    expect(viaGateway.kind).toBe('truncated');
    expect(viaGateway.message).toContain('8192');
    expect(viaGateway.message).toContain('ignores "Max output tokens"');
    expect(viaGateway.message).not.toContain('Raise');

    // A direct provider honours the ceiling, so raising it is the fix.
    const direct = thrownAiError(() =>
      OPENAI.extractText(200, cutOff, cfgFor(OPENAI, 'k')),
    );
    expect(direct.kind).toBe('truncated');
    expect(direct.message).toContain('Raise "Max output tokens"');
    expect(direct.message).not.toContain('caps every reply');
  });

  it("70. the gateway's own 401, 403, 429 and 500 explanations survive", () => {
    const gatewaySays = (status: number, message: string, code?: string) =>
      thrownAiError(() =>
        TRIMURTI.extractText(
          status,
          { error: code ? { code, message } : { message } },
          cfgFor(TRIMURTI, 'k'),
        ),
      );

    const badKey = gatewaySays(401, 'Invalid access key.');
    expect(badKey.kind).toBe('auth');
    expect(badKey.message).toContain('Invalid access key.');
    expect(badKey.message).toContain('access key');
    expect(badKey.message).not.toContain('API key');

    // A 403 body is the origin allowlist, which no re-typed key cures. A
    // browser rarely sees it (the gateway refuses before the CORS preflight,
    // so the fetch fails — test 67 covers that path); a forwarding proxy
    // delivers it, and then the gateway's line is kept.
    const badOrigin = gatewaySays(403, 'Browser origin is not allowed.');
    expect(badOrigin.kind).toBe('auth');
    expect(badOrigin.message).toContain('Browser origin is not allowed.');

    // A provider's own 401 relayed verbatim through the gateway is about the
    // key the GATEWAY holds; sending the dealer to the access key would be
    // the wrong secret.
    const relayed = gatewaySays(
      401,
      'Incorrect API key provided: sk-proj-********. You can find your API key at https://platform.openai.com.',
    );
    expect(relayed.kind).toBe('auth');
    expect(relayed.message).toContain('held on the gateway');
    expect(relayed.message).toContain('Incorrect API key provided');
    expect(relayed.message).not.toContain('Check the access key');

    // The gateway's 8 MB body cap, which four large details can exceed.
    const tooLarge = gatewaySays(413, 'Request body exceeds 8388608 bytes.');
    expect(tooLarge.kind).toBe('bad_request');
    expect(tooLarge.message).toContain('8388608');
    expect(tooLarge.message).toContain('Image max edge');

    const budget = gatewaySays(
      429,
      'This request exceeds the remaining Trimurti app usage budget. It was not sent to the model provider.',
      'trimurti_usage_limit',
    );
    expect(budget.kind).toBe('rate_limit');
    expect(budget.message).toContain('not sent to the model provider');

    const unset = gatewaySays(
      500,
      'TRIMURTI_ACCESS_KEY is not configured on the Supabase project.',
    );
    expect(unset.kind).toBe('server');
    expect(unset.message).toContain('TRIMURTI_ACCESS_KEY is not configured');

    // The other providers' secrets keep their own names in the same line.
    const github = thrownAiError(() =>
      GITHUB.extractText(401, null, cfgFor(GITHUB, 'k')),
    );
    expect(github.message).toContain('GitHub token');
  });

  it('71. a root-dot host is the provider itself, not a proxy', () => {
    // The per-provider isOwnEndpoint tests strip the root dot; the generic
    // compare used by every other provider must not be the one path that
    // reads `api.openai.com.` as a proxy and accepts a blank key.
    expect(
      isProxyMode(
        { apiKey: '', model: 'm', baseUrl: 'https://api.openai.com./v1' },
        OPENAI,
      ),
    ).toBe(false);
    expect(
      isProxyMode(
        { apiKey: '', model: 'm', baseUrl: 'https://API.OPENAI.COM/v1/' },
        OPENAI,
      ),
    ).toBe(false);
    expect(
      isProxyMode(
        { apiKey: '', model: 'm', baseUrl: 'https://api.openai.com:8443/v1' },
        OPENAI,
      ),
    ).toBe(true);
  });

  it('72. the gateway route decides per slot whether the schema was enforced', async () => {
    // Gemini through the gateway: the route answers a free 400 naming
    // response_format, the driver retries once with the schema in the
    // prompt, and the record arrives flagged "not schema-constrained".
    const record = recordFixture();
    const stub = stubFetch([
      {
        status: 400,
        body: providerError(
          'response_format is not enforced for model "google/gemini-3.5-flash-lite" on this gateway; omit it and describe the schema in the prompt.',
        ),
      },
      { status: 200, body: openaiOk(JSON.stringify(record)) },
    ]);
    const settings = settingsFixture(
      'trimurti',
      'a-passphrase-of-at-least-32-characters!!',
    );
    const result = await runCatalogue('trimurti', settings, dataUrlRequest(), {
      fetchImpl: stub.impl,
    });
    expect(result.usedFallback).toBe(true);
    expect(result.record).toEqual(record);
    expect(stub.calls).toHaveLength(2);
    const first = JSON.parse(stub.calls[0].init.body as string) as RawNode;
    const second = JSON.parse(stub.calls[1].init.body as string) as RawNode;
    expect(first.response_format).toBeDefined();
    expect(second.response_format).toBeUndefined();
    expect(second.stream).toBe(false);
    expect(stub.calls[1].url).toContain('/catalogue/completions');

    // GPT through the gateway: the schema is enforced upstream, one call,
    // and the record is not flagged.
    const enforced = stubFetch([
      { status: 200, body: openaiOk(JSON.stringify(record)) },
    ]);
    settings.providers.trimurti.model = 'openai/gpt-5.6-terra';
    const viaGpt = await runCatalogue('trimurti', settings, dataUrlRequest(), {
      fetchImpl: enforced.impl,
    });
    expect(viaGpt.usedFallback).toBe(false);
    expect(enforced.calls).toHaveLength(1);

    // A gateway that predates the route answers 404, reported as such —
    // never the chat route's limits in disguise.
    const older = stubFetch([
      {
        status: 404,
        body: providerError('No such endpoint: POST /catalogue/completions'),
      },
    ]);
    const missing = await rejectedAiError(
      runCatalogue('trimurti', settings, dataUrlRequest(), {
        fetchImpl: older.impl,
      }),
    );
    expect(missing.kind).toBe('not_found');
    expect(older.calls).toHaveLength(1);

    // A direct, schema-constrained provider that never fell back stays false.
    const direct = stubFetch([
      { status: 200, body: openaiOk(JSON.stringify(record)) },
    ]);
    const viaOpenAi = await runCatalogue(
      'openai',
      settingsFixture('openai', 'sk-test0123456789'),
      dataUrlRequest(),
      { fetchImpl: direct.impl },
    );
    expect(viaOpenAi.usedFallback).toBe(false);
  });
});
