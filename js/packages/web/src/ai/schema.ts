/**
 * The canonical output schema, plus the transform into Gemini's dialect.
 *
 * HARD RULES this schema obeys, and ai.test.ts enforces:
 *  1. every object node has additionalProperties: false
 *  2. every object node's `required` equals Object.keys(properties)
 *  3. no null types, no type unions, no minItems, no maxItems, no format,
 *     no pattern, no oneOf/anyOf/allOf, no $ref
 *
 * That set is the intersection of what OpenAI strict json_schema and
 * Gemini's responseSchema both accept. Absence is modelled as '' / [] / 0
 * or an enum member, never as null.
 */

export interface JsonSchemaNode {
  type: string;
  description?: string;
  enum?: string[];
  items?: JsonSchemaNode;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  additionalProperties?: boolean;
}

export const CATALOGUE_SCHEMA_NAME = 'catalogue_record';

const S = (description: string): JsonSchemaNode => ({
  type: 'string',
  description,
});

const ENUM = (values: string[], description: string): JsonSchemaNode => ({
  type: 'string',
  enum: values,
  description,
});

const NUM = (description: string): JsonSchemaNode => ({
  type: 'number',
  description,
});

const BOOL = (description: string): JsonSchemaNode => ({
  type: 'boolean',
  description,
});

const ARR = (items: JsonSchemaNode, description: string): JsonSchemaNode => ({
  type: 'array',
  items,
  description,
});

