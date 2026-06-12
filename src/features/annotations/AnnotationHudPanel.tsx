import { useMemo, type CSSProperties } from 'react'
import {
  ALL_ANNOTATION_GROUP_ID,
  type AnnotationGroupOption,
} from '../../data/datasetAnnotations'
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
  readonly annotationHeaderCopy: string
  readonly loadEnabled: boolean
  readonly selectedAnnotationGroupId: string
  readonly annotationGroupOptions: readonly AnnotationGroupOption[]
  readonly annotationState: AnnotationState
  readonly annotationGroupState: AnnotationGroupState
  readonly annotationColors: Readonly<Record<string, string>>
  readonly onAnnotationGroupChange: (groupId: string) => void
  readonly onLoadAnnotations: () => void
  readonly onClearAnnotations: () => void
  readonly onImportAnnotations: (file: File | null) => void
  readonly onAnnotationColorChange: (annotationId: string, color: string) => void
  readonly onRemoveAnnotation: (annotationId: string) => void
}

export function AnnotationHudPanel({
  active,
  annotationGroupInputId,
  annotationImportInputId,
  annotationHeaderCopy,
  loadEnabled,
  selectedAnnotationGroupId,
  annotationGroupOptions,
  annotationState,
  annotationGroupState,
  annotationColors,
  onAnnotationGroupChange,
  onLoadAnnotations,
  onClearAnnotations,
  onImportAnnotations,
  onAnnotationColorChange,
  onRemoveAnnotation,
}: AnnotationHudPanelProps) {
  const isAnnotationLoading =
    annotationState.status === 'loading' || annotationGroupState.status === 'loading'
  const loadedAnnotations =
    annotationState.status === 'ready' ? annotationState.annotations : []

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
          disabled={annotationState.status !== 'ready'}
          title="Clear annotations"
          onClick={onClearAnnotations}
        >
          Clear Annotations
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
        {annotationState.status === 'ready' && annotationState.annotations.length > 0 ? (
          <>
            <AnnotationSizeCharts
              annotations={loadedAnnotations}
              annotationColors={annotationColors}
            />
            <ul className="annotation-list" aria-label="Loaded annotations">
              {annotationState.annotations.map((annotation, annotationIndex) => {
                const annotationColor =
                  annotationColors[annotation.id] ??
                  annotationPaletteColor(annotationIndex)

                return (
                  <li key={annotation.id}>
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
      </section>
    </div>
  )
}

function AnnotationSizeCharts({
  annotations,
  annotationColors,
}: {
  readonly annotations: readonly Annotation[]
  readonly annotationColors: Readonly<Record<string, string>>
}) {
  const plots = useMemo(() => annotationSizePlots(annotations), [annotations])
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
}: {
  readonly plot: AnnotationSizePlot
  readonly annotationColors: Readonly<Record<string, string>>
  readonly annotationIndexById: ReadonlyMap<string, number>
}) {
  const headingId = `annotation-size-${plot.id.replaceAll(':', '-')}`

  return (
    <article className="annotation-size-plot" aria-label={`${plot.label} size plot`}>
      <div className="annotation-size-plot-heading">
        <h4 id={headingId}>{plot.label}</h4>
        <small>{plot.totalCellAssignments.toLocaleString()}</small>
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
