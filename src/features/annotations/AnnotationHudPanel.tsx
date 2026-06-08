import type { CSSProperties } from 'react'
import {
  ALL_ANNOTATION_GROUP_ID,
  type AnnotationGroupOption,
} from '../../data/datasetAnnotations'
import { annotationPaletteColor } from '../../rendering/annotationPalette'
import type { AnnotationGroupState, AnnotationState } from './annotationModel'

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
          onClick={onLoadAnnotations}
        >
          {annotationState.status === 'loading' ? 'Loading…' : 'Load Annotations'}
        </button>
        <button
          type="button"
          className="secondary-action"
          disabled={annotationState.status !== 'ready'}
          onClick={onClearAnnotations}
        >
          Clear Annotations
        </button>
        <label className="secondary-file-action" htmlFor={annotationImportInputId}>
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
          <ul className="annotation-list" aria-label="Loaded annotations">
            {annotationState.annotations.map((annotation, annotationIndex) => {
              const annotationColor =
                annotationColors[annotation.id] ?? annotationPaletteColor(annotationIndex)

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
                      onChange={(event) => {
                        onAnnotationColorChange(annotation.id, event.currentTarget.value)
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
        ) : null}
      </section>
    </div>
  )
}
