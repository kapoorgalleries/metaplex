import React, { useCallback, useRef, useState } from 'react';
import { Alert, Button, Input, Row, Select, Spin, Upload } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import { MetadataCategory, MetaplexModal, notify } from '@oyster/common';

import {
  AiSettings,
  ApplySelection,
  CatalogueRecord,
  CatalogueResult,
  ImagePart,
  TraitKey,
  WarningCode,
  errorMessage,
  isAiError,
} from '../../ai/types';
import { PROVIDERS } from '../../ai/providers';
import { configProblem, loadSettings, saveSettings } from '../../ai/settings';
import { resolveImage } from '../../ai/image';
import { runCatalogue } from '../../ai/client';
import { MetadataPatch, buildPatch, recordToTraits } from '../../ai/apply';
import { SettingsPanel } from './SettingsPanel';
import { ReviewPanel } from './ReviewPanel';
import './index.less';

/* Detail photographs are sent to the model to make an inscription legible.
 * They are never uploaded to Arweave and never become part of the NFT. */
const DETAIL_LABELS = ['detail', 'inscription close-up', 'reverse', 'base'];
const MAX_DETAIL_IMAGES = 3;

/* Trait rows that a still-standing 'block' warning makes untrustworthy, so
 * they arrive unticked in the review panel. */
const TRAITS_BLOCKED_BY: { code: WarningCode; trait: TraitKey }[] = [
  { code: 'unscaled-dimensions', trait: 'Dimensions' },
];

interface DetailImage {
  file: File;
  label: string;
}

type View = 'closed' | 'settings' | 'review';

