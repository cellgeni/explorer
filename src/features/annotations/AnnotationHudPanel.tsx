import { memo, useId, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import {
  ALL_ANNOTATION_GROUP_ID,
  NO_ANNOTATION_GROUP_ID,
  type AnnotationGroupOption,
} from '../../data/datasetAnnotations'
import type { ContinuousCellMetadataTrack } from '../../data/customAnnotations'
import { annotationPaletteColor } from '../../rendering/annotationPalette'
import type { Annotation } from '../../datasets/spatialDataset'
import type { GeometricAnnotationFeature } from './geometricAnnotationModel'
import {
  annotationSizePlots,
  isIdLikeAnnotationGroup,
  type AnnotationGroupState,
  type AnnotationSizePlot,
  type AnnotationState,
  type PlacedCellIds,
} from './annotationModel'

const METADATA_TRACK_ROW_HEIGHT = 34
const METADATA_TRACK_VISIBLE_ROWS = 6
const METADATA_TRACK_OVERSCAN_ROWS = 3
const ANNOTATION_SET_ROW_HEIGHT = 28
const ANNOTATION_SET_VISIBLE_ROWS = 8
const ANNOTATION_SET_OVERSCAN_ROWS = 4

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
  // Set when some cells are not on the map (Visium spots off the tissue),
  // so label counts leave them out.
  readonly placedCellIds?: PlacedCellIds | null | undefined
  readonly cellMetadataTracks: readonly ContinuousCellMetadataTrack[]
  readonly geometricAnnotations: readonly GeometricAnnotationFeature[]
  readonly geometricAnnotationsEnabled: boolean
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
  readonly onImportGeometricAnnotations: (file: File | null) => void
  readonly onExportGeometricAnnotations: () => void
  readonly onClearGeometricAnnotations: () => void
  readonly onGeometricAnnotationColorChange: (annotationId: string, color: string) => void
  readonly onGeometricAnnotationVisibilityChange: (
    annotationId: string,
    visible: boolean,
  ) => void
  readonly onRemoveGeometricAnnotation: (annotationId: string) => void
}

export const AnnotationHudPanel = memo(function AnnotationHudPanel({
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
  placedCellIds = null,
  cellMetadataTracks,
  geometricAnnotations,
  geometricAnnotationsEnabled,
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
  onImportGeometricAnnotations,
  onExportGeometricAnnotations,
  onClearGeometricAnnotations,
  onGeometricAnnotationColorChange,
  onGeometricAnnotationVisibilityChange,
  onRemoveGeometricAnnotation,
}: AnnotationHudPanelProps) {
  const geometricAnnotationInputId = useId()
  const [isImportingAnnotationUrl, setIsImportingAnnotationUrl] = useState(false)
  const isAnnotationLoading =
    annotationState.status === 'loading' || annotationGroupState.status === 'loading'
  const hasNoAnnotationSelection = selectedAnnotationGroupId === NO_ANNOTATION_GROUP_ID
  const annotationLoadDisabled =
    !loadEnabled || annotationState.status === 'loading' || hasNoAnnotationSelection
  const loadedAnnotations =
    annotationState.status === 'ready' ? annotationState.annotations : []
  const trimmedAnnotationImportUrl = annotationImportUrl.trim()
  const showCellAnnotationControls =
    !geometricAnnotationsEnabled ||
    loadEnabled ||
    annotationState.status !== 'idle' ||
    annotationGroupState.status !== 'idle' ||
    cellMetadataTracks.length > 0

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

  if (!active) {
    return (
      <div
        id="hud-panel-annotations"
        className="hud-tab-panel"
        role="tabpanel"
        aria-labelledby="hud-tab-annotations"
        hidden
      />
    )
  }

  return (
    <div
      id="hud-panel-annotations"
      className="hud-tab-panel"
      role="tabpanel"
      aria-labelledby="hud-tab-annotations"
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
        {showCellAnnotationControls ? (
          <>
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
              <option value={NO_ANNOTATION_GROUP_ID}>None</option>
              <option value={ALL_ANNOTATION_GROUP_ID}>All</option>
              {annotationGroupOptions
                .filter((group) => !isIdLikeAnnotationGroup(group))
                .map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.label}
                  </option>
                ))}
              {annotationGroupOptions.some(isIdLikeAnnotationGroup) ? (
                <optgroup label="More columns">
                  {annotationGroupOptions.filter(isIdLikeAnnotationGroup).map((group) => (
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
              disabled={annotationLoadDisabled}
              title="Load annotations"
              onClick={onLoadAnnotations}
            >
              {annotationState.status === 'loading' ? 'Loading…' : 'Load Annotations'}
            </button>
            <button
              type="button"
              className="secondary-action"
              disabled={
                annotationState.status !== 'ready' && cellMetadataTracks.length === 0
              }
              title="Clear annotations"
              onClick={onClearAnnotations}
            >
              Clear Annotations
            </button>
            <button
              type="button"
              className="secondary-action"
              disabled={
                annotationState.status !== 'ready' ||
                annotationState.annotations.length === 0
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
          </>
        ) : null}
        {annotationState.status === 'ready' && annotationState.annotations.length > 0 ? (
          <>
            <AnnotationSetLists
              annotations={loadedAnnotations}
              annotationColors={annotationColors}
              hiddenAnnotationIds={hiddenAnnotationIds}
              hiddenAnnotationSetIds={hiddenAnnotationSetIds}
              placedCellIds={placedCellIds}
              onAnnotationColorChange={onAnnotationColorChange}
              onAnnotationSetVisibilityChange={onAnnotationSetVisibilityChange}
              onAnnotationVisibilityChange={onAnnotationVisibilityChange}
              onRemoveAnnotation={onRemoveAnnotation}
            />
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
            <MetadataTrackList
              tracks={cellMetadataTracks}
              onRemoveCellMetadataTrack={onRemoveCellMetadataTrack}
            />
          </section>
        ) : null}
        <section
          className="annotation-size-panel"
          aria-labelledby="geometric-annotation-heading"
        >
          <div className="annotation-size-heading">
            <h3 id="geometric-annotation-heading">GeoJSON shapes</h3>
            <small>{geometricAnnotations.length.toLocaleString()} loaded</small>
          </div>
          <div className="roi-action-row">
            <label
              className="secondary-file-action"
              htmlFor={geometricAnnotationInputId}
              title="Import GeoJSON"
            >
              Import GeoJSON
            </label>
            <input
              id={geometricAnnotationInputId}
              className="visually-hidden-file"
              type="file"
              accept=".geojson,.json,application/geo+json,application/json"
              disabled={!geometricAnnotationsEnabled}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0] ?? null
                onImportGeometricAnnotations(file)
                event.currentTarget.value = ''
              }}
            />
            <button
              type="button"
              className="secondary-action"
              disabled={geometricAnnotations.length === 0}
              title="Export GeoJSON"
              onClick={onExportGeometricAnnotations}
            >
              Export GeoJSON
            </button>
            <button
              type="button"
              className="secondary-action"
              disabled={geometricAnnotations.length === 0}
              title="Clear GeoJSON"
              onClick={onClearGeometricAnnotations}
            >
              Clear GeoJSON
            </button>
          </div>
          {geometricAnnotations.length > 0 ? (
            <GeometricAnnotationList
              annotations={geometricAnnotations}
              onColorChange={onGeometricAnnotationColorChange}
              onVisibilityChange={onGeometricAnnotationVisibilityChange}
              onRemove={onRemoveGeometricAnnotation}
            />
          ) : null}
        </section>
      </section>
    </div>
  )
})

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
        <h4>{plot.label}</h4>
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
