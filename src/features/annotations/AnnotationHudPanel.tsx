import { useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import {
  ALL_ANNOTATION_GROUP_ID,
  type AnnotationGroupOption,
} from '../../data/datasetAnnotations'
import type { ContinuousCellMetadataTrack } from '../../data/customAnnotations'
import { annotationPaletteColor } from '../../rendering/annotationPalette'
import type { Annotation } from '../../datasets/spatialDataset'
import {
  annotationSizePlots,
  type AnnotationGroupState,
  type AnnotationSizePlot,
  type AnnotationState,
} from './annotationModel'

interface AnnotationHudPanelProps {
  readonly active: boolean
  readonly annotationGroupInputId: string
  readonly annotationImportInputId: string
  readonly annotationImportUrlInputId: string
  readonly annotationImportUrl: string
  readonly annotationHeaderCopy: string
  readonly loadEnabled: boolean
  readonly selectedAnnotationGroupId: string
  readonly annotationGroupOptions: readonly AnnotationGroupOption[]
  readonly annotationState: AnnotationState
  readonly annotationGroupState: AnnotationGroupState
  readonly annotationColors: Readonly<Record<string, string>>
  readonly hiddenAnnotationSetIds: readonly string[]
  readonly hiddenAnnotationIds: readonly string[]
  readonly cellMetadataTracks: readonly ContinuousCellMetadataTrack[]
  readonly onAnnotationGroupChange: (groupId: string) => void
  readonly onLoadAnnotations: () => void
  readonly onClearAnnotations: () => void
  readonly onExportAnnotations: () => void
  readonly onImportAnnotations: (file: File | null) => void
  readonly onAnnotationImportUrlChange: (url: string) => void
  readonly onImportAnnotationUrl: (url: string) => Promise<boolean>
  readonly onAnnotationColorChange: (annotationId: string, color: string) => void
  readonly onAnnotationSetVisibilityChange: (setId: string, visible: boolean) => void
  readonly onAnnotationVisibilityChange: (annotationId: string, visible: boolean) => void
  readonly onRemoveAnnotation: (annotationId: string) => void
  readonly onRemoveCellMetadataTrack: (trackId: string) => void
}

export function AnnotationHudPanel({
  active,
  annotationGroupInputId,
  annotationImportInputId,
  annotationImportUrlInputId,
  annotationImportUrl,
  annotationHeaderCopy,
  loadEnabled,
  selectedAnnotationGroupId,
  annotationGroupOptions,
  annotationState,
  annotationGroupState,
  annotationColors,
  hiddenAnnotationSetIds,
  hiddenAnnotationIds,
  cellMetadataTracks,
  onAnnotationGroupChange,
  onLoadAnnotations,
  onClearAnnotations,
  onExportAnnotations,
  onImportAnnotations,
  onAnnotationImportUrlChange,
  onImportAnnotationUrl,
  onAnnotationColorChange,
  onAnnotationSetVisibilityChange,
  onAnnotationVisibilityChange,
  onRemoveAnnotation,
  onRemoveCellMetadataTrack,
}: AnnotationHudPanelProps) {
  const [isImportingAnnotationUrl, setIsImportingAnnotationUrl] = useState(false)
  const isAnnotationLoading =
    annotationState.status === 'loading' || annotationGroupState.status === 'loading'
  const loadedAnnotations =
    annotationState.status === 'ready' ? annotationState.annotations : []
  const hiddenAnnotationIdSet = useMemo(
    () => new Set(hiddenAnnotationIds),
    [hiddenAnnotationIds],
  )
  const trimmedAnnotationImportUrl = annotationImportUrl.trim()

  async function handleAnnotationUrlSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!loadEnabled || trimmedAnnotationImportUrl.length === 0) {
      return
    }

    setIsImportingAnnotationUrl(true)
    try {
      const imported = await onImportAnnotationUrl(trimmedAnnotationImportUrl)

      if (imported) {
        onAnnotationImportUrlChange(trimmedAnnotationImportUrl)
      }
    } finally {
      setIsImportingAnnotationUrl(false)
    }
  }

  return (
    <div
      id="hud-panel-annotations"
      className="hud-tab-panel"
      role="tabpanel"
      aria-labelledby="hud-tab-annotations"
      hidden={!active}
    >
      <section className="analysis-section" aria-labelledby="annotation-heading">
        <div className="section-heading-row">
          <h2 id="annotation-heading">Annotations</h2>
          <span
            className={isAnnotationLoading ? 'status-chip is-loading' : 'status-chip'}
            aria-live="polite"
          >
            {annotationHeaderCopy}
          </span>
        </div>
        <label htmlFor={annotationGroupInputId}>Annotation set</label>
        <select
          id={annotationGroupInputId}
          value={selectedAnnotationGroupId}
          disabled={!loadEnabled}
          title="Annotation set"
          onChange={(event) => {
            onAnnotationGroupChange(event.currentTarget.value)
          }}
        >
          <option value={ALL_ANNOTATION_GROUP_ID}>All</option>
          {annotationGroupOptions.map((group) => (
            <option key={group.id} value={group.id}>
              {group.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="secondary-action"
          disabled={!loadEnabled || annotationState.status === 'loading'}
          title="Load annotations"
          onClick={onLoadAnnotations}
        >
          {annotationState.status === 'loading' ? 'Loading…' : 'Load Annotations'}
        </button>
        <button
          type="button"
          className="secondary-action"
          disabled={annotationState.status !== 'ready' && cellMetadataTracks.length === 0}
          title="Clear annotations"
          onClick={onClearAnnotations}
        >
          Clear Annotations
        </button>
        <button
          type="button"
          className="secondary-action"
          disabled={
            annotationState.status !== 'ready' || annotationState.annotations.length === 0
          }
          title="Export annotations"
          onClick={onExportAnnotations}
        >
          Export Annotations
        </button>
        <label
          className="secondary-file-action"
          htmlFor={annotationImportInputId}
          title="Import annotation file"
        >
          Import File
        </label>
        <input
          id={annotationImportInputId}
          className="visually-hidden-file"
          type="file"
          accept=".csv,.json,application/json,text/csv"
          disabled={!loadEnabled}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0] ?? null
            onImportAnnotations(file)
            event.currentTarget.value = ''
          }}
        />
        <form
          className="annotation-url-import"
          aria-label="Import annotation URL"
          onSubmit={(event) => {
            void handleAnnotationUrlSubmit(event)
          }}
        >
          <label htmlFor={annotationImportUrlInputId}>Annotation URL</label>
          <div className="annotation-url-row">
            <input
              id={annotationImportUrlInputId}
              type="url"
              name="annotation-url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://example.org/labels.csv…"
              title="Annotation URL"
              value={annotationImportUrl}
              disabled={!loadEnabled || isImportingAnnotationUrl}
              onChange={(event) => {
                onAnnotationImportUrlChange(event.currentTarget.value)
              }}
            />
            <button
              type="submit"
              className="secondary-action"
              disabled={
                !loadEnabled ||
                isImportingAnnotationUrl ||
                trimmedAnnotationImportUrl.length === 0
              }
              title="Import annotation URL"
            >
              {isImportingAnnotationUrl ? 'Importing…' : 'Import URL'}
            </button>
          </div>
        </form>
        {annotationState.status === 'ready' && annotationState.annotations.length > 0 ? (
          <>
            <AnnotationSizeCharts
              annotations={loadedAnnotations}
              annotationColors={annotationColors}
              hiddenAnnotationSetIds={hiddenAnnotationSetIds}
              onAnnotationSetVisibilityChange={onAnnotationSetVisibilityChange}
            />
            <ul className="annotation-list" aria-label="Loaded annotations">
              {annotationState.annotations.map((annotation, annotationIndex) => {
                const annotationColor =
                  annotationColors[annotation.id] ??
                  annotationPaletteColor(annotationIndex)
                const visible = !hiddenAnnotationIdSet.has(annotation.id)

                return (
                  <li
                    key={annotation.id}
                    className={visible ? undefined : 'is-hidden'}
                  >
                    <label
                      className="annotation-color-picker"
                      style={{ '--annotation-color': annotationColor } as CSSProperties}
                    >
                      <input
                        className="annotation-color-input"
                        type="color"
                        aria-label={`${annotation.label} color`}
                        value={annotationColor}
                        title={`${annotation.label} color`}
                        onChange={(event) => {
                          onAnnotationColorChange(
                            annotation.id,
                            event.currentTarget.value,
                          )
                        }}
                      />
                      <span className="annotation-color-swatch" aria-hidden="true" />
                    </label>
                    <label className="annotation-visibility-toggle">
                      <input
                        type="checkbox"
                        checked={visible}
                        aria-label={`${annotation.label} visible`}
                        title={`${annotation.label} visible`}
                        onChange={(event) => {
                          onAnnotationVisibilityChange(
                            annotation.id,
                            event.currentTarget.checked,
                          )
                        }}
                      />
                    </label>
                    <span>{annotation.label}</span>
                    <small>{annotation.cellIds.length.toLocaleString()}</small>
                    <button
                      type="button"
                      className="annotation-remove"
                      aria-label={`Remove ${annotation.label}`}
                      title={`Remove ${annotation.label}`}
                      onClick={() => {
                        onRemoveAnnotation(annotation.id)
                      }}
                    >
                      x
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        ) : null}
        {cellMetadataTracks.length > 0 ? (
          <section
            className="annotation-size-panel"
            aria-labelledby="metadata-track-heading"
          >
            <div className="annotation-size-heading">
              <h3 id="metadata-track-heading">Metadata tracks</h3>
              <small>{cellMetadataTracks.length.toLocaleString()} loaded</small>
            </div>
            <ul className="metadata-track-list" aria-label="Loaded metadata tracks">
              {cellMetadataTracks.map((track) => (
                <li key={track.id}>
                  <span>{track.label}</span>
                  <small>
                    {track.values.length.toLocaleString()} cells |{' '}
                    {formatMetadataTrackDomain(track)}
                  </small>
                  <button
                    type="button"
                    className="annotation-remove"
                    aria-label={`Remove ${track.label}`}
                    title={`Remove ${track.label}`}
                    onClick={() => {
                      onRemoveCellMetadataTrack(track.id)
                    }}
                  >
                    x
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </section>
    </div>
  )
}

function formatMetadataTrackDomain(track: ContinuousCellMetadataTrack): string {
  return `${formatMetadataValue(track.min)}-${formatMetadataValue(track.max)}`
}

function formatMetadataValue(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString() : value.toPrecision(3)
}

function AnnotationSizeCharts({
  annotations,
  annotationColors,
  hiddenAnnotationSetIds,
  onAnnotationSetVisibilityChange,
}: {
  readonly annotations: readonly Annotation[]
  readonly annotationColors: Readonly<Record<string, string>>
  readonly hiddenAnnotationSetIds: readonly string[]
  readonly onAnnotationSetVisibilityChange: (setId: string, visible: boolean) => void
}) {
  const plots = useMemo(() => annotationSizePlots(annotations), [annotations])
  const hiddenAnnotationSetIdSet = useMemo(
    () => new Set(hiddenAnnotationSetIds),
    [hiddenAnnotationSetIds],
  )
  const annotationIndexById = useMemo(() => {
    const indexes = new Map<string, number>()

    annotations.forEach((annotation, index) => {
      indexes.set(annotation.id, index)
    })

    return indexes
  }, [annotations])

  if (plots.length === 0) {
    return null
  }

  const totalAssignments = plots.reduce(
    (total, plot) => total + plot.totalCellAssignments,
    0,
  )

  return (
    <section className="annotation-size-panel" aria-labelledby="annotation-size-heading">
      <div className="annotation-size-heading">
        <h3 id="annotation-size-heading">Set sizes</h3>
        <small>{totalAssignments.toLocaleString()} cell assignments</small>
      </div>
      <div className="annotation-size-plots">
        {plots.map((plot) => (
          <AnnotationSizePlotView
            key={plot.id}
            plot={plot}
            annotationColors={annotationColors}
            annotationIndexById={annotationIndexById}
            visible={!hiddenAnnotationSetIdSet.has(plot.id)}
            onVisibilityChange={onAnnotationSetVisibilityChange}
          />
        ))}
      </div>
    </section>
  )
}

function AnnotationSizePlotView({
  plot,
  annotationColors,
  annotationIndexById,
  visible,
  onVisibilityChange,
}: {
  readonly plot: AnnotationSizePlot
  readonly annotationColors: Readonly<Record<string, string>>
  readonly annotationIndexById: ReadonlyMap<string, number>
  readonly visible: boolean
  readonly onVisibilityChange: (setId: string, visible: boolean) => void
}) {
  const headingId = `annotation-size-${plot.id.replaceAll(':', '-')}`

  return (
    <article
      className={visible ? 'annotation-size-plot' : 'annotation-size-plot is-hidden'}
      aria-label={`${plot.label} size plot`}
    >
      <div className="annotation-size-plot-heading">
        <h4 id={headingId}>{plot.label}</h4>
        <div className="annotation-size-plot-actions">
          <small>{plot.totalCellAssignments.toLocaleString()}</small>
          <label className="annotation-set-toggle">
            <input
              type="checkbox"
              checked={visible}
              aria-label={`${plot.label} visible`}
              title={`${plot.label} visible`}
              onChange={(event) => {
                onVisibilityChange(plot.id, event.currentTarget.checked)
              }}
            />
            <span>Visible</span>
          </label>
        </div>
      </div>
      <div className="annotation-size-axis" aria-hidden="true">
        <span>0</span>
        <span>{plot.maxCellCount.toLocaleString()} cells</span>
      </div>
      <ol className="annotation-size-list" aria-label={`${plot.label} cell counts`}>
        {plot.rows.map((row, rowIndex) => {
          const width =
            plot.maxCellCount === 0 ? 0 : (row.cellCount / plot.maxCellCount) * 100
          const annotationColor =
            annotationColors[row.id] ??
            annotationPaletteColor(annotationIndexById.get(row.id) ?? rowIndex)

          return (
            <li
              key={row.id}
              className="annotation-size-row"
              style={
                {
                  '--annotation-color': annotationColor,
                  '--annotation-size-width': `${width}%`,
                } as CSSProperties
              }
            >
              <span className="annotation-size-label">{row.label}</span>
              <span className="annotation-size-track" aria-hidden="true">
                <span className="annotation-size-bar" />
              </span>
              <strong>{row.cellCount.toLocaleString()}</strong>
              <small>{formatAnnotationFraction(row.fraction)}</small>
            </li>
          )
        })}
      </ol>
    </article>
  )
}

function formatAnnotationFraction(fraction: number): string {
  return `${(fraction * 100).toFixed(fraction >= 0.1 ? 0 : 1)}%`
}
