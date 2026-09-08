import React from 'react';
import { Alert, Button, Checkbox, Input, Tag } from 'antd';

import {
  ApplySelection,
  CatalogueRecord,
  CatalogueResult,
  InscriptionSegment,
  RecordWarning,
  TraitKey,
  TranslationCompleteness,
  WarningCode,
} from '../../ai/types';
import {
  TRAIT_VOCABULARY,
  composeDescription,
  recordToTraits,
} from '../../ai/apply';
import { ELISION_PATTERN } from '../../ai/validate';

/**
 * The last surface between machine output and immutable on-chain metadata.
 *
 * Stateless and fully controlled: the parent owns the edited record, the
 * selection and the warning overrides, so "what will be written" is derivable
 * from props alone at every instant. The only local state is whether the raw
 * response is expanded, which nothing downstream depends on.
 *
 * Every edit rebuilds the record; nothing here mutates props.
 */

const { TextArea } = Input;

/** The mint form's own on-chain name limit; buildPatch slices to it. */
const TITLE_MAX_CHARS = 50;

const OVERRIDE_LABEL = 'I have checked this myself';

const FALLBACK_NOTE =
  'Structured output was not supported by this endpoint — the response was ' +
  'validated client-side instead.';

const INSCRIPTION_CAUTION =
  'Verify the transcription and translation before minting — this is machine ' +
  'output.';

const DESCRIPTION_LOCKED_NOTE =
  'Edit the prose in the Description field of the form after applying, or ' +
  'edit the inscription below.';

const TRANSLATION_PROBLEM =
  'This translation is empty or still marked as truncated. The inscription ' +
  'will not be added to the description until it is complete.';

const WORKING_NOTES_HEADING = 'Working notes — not written to the NFT.';

const AMBER = '#f0c674';
const RED = '#ff7875';

/** Trait rows an un-overridden blocking warning makes unsafe to write. */
const TRAITS_BLOCKED_BY: Partial<Record<WarningCode, TraitKey[]>> = {
  'unscaled-dimensions': ['Dimensions'],
};

/** Traits computed from several record fields, or from the run itself. There
 *  is no single field to write an edit back to, so their cells are read-only;
 *  the row can still be unticked. */
const DERIVED_TRAITS: TraitKey[] = [
  'Date Range',
  'Dimensions',
  'Attribution Confidence',
  'Catalogued By',
];

function completenessColour(c: TranslationCompleteness): string {
  if (c === 'complete') {
    return 'green';
  }
  if (c === 'partial') {
    return 'orange';
  }
  if (c === 'illegible') {
    return 'red';
  }
  return 'default';
}

/** The same rule the parser used, re-applied to a hand-edited translation. */
function translationIsUnusable(seg: InscriptionSegment): boolean {
  return seg.translation.trim() === '' || ELISION_PATTERN.test(seg.translation);
}

function withFirstSegment(
  r: CatalogueRecord,
  patch: Partial<InscriptionSegment>,
): CatalogueRecord {
  if (r.inscription.segments.length === 0) {
    return r;
  }
  return {
    ...r,
    inscription: {
      ...r.inscription,
      segments: r.inscription.segments.map((seg, i) =>
        i === 0 ? { ...seg, ...patch } : seg,
      ),
    },
  };
}

/** Writes an edited trait cell back into the field it was derived from, so the
 *  record stays the single source of truth. Derived traits return r unchanged
 *  and are never rendered editable. */