const OBJ = (
  properties: Record<string, JsonSchemaNode>,
  description: string,
): JsonSchemaNode => ({
  type: 'object',
  description,
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

const STR_ITEM: JsonSchemaNode = { type: 'string' };

const CONFIDENCE_VALUES = ['high', 'medium', 'low', 'unable'];

const INSCRIPTION_SEGMENT = OBJ(
  {
    location: S(
      'Where on the object, e.g. "front of lotus base", "reverse, upper register". "" if not determinable.',
    ),
    script: S(
      'Script only, not language: Ranjana (Lantsa), Uchen, Devanagari, Sharada, Nastaliq, Grantha. "" if undetermined.',
    ),
    language: S(
      'Classical Tibetan, Sanskrit, Newari, Persian, Nepali. "" if undetermined.',
    ),
    transcription: S(
      'Every legible character, verbatim, in the original script, character for character. Do not normalise or correct. Mark illegible runs inline as [illegible].',
    ),
    transliteration: S(
      'Romanisation of the transcription. IAST for Sanskrit and Devanagari, Wylie for Tibetan.',
    ),
    translation: S(
      'COMPLETE English translation of this entire segment. Never abridge, never summarise, never stop after the opening formula, never write "..." or "[remainder omitted]". Must not be empty when transcription is non-empty.',
    ),
    notes: S(
      'Standard formulae identified by name (e.g. the ye dharma hetu verse), donor formulae, dating formulae. "" if none.',
    ),
  },
  'One distinct inscription, or one register of a long inscription.',
);

export const CATALOGUE_JSON_SCHEMA = OBJ(
  {
    objectType: S(
      'e.g. "Figure of Padmapani", "Thangka", "Ritual dagger (phurba)", "Manuscript folio".',
    ),
    title: S(
      'Short dealer-style catalogue title: object, subject, likely region and period. At most 50 characters, no trailing full stop, no hedging words.',
    ),
    subject: OBJ(
      {
        iconographicBasis: S(
          'FILL THIS FIRST. Only what is physically visible: attributes held, mudra, asana, vahana, lakshanas, crown and jewellery type, treatment of the base, hair and urna.',
        ),
        primaryIdentification: S(
          'The identification the visible evidence best supports. "" if you cannot identify the figure.',
        ),
        alternativeIdentifications: ARR(
          STR_ITEM,
          'Other identifications the same evidence would support. [] if none.',
        ),
      },
      'Iconographic identification. Evidence before conclusion.',
    ),
    culture: OBJ(
      {
        region: S('e.g. Nepal, Tibet, North India (Bihar). "" if unknown.'),
        schoolOrSubRegion: S(
          'e.g. "Newar, Kathmandu Valley", "Pala", "Densatil". "" if unknown.',
        ),
        tradition: S(
          'e.g. "Vajrayana Buddhist", "Shaiva", "Jain". "" if unknown.',
        ),
      },
      'Cultural attribution.',
    ),
    period: OBJ(
      {
        datingRationale: S(
          'FILL THIS FIRST. The style features that drive the date: proportion, casting, treatment of drapery, base form, patina, pigment.',
        ),
        label: S(
          'e.g. "Malla period", "circa 15th century", "19th century or later". "" if undetermined.',
        ),
        earliestYear: NUM(
          'Earliest plausible year CE as an integer. 0 means not determined. Negative values are BCE.',
        ),
        latestYear: NUM(
          'Latest plausible year CE as an integer. 0 means not determined. Must not be earlier than earliestYear.',
        ),
      },
      'Dating. Rationale before conclusion. Prefer a broad honest range.',
    ),
    medium: OBJ(
      {
        primaryMedium: S('e.g. "Gilt copper alloy", "Distemper on cloth".'),
        materials: ARR(
          STR_ITEM,
          'e.g. ["copper alloy", "gilding", "turquoise", "coral"]. [] if undetermined.',
        ),
        surfaceAndDecoration: ARR(
          STR_ITEM,
          'e.g. ["cold gold", "polychrome", "repousse", "inlay"]. [] if none visible.',
        ),
      },
      'Medium and materials, as far as a photograph can show them.',
    ),
    dimensions: OBJ(
      {
        scaleReferenceVisible: BOOL(
          'True ONLY if a ruler, scale bar or stated measurement is visible in a photograph, or measurements were supplied in the dealer notes. Otherwise false and all measurements 0.',
        ),
        heightCm: NUM('Centimetres. 0 means not determined.'),
        widthCm: NUM('Centimetres. 0 means not determined.'),
        depthCm: NUM('Centimetres. 0 means not determined.'),
        basisForMeasurement: S(
          'What the measurement came from. "" when no measurement was given.',
        ),
      },
      'Dimensions. Never estimate from a photograph alone.',
    ),
    condition: OBJ(
      {
        summary: S('One sentence on overall condition.'),
        observations: ARR(
          STR_ITEM,
          'Specific observations: losses, wear to gilding, later paint, repairs, corrosion, cracks. [] if none visible.',
        ),
      },
      'Condition as visible in the photographs.',
    ),
    inscription: OBJ(
      {
        present: ENUM(
          ['yes', 'no', 'possible'],
          'Whether any inscription, dedication, seal, colophon or mantra is visible.',
        ),
        segments: ARR(
          INSCRIPTION_SEGMENT,
          'One entry per distinct inscription or register. [] when present is "no".',
        ),
        completeness: ENUM(
          ['complete', 'partial', 'illegible', 'not-applicable'],
          'Set "complete" ONLY if every legible character has been translated. If any legible portion is untranslated, set "partial" and describe it in untranslatedPortions.',
        ),
        untranslatedPortions: S(
          'Exactly what could not be read or translated. "" when completeness is "complete" or "not-applicable".',
        ),
      },
      'Inscriptions. Transcribe in full, transliterate, then translate in full.',
    ),
    catalogueDescription: S(
      '100 to 250 words of catalogue prose on form, iconography, materials, technique and condition. Do not repeat the inscription translation here.',
    ),
    provenanceNote: S(
      'Exactly "No provenance can be determined from the image." unless a collection label, inventory number, auction sticker or old paper label is physically legible — then transcribe only what is legible.',
    ),
    confidence: OBJ(
      {
        subject: ENUM(CONFIDENCE_VALUES, 'Identification.'),
        culture: ENUM(CONFIDENCE_VALUES, 'Region/school.'),
        period: ENUM(CONFIDENCE_VALUES, 'Dating.'),
        medium: ENUM(CONFIDENCE_VALUES, 'Materials.'),
        inscription: ENUM(
          CONFIDENCE_VALUES,
          'Reading and translation of the inscription.',
        ),
      },
      'Your own confidence per area.',
    ),
    uncertainties: ARR(
      STR_ITEM,
      'Everything you could not determine from photographs alone. Must never be empty.',
    ),
    recommendedExpertChecks: ARR(
      STR_ITEM,
      'What a specialist should verify in the hand: alloy analysis, base seal, pigment, dating of the textile mount.',
    ),
  },
  'A catalogue record for one work of Indian, Himalayan or South Asian art.',
);

const GEMINI_TYPE_MAP: Record<string, string> = {
  string: 'STRING',
  number: 'NUMBER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN',
  object: 'OBJECT',
  array: 'ARRAY',
};

/**
 * Rewrites the canonical (OpenAI-strict) schema into Gemini's responseSchema
 * dialect: uppercase type tokens, no additionalProperties, and an explicit
 * propertyOrdering.
 *
 * propertyOrdering is not cosmetic — it is what makes the model generate
 * iconographicBasis before primaryIdentification, datingRationale before the
 * period label, and transcription -> transliteration -> translation. Dropping
 * it silently removes the evidence-before-conclusion guarantee.
 */
export function toGeminiSchema(node: JsonSchemaNode): Record<string, unknown> {
  const mapped = GEMINI_TYPE_MAP[node.type];
  if (!mapped) {
    // A programming mistake in this file, not a runtime condition.
    throw new Error('toGeminiSchema: unmapped JSON Schema type ' + node.type);
  }

  const out: Record<string, unknown> = { type: mapped };

  if (node.description !== undefined) {
    out.description = node.description;
  }
  if (node.enum !== undefined) {
    out.enum = node.enum;
  }
  if (node.items !== undefined) {
    out.items = toGeminiSchema(node.items);
  }
  if (node.properties !== undefined) {
    const keys = Object.keys(node.properties);
    const properties: Record<string, unknown> = {};
    keys.forEach(key => {
      properties[key] = toGeminiSchema(
        (node.properties as Record<string, JsonSchemaNode>)[key],
      );
    });
    out.properties = properties;
    out.propertyOrdering = keys;
  }
  if (node.required !== undefined) {
    out.required = node.required;
  }
  // `additionalProperties` is deliberately never copied: Gemini rejects it.

  return out;
}
