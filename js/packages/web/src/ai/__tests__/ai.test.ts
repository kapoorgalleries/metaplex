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
import { GEMINI, OPENAI } from '../providers';
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
  loadSettings,
  redactSecrets,
  saveSettings,
} from '../settings';
import { runCatalogue } from '../client';
import {
  TRAIT_VOCABULARY,
  buildPatch,
  composeDescription,
  recordToTraits,
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

  it('18. both fallback requests drop the structured-output directive', () => {
    const gemini = geminiBody(
      GEMINI.buildFallbackRequest(twoInlineImages(), geminiCfg(GEMINI_KEY)),
    );
    expect('responseSchema' in gemini.generationConfig).toBe(false);
    expect(gemini.generationConfig.responseMimeType).toBe('application/json');

    const openai = openaiBody(
      OPENAI.buildFallbackRequest(
        inlineAndRemoteImages(),
        openaiCfg(OPENAI_KEY),
      ),
    );
    expect(openai.response_format).toEqual({ type: 'json_object' });
    const serialised = JSON.stringify(CATALOGUE_JSON_SCHEMA);
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
    expect(String(truncated.name).length).toBeLessThanOrEqual(50);
  });
});