export const AiCatalogueAssist = (props: {
  image: string;
  primaryFile: File | string | undefined;
  category: MetadataCategory | undefined;
  onApply: (patch: MetadataPatch) => void;
}) => {
  const [settings, setSettings] = useState<AiSettings>(() => loadSettings());
  const [view, setView] = useState<View>('closed');
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [applied, setApplied] = useState<boolean>(false);
  const [result, setResult] = useState<CatalogueResult | null>(null);
  const [edited, setEdited] = useState<CatalogueRecord | null>(null);
  const [selection, setSelection] = useState<ApplySelection>({
    title: true,
    description: true,
    traits: true,
    includeInscription: false,
    traitKeys: [],
  });
  const [overrides, setOverrides] = useState<WarningCode[]>([]);
  const [dealerNotes, setDealerNotes] = useState<string>('');
  const [details, setDetails] = useState<DetailImage[]>([]);
  const [expanded, setExpanded] = useState<boolean>(false);

  const controllerRef = useRef<AbortController | null>(null);
  const runIdRef = useRef<number>(0);

  const provider = PROVIDERS[settings.activeProvider];
  const cfg = settings.providers[settings.activeProvider];
  const problem = configProblem(cfg, provider);
  const isImage = props.category === MetadataCategory.Image;
  const hasImage = !!props.image || props.primaryFile !== undefined;

  const close = useCallback(() => setView('closed'), []);

  const cancel = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.abort();
    }
  }, []);

  const run = async () => {
    saveSettings(settings);
    setBusy(true);
    setError('');
    setApplied(false);

    const myRun = runIdRef.current + 1;
    runIdRef.current = myRun;
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const imageOpts = {
        maxEdgePx: settings.imageMaxEdgePx,
        supportsRemoteImageUrl: provider.supportsRemoteImageUrl,
      };

      /* The mint form leaves the primary artwork either as a data URL / absolute
       * URL in `image`, or as the File the dragger captured. Prefer whichever
       * exists; UploadStep guarantees at least one before this step. */
      const primarySource: string | File | undefined = props.image
        ? props.image
        : props.primaryFile instanceof File
        ? props.primaryFile
        : undefined;

      if (primarySource === undefined) {
        throw new Error('Upload an image before cataloguing.');
      }

      const images: ImagePart[] = [
        await resolveImage(primarySource, 'primary', imageOpts),
      ];
      for (let i = 0; i < details.length; i++) {
        images.push(
          await resolveImage(details[i].file, details[i].label, imageOpts),
        );
      }

      const res = await runCatalogue(
        settings.activeProvider,
        settings,
        {
          images,
          dealerNotes,
          maxOutputTokens: settings.maxOutputTokens,
          temperature: 0.2,
        },
        { signal: controller.signal },
      );

      /* A cancelled-then-restarted run must not clobber the newer result. */
      if (myRun !== runIdRef.current) {
        return;
      }

      const blocked = res.warnings
        .filter(warning => warning.severity === 'block')
        .map(warning => warning.code);
      const withheld = TRAITS_BLOCKED_BY.filter(
        entry => blocked.indexOf(entry.code) >= 0,
      ).map(entry => entry.trait);

      const traitKeys = recordToTraits(res.record, {
        providerId: res.providerId,
        model: res.model,
      })
        .map(attribute => attribute.trait_type as TraitKey)
        .filter(trait => withheld.indexOf(trait) < 0);

      setResult(res);
      setEdited(res.record);
      setSelection({
        title: true,
        description: true,
        traits: true,
        includeInscription: res.record.inscription.present === 'yes',
        traitKeys,
      });
      setOverrides([]);
      setView('review');
    } catch (e) {
      if (myRun !== runIdRef.current) {
        return;
      }
      if (isAiError(e) && e.kind === 'aborted') {
        return;
      }
      const message = errorMessage(e);
      setError(message);
      /* A CORS-shaped failure otherwise reads as a hang, and it is the one
       * error whose fix (a proxy base URL) is not obvious from the panel. */
      if (isAiError(e) && e.kind === 'network') {
        notify({
          message: 'AI request failed',
          description: message,
          type: 'error',
        });
      }
    } finally {
      if (myRun === runIdRef.current) {
        setBusy(false);
        controllerRef.current = null;
      }
    }
  };

  const apply = () => {
    if (!edited || !result) {
      return;
    }
    props.onApply(
      buildPatch(edited, selection, {
        providerId: result.providerId,
        model: result.model,
      }),
    );
    setApplied(true);
    setView('closed');
  };

  /* A section whose 'block' warning has not been overridden cannot be applied. */
  const unresolved = (result ? result.warnings : []).filter(
    warning =>
      warning.severity === 'block' && overrides.indexOf(warning.code) < 0,
  );
  const sectionCount =
    (selection.title ? 1 : 0) +
    (selection.description ? 1 : 0) +
    (selection.traits && selection.traitKeys.length > 0 ? 1 : 0);

  const disabledReason = !isImage
    ? 'Image artworks only'
    : !hasImage
    ? 'Upload an image first'
    : '';

  return (
    <div className="ai-panel">
      <div className="ai-panel-row">
        <Button
          size="large"
          disabled={!!disabledReason}
          title={disabledReason}
          onClick={() => {
            /* No dead end: an unconfigured provider opens settings rather
             * than failing on the first call. */
            if (problem) {
              setView('settings');
              return;
            }
            setApplied(false);
            setError('');
            setExpanded(!expanded);
          }}
        >
          {problem ? 'Set up AI cataloguing' : 'Catalogue with AI'}
        </Button>
        <span className="ai-panel-caption">
          {provider.label} · {cfg.model}
        </span>
        <Button
          type="text"
          icon={<SettingOutlined />}
          title="AI settings"
          onClick={() => setView('settings')}
        />
      </div>

      {expanded && !problem && !disabledReason && (
        <>
          <label className="action-field" style={{ marginTop: 16 }}>
            <span className="field-title">What you already know</span>
            <Input.TextArea
              className="input"
              rows={3}
              value={dealerNotes}
              onChange={info => setDealerNotes(info.target.value)}
              placeholder="e.g. 18.5 cm high; gilt copper alloy; acquired as Nepalese, Malla period; inscription on reverse of base"
            />
            <span className="ai-panel-caption">
              Anything you enter is treated as fact and constrains the reading.
              This is the single biggest thing you can do to improve the result.
            </span>
          </label>

          <label className="action-field" style={{ marginTop: 16 }}>
            <span className="field-title">
              Detail photographs (optional, not minted)
            </span>
            <Upload
              accept="image/*"
              multiple={false}
              listType="text"
              fileList={[]}
              customRequest={info => {
                // Files are never uploaded from here; the model reads them
                // in-memory. Same stub UploadStep uses.
                info?.onSuccess?.({}, null as any);
              }}
              onChange={info => {
                const file = info.file.originFileObj;
                if (file && details.length < MAX_DETAIL_IMAGES) {
                  setDetails(
                    details.concat([{ file, label: DETAIL_LABELS[0] }]),
                  );
                }
              }}
            >
              <Button disabled={details.length >= MAX_DETAIL_IMAGES}>
                Add a detail photograph
              </Button>
            </Upload>
            {details.map((detail, index) => (
              <div className="ai-panel-row" key={index}>
                <span className="ai-panel-caption">{detail.file.name}</span>
                <Select
                  value={detail.label}
                  style={{ minWidth: 200 }}
                  onChange={(next: string) =>
                    setDetails(
                      details.map((entry, i) =>
                        i === index ? { file: entry.file, label: next } : entry,
                      ),
                    )
                  }
                >
                  {DETAIL_LABELS.map(label => (
                    <Select.Option value={label} key={label}>
                      {label}
                    </Select.Option>
                  ))}
                </Select>
                <Button
                  type="link"
                  onClick={() =>
                    setDetails(
                      details.slice(0, index).concat(details.slice(index + 1)),
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
            <span className="ai-panel-caption">
              These are sent to the AI to improve the reading. They are not
              uploaded to Arweave and are not part of the NFT.
            </span>
          </label>

          <Row style={{ marginTop: 16 }}>
            <Button
              className="action-btn"
              type="primary"
              loading={busy}
              disabled={busy || !!problem}
              onClick={run}
            >
              Generate catalogue entry
            </Button>
          </Row>
        </>
      )}

      {busy && (
        <div className="ai-panel-row" style={{ marginTop: 16 }}>
          <Spin />
          <span className="ai-panel-caption">
            Reading the photographs. This usually takes 20–60 seconds.
          </span>
          <Button type="link" onClick={cancel}>
            Cancel
          </Button>
        </div>
      )}

      {!!error && (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 16 }}
          message="AI cataloguing failed"
          description={error}
        />
      )}

      {applied && (
        <Alert
          type="success"
          showIcon
          style={{ marginTop: 16 }}
          message="Applied — review the fields below before continuing."
        />
      )}

      <MetaplexModal
        visible={view !== 'closed'}
        onCancel={close}
        width={760}
        maskClosable={false}
        bodyStyle={{
          alignItems: 'stretch',
          textAlign: 'left',
          maxHeight: '75vh',
          overflowY: 'auto',
        }}
      >
        {view === 'settings' && (
          <>
            <SettingsPanel value={settings} onChange={setSettings} />
            <Row justify="end" style={{ marginTop: 24 }}>
              <Button
                type="primary"
                onClick={() => {
                  saveSettings(settings);
                  close();
                }}
              >
                Done
              </Button>
            </Row>
          </>
        )}
        {view === 'review' && result && edited && (
          <>
            <ReviewPanel
              result={result}
              record={edited}
              onRecordChange={setEdited}
              selection={selection}
              onSelectionChange={setSelection}
              overrides={overrides}
              onOverridesChange={setOverrides}
            />
            <Row justify="end" style={{ marginTop: 24 }}>
              <Button onClick={close} style={{ marginRight: 12 }}>
                Discard
              </Button>
              <Button
                type="primary"
                className="action-btn"
                disabled={sectionCount === 0 || unresolved.length > 0}
                onClick={apply}
              >
                {unresolved.length > 0
                  ? 'Check the warnings above'
                  : `Apply ${sectionCount} section${
                      sectionCount === 1 ? '' : 's'
                    }`}
              </Button>
            </Row>
          </>
        )}
      </MetaplexModal>
    </div>
  );
};
