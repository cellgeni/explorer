import { useId, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import type { ContinuousCellMetadataTrack } from '../../data/customAnnotations'
import {
  ALL_ANNOTATION_GROUP_ID,
  NO_ANNOTATION_GROUP_ID,
} from '../../data/datasetAnnotations'
import type { Annotation } from '../../datasets/spatialDataset'
import { annotationPaletteColor } from '../../rendering/annotationPalette'
import {
  annotationSizePlots,
  isIdLikeAnnotationGroup,
  type AnnotationSizePlot,
  type PlacedCellIds,
} from '../annotations/annotationModel'
import type { GeometricAnnotationFeature } from '../annotations/geometricAnnotationModel'
import type {
  AnnotationSetsModel,
  GeometricShapesModel,
  MetadataTracksModel,
} from './annotationsSectionModel'

const METADATA_TRACK_ROW_HEIGHT = 34
const METADATA_TRACK_VISIBLE_ROWS = 6
const METADATA_TRACK_OVERSCAN_ROWS = 3
const ANNOTATION_SET_ROW_HEIGHT = 28
const ANNOTATION_SET_VISIBLE_ROWS = 8
const ANNOTATION_SET_OVERSCAN_ROWS = 4

// The annotation set choice, Load, Clear and Export, and label import from
// a file or URL.
export function AnnotationSetControls({ sets }: { readonly sets: AnnotationSetsModel }) {
  const groupInputId = useId()
  const importInputId = useId()
  const importUrlInputId = useId()

  if (!sets.available) {
    return null
  }

  const { isImportingUrl, loadEnabled, state } = sets
  const loadDisabled =
    !loadEnabled ||
    state.status === 'loading' ||
    sets.selectedGroupId === NO_ANNOTATION_GROUP_ID
  const trimmedImportUrl = sets.importUrl.trim()

  function handleUrlSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!loadEnabled || trimmedImportUrl.length === 0) {
      return
    }

    void sets.onImportUrl(trimmedImportUrl)
  }

  return (
    <>
      <label htmlFor={groupInputId}>Annotation set</label>
      <select
        id={groupInputId}
        value={sets.selectedGroupId}
        disabled={!loadEnabled}
        title="Annotation set"
        onChange={(event) => {
          sets.onGroupChange(event.currentTarget.value)
        }}
      >
        <option value={NO_ANNOTATION_GROUP_ID}>None</option>
        <option value={ALL_ANNOTATION_GROUP_ID}>All</option>
        {sets.groupOptions
          .filter((group) => !isIdLikeAnnotationGroup(group))
          .map((group) => (
            <option key={group.id} value={group.id}>
              {group.label}
            </option>
          ))}
        {sets.groupOptions.some(isIdLikeAnnotationGroup) ? (
          <optgroup label="More columns">
            {sets.groupOptions.filter(isIdLikeAnnotationGroup).map((group) => (
              <option key={group.id} value={group.id}>
                {group.label}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
      <button
        type="button"
        className="secondary-action"
        disabled={loadDisabled}
        title="Load annotations"
        onClick={sets.onLoad}
      >
        {state.status === 'loading' ? 'Loading…' : 'Load Annotations'}
      </button>
      <button
        type="button"
        className="secondary-action"
        disabled={!sets.canClear}
        title="Clear annotations"
        onClick={sets.onClear}
      >
        Clear Annotations
      </button>
      <button
        type="button"
        className="secondary-action"
        disabled={state.status !== 'ready' || state.annotations.length === 0}
        title="Export annotations"
        onClick={sets.onExport}
      >
        Export Annotations
      </button>
      <label
        className="secondary-file-action"
        htmlFor={importInputId}
        title="Import annotation file"
      >
        Import File
      </label>
      <input
        id={importInputId}
        className="visually-hidden-file"
        type="file"
        accept=".csv,.json,application/json,text/csv"
        disabled={!loadEnabled}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0] ?? null
          sets.onImportFile(file)
          event.currentTarget.value = ''
        }}
      />
      <form
        className="annotation-url-import"
        aria-label="Import annotation URL"
        onSubmit={handleUrlSubmit}
      >
        <label htmlFor={importUrlInputId}>Annotation URL</label>
        <div className="annotation-url-row">
          <input
            id={importUrlInputId}
            type="url"
            name="annotation-url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://example.org/labels.csv…"
            title="Annotation URL"
            value={sets.importUrl}
            disabled={!loadEnabled || isImportingUrl}
            onChange={(event) => {
              sets.onImportUrlChange(event.currentTarget.value)
            }}
          />
          <button
            type="submit"
            className="secondary-action"
            disabled={!loadEnabled || isImportingUrl || trimmedImportUrl.length === 0}
            title="Import annotation URL"
          >
            {isImportingUrl ? 'Importing…' : 'Import URL'}
          </button>
        </div>
      </form>
    </>
  )
}

// The loaded labels, one list per annotation set.
export function AnnotationLabelLists({ sets }: { readonly sets: AnnotationSetsModel }) {
  if (sets.state.status !== 'ready' || sets.state.annotations.length === 0) {
    return null
  }

  return (
    <AnnotationSetLists
      annotations={sets.state.annotations}
      annotationColors={sets.colors}
      hiddenAnnotationIds={sets.hiddenIds}
      hiddenAnnotationSetIds={sets.hiddenSetIds}
      placedCellIds={sets.placedCellIds}
      onAnnotationColorChange={sets.onColorChange}
      onAnnotationSetVisibilityChange={sets.onSetVisibilityChange}
      onAnnotationVisibilityChange={sets.onVisibilityChange}
      onRemoveAnnotation={sets.onRemove}
    />
  )
}

export function MetadataTracksPanel({
  metadataTracks: { onRemove, tracks },
}: {
  readonly metadataTracks: MetadataTracksModel
}) {
  if (tracks.length === 0) {
    return null
  }

  return (
    <section className="annotation-size-panel" aria-labelledby="metadata-track-heading">
      <div className="annotation-size-heading">
        <h5 id="metadata-track-heading">Metadata tracks</h5>
        <small>{tracks.length.toLocaleString()} loaded</small>
      </div>
      <MetadataTrackList tracks={tracks} onRemoveCellMetadataTrack={onRemove} />
    </section>
  )
}

export function GeometricShapesPanel({
  shapes: model,
}: {
  readonly shapes: GeometricShapesModel
}) {
  const importInputId = useId()
  const { shapes } = model

  return (
    <section
      className="annotation-size-panel"
      aria-labelledby="geometric-annotation-heading"
    >
      <div className="annotation-size-heading">
        <h4 id="geometric-annotation-heading">GeoJSON shapes</h4>
        <small>{shapes.length.toLocaleString()} loaded</small>
      </div>
      <div className="roi-action-row">
        <label
          className="secondary-file-action"
          htmlFor={importInputId}
          title="Import GeoJSON"
        >
          Import GeoJSON
        </label>
        <input
          id={importInputId}
          className="visually-hidden-file"
          type="file"
          accept=".geojson,.json,application/geo+json,application/json"
          disabled={!model.enabled}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0] ?? null
            model.onImportFile(file)
            event.currentTarget.value = ''
          }}
        />
        <button
          type="button"
          className="secondary-action"
          disabled={shapes.length === 0}
          title="Export GeoJSON"
          onClick={model.onExport}
        >
          Export GeoJSON
        </button>
        <button
          type="button"
          className="secondary-action"
          disabled={shapes.length === 0}
          title="Clear GeoJSON"
          onClick={model.onClear}
        >
          Clear GeoJSON
        </button>
      </div>
      {model.importError === null ? null : (
        <p className="annotation-import-error" role="alert">
          {model.importError}
        </p>
      )}
      {shapes.length > 0 ? (
        <GeometricAnnotationList
          annotations={shapes}
          onColorChange={model.onColorChange}
          onVisibilityChange={model.onVisibilityChange}
          onRemove={model.onRemove}
        />
      ) : null}
    </section>
  )
}