function withTraitValue(
  r: CatalogueRecord,
  key: TraitKey,
  value: string,
): CatalogueRecord {
  switch (key) {
    case 'Object Type':
      return { ...r, objectType: value };
    case 'Subject':
      return { ...r, subject: { ...r.subject, primaryIdentification: value } };
    case 'Region':
      return { ...r, culture: { ...r.culture, region: value } };
    case 'School':
      return { ...r, culture: { ...r.culture, schoolOrSubRegion: value } };
    case 'Tradition':
      return { ...r, culture: { ...r.culture, tradition: value } };
    case 'Period':
      return { ...r, period: { ...r.period, label: value } };
    case 'Medium':
      return { ...r, medium: { ...r.medium, primaryMedium: value } };
    case 'Materials':
      return {
        ...r,
        medium: {
          ...r.medium,
          materials: value
            .split(',')
            .map(part => part.trim())
            .filter(part => part !== ''),
        },
      };
    case 'Condition':
      return { ...r, condition: { ...r.condition, summary: value } };
    case 'Inscription Script':
      return withFirstSegment(r, { script: value });
    case 'Inscription Language':
      return withFirstSegment(r, { language: value });
    default:
      return r;
  }
}

export const ReviewPanel = (props: {
  result: CatalogueResult;
  record: CatalogueRecord;
  onRecordChange: (r: CatalogueRecord) => void;
  selection: ApplySelection;
  onSelectionChange: (s: ApplySelection) => void;
  overrides: WarningCode[];
  onOverridesChange: (c: WarningCode[]) => void;
}) => {
  const result = props.result;
  const record = props.record;
  const selection = props.selection;
  const overrides = props.overrides;

  const [showRaw, setShowRaw] = React.useState(false);

  const isOverridden = (code: WarningCode) => overrides.indexOf(code) >= 0;

  const setSelection = (patch: Partial<ApplySelection>) => {
    props.onSelectionChange({ ...selection, ...patch });
  };

  const setRecord = (patch: Partial<CatalogueRecord>) => {
    props.onRecordChange({ ...record, ...patch });
  };

  const toggleOverride = (code: WarningCode, on: boolean) => {
    const next = overrides.filter(c => c !== code);
    if (on) {
      next.push(code);
    }
    props.onOverridesChange(next);
  };

  const editSegment = (index: number, patch: Partial<InscriptionSegment>) => {
    setRecord({
      inscription: {
        ...record.inscription,
        segments: record.inscription.segments.map((seg, i) =>
          i === index ? { ...seg, ...patch } : seg,
        ),
      },
    });
  };

  /* --- warnings ------------------------------------------------------- */

  const blockWarnings = result.warnings.filter(w => w.severity === 'block');
  const orderedWarnings: RecordWarning[] = blockWarnings.concat(
    result.warnings.filter(w => w.severity !== 'block'),
  );

  const blockedTraits: TraitKey[] = [];
  blockWarnings.forEach(w => {
    if (isOverridden(w.code)) {
      return;
    }
    const keys = TRAITS_BLOCKED_BY[w.code];
    if (keys) {
      keys.forEach(key => blockedTraits.push(key));
    }
  });

  /* --- inscription ---------------------------------------------------- */

  const inscription = record.inscription;
  const segments = inscription.segments;
  const unusableTranslation = segments.some(translationIsUnusable);

  // A hand-edit that empties or re-elides a translation must not be able to
  // reach the description. No dependency array: the guard already makes this
  // a no-op on every render after the one that corrects the selection.
  React.useEffect(() => {
    if (unusableTranslation && selection.includeInscription) {
      props.onSelectionChange({ ...selection, includeInscription: false });
    }
  });

  const inscriptionAvailable =
    inscription.present !== 'no' && segments.length > 0;

  /* --- traits --------------------------------------------------------- */

  const traits = recordToTraits(record, {
    providerId: result.providerId,
    model: result.model,
  });

  const traitValue = (key: TraitKey): string => {
    for (let i = 0; i < traits.length; i++) {
      if (traits[i].trait_type === key) {
        return traits[i].value;
      }
    }
    return '';
  };

  // A checked row stays visible even after its value is cleared, so a dealer
  // who empties a cell to retype it does not watch the row disappear.
  const traitRows = TRAIT_VOCABULARY.filter(
    key => traitValue(key) !== '' || selection.traitKeys.indexOf(key) >= 0,
  );

  const toggleTrait = (key: TraitKey, on: boolean) => {
    setSelection({
      traitKeys: TRAIT_VOCABULARY.filter(k =>
        k === key ? on : selection.traitKeys.indexOf(k) >= 0,
      ),
    });
  };

  /* --- description ---------------------------------------------------- */

  const descriptionLocked = selection.includeInscription;
  const composed = composeDescription(record, selection.includeInscription);

  const titleLength = record.title.length;
  const titleOver = titleLength > TITLE_MAX_CHARS;

  return (
    <div style={{ width: '100%', textAlign: 'left' }}>
      <div className="ai-panel-caption">
        {result.providerId} · {result.model} ·{' '}
        {(result.elapsedMs / 1000).toFixed(1)} s
      </div>

      {result.usedFallback ? (
        <Alert
          style={{ marginTop: 8 }}
          type="warning"
          message={FALLBACK_NOTE}
        />
      ) : null}

      {orderedWarnings.map((w, i) => (
        <div key={w.code + ':' + i} style={{ marginTop: 12 }}>
          <Alert
            type={w.severity === 'block' ? 'error' : 'warning'}
            message={w.message}
          />
          {w.severity === 'block' ? (
            <Checkbox
              style={{ marginTop: 6 }}
              checked={isOverridden(w.code)}
              onChange={e => toggleOverride(w.code, e.target.checked)}
            >
              {OVERRIDE_LABEL}
            </Checkbox>
          ) : null}
        </div>
      ))}

      <div className="ai-review-section">
        <Checkbox
          checked={selection.title}
          onChange={e => setSelection({ title: e.target.checked })}
        >
          <span className="ai-review-label" style={{ display: 'inline' }}>
            Title
          </span>
        </Checkbox>
        <Input
          className="input"
          value={record.title}
          onChange={info => setRecord({ title: info.target.value })}
        />
        <span
          className="field-info"
          style={titleOver ? { color: RED } : undefined}
        >
          {titleLength} / {TITLE_MAX_CHARS} characters
          {titleOver ? ' — the rest is cut off when applied.' : ''}
        </span>
      </div>

      <div className="ai-review-section">
        <Checkbox
          checked={selection.description}
          onChange={e => setSelection({ description: e.target.checked })}
        >
          <span className="ai-review-label" style={{ display: 'inline' }}>
            Description
          </span>
        </Checkbox>
        <div>
          <Checkbox
            checked={selection.includeInscription}
            disabled={!inscriptionAvailable || unusableTranslation}
            onChange={e =>
              setSelection({ includeInscription: e.target.checked })
            }
          >
            Include the full inscription in the description
          </Checkbox>
        </div>
        <TextArea
          className="input textarea"
          rows={12}
          readOnly={descriptionLocked}
          value={descriptionLocked ? composed : record.catalogueDescription}
          onChange={info =>
            setRecord({ catalogueDescription: info.target.value })
          }
        />
        {descriptionLocked ? (
          <span className="field-info">{DESCRIPTION_LOCKED_NOTE}</span>
        ) : null}
      </div>

      {inscription.present === 'no' ? null : (
        <div className="ai-review-section">
          <span className="ai-review-label">
            Inscription{' '}
            <Tag color={completenessColour(inscription.completeness)}>
              {inscription.completeness}
            </Tag>
            {inscription.present === 'possible' ? (
              <Tag>possibly inscribed</Tag>
            ) : null}
          </span>
          <div style={{ color: AMBER, fontSize: 13, marginBottom: 8 }}>
            {INSCRIPTION_CAUTION}
          </div>

          {segments.length === 0 ? (
            <div className="ai-notes">
              No inscription segments were returned.
            </div>
          ) : null}

          {segments.map((seg, i) => (
            <div className="ai-inscription" key={i}>
              <div className="ai-notes">
                {seg.location === '' ? 'Location not stated' : seg.location}
              </div>
              <div className="ai-notes">
                {seg.script === '' ? 'Script not stated' : seg.script} |{' '}
                {seg.language === '' ? 'Language not stated' : seg.language}
              </div>

              <span className="field-title">Transcription</span>
              <TextArea
                className="input ai-script"
                autoSize={{ minRows: 2 }}
                value={seg.transcription}
                onChange={info =>
                  editSegment(i, { transcription: info.target.value })
                }
              />

              <span className="field-title">Transliteration</span>
              <TextArea
                className="input ai-mono"
                autoSize={{ minRows: 2 }}
                value={seg.transliteration}
                onChange={info =>
                  editSegment(i, { transliteration: info.target.value })
                }
              />

              <span className="field-title">Translation</span>
              <TextArea
                className="input ai-mono"
                autoSize={{ minRows: 2 }}
                value={seg.translation}
                onChange={info =>
                  editSegment(i, { translation: info.target.value })
                }
              />
              {translationIsUnusable(seg) ? (
                <div style={{ color: RED, fontSize: 13 }}>
                  {TRANSLATION_PROBLEM}
                </div>
              ) : null}

              {seg.notes === '' ? null : (
                <div className="ai-notes">Notes: {seg.notes}</div>
              )}
            </div>
          ))}

          {inscription.untranslatedPortions.trim() === '' ? null : (
            <div className="ai-notes" style={{ marginTop: 8 }}>
              Untranslated: {inscription.untranslatedPortions}
            </div>
          )}
        </div>
      )}

      <div className="ai-review-section">
        <Checkbox
          checked={selection.traits}
          onChange={e => setSelection({ traits: e.target.checked })}
        >
          <span className="ai-review-label" style={{ display: 'inline' }}>
            Attributes
          </span>
        </Checkbox>

        {traitRows.length === 0 ? (
          <div className="ai-notes">No attributes returned.</div>
        ) : (
          <table className="ai-trait-table">
            <tbody>
              {traitRows.map(key => {
                const blocked = blockedTraits.indexOf(key) >= 0;
                const derived = DERIVED_TRAITS.indexOf(key) >= 0;
                return (
                  <tr className="ai-trait-row" key={key}>
                    <td style={{ width: 32 }}>
                      <Checkbox
                        checked={selection.traitKeys.indexOf(key) >= 0}
                        disabled={blocked}
                        onChange={e => toggleTrait(key, e.target.checked)}
                      />
                    </td>
                    <td className="ai-trait-key">{key}</td>
                    <td>
                      {derived ? (
                        <span>{traitValue(key)}</span>
                      ) : (
                        <Input
                          className="input"
                          value={traitValue(key)}
                          onChange={info =>
                            props.onRecordChange(
                              withTraitValue(record, key, info.target.value),
                            )
                          }
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="ai-review-section">
        <span className="ai-review-label">{WORKING_NOTES_HEADING}</span>
        <div className="ai-notes">
          {record.uncertainties.length === 0 ? null : (
            <div>
              <div>Uncertainties</div>
              <ul>
                {record.uncertainties.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          )}
          {record.recommendedExpertChecks.length === 0 ? null : (
            <div>
              <div>Recommended expert checks</div>
              <ul>
                {record.recommendedExpertChecks.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          )}
          {record.uncertainties.length === 0 &&
          record.recommendedExpertChecks.length === 0
            ? 'None declared.'
            : null}
        </div>
      </div>

      <div className="ai-review-section">
        <Button
          type="link"
          style={{ paddingLeft: 0 }}
          onClick={() => setShowRaw(!showRaw)}
        >
          {showRaw ? 'Hide raw response' : 'Show raw response'}
        </Button>
        {showRaw ? (
          <pre
            className="ai-notes"
            style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
          >
            {result.rawText}
          </pre>
        ) : null}
      </div>
    </div>
  );
};
