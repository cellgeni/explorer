import type { ViewerTranscriptHoverDetail } from '../../components/ViewerCore'
import type { TranscriptPointDatum } from '../../rendering/deckLayers'
import {
  transcriptAggregateRenderedLabel,
  transcriptCapabilityLabel,
} from './transcriptLabels'
import type {
  TranscriptCapabilityState,
  TranscriptLayerState,
} from './transcriptLayerModel'

interface TranscriptStatusPanelProps {
  readonly capabilityState: TranscriptCapabilityState
  readonly layerState: TranscriptLayerState
  readonly exactPointLimit: number
  readonly visibleTranscriptEstimate: number
  readonly hoveredTranscript: ViewerTranscriptHoverDetail | null
  readonly pinnedTranscript: ViewerTranscriptHoverDetail | null
  readonly onPinTranscript: (detail: ViewerTranscriptHoverDetail) => void
  readonly onClearPinnedTranscript: () => void
  readonly onLoadExactViewport: (requestKey: string) => void
}

export function TranscriptStatusPanel({
  capabilityState,
  layerState,
  exactPointLimit,
  visibleTranscriptEstimate,
  hoveredTranscript,
  pinnedTranscript,
  onPinTranscript,
  onClearPinnedTranscript,
  onLoadExactViewport,
}: TranscriptStatusPanelProps) {
  const capabilities =
    capabilityState.status === 'ready' ? capabilityState.capabilities : null
  const exactLoadRequestKey =
    layerState.status === 'waiting' ? layerState.exactLoadRequestKey : undefined

  return (
    <div className="transcript-status-panel">
      <dl className="transcript-summary-list" aria-label="Transcript overlay summary">
        <div>
          <dt>Source</dt>
          <dd>
            {capabilities === null
              ? capabilityStateLabel(capabilityState)
              : transcriptCapabilityLabel(capabilities)}
          </dd>
        </div>
        <div>
          <dt>Estimate</dt>
          <dd>{visibleTranscriptEstimate.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Exact budget</dt>
          <dd>{exactPointLimit.toLocaleString()}</dd>
        </div>
        {layerState.status === 'ready' ? (
          <>
            <div>
              <dt>Rendered</dt>
              <dd>
                {layerState.points.length.toLocaleString()}
                {layerState.hitPointLimit ? '+' : ''}
              </dd>
            </div>
            <div>
              <dt>Query</dt>
              <dd>{layerState.durationMs.toLocaleString()} ms</dd>
            </div>
          </>
        ) : null}
        {layerState.status === 'aggregate' ? (
          <>
            <div>
              <dt>Rendered</dt>
              <dd>{transcriptAggregateRenderedLabel(layerState.bins)}</dd>
            </div>
            <div>
              <dt>Layer</dt>
              <dd>{layerState.source === 'cell-summary' ? 'Cell summary' : 'Native'}</dd>
            </div>
            {layerState.durationMs === undefined ? null : (
              <div>
                <dt>Query</dt>
                <dd>{layerState.durationMs.toLocaleString()} ms</dd>
              </div>
            )}
          </>
        ) : null}
      </dl>

      {layerState.status === 'waiting' ||
      layerState.status === 'aggregate' ||
      layerState.status === 'unavailable' ? (
        <p className="transcript-status-message">{layerState.message}</p>
      ) : null}
      {layerState.status === 'error' ? (
        <p className="transcript-status-message">{layerState.error.message}</p>
      ) : null}
      {exactLoadRequestKey === undefined ? null : (
        <button
          type="button"
          className="secondary-action"
          title="Load exact transcript viewport"
          onClick={() => {
            onLoadExactViewport(exactLoadRequestKey)
          }}
        >
          Load exact viewport
        </button>
      )}

      {layerState.status === 'ready' && layerState.groups.length > 0 ? (
        <div className="transcript-group-panel">
          <div className="transcript-group-heading">
            <span>Gene</span>
            <span>FOV</span>
            <span>Count</span>
          </div>
          <ol className="transcript-group-list" aria-label="Top transcript groups">
            {layerState.groups.map((group) => (
              <li key={`${group.featureName}:${group.fovName ?? 'none'}`}>
                <span>{group.featureName}</span>
                <span>{group.fovName ?? 'Unassigned'}</span>
                <strong>{group.count.toLocaleString()}</strong>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {pinnedTranscript === null ? null : (
        <TranscriptInspectionPanel
          detail={pinnedTranscript}
          title={transcriptInspectionTitle('Pinned', pinnedTranscript)}
          actionLabel="Clear"
          onAction={onClearPinnedTranscript}
        />
      )}
      {hoveredTranscript === null ? null : (
        <TranscriptInspectionPanel
          detail={hoveredTranscript}
          title={transcriptInspectionTitle('Hovered', hoveredTranscript)}
          actionLabel="Pin"
          onAction={() => {
            onPinTranscript(hoveredTranscript)
          }}
        />
      )}
    </div>
  )
}

function TranscriptInspectionPanel({
  detail,
  title,
  actionLabel,
  onAction,
}: {
  readonly detail: ViewerTranscriptHoverDetail
  readonly title: string
  readonly actionLabel: string
  readonly onAction: () => void
}) {
  if (detail.transcript !== undefined) {
    const transcript = detail.transcript
    const cellLabel = transcriptCellDisplayLabel(transcript)

    return (
      <div className="transcript-hover-panel">
        <div className="transcript-hover-heading">
          <p>{title}</p>
          <button type="button" title={`${actionLabel} transcript`} onClick={onAction}>
            {actionLabel}
          </button>
        </div>
        <strong className="transcript-hover-title">{transcript.featureName}</strong>
        <dl>
          <div>
            <dt>ID</dt>
            <dd>{transcript.transcriptId ?? transcript.id}</dd>
          </div>
          <div>
            <dt>FOV</dt>
            <dd>{transcript.fovName ?? 'Unassigned'}</dd>
          </div>
          {cellLabel === null ? null : (
            <div>
              <dt>Cell</dt>
              <dd>{cellLabel}</dd>
            </div>
          )}
          <div>
            <dt>QV</dt>
            <dd>{formatOptionalNumber(transcript.qv)}</dd>
          </div>
          <div>
            <dt>X/Y</dt>
            <dd>
              {formatOptionalNumber(transcript.position[0])},{' '}
              {formatOptionalNumber(Math.abs(transcript.position[1] ?? 0))}
            </dd>
          </div>
          <div>
            <dt>Z</dt>
            <dd>{formatOptionalNumber(transcript.zLocation)}</dd>
          </div>
          <div>
            <dt>Nucleus</dt>
            <dd>{formatBooleanLabel(transcript.overlapsNucleus)}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{transcriptGeneStatusLabel(transcript.isGene)}</dd>
          </div>
        </dl>
      </div>
    )
  }

  if (detail.aggregate === undefined) {
    return null
  }

  const aggregate = detail.aggregate

  return (
    <div className="transcript-hover-panel">
      <div className="transcript-hover-heading">
        <p>{title}</p>
        <button type="button" title={`${actionLabel} transcript bin`} onClick={onAction}>
          {actionLabel}
        </button>
      </div>
      <strong className="transcript-hover-title">
        {aggregate.featureName === undefined
          ? 'Transcript density bin'
          : aggregate.featureName}
      </strong>
      <dl>
        <div>
          <dt>Count</dt>
          <dd>{aggregate.count.toLocaleString()}</dd>
        </div>
        {aggregate.binTotalCount === undefined ? null : (
          <div>
            <dt>Total</dt>
            <dd>{aggregate.binTotalCount.toLocaleString()}</dd>
          </div>
        )}
        <div>
          <dt>Level</dt>
          <dd>{aggregate.level.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{aggregate.source === 'native-zarr' ? 'Native' : 'Cell summary'}</dd>
        </div>
        <div>
          <dt>Bin size</dt>
          <dd>{formatOptionalNumber(aggregate.binSizeMicrometers)} µm</dd>
        </div>
        {aggregate.selectedGeneCount === undefined ? null : (
          <div>
            <dt>Selected</dt>
            <dd>{aggregate.selectedGeneCount.toLocaleString()}</dd>
          </div>
        )}
        {aggregate.omittedFeatureCount === undefined ? null : (
          <div>
            <dt>Hidden</dt>
            <dd>{aggregate.omittedFeatureCount.toLocaleString()} genes</dd>
          </div>
        )}
        <div>
          <dt>Bin</dt>
          <dd>
            {aggregate.binX.toLocaleString()}, {aggregate.binY.toLocaleString()}
          </dd>
        </div>
      </dl>
      {aggregate.topFeatures === undefined ||
      aggregate.topFeatures.length === 0 ? null : (
        <ol className="transcript-hover-feature-list">
          {aggregate.topFeatures.map((feature) => (
            <li key={feature.featureName}>
              <span>{feature.featureName}</span>
              <strong>{feature.count.toLocaleString()}</strong>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function transcriptInspectionTitle(
  prefix: 'Hovered' | 'Pinned',
  detail: ViewerTranscriptHoverDetail,
): string {
  if (detail.transcript !== undefined) {
    return `${prefix} transcript`
  }

  if (detail.aggregate?.featureName === undefined) {
    return `${prefix} density bin`
  }

  return `${prefix} feature bin`
}

function capabilityStateLabel(state: TranscriptCapabilityState): string {
  if (state.status === 'loading') {
    return 'Checking'
  }

  if (state.status === 'error') {
    return 'Unavailable'
  }

  return 'Not checked'
}

function formatOptionalNumber(value: number | undefined): string {
  return value === undefined
    ? 'None'
    : value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

function transcriptCellDisplayLabel(transcript: TranscriptPointDatum): string | null {
  if (transcript.cellId !== null) {
    return transcript.cellId
  }

  return transcript.cellAssignment === 'unassigned' ? 'Unassigned' : null
}

function formatBooleanLabel(value: boolean | undefined): string {
  if (value === undefined) {
    return 'Unknown'
  }

  return value ? 'Yes' : 'No'
}

function transcriptGeneStatusLabel(value: boolean | undefined): string {
  if (value === undefined) {
    return 'Unknown'
  }

  return value ? 'Gene' : 'Control'
}