function GeometricAnnotationList({
  annotations,
  onColorChange,
  onVisibilityChange,
  onRemove,
}: {
  readonly annotations: readonly GeometricAnnotationFeature[]
  readonly onColorChange: (annotationId: string, color: string) => void
  readonly onVisibilityChange: (annotationId: string, visible: boolean) => void
  readonly onRemove: (annotationId: string) => void
}) {
  return (
    <ul className="annotation-list" aria-label="Loaded GeoJSON shapes">
      {annotations.map((annotation) => (
        <li key={annotation.id} className={annotation.visible ? undefined : 'is-hidden'}>
          <label
            className="annotation-color-picker"
            style={{ '--annotation-color': annotation.color } as CSSProperties}
          >
            <input
              className="annotation-color-input"
              type="color"
              aria-label={`${annotation.label} color`}
              value={annotation.color}
              title={`${annotation.label} color`}
              onChange={(event) => {
                onColorChange(annotation.id, event.currentTarget.value)
              }}
            />
            <span className="annotation-color-swatch" aria-hidden="true" />
          </label>
          <label className="annotation-visibility-toggle">
            <input
              type="checkbox"
              checked={annotation.visible}
              aria-label={`${annotation.label} visible`}
              title={`${annotation.label} visible`}
              onChange={(event) => {
                onVisibilityChange(annotation.id, event.currentTarget.checked)
              }}
            />
          </label>
          <span>{annotation.label}</span>
          <small>{geometryTypeLabel(annotation)}</small>
          <button
            type="button"
            className="annotation-remove"
            aria-label={`Remove ${annotation.label}`}
            title={`Remove ${annotation.label}`}
            onClick={() => {
              onRemove(annotation.id)
            }}
          >
            x
          </button>
        </li>
      ))}
    </ul>
  )
}

