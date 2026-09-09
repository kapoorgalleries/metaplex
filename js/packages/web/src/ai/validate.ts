/**
 * Runtime validation of provider JSON, and the domain audit over a parsed
 * record.
 *
 * Hand-written on purpose: no ajv, no zod, no new dependency. Both providers'
 * output is untrusted — OpenAI strict json_schema and Gemini responseSchema
 * are best-effort, and the fallback request path drops them entirely — so the
 * shape has to be re-established here regardless.
 *
 * parseCatalogueRecord throws on anything malformed. auditRecord never throws:
 * it reports on a record that is structurally fine but editorially suspect.
 */

import {
  CatalogueRecord,
  ConditionBlock,
  ConfidenceBlock,
  ConfidenceLevel,
  CultureBlock,
  DimensionsBlock,
  InscriptionBlock,
  InscriptionPresence,
  InscriptionSegment,
  MediumBlock,
  PeriodBlock,
  RecordWarning,
  SubjectBlock,
  TranslationCompleteness,
  WarningCode,
  aiError,
} from './types';
import { NO_PROVENANCE_SENTINEL } from './prompt';

/**
 * The never-partial guard.
 *
 * Anchored to the end of the string for the trailing-ellipsis cases so a
 * legitimate translation that quotes an ellipsis mid-sentence is not rejected;
 * the bracketed and parenthesised truncation markers are matched anywhere.
 * Exported so the review panel can re-check a hand-edited translation with the
 * exact same rule the parser used.
 */
export const ELISION_PATTERN =
  /\[\s*\.\.\.\s*\]|\[\s*truncated|\(truncated\)|\[\s*remainder\s+omitted\s*\]|(?:\.\.\.|…)[\s"'”’»)\]}]*$/i;

const CONFIDENCE_LEVELS: ConfidenceLevel[] = [
  'high',
  'medium',
  'low',
  'unable',
];

const PRESENCE_VALUES: InscriptionPresence[] = ['yes', 'no', 'possible'];

const COMPLETENESS_VALUES: TranslationCompleteness[] = [
  'complete',
  'partial',
  'illegible',
  'not-applicable',
];

/** A model that emits more registers than this has run away, not read a base. */
const MAX_SEGMENTS = 24;

/** A span wider than this is not a date, it is a shrug. */
const MAX_PLAUSIBLE_SPAN_YEARS = 800;

/* ------------------------------------------------------------------ */
/* Narrowing helpers. Every one names the offending path.              */
/* ------------------------------------------------------------------ */

function obj(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw aiError('schema', path + ' is missing or is not an object');
  }
  return v as Record<string, unknown>;
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string') {
    throw aiError('schema', path + ' is missing or is not a string');
  }
  return v;
}

function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !isFinite(v)) {
    throw aiError('schema', path + ' is missing or is not a finite number');
  }
  return v;
}

function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') {
    throw aiError('schema', path + ' is missing or is not a boolean');
  }
  return v;
}

/** Trims every entry and drops the empty ones, so '' never reaches metadata. */
function strArr(v: unknown, path: string): string[] {
  if (!Array.isArray(v)) {
    throw aiError('schema', path + ' is missing or is not an array');
  }
  const out: string[] = [];
  v.forEach((item, i) => {
    if (typeof item !== 'string') {
      throw aiError('schema', path + '[' + i + '] is not a string');
    }
    const trimmed = item.trim();
    if (trimmed !== '') {
      out.push(trimmed);
    }
  });
  return out;
}

function oneOf<T extends string>(v: unknown, allowed: T[], path: string): T {
  const s = str(v, path);
  if (allowed.indexOf(s as T) === -1) {
    throw aiError(
      'schema',
      path + ' is "' + s + '", expected one of ' + allowed.join(', '),
    );
  }
  return s as T;
}

/* ------------------------------------------------------------------ */
/* Block parsers                                                       */
/* ------------------------------------------------------------------ */

function parseSubject(v: unknown): SubjectBlock {
  const o = obj(v, 'subject');
  return {
    iconographicBasis: str(o.iconographicBasis, 'subject.iconographicBasis'),
    primaryIdentification: str(
      o.primaryIdentification,
      'subject.primaryIdentification',
    ),
    alternativeIdentifications: strArr(
      o.alternativeIdentifications,
      'subject.alternativeIdentifications',
    ),
  };
}

function parseCulture(v: unknown): CultureBlock {
  const o = obj(v, 'culture');
  return {
    region: str(o.region, 'culture.region'),
    schoolOrSubRegion: str(o.schoolOrSubRegion, 'culture.schoolOrSubRegion'),
    tradition: str(o.tradition, 'culture.tradition'),
  };
}

