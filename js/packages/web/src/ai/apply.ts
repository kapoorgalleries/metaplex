/**
 * Pure mapper: a reviewed catalogue record plus the user's selection -> the
 * single object merged into the NFT's metadata.
 *
 * Everything here is pure and imports nothing but types.ts, so "what actually
 * lands on chain" is answerable in a unit test. The patch is a structural
 * supertype of the fields we touch on IMetadataExtension rather than that
 * interface itself, which keeps src/ai free of '@oyster/common'.
 *
 * The model never authors a trait name: every trait_type comes from the fixed
 * TRAIT_VOCABULARY below and the values are read out of the typed record, so a
 * hallucinated trait_type cannot reach immutable metadata.
 */

import {
  ApplySelection,
  CatalogueRecord,
  DimensionsBlock,
  InscriptionSegment,
  MetadataAttribute,
  ProviderId,
  TraitKey,
} from './types';

/** The 15 members of TraitKey, in the order they are displayed and written. */
export const TRAIT_VOCABULARY: TraitKey[] = [
  'Object Type',
  'Subject',
  'Region',
  'School',
  'Tradition',
  'Period',
  'Date Range',
  'Medium',
  'Materials',
  'Dimensions',
  'Condition',
  'Inscription Script',
  'Inscription Language',
  'Attribution Confidence',
  'Catalogued By',
];

const CONDITION_MAX_CHARS = 120;

const INSCRIPTION_HEADING = '— Inscription —';

function truncate(text: string, max: number): string {
  const value = text.trim();
  if (value.length <= max) {
    return value;
  }
  return value.slice(0, max).replace(/\s+$/, '') + '…';
}

/** '' unless both bounds are known; 0 means "not determined". */
function formatDateRange(earliestYear: number, latestYear: number): string {
  if (earliestYear === 0 || latestYear === 0) {
    return '';
  }
  // En dash, matching catalogue house style.
  return earliestYear + '–' + latestYear + ' CE';
}

/** '' unless a scale reference was actually visible: a measurement inferred
 *  from an unscaled photograph is a guess and must not be written. */
function formatDimensions(d: DimensionsBlock): string {
  if (!d.scaleReferenceVisible) {
    return '';
  }
  const parts: string[] = [];
  if (d.heightCm !== 0) {
    parts.push(String(d.heightCm));
  }
  if (d.widthCm !== 0) {
    parts.push(String(d.widthCm));
  }
  if (d.depthCm !== 0) {
    parts.push(String(d.depthCm));
  }
  if (parts.length === 0) {
    return '';
  }
  return parts.join(' × ') + ' cm';
}

export function recordToTraits(
  r: CatalogueRecord,
  meta: { providerId: ProviderId; model: string },
): MetadataAttribute[] {
  const firstSegment: InscriptionSegment | undefined =
    r.inscription.segments[0];
  const values: Record<TraitKey, string> = {
    'Object Type': r.objectType,
    Subject: r.subject.primaryIdentification,
    Region: r.culture.region,
    School: r.culture.schoolOrSubRegion,
    Tradition: r.culture.tradition,
    Period: r.period.label,
    'Date Range': formatDateRange(r.period.earliestYear, r.period.latestYear),
    Medium: r.medium.primaryMedium,
    Materials: r.medium.materials.join(', '),
    Dimensions: formatDimensions(r.dimensions),
    Condition: truncate(r.condition.summary, CONDITION_MAX_CHARS),
    'Inscription Script': firstSegment ? firstSegment.script : '',
    'Inscription Language': firstSegment ? firstSegment.language : '',
    'Attribution Confidence': r.confidence.subject,
    'Catalogued By': meta.providerId + ':' + meta.model,
  };
  return TRAIT_VOCABULARY.map(key => ({
    trait_type: key,
    value: String(values[key]).trim(),
  })).filter(attribute => attribute.value !== '');
}

function segmentLines(seg: InscriptionSegment, index: number): string[] {
  const lines: string[] = [];
  if (index > 0) {
    lines.push('Inscription ' + index);
  }
  const location = seg.location.trim();
  if (location !== '') {
    lines.push('Location: ' + location);
  }
  const script = seg.script.trim();
  const language = seg.language.trim();
  const halves: string[] = [];
  if (script !== '') {
    halves.push('Script: ' + script);
  }
  if (language !== '') {
    halves.push('Language: ' + language);
  }
  if (halves.length > 0) {
    lines.push(halves.join(' | '));
  }
  lines.push('Transcription:');
  lines.push(seg.transcription.trim());
  const transliteration = seg.transliteration.trim();
  if (transliteration !== '') {
    lines.push('Transliteration:');
    lines.push(transliteration);
  }
  lines.push('Translation:');
  lines.push(seg.translation.trim());
  const notes = seg.notes.trim();
  if (notes !== '') {
    lines.push('Notes: ' + notes);
  }
  return lines;
}

/**
 * The exact string the review panel shows in its Description box and the exact
 * string that gets written. Nothing transforms it again on the way out.
 */
export function composeDescription(
  r: CatalogueRecord,
  includeInscription: boolean,
): string {
  const prose = r.catalogueDescription.trim();
  const inscription = r.inscription;
  const omitInscription =
    !includeInscription ||
    inscription.present === 'no' ||
    inscription.segments.length === 0;
  if (omitInscription) {
    return prose;
  }

  const numbered = inscription.segments.length > 1;
  const blocks = inscription.segments.map((seg, i) =>
    segmentLines(seg, numbered ? i + 1 : 0).join('\n'),
  );
  if (
    inscription.completeness === 'partial' ||
    inscription.completeness === 'illegible'
  ) {
    const untranslated = inscription.untranslatedPortions.trim();
    blocks.push(
      '[TRANSLATION INCOMPLETE — untranslated: ' +
        (untranslated === '' ? 'not specified' : untranslated) +
        ']',
    );
  }

  const block = INSCRIPTION_HEADING + '\n' + blocks.join('\n\n');
  return (prose + '\n\n' + block).trim();
}

/** Structural supertype of the IMetadataExtension fields this feature writes.
 *  Keys the selection turns off are absent, so the caller can spread it. */
export interface MetadataPatch {
  name?: string;
  description?: string;
  attributes?: MetadataAttribute[];
}

export function buildPatch(
  r: CatalogueRecord,
  sel: ApplySelection,
  meta: { providerId: ProviderId; model: string },
): MetadataPatch {
  const patch: MetadataPatch = {};
  if (sel.title) {
    // 50 is the on-chain name limit the mint form enforces.
    patch.name = r.title.slice(0, 50).trim();
  }
  if (sel.description) {
    patch.description = composeDescription(r, sel.includeInscription);
  }
  if (sel.traits) {
    patch.attributes = recordToTraits(r, meta).filter(
      attribute => sel.traitKeys.indexOf(attribute.trait_type as TraitKey) >= 0,
    );
  }
  return patch;
}