function geometryTypeLabel(annotation: GeometricAnnotationFeature): string {
  if (annotation.geometry.type === 'Polygon') {
    return 'Polygon'
  }

  return `${annotation.geometry.coordinates.length.toLocaleString()} polygons`
}

// One list per annotation set (15.1-I): each label's swatch, visibility, name
// without the set prefix, a bar of its size, its count and share of the set.
function AnnotationSetLists({
  annotations,
  annotationColors,
  hiddenAnnotationIds,
  hiddenAnnotationSetIds,
  placedCellIds,
  onAnnotationColorChange,
  onAnnotationSetVisibilityChange,
  onAnnotationVisibilityChange,
  onRemoveAnnotation,
}: {
  readonly annotations: readonly Annotation[]
  readonly annotationColors: Readonly<Record<string, string>>
  readonly hiddenAnnotationIds: readonly string[]
  readonly hiddenAnnotationSetIds: readonly string[]
  readonly placedCellIds: PlacedCellIds | null
  readonly onAnnotationColorChange: (annotationId: string, color: string) => void
  readonly onAnnotationSetVisibilityChange: (setId: string, visible: boolean) => void
  readonly onAnnotationVisibilityChange: (annotationId: string, visible: boolean) => void
  readonly onRemoveAnnotation: (annotationId: string) => void
}) {
  const plots = useMemo(
    () => annotationSizePlots(annotations, placedCellIds),
    [annotations, placedCellIds],
  )
  const annotationById = useMemo(() => {
    const byId = new Map<string, { readonly label: string; readonly index: number }>()
    annotations.forEach((annotation, index) => {
      byId.set(annotation.id, { label: annotation.label, index })
    })
    return byId
  }, [annotations])
  const hiddenAnnotationIdSet = useMemo(
    () => new Set(hiddenAnnotationIds),
    [hiddenAnnotationIds],
  )
  const hiddenAnnotationSetIdSet = useMemo(
    () => new Set(hiddenAnnotationSetIds),
    [hiddenAnnotationSetIds],
  )

  return (
    <div className="annotation-sets" role="group" aria-label="Loaded annotations">
      {plots.map((plot) => (
        <AnnotationSetList
          key={plot.id}
          plot={plot}
          annotationById={annotationById}
          annotationColors={annotationColors}
          hiddenAnnotationIdSet={hiddenAnnotationIdSet}
          visible={!hiddenAnnotationSetIdSet.has(plot.id)}
          onAnnotationColorChange={onAnnotationColorChange}
          onAnnotationSetVisibilityChange={onAnnotationSetVisibilityChange}
          onAnnotationVisibilityChange={onAnnotationVisibilityChange}
          onRemoveAnnotation={onRemoveAnnotation}
        />
      ))}
    </div>
  )
}