function parsePeriod(v: unknown): PeriodBlock {
  const o = obj(v, 'period');
  return {
    datingRationale: str(o.datingRationale, 'period.datingRationale'),
    label: str(o.label, 'period.label'),
    earliestYear: num(o.earliestYear, 'period.earliestYear'),
    latestYear: num(o.latestYear, 'period.latestYear'),
  };
}

function parseMedium(v: unknown): MediumBlock {
  const o = obj(v, 'medium');
  return {
    primaryMedium: str(o.primaryMedium, 'medium.primaryMedium'),
    materials: strArr(o.materials, 'medium.materials'),
    surfaceAndDecoration: strArr(
      o.surfaceAndDecoration,
      'medium.surfaceAndDecoration',
    ),
  };
}

function parseDimensions(v: unknown): DimensionsBlock {
  const o = obj(v, 'dimensions');
  return {
    scaleReferenceVisible: bool(
      o.scaleReferenceVisible,
      'dimensions.scaleReferenceVisible',
    ),
    heightCm: num(o.heightCm, 'dimensions.heightCm'),
    widthCm: num(o.widthCm, 'dimensions.widthCm'),
    depthCm: num(o.depthCm, 'dimensions.depthCm'),
    basisForMeasurement: str(
      o.basisForMeasurement,
      'dimensions.basisForMeasurement',
    ),
  };
}

function parseCondition(v: unknown): ConditionBlock {
  const o = obj(v, 'condition');
  return {
    summary: str(o.summary, 'condition.summary'),
    observations: strArr(o.observations, 'condition.observations'),
  };
}

function parseSegment(v: unknown, i: number): InscriptionSegment {
  const p = 'inscription.segments[' + i + ']';
  const o = obj(v, p);
  const segment: InscriptionSegment = {
    location: str(o.location, p + '.location'),
    script: str(o.script, p + '.script'),
    language: str(o.language, p + '.language'),
    transcription: str(o.transcription, p + '.transcription'),
    transliteration: str(o.transliteration, p + '.transliteration'),
    translation: str(o.translation, p + '.translation'),
    notes: str(o.notes, p + '.notes'),
  };

  if (
    segment.transcription.trim() !== '' &&
    segment.translation.trim() === ''
  ) {
    throw aiError(
      'schema',
      p +
        '.translation is empty: segment ' +
        (i + 1) +
        ' has a transcription but no translation. Inscriptions are ' +
        'translated in full or not at all.',
    );
  }

  if (ELISION_PATTERN.test(segment.translation)) {
    throw aiError(
      'schema',
      p +
        '.translation is abridged: segment ' +
        (i + 1) +
        ' ends in an ellipsis or carries a truncation marker. A partial ' +
        'translation is never acceptable.',
    );
  }

  return segment;
}

function parseInscription(v: unknown): InscriptionBlock {
  const o = obj(v, 'inscription');
  const present = oneOf(o.present, PRESENCE_VALUES, 'inscription.present');

  const rawSegments = o.segments;
  if (!Array.isArray(rawSegments)) {
    throw aiError(
      'schema',
      'inscription.segments is missing or is not an array',
    );
  }
  if (rawSegments.length > MAX_SEGMENTS) {
    throw aiError(
      'schema',
      'inscription.segments has ' +
        rawSegments.length +
        ' entries, more than the ' +
        MAX_SEGMENTS +
        ' allowed; the response looks like runaway output',
    );
  }
  const segments: InscriptionSegment[] = rawSegments.map(parseSegment);

  const completeness = oneOf(
    o.completeness,
    COMPLETENESS_VALUES,
    'inscription.completeness',
  );
  const untranslatedPortions = str(
    o.untranslatedPortions,
    'inscription.untranslatedPortions',
  );

  if (present === 'yes' && segments.length === 0) {
    throw aiError(
      'schema',
      'inscription.present is "yes" but inscription.segments is empty',
    );
  }
  if (completeness === 'complete' && untranslatedPortions.trim() !== '') {
    throw aiError(
      'schema',
      'inscription.completeness is "complete" but ' +
        'inscription.untranslatedPortions is not empty',
    );
  }

  return { present, segments, completeness, untranslatedPortions };
}