function AnnotationSetList({
  plot,
  annotationById,
  annotationColors,
  hiddenAnnotationIdSet,
  visible,
  onAnnotationColorChange,
  onAnnotationSetVisibilityChange,
  onAnnotationVisibilityChange,
  onRemoveAnnotation,
}: {
  readonly plot: AnnotationSizePlot
  readonly annotationById: ReadonlyMap<
    string,
    { readonly label: string; readonly index: number }
  >
  readonly annotationColors: Readonly<Record<string, string>>
  readonly hiddenAnnotationIdSet: ReadonlySet<string>
  readonly visible: boolean
  readonly onAnnotationColorChange: (annotationId: string, color: string) => void
  readonly onAnnotationSetVisibilityChange: (setId: string, visible: boolean) => void
  readonly onAnnotationVisibilityChange: (annotationId: string, visible: boolean) => void
  readonly onRemoveAnnotation: (annotationId: string) => void
}) {
  const [scrollTop, setScrollTop] = useState(0)
  const virtualRows = virtualWindow({
    itemCount: plot.rows.length,
    rowHeight: ANNOTATION_SET_ROW_HEIGHT,
    visibleRows: ANNOTATION_SET_VISIBLE_ROWS,
    overscanRows: ANNOTATION_SET_OVERSCAN_ROWS,
    scrollTop,
  })
  const visibleRows = plot.rows.slice(virtualRows.startIndex, virtualRows.endIndex)

  return (
    <section
      className={visible ? 'annotation-set' : 'annotation-set is-hidden'}
      aria-label={`${plot.label} labels`}
    >
      <div className="annotation-set-heading">
        <input
          type="checkbox"
          checked={visible}
          aria-label={`${plot.label} visible`}
          title={`${plot.label} visible`}
          onChange={(event) => {
            onAnnotationSetVisibilityChange(plot.id, event.currentTarget.checked)
          }}
        />
        <h5>{plot.label}</h5>
        <small>{plot.totalCellAssignments.toLocaleString()} cells</small>
      </div>
      <ol
        className="annotation-set-rows is-virtualized"
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop)
        }}
        style={{
          height: `${virtualRows.viewportHeight}px`,
          paddingTop: `${virtualRows.beforeHeight}px`,
          paddingBottom: `${virtualRows.afterHeight}px`,
        }}
      >
        {visibleRows.map((row, visibleIndex) => {
          const rowIndex = virtualRows.startIndex + visibleIndex
          const annotation = annotationById.get(row.id)
          const fullLabel = annotation?.label ?? row.label
          const color =
            annotationColors[row.id] ??
            annotationPaletteColor(annotation?.index ?? rowIndex)
          const rowVisible = !hiddenAnnotationIdSet.has(row.id)
          const width =
            plot.maxCellCount === 0 ? 0 : (row.cellCount / plot.maxCellCount) * 100

          return (
            <li
              key={row.id}
              className={
                rowVisible ? 'annotation-set-row' : 'annotation-set-row is-hidden'
              }
              aria-setsize={plot.rows.length}
              aria-posinset={rowIndex + 1}
              style={
                {
                  '--annotation-color': color,
                  '--annotation-size-width': `${width}%`,
                } as CSSProperties
              }
            >
              <label className="annotation-color-picker">
                <input
                  className="annotation-color-input"
                  type="color"
                  aria-label={`${fullLabel} color`}
                  value={color}
                  title={`${fullLabel} color`}
                  onChange={(event) => {
                    onAnnotationColorChange(row.id, event.currentTarget.value)
                  }}
                />
                <span className="annotation-color-swatch" aria-hidden="true" />
              </label>
              <label className="annotation-visibility-toggle">
                <input
                  type="checkbox"
                  checked={rowVisible}
                  aria-label={`${fullLabel} visible`}
                  title={`${fullLabel} visible`}
                  onChange={(event) => {
                    onAnnotationVisibilityChange(row.id, event.currentTarget.checked)
                  }}
                />
              </label>
              <span className="annotation-set-label" title={fullLabel}>
                {row.label}
              </span>
              <span className="annotation-size-track" aria-hidden="true">
                <span className="annotation-size-bar" />
              </span>
              <strong>{row.cellCount.toLocaleString()}</strong>
              <small>{formatAnnotationFraction(row.fraction)}</small>
              <button
                type="button"
                className="annotation-remove"
                aria-label={`Remove ${fullLabel}`}
                title={`Remove ${fullLabel}`}
                onClick={() => {
                  onRemoveAnnotation(row.id)
                }}
              >
                ×
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function MetadataTrackList({
  tracks,
  onRemoveCellMetadataTrack,
}: {
  readonly tracks: readonly ContinuousCellMetadataTrack[]
  readonly onRemoveCellMetadataTrack: (trackId: string) => void
}) {
  const listKey = itemListKey(tracks)
  const [scrollState, setScrollState] = useState({ key: '', scrollTop: 0 })
  const virtualRows = virtualWindow({
    itemCount: tracks.length,
    rowHeight: METADATA_TRACK_ROW_HEIGHT,
    visibleRows: METADATA_TRACK_VISIBLE_ROWS,
    overscanRows: METADATA_TRACK_OVERSCAN_ROWS,
    scrollTop: scrollState.key === listKey ? scrollState.scrollTop : 0,
  })
  const visibleTracks = tracks.slice(virtualRows.startIndex, virtualRows.endIndex)

  return (
    <ul
      className="metadata-track-list is-virtualized"
      aria-label="Loaded metadata tracks"
      onScroll={(event) => {
        setScrollState({ key: listKey, scrollTop: event.currentTarget.scrollTop })
      }}
      style={{
        height: `${virtualRows.viewportHeight}px`,
        paddingTop: `${virtualRows.beforeHeight}px`,
        paddingBottom: `${virtualRows.afterHeight}px`,
      }}
    >
      {visibleTracks.map((track, visibleIndex) => {
        const trackIndex = virtualRows.startIndex + visibleIndex

        return (
          <li key={track.id} aria-setsize={tracks.length} aria-posinset={trackIndex + 1}>
            <span>{track.label}</span>
            <small>
              {track.cellCount.toLocaleString()} cells |{' '}
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
        )
      })}
    </ul>
  )
}

function formatMetadataTrackDomain(track: ContinuousCellMetadataTrack): string {
  return `${formatMetadataValue(track.min)}-${formatMetadataValue(track.max)}`
}

function formatMetadataValue(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString() : value.toPrecision(3)
}

function formatAnnotationFraction(fraction: number): string {
  return `${(fraction * 100).toFixed(fraction >= 0.1 ? 0 : 1)}%`
}

function itemListKey(items: readonly { readonly id: string }[]): string {
  return `${items.length}:${items[0]?.id ?? ''}:${items[items.length - 1]?.id ?? ''}`
}

function virtualWindow({
  itemCount,
  rowHeight,
  visibleRows,
  overscanRows,
  scrollTop,
}: {
  readonly itemCount: number
  readonly rowHeight: number
  readonly visibleRows: number
  readonly overscanRows: number
  readonly scrollTop: number
}): {
  readonly startIndex: number
  readonly endIndex: number
  readonly beforeHeight: number
  readonly afterHeight: number
  readonly viewportHeight: number
} {
  if (itemCount <= 0) {
    return {
      startIndex: 0,
      endIndex: 0,
      beforeHeight: 0,
      afterHeight: 0,
      viewportHeight: 0,
    }
  }

  const viewportRowCount = Math.min(itemCount, visibleRows)
  const viewportHeight = viewportRowCount * rowHeight
  const maxScrollTop = Math.max(0, itemCount * rowHeight - viewportHeight)
  const normalizedScrollTop = Math.max(0, Math.min(scrollTop, maxScrollTop))
  const firstVisibleIndex = Math.floor(normalizedScrollTop / rowHeight)
  const startIndex = Math.max(0, firstVisibleIndex - overscanRows)
  const endIndex = Math.min(
    itemCount,
    firstVisibleIndex + viewportRowCount + overscanRows,
  )

  return {
    startIndex,
    endIndex,
    beforeHeight: startIndex * rowHeight,
    afterHeight: Math.max(0, (itemCount - endIndex) * rowHeight),
    viewportHeight,
  }
}