function parseConfidence(v: unknown): ConfidenceBlock {
  const o = obj(v, 'confidence');
  return {
    subject: oneOf(o.subject, CONFIDENCE_LEVELS, 'confidence.subject'),
    culture: oneOf(o.culture, CONFIDENCE_LEVELS, 'confidence.culture'),
    period: oneOf(o.period, CONFIDENCE_LEVELS, 'confidence.period'),
    medium: oneOf(o.medium, CONFIDENCE_LEVELS, 'confidence.medium'),
    inscription: oneOf(
      o.inscription,
      CONFIDENCE_LEVELS,
      'confidence.inscription',
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Narrows arbitrary parsed JSON into a CatalogueRecord, or throws
 * aiError('schema') naming the offending path.
 *
 * The result is built key by key rather than spread from `raw`, so extra keys
 * the model invented can never travel on into NFT metadata.
 */
export function parseCatalogueRecord(raw: unknown): CatalogueRecord {
  const r = obj(raw, 'record');
  return {
    objectType: str(r.objectType, 'objectType'),
    title: str(r.title, 'title'),
    subject: parseSubject(r.subject),
    culture: parseCulture(r.culture),
    period: parsePeriod(r.period),
    medium: parseMedium(r.medium),
    dimensions: parseDimensions(r.dimensions),
    condition: parseCondition(r.condition),
    inscription: parseInscription(r.inscription),
    catalogueDescription: str(r.catalogueDescription, 'catalogueDescription'),
    provenanceNote: str(r.provenanceNote, 'provenanceNote'),
    confidence: parseConfidence(r.confidence),
    uncertainties: strArr(r.uncertainties, 'uncertainties'),
    recommendedExpertChecks: strArr(
      r.recommendedExpertChecks,
      'recommendedExpertChecks',
    ),
  };
}

/**
 * Editorial audit of a structurally valid record. Pure; never throws.
 * 'block' warnings pre-uncheck their section in the review panel.
 */
export function auditRecord(r: CatalogueRecord): RecordWarning[] {
  const out: RecordWarning[] = [];
  const add = (
    code: WarningCode,
    severity: 'block' | 'warn',
    message: string,
  ) => {
    out.push({ code, severity, message });
  };

  const ins = r.inscription;
  /* The model's own admission of untranslated text counts even when it
   * labelled completeness something other than partial/illegible — an
   * incoherent pair like completeness 'not-applicable' alongside a populated
   * untranslatedPortions must not slip past as a full translation. Guarded on
   * segments, so a piece with no inscription at all cannot trip it. */
  const admitsUntranslated =
    ins.untranslatedPortions.trim() !== '' && ins.segments.length > 0;
  if (
    ins.completeness === 'partial' ||
    ins.completeness === 'illegible' ||
    admitsUntranslated
  ) {
    const untranslated = ins.untranslatedPortions.trim() || 'not specified';
    add(
      'partial-translation',
      'block',
      'The model reports the inscription translation is INCOMPLETE. ' +
        'Untranslated: "' +
        untranslated +
        '". Do not publish this as a full translation. Try again with a ' +
        'close-up photograph of the inscription, or with the other provider.',
    );
  }

  const d = r.dimensions;
  const hasMeasurement = d.heightCm > 0 || d.widthCm > 0 || d.depthCm > 0;
  if (!d.scaleReferenceVisible && hasMeasurement) {
    add(
      'unscaled-dimensions',
      'block',
      'Dimensions were given with no scale reference visible. Measure the ' +
        'piece before publishing.',
    );
  }

  const earliest = r.period.earliestYear;
  const latest = r.period.latestYear;
  if (earliest > 0 && latest > 0 && latest < earliest) {
    add(
      'inverted-date-range',
      'warn',
      'The date range is inverted (' +
        earliest +
        ' to ' +
        latest +
        '). Treat the dating as unattributed.',
    );
  }
  if (
    earliest > 0 &&
    latest > 0 &&
    latest - earliest > MAX_PLAUSIBLE_SPAN_YEARS
  ) {
    add(
      'implausible-date-range',
      'warn',
      'The date range spans ' +
        (latest - earliest) +
        ' years. Treat the dating as unattributed.',
    );
  }

  if (r.uncertainties.length === 0) {
    add(
      'no-uncertainties-declared',
      'warn',
      'The model declared no uncertainties. That is itself suspicious for ' +
        'an image-only assessment; read the attribution sceptically.',
    );
  }

  const provenance = r.provenanceNote.trim();
  if (provenance !== '' && provenance !== NO_PROVENANCE_SENTINEL) {
    add(
      'provenance-asserted',
      'block',
      'The model volunteered provenance information. Ignore it unless you ' +
        'can read the label yourself.',
    );
  }

  if (r.confidence.subject === 'low' || r.confidence.subject === 'unable') {
    add(
      'low-confidence-subject',
      'warn',
      'The identification is low confidence. Verify before publishing.',
    );
  }

  return out;
}
