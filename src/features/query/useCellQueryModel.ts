import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { slug } from '../../utils/slug'
import { lazyIdLookup, type IdLookup } from '../../data/lazyIdLookup'
import type {
  ContinuousCellMetadataTrack,
  ContinuousCellMetadataValue,
} from '../../data/customAnnotations'
import type { OverviewCellDatum } from '../../rendering/deckLayerTypes'
import { formatCsv } from '../../utils/csv'
import type { CellQueryColumnRequest } from '../../workers/cellQueryMessages'
import { annotationSetGrouping } from '../annotations/annotationModel'
import type { CellMetadataTrackValuesLoader } from '../annotations/useCellMetadataTrackValues'
import type {
  AnnotationLoader,
  CellOutlinesLoader,
  RoiCellsLoader,
} from '../app-shell/appDependencies'
import { downloadTextFile, type AppendDebugEvent } from '../app-shell/appRuntimeModel'
import { plotFileName } from '../plots/plotExport'
import {
  datasetSetGroupId,
  datasetSetOptionId,
  formatReadSize,
  plotSetOptions,
  SELECTIONS_SET_ID,
  type PlotDatasetSet,
  type PlotSavedSelection,
} from '../plots/plotsPanelModel'
import { useSelectionCells } from '../plots/useSelectionCells'
import type { SavedSelection } from '../roi/selectionListModel'
import { selectedCellBoundaryBbox } from '../cells/cellDetailModel'
import { DEFAULT_CELL_IMAGE_RADIUS } from './cellImageMeasurer'
import {
  CellImageMeasurements,
  type CellImageMeasurementsSnapshot,
} from './cellImageMeasurements'
import { CellOutlineReader } from './cellOutlineReader'
import { defaultCellPictureField, type CellPictureOutline } from './cellPictureModel'
import type { CellQueryPictureImage } from './CellPicture'
import {
  CELL_QUERY_ID_COLUMN,
  type CellQueryClassInput,
  type CellQueryCondition,
  type CellQuerySort,
} from './cellQuery'
import {
  formatCellImageReadSize,
  imageChannelOptions,
  imageColumnNeeds,
  imageGroupNote,
  imageLevelOptions,
  measuredRange,
  measurementView,
  type CellQueryConditionImage,
  type CellQueryImageChannel,
  type CellQueryImageProgress,
  type CellQueryMeasurementView,
} from './cellQueryImage'
import {
  cellQueryColumns,
  cellQueryCountCopy,
  cellQueryImageColumns,
  defaultCellQueryCondition,
  defaultQueryClassName,
  formatCellQueryNumber,
  imageColumn,
  isConditionComplete,
  isImageColumnId,
  overviewCellColumns,
  overviewNumberColumn,
  overviewSegmentationColumn,
  parseImageColumnId,
  setColumnId,
  type CellQueryColumn,
  type CellQueryImageChannelOption,
} from './cellQueryModel'
import {
  createCellQuerySession,
  type CellQuerySession,
  type CellQueryValues,
} from './cellQuerySession'
import { useOnDemandLoads, type OnDemandLoad } from './useOnDemandLoads'
import type { Annotation } from '../../data/annotation'

// The Cell Query window (plan 23-B to 23-E): conditions on the dataset's
// columns, the cells that match them in a table, and saving them as a class.
// Columns are read the first time a condition or table column uses them
// and handed to a query worker (23-D4), which matches and sorts. The table
// asks it for the values of the rows in view only (23-D5).

// Edits wait this long before matching (23-D4).
export const CELL_QUERY_RUN_DELAY_MS = 250
// Rows per values request when exporting.
const EXPORT_CHUNK = 20_000

export interface CellQueryClassOption {
  readonly id: string
  readonly label: string
  // Cells in the class, where known.
  readonly count: number | null
}

export interface CellQueryConditionView {
  readonly index: number
  readonly condition: CellQueryCondition
  // Null when the dataset no longer lists the column.
  readonly column: CellQueryColumn | null
  readonly status: 'loading' | 'ready' | 'error'
  readonly message: string | null
  readonly classes: readonly CellQueryClassOption[]
  readonly complete: boolean
  // For an image column (plan 26): its settings and measurement.
  readonly image: CellQueryConditionImage | null
}

export interface CellQueryTableColumn {
  readonly id: string
  readonly label: string
  readonly kind: 'id' | 'number' | 'category'
  readonly unit?: string | undefined
  // Added with Add column, not by a condition.
  readonly removable: boolean
  readonly sort: CellQuerySort['direction'] | null
}

export interface CellQueryTableModel {
  readonly columns: readonly CellQueryTableColumn[]
  readonly rowCount: number
  // Functions, not arrays: a million rows as props would be walked by
  // React's dev build on every render.
  readonly cellIdAt: (index: number) => string
  // Each column's text for rows start to end, read from the worker.
  readonly readValues: (start: number, end: number) => Promise<CellQueryRowValues>
  // Changes when the rows or columns do, so values read before are dropped.
  readonly valuesKey: string
  readonly selectedCellId: string | null
  readonly onSelectRow: (index: number) => void
  readonly onSort: (columnId: string) => void
  readonly addColumnOptions: readonly CellQueryColumn[]
  readonly onAddColumn: (columnId: string) => void
  readonly onRemoveColumn: (columnId: string) => void
  // Changes when the rows do, so the table scrolls back to the top.
  readonly resultKey: string
  readonly cellAt: (index: number) => OverviewCellDatum | null
  // Null while Picture is Off.
  readonly pictures: CellQueryPictures | null
  // Micrometres across, or null for Off.
  readonly pictureField: number | null
  readonly onPictureFieldChange: (field: number | null) => void
}

// A picture per row (plan 23-D10).
export interface CellQueryPictures {
  // Changes with the dataset, whose tiles and outlines are dropped.
  readonly key: string
  readonly field: number
  // The elements are Visium spots, drawn as their circles.
  readonly spots: boolean
  // Null for a dataset without an image: outlines alone.
  readonly image: CellQueryPictureImage | null
  // Tells the outline of each cell in rows start to end, at once for those
  // read before.
  readonly readOutlines: (
    start: number,
    end: number,
    signal: AbortSignal,
    onOutline: (cellId: string, outline: CellPictureOutline | null) => void,
  ) => Promise<void>
}

export interface CellQueryModel {
  // The window's status line.
  readonly status: string
  readonly loading: boolean
  readonly elementNoun: string
  // Every column, for Add condition.
  readonly columnOptions: readonly CellQueryColumn[]
  readonly conditions: readonly CellQueryConditionView[]
  readonly onAddCondition: (columnId: string) => void
  readonly onConditionChange: (index: number, condition: CellQueryCondition) => void
  readonly onRemoveCondition: (index: number) => void
  // Null until the first match.
  readonly matchCount: number | null
  readonly totalCount: number
  readonly matching: boolean
  readonly notes: readonly string[]
  readonly errors: readonly string[]
  readonly table: CellQueryTableModel
  readonly saveName: string
  readonly saveNamePlaceholder: string
  readonly onSaveNameChange: (name: string) => void
  readonly canSave: boolean
  readonly onSaveClass: () => void
  readonly exporting: boolean
  // A current, successful result with rows, its columns read.
  readonly canExport: boolean
  readonly onExportCsv: () => void
  // Why the image's channels are not listed, or null (plan 26-D1).
  readonly imageNote: string | null
  // Measurements for table columns no condition shows.
  readonly tableMeasurements: readonly CellQueryMeasurementView[]
  readonly imageProgress: CellQueryImageProgress
}

export interface CellQueryModelInput {
  readonly open: boolean
  // The platform's cells can be queried (not images or Visium HD bins).
  readonly available: boolean
  readonly datasetUrl: string | null
  readonly datasetReady: boolean
  readonly cells: readonly OverviewCellDatum[]
  readonly elementNoun: string
  readonly annotations: readonly Annotation<string>[]
  // The dataset's sets Clusters has not loaded, read for the query alone,
  // and every set the dataset lists, for conditions on a set Clusters has
  // since loaded.
  readonly datasetSets: readonly PlotDatasetSet[]
  readonly annotationGroups: readonly { readonly id: string; readonly label: string }[]
  readonly loadSetAnnotations: AnnotationLoader
  readonly savedSelections: readonly SavedSelection[]
  readonly loadSelectionCells: RoiCellsLoader
  readonly metadataTracks: readonly ContinuousCellMetadataTrack[]
  readonly loadMetadataTrackValues: CellMetadataTrackValuesLoader
  // Kept by App for the link (query=).
  readonly conditions: readonly CellQueryCondition[]
  readonly onConditionsChange: (conditions: readonly CellQueryCondition[]) => void
  readonly selectedCellId: string | null
  readonly onSelectCell: (cellId: string) => void
  readonly onSaveClass: (name: string, cellIds: readonly string[]) => void
  // The canvas's image, for the pictures; null for none.
  readonly pictureImage: CellQueryPictureImage | null
  // The pictures' outlines (plan 23-H).
  readonly loadCellOutlines: CellOutlinesLoader
  // The canvas's image channels, measured for image columns (plan 26).
  readonly imageChannels: readonly CellQueryImageChannel[]
  // The plane the canvas shows of a z-stack, or null.
  readonly imageZPlane: number | null
  readonly appendDebugEvent: AppendDebugEvent
  readonly createSession?: () => CellQuerySession
  readonly createImageMeasurements?: () => CellImageMeasurements
}

type ColumnInput =
  | { readonly status: 'loading' }
  // An image column waiting for Measure (plan 26-D7) or after Cancel.
  | { readonly status: 'waiting' }
  | { readonly status: 'error'; readonly message: string }
  | {
      readonly status: 'ready'
      // Changes whenever the column's values do.
      readonly key: string
      readonly classes: readonly CellQueryClassOption[]
      readonly request: () => CellQueryColumnRequest
    }

interface SessionEntry {
  readonly url: string
  readonly cells: readonly OverviewCellDatum[]
  // The render's rowsKey for these rows.
  readonly rowsKey: string
  readonly session: CellQuerySession
  // Each column's key as last sent.
  readonly sent: Map<string, string>
}

interface QueryResult {
  readonly key: string
  readonly rows: Uint32Array
  readonly total: number
  readonly error: string | null
}

// Each row's text by column, for a run of the table's rows.
export type CellQueryRowValues = readonly Readonly<Record<string, string>>[]

// Ids for objects, so a key changes when a list is replaced.
const objectIds = new WeakMap<object, number>()
let nextObjectId = 0

function objectId(value: object): number {
  let id = objectIds.get(value)
  if (id === undefined) {
    nextObjectId += 1
    id = nextObjectId
    objectIds.set(value, id)
  }
  return id
}

const EMPTY_CLASSES: readonly CellQueryClassOption[] = []
const NO_MEASUREMENTS: readonly CellQueryMeasurementView[] = []
const NO_ERRORS: ReadonlyMap<string, string> = new Map()
const NO_COUNTS: ReadonlyMap<string, number> = new Map()

function createCellImageMeasurements(): CellImageMeasurements {
  return new CellImageMeasurements()
}

export function useCellQueryModel({
  open,
  available,
  datasetUrl,
  datasetReady,
  cells,
  elementNoun,
  annotations,
  datasetSets,
  annotationGroups,
  loadSetAnnotations,
  savedSelections: savedSelectionList,
  loadSelectionCells,
  metadataTracks,
  loadMetadataTrackValues,
  conditions,
  onConditionsChange,
  selectedCellId,
  onSelectCell,
  onSaveClass,
  pictureImage,
  loadCellOutlines,
  imageChannels,
  imageZPlane,
  appendDebugEvent,
  createSession = createCellQuerySession,
  createImageMeasurements = createCellImageMeasurements,
}: CellQueryModelInput): CellQueryModel {
  const active = open && available && datasetReady && datasetUrl !== null
  const [extraColumnIds, setExtraColumnIds] = useState<readonly string[]>([])
  // 'default' follows the dataset: 40 µm with an image (80 µm for Visium
  // spots), Off without.
  const [pictureChoice, setPictureChoice] = useState<number | null | 'default'>('default')
  const [sort, setSort] = useState<CellQuerySort | null>(null)
  const [saveName, setSaveName] = useState('')
  const [exporting, setExporting] = useState(false)
  // A failed export, for the dataset it was of.
  const [exportError, setExportError] = useState<{
    readonly url: string
    readonly message: string
  } | null>(null)

  // The columns (23-D2).
  const cellColumns = useMemo(
    () => overviewCellColumns(active ? cells : []),
    [active, cells],
  )
  const setOptions = useMemo(
    () =>
      plotSetOptions({
        annotations,
        savedSelectionCount: savedSelectionList.length,
        datasetSets,
        datasetSet: null,
      }),
    [annotations, datasetSets, savedSelectionList.length],
  )
  // Image columns (plan 26), measured by a store of the dataset's
  // measurements whose state changes render the window.
  const [measurements] = useState(createImageMeasurements)
  const imageSnapshot = useSyncExternalStore(
    measurements.subscribe,
    measurements.getSnapshot,
    measurements.getSnapshot,
  )
  const imageChannelList = useMemo(
    () => (active ? imageChannelOptions(imageChannels, imageSnapshot) : []),
    [active, imageChannels, imageSnapshot],
  )
  // Cells without an area are discs of a radius set in the condition (26-D4).
  const imageRadius =
    cellColumns.numbers.cellArea === undefined ? DEFAULT_CELL_IMAGE_RADIUS : undefined
  const resolveImageColumn = useCallback(
    (columnId: string): CellQueryColumn | null => {
      const spec = parseImageColumnId(columnId)
      const channel =
        spec === null
          ? undefined
          : imageChannelList.find((candidate) => candidate.id === spec.channelId)
      if (spec === null || channel === undefined) return null
      const state = imageMeasurementState(imageSnapshot, columnId)
      const values =
        state?.status !== 'ready'
          ? undefined
          : spec.stat === 'mean'
            ? state.result.mean
            : state.result.above
      return imageColumn(
        spec,
        channel,
        values === undefined ? undefined : measuredRange(values),
      )
    },
    [imageChannelList, imageSnapshot],
  )
  const nonImageColumns = useMemo(
    () => cellQueryColumns({ cellColumns, setOptions, tracks: metadataTracks }),
    [cellColumns, metadataTracks, setOptions],
  )
  const resolveColumn = useCallback(
    (columnId: string): CellQueryColumn | null =>
      resolveImageColumn(columnId) ??
      nonImageColumns.find((column) => column.id === columnId) ??
      unlistedDatasetSetColumn(columnId, annotationGroups),
    [annotationGroups, nonImageColumns, resolveImageColumn],
  )
  // The sort, while the dataset lists its column: one kept from another
  // dataset is left out until it does, as conditions are, rather than
  // waiting on a column that never comes.
  // Columns the conditions, table and sort use.
  const tableColumnIds = useMemo(
    () =>
      uniqueStrings([
        ...conditions.map((condition) => condition.columnId),
        ...extraColumnIds,
      ]),
    [conditions, extraColumnIds],
  )
  // Only on a column the table shows, so a removed condition's column does
  // not keep ordering the rows with no arrow to say so.
  const activeSort =
    sort === null ||
    sort.columnId === CELL_QUERY_ID_COLUMN ||
    (tableColumnIds.includes(sort.columnId) && resolveColumn(sort.columnId) !== null)
      ? sort
      : null
  const neededColumns = useMemo(
    () =>
      uniqueStrings([
        ...tableColumnIds,
        ...(activeSort === null || activeSort.columnId === CELL_QUERY_ID_COLUMN
          ? []
          : [activeSort.columnId]),
      ]).flatMap((id) => {
        const column = resolveColumn(id)
        return column === null ? [] : [column]
      }),
    [activeSort, resolveColumn, tableColumnIds],
  )
  const imageNeeds = useMemo(
    () => imageColumnNeeds(neededColumns, imageChannelList),
    [imageChannelList, neededColumns],
  )
  const columnOptions = useMemo(
    () => [
      ...nonImageColumns,
      ...cellQueryImageColumns({
        channels: imageChannelList,
        z: imageZPlane ?? undefined,
        radius: imageRadius,
        channelsInUse: imageNeeds.channelsInUse,
      }),
    ],
    [
      imageChannelList,
      imageNeeds.channelsInUse,
      imageRadius,
      imageZPlane,
      nonImageColumns,
    ],
  )

  // Measures what the image columns need while the window is open; another
  // dataset, or other cells, start again.
  const imageChannelsRef = useRef({ imageChannels, imageZPlane })
  useEffect(() => {
    imageChannelsRef.current = { imageChannels, imageZPlane }
  })
  useEffect(() => {
    measurements.reset()
  }, [cells, datasetUrl, measurements])
  useEffect(() => {
    measurements.sync(active ? imageNeeds.needs : [], {
      cells,
      loaderFor: (channelId, z) => {
        const current = imageChannelsRef.current
        if (z !== current.imageZPlane) return null
        return (
          current.imageChannels.find((channel) => channel.id === channelId)?.loader ??
          null
        )
      },
      onMeasured: (spec, ms, bytes) => {
        const name =
          imageChannelsRef.current.imageChannels.find(
            (channel) => channel.id === spec.channelId,
          )?.name ?? spec.channelId
        appendDebugEvent(
          `Cell query: measured ${name} at level ${spec.level.toString()} in ${(ms / 1000).toFixed(1)} s (${formatReadSize(bytes)})`,
        )
      },
    })
  }, [active, appendDebugEvent, cells, imageNeeds.needs, measurements])
  useEffect(() => {
    if (!active) return
    measurements.findThresholds(
      imageChannels.filter(
        (channel) =>
          channel.histogram?.threshold === undefined &&
          imageChannelList.some((option) => option.id === channel.id),
      ),
    )
  }, [active, imageChannelList, imageChannels, measurements])
  // Each level's size for the Resolution lists of the channels in use.
  useEffect(() => {
    if (!active) return
    measurements.findLevelSizes(
      imageChannels.filter((channel) => imageNeeds.channelsInUse.includes(channel.id)),
    )
  }, [active, imageChannels, imageNeeds.channelsInUse, measurements])
  useEffect(
    () => () => {
      measurements.reset()
    },
    [measurements],
  )

  // Values read on demand: dataset sets, metadata tracks and the saved
  // selections' cells.
  const datasetGroupIds = useMemo(
    () =>
      neededColumns.flatMap((column) =>
        column.source.kind === 'set' && column.source.setKind === 'dataset'
          ? [datasetSetGroupId(column.source.setId) ?? '']
          : [],
      ),
    [neededColumns],
  )
  const loadGroup = useCallback(
    (
      url: string,
      groupId: string,
      signal: AbortSignal,
    ): Promise<readonly Annotation<string>[]> =>
      loadSetAnnotations(url, { groupId, signal }),
    [loadSetAnnotations],
  )
  const describeGroup = useCallback((groupId: string) => `annotation set ${groupId}`, [])
  const datasetSetLoads = useOnDemandLoads({
    enabled: active,
    datasetUrl,
    keys: datasetGroupIds,
    load: loadGroup,
    describe: describeGroup,
    appendDebugEvent,
  })
  const unreadTrackIds = useMemo(
    () =>
      neededColumns.flatMap(({ source }) =>
        source.kind === 'track' &&
        metadataTracks.find((track) => track.id === source.trackId)?.values === null
          ? [source.trackId]
          : [],
      ),
    [metadataTracks, neededColumns],
  )
  const loadTrack = useCallback(
    (url: string, trackId: string, signal: AbortSignal) =>
      loadMetadataTrackValues(url, trackId, { signal }),
    [loadMetadataTrackValues],
  )
  const describeTrack = useCallback((trackId: string) => `metadata track ${trackId}`, [])
  const trackLoads = useOnDemandLoads({
    enabled: active,
    datasetUrl,
    keys: unreadTrackIds,
    load: loadTrack,
    describe: describeTrack,
    appendDebugEvent,
  })
  const savedSelections = useSelectionCells({
    enabled:
      active &&
      neededColumns.some(
        (column) =>
          column.source.kind === 'set' && column.source.setKind === 'selections',
      ),
    datasetUrl,
    selections: savedSelectionList,
    loadCells: loadSelectionCells,
    appendDebugEvent,
  })

  // Built when a column first counts its classes, not while Cell Query is
  // closed (optimization pass, O5).
  const placedCellIds = useMemo(
    () =>
      lazyIdLookup(
        cells,
        (cell) => cell.id,
        () => true,
      ),
    [cells],
  )
  const columnInputs = useMemo(() => {
    const inputs = new Map<string, ColumnInput>()
    for (const column of neededColumns) {
      inputs.set(
        column.id,
        columnInput(column, {
          cells,
          placedCellIds,
          cellColumns,
          annotations,
          datasetSetLoads,
          savedSelections,
          metadataTracks,
          trackLoads,
          imageSnapshot,
          imageOverLimit: imageNeeds.overLimit,
        }),
      )
    }
    return inputs
  }, [
    annotations,
    cellColumns,
    cells,
    datasetSetLoads,
    placedCellIds,
    imageNeeds.overLimit,
    imageSnapshot,
    metadataTracks,
    neededColumns,
    savedSelections,
    trackLoads,
  ])

  // The query sent to the worker: complete conditions on listed columns
  // (23-D3). The others show why they are left out.
  const activeConditions = useMemo(
    () =>
      conditions.filter(
        (condition) =>
          isConditionComplete(condition) && resolveColumn(condition.columnId) !== null,
      ),
    [conditions, resolveColumn],
  )
  const usedColumnIds = [
    ...activeConditions.map((condition) => condition.columnId),
    ...(activeSort === null || activeSort.columnId === CELL_QUERY_ID_COLUMN
      ? []
      : [activeSort.columnId]),
  ]
  const runnable =
    active && usedColumnIds.every((id) => columnInputs.get(id)?.status === 'ready')
  const blocked = usedColumnIds.some((id) => columnInputs.get(id)?.status === 'error')
  const readyKey = [...columnInputs]
    .map(([id, input]) => (input.status === 'ready' ? `${id}=${input.key}` : ''))
    .join('\u0000')
  // The rows the results are for: the dataset's cells as drawn.
  const rowsKey = `${datasetUrl ?? ''}|${objectId(cells)}`
  const runKey = `${rowsKey}|${JSON.stringify(activeConditions, numbersInJson)}|${JSON.stringify(
    activeSort,
  )}|${readyKey}`

  const [result, setResult] = useState<QueryResult | null>(null)
  // Per column, for the rows they were set on.
  const [columnStates, setColumnStates] = useState<{
    readonly rowsKey: string
    readonly errors: ReadonlyMap<string, string>
    readonly unmatched: ReadonlyMap<string, number>
  }>({ rowsKey: '', errors: new Map(), unmatched: new Map() })
  const columnErrors = columnStates.rowsKey === rowsKey ? columnStates.errors : NO_ERRORS
  const unmatched = columnStates.rowsKey === rowsKey ? columnStates.unmatched : NO_COUNTS
  const entryRef = useRef<SessionEntry | null>(null)

  // Another dataset, or new cells, frees the worker even while the window is
  // closed.
  useEffect(() => {
    const entry = entryRef.current
    if (entry !== null && (entry.url !== datasetUrl || entry.cells !== cells)) {
      entry.session.dispose()
      entryRef.current = null
    }
  }, [cells, datasetUrl])

  // The latest inputs, read by the effect below without restarting it.
  const latestRef = useRef({ columnInputs, activeConditions, activeSort, createSession })
  useEffect(() => {
    latestRef.current = { columnInputs, activeConditions, activeSort, createSession }
  })

  // Sends changed columns, then matches once edits pause (23-D4).
  useEffect(() => {
    if (!active || datasetUrl === null) return

    const latest = latestRef.current
    const entry = sessionEntry(entryRef, datasetUrl, cells, rowsKey, latest.createSession)
    const updateColumnStates = (
      update: (errors: Map<string, string>, unmatchedIds: Map<string, number>) => void,
    ) => {
      setColumnStates((current) => {
        const same = current.rowsKey === entry.rowsKey
        const errors = new Map(same ? current.errors : [])
        const unmatchedIds = new Map(same ? current.unmatched : [])
        update(errors, unmatchedIds)
        return { rowsKey: entry.rowsKey, errors, unmatched: unmatchedIds }
      })
    }

    for (const [columnId, input] of latest.columnInputs) {
      if (input.status !== 'ready' || entry.sent.get(columnId) === input.key) continue
      entry.sent.set(columnId, input.key)
      entry.session.setColumn(input.request()).then(
        (summary) => {
          if (entryRef.current !== entry) return
          updateColumnStates((errors, unmatchedIds) => {
            unmatchedIds.set(columnId, summary.unmatchedIds)
            errors.delete(columnId)
          })
        },
        (error: unknown) => {
          if (entryRef.current !== entry || isAbort(error)) return
          entry.sent.delete(columnId)
          updateColumnStates((errors) => {
            errors.set(columnId, errorMessage(error))
          })
        },
      )
    }

    if (!runnable) return

    const key = runKey
    const timer = setTimeout(() => {
      const startedAt = performance.now()
      entry.session.run(latest.activeConditions, latest.activeSort).then(
        (queryResult) => {
          if (entryRef.current !== entry) return
          setResult({
            key,
            rows: queryResult.rows,
            total: queryResult.total,
            error:
              queryResult.missingColumnIds.length > 0
                ? `Columns not read: ${queryResult.missingColumnIds.join(', ')}`
                : null,
          })
          appendDebugEvent(
            `Cell query: ${queryResult.rows.length.toLocaleString()} of ${queryResult.total.toLocaleString()} match in ${Math.round(performance.now() - startedAt).toLocaleString()} ms`,
            { coalesceKey: 'cell-query' },
          )
        },
        (error: unknown) => {
          if (entryRef.current !== entry || isAbort(error)) return
          setResult({
            key,
            rows: new Uint32Array(0),
            total: cells.length,
            error: errorMessage(error),
          })
        },
      )
    }, CELL_QUERY_RUN_DELAY_MS)

    return () => {
      clearTimeout(timer)
    }
  }, [active, appendDebugEvent, cells, datasetUrl, readyKey, rowsKey, runKey, runnable])

  // The worker goes with the dataset and the window's owner.
  useEffect(
    () => () => {
      entryRef.current?.session.dispose()
      entryRef.current = null
    },
    [],
  )

  // The table reads the values of the rows in view (23-D5); it keeps them
  // itself, so scrolling renders the table alone.
  const currentResult =
    result !== null && result.key.startsWith(`${rowsKey}|`) ? result : null
  const tableColumnsKey = tableColumnIds
    .map((id) => {
      const input = columnInputs.get(id)
      return input?.status === 'ready' ? `${id}=${input.key}` : `${id}=…`
    })
    .join('\u0000')
  const valuesKey = `${currentResult?.key ?? ''}#${tableColumnsKey}`
  const readyTableColumnIds = useMemo(
    () => tableColumnIds.filter((id) => columnInputs.get(id)?.status === 'ready'),
    [columnInputs, tableColumnIds],
  )
  const columnKinds = useMemo(() => {
    const kinds = new Map<string, CellQueryColumn | null>()
    for (const id of tableColumnIds) kinds.set(id, resolveColumn(id))
    return kinds
  }, [resolveColumn, tableColumnIds])
  const rows = currentResult?.rows ?? null

  const readValues = useCallback(
    async (start: number, end: number): Promise<CellQueryRowValues> => {
      const entry = entryRef.current
      if (entry === null || rows === null) return []
      // A copy: a view would send the whole buffer to the worker.
      const pageRows = rows.slice(start, Math.min(rows.length, end))
      const values = await entry.session.values(pageRows, readyTableColumnIds)
      return pageTexts(pageRows.length, values, columnKinds)
    },
    [columnKinds, readyTableColumnIds, rows],
  )
  const cellIdAt = useCallback(
    (index: number) => {
      const row = rows?.[index]
      return row === undefined ? '' : (cells[row]?.id ?? '')
    },
    [cells, rows],
  )
  const cellAt = useCallback(
    (index: number) => {
      const row = rows?.[index]
      return row === undefined ? null : (cells[row] ?? null)
    },
    [cells, rows],
  )

  // Pictures (23-G, 23-H).
  const pictureField =
    pictureChoice === 'default'
      ? pictureImage === null
        ? null
        : defaultCellPictureField(cells[0])
      : pictureChoice
  const outlineReader = useMemo(
    () =>
      datasetUrl === null
        ? null
        : new CellOutlineReader((requests, signal) =>
            loadCellOutlines(datasetUrl, requests, { signal }),
          ),
    [datasetUrl, loadCellOutlines],
  )
  const pictures = useMemo<CellQueryPictures | null>(
    () =>
      pictureField === null || outlineReader === null || datasetUrl === null
        ? null
        : {
            key: datasetUrl,
            field: pictureField,
            spots: elementNoun === 'spots',
            image: pictureImage,
            readOutlines: async (start, end, signal, onOutline) => {
              const requests = Array.from(rows?.slice(start, end) ?? [], (row) => {
                const cell = cells[row]
                return cell === undefined
                  ? null
                  : {
                      id: cell.id,
                      overviewRow: row,
                      bbox: selectedCellBoundaryBbox(cell),
                    }
              }).filter((request) => request !== null)
              const startedAt = performance.now()
              const read = await outlineReader.read(requests, signal, onOutline)
              if (read > 0 && !signal.aborted) {
                appendDebugEvent(
                  `Cell query: ${read.toLocaleString()} ${read === 1 ? 'outline' : 'outlines'} in ${Math.round(performance.now() - startedAt).toLocaleString()} ms`,
                )
              }
            },
          },
    [
      appendDebugEvent,
      cells,
      datasetUrl,
      elementNoun,
      outlineReader,
      pictureField,
      pictureImage,
      rows,
    ],
  )
  const onPictureFieldChange = useCallback((field: number | null) => {
    setPictureChoice(field)
  }, [])

  const onSelectRow = useCallback(
    (index: number) => {
      const cellId = cellIdAt(index)
      if (cellId !== '') onSelectCell(cellId)
    },
    [cellIdAt, onSelectCell],
  )
  const onSort = useCallback((columnId: string) => {
    setSort((current) =>
      current?.columnId === columnId
        ? {
            columnId,
            direction: current.direction === 'ascending' ? 'descending' : 'ascending',
          }
        : { columnId, direction: 'ascending' },
    )
  }, [])
  const onAddColumn = useCallback((columnId: string) => {
    setExtraColumnIds((current) => uniqueStrings([...current, columnId]))
  }, [])
  const onRemoveColumn = useCallback((columnId: string) => {
    setExtraColumnIds((current) => current.filter((id) => id !== columnId))
    setSort((current) => (current?.columnId === columnId ? null : current))
  }, [])

  const conditionColumnIds = new Set(conditions.map((condition) => condition.columnId))
  const tableColumns: readonly CellQueryTableColumn[] = [
    {
      id: CELL_QUERY_ID_COLUMN,
      label: elementNoun === 'spots' ? 'Spot' : 'Cell',
      kind: 'id',
      removable: false,
      sort: activeSort?.columnId === CELL_QUERY_ID_COLUMN ? activeSort.direction : null,
    },
    ...tableColumnIds.map((id): CellQueryTableColumn => {
      const column = columnKinds.get(id) ?? null
      return {
        id,
        label: column?.label ?? id,
        kind: column?.kind ?? 'category',
        unit: column?.unit,
        removable: !conditionColumnIds.has(id),
        sort: activeSort?.columnId === id ? activeSort.direction : null,
      }
    }),
  ]

  // Conditions (23-B).
  const onAddCondition = useCallback(
    (columnId: string) => {
      const column = resolveColumn(columnId)
      if (column === null) return
      const threshold =
        column.source.kind === 'image'
          ? imageChannelList.find(
              (channel) =>
                column.source.kind === 'image' &&
                channel.id === column.source.spec.channelId,
            )?.threshold
          : undefined
      onConditionsChange([
        ...conditions,
        defaultCellQueryCondition(
          column,
          typeof threshold === 'number' ? threshold : undefined,
        ),
      ])
    },
    [conditions, imageChannelList, onConditionsChange, resolveColumn],
  )
  const onConditionChange = useCallback(
    (index: number, condition: CellQueryCondition) => {
      // An image condition's threshold, level or radius makes it another
      // column; a sort on it follows.
      const previous = conditions[index]?.columnId
      if (previous !== undefined && previous !== condition.columnId) {
        setSort((current) =>
          current?.columnId === previous
            ? { ...current, columnId: condition.columnId }
            : current,
        )
      }
      onConditionsChange(
        conditions.map((current, at) => (at === index ? condition : current)),
      )
    },
    [conditions, onConditionsChange],
  )
  const onRemoveCondition = useCallback(
    (index: number) => {
      const next = conditions.filter((_, at) => at !== index)
      const removed = conditions[index]?.columnId
      if (
        removed !== undefined &&
        !next.some((condition) => condition.columnId === removed) &&
        !extraColumnIds.includes(removed)
      ) {
        setSort((current) => (current?.columnId === removed ? null : current))
      }
      onConditionsChange(next)
    },
    [conditions, extraColumnIds, onConditionsChange],
  )

  const imageMeasurementView = (
    column: CellQueryColumn,
  ): CellQueryMeasurementView | null => {
    if (column.source.kind !== 'image') return null
    const { spec } = column.source
    const key = imageSnapshot.keyFor(column.id)
    return measurementView(
      column,
      imageChannelList.find((channel) => channel.id === spec.channelId)?.name ??
        spec.channelId,
      key,
      key === undefined ? undefined : imageSnapshot.state(key),
      imageNeeds.overLimit.get(column.id),
      measurements,
    )
  }
  const conditionImage = (
    column: CellQueryColumn | null,
  ): CellQueryConditionImage | null => {
    if (column?.source.kind !== 'image') return null
    const { spec } = column.source
    const channel = imageChannelList.find((candidate) => candidate.id === spec.channelId)
    const measurement = imageMeasurementView(column)
    if (channel === undefined || measurement === null) return null
    return {
      spec,
      channelName: channel.name,
      levels: imageLevelOptions(channel, imageSnapshot.levelSizes(channel.id)),
      histogram:
        imageChannels.find((candidate) => candidate.id === channel.id)?.histogram ?? null,
      measurement,
    }
  }

  const conditionViews = conditions.map((condition, index): CellQueryConditionView => {
    const column = resolveColumn(condition.columnId)
    const input = columnInputs.get(condition.columnId)
    const error = columnErrors.get(condition.columnId) ?? null
    return {
      index,
      condition,
      column,
      status:
        column === null || error !== null || input?.status === 'error'
          ? 'error'
          : input?.status === 'ready'
            ? 'ready'
            : 'loading',
      message:
        column === null
          ? isImageColumnWaiting(condition.columnId, imageChannels)
            ? 'Waiting for the image.'
            : 'The dataset no longer lists this column.'
          : (error ?? (input?.status === 'error' ? input.message : null)),
      classes: input?.status === 'ready' ? input.classes : EMPTY_CLASSES,
      complete: isConditionComplete(condition),
      image: conditionImage(column),
    }
  })
  const tableMeasurements = tableColumnIds.flatMap((id) => {
    if (conditionColumnIds.has(id)) return []
    const column = columnKinds.get(id)
    const view =
      column === undefined || column === null ? null : imageMeasurementView(column)
    return view === null || view.status === 'ready' ? [] : [view]
  })

  // Save as class and export (23-D7, 23-D8), for the query as it stands: an
  // edit's rows stay listed until its own result arrives.
  const resultIsCurrent = currentResult !== null && currentResult.key === runKey
  const saveNamePlaceholder = defaultQueryClassName(annotations)
  const handleSaveClass = useCallback(() => {
    if (rows === null || rows.length === 0) return
    const ids = Array.from(rows, (row) => cells[row]?.id ?? '').filter((id) => id !== '')
    const name = saveName.trim() === '' ? saveNamePlaceholder : saveName.trim()
    onSaveClass(name, ids)
    setSaveName('')
    appendDebugEvent(`Cell query: saved ${ids.length.toLocaleString()} cells as ${name}`)
  }, [appendDebugEvent, cells, onSaveClass, rows, saveName, saveNamePlaceholder])

  const exportColumns = tableColumns.filter(
    (column) => column.kind === 'id' || readyTableColumnIds.includes(column.id),
  )
  // A current, successful result, once no table column is still being read
  // so the file leaves none out.
  const canExport =
    resultIsCurrent &&
    currentResult.error === null &&
    currentResult.rows.length > 0 &&
    !exporting &&
    tableColumnIds.every((id) => columnInputs.get(id)?.status !== 'loading')
  const handleExportCsv = useCallback(() => {
    const entry = entryRef.current
    if (!canExport || entry === null || rows === null || datasetUrl === null) return

    setExporting(true)
    setExportError(null)
    void exportCsv(entry.session, rows, cells, exportColumns, columnKinds).then(
      (csv) => {
        downloadTextFile(plotFileName(datasetUrl, 'cell-query', null, 'csv'), csv)
        setExporting(false)
        appendDebugEvent(`Cell query: exported ${rows.length.toLocaleString()} rows`)
      },
      (error: unknown) => {
        setExporting(false)
        // Closed by a dataset switch or the window: nothing to report.
        if (isAbort(error)) return
        setExportError({
          url: datasetUrl,
          message: `The CSV could not be written: ${errorMessage(error)}`,
        })
      },
    )
  }, [appendDebugEvent, canExport, cells, columnKinds, datasetUrl, exportColumns, rows])

  const matching = runnable && !resultIsCurrent
  const waitingColumns = usedColumnIds.some(
    (id) => columnInputs.get(id)?.status === 'waiting',
  )
  // The count waits for a measurement (plan 26-D3) rather than showing the
  // last one.
  const measuringColumns = usedColumnIds.some(
    (id) => isImageColumnId(id) && columnInputs.get(id)?.status === 'loading',
  )
  // Columns added to the table, which no condition reports on.
  const addedColumnIds = tableColumnIds.filter((id) => !conditionColumnIds.has(id))
  const loadingColumns =
    conditionViews.some(
      (view) =>
        view.status === 'loading' &&
        columnInputs.get(view.condition.columnId)?.status !== 'waiting',
    ) || addedColumnIds.some((id) => columnInputs.get(id)?.status === 'loading')
  const addedColumnErrors = addedColumnIds.flatMap((id) => {
    const input = columnInputs.get(id)
    return input?.status === 'error'
      ? [
          `The ${resolveColumn(id)?.label ?? id} column could not be read, so it is blank and the CSV leaves it out: ${input.message}`,
        ]
      : []
  })
  const matchCount = currentResult === null ? null : currentResult.rows.length
  const totalCount = cells.length
  // Imported sets' cells not on the map; a dataset's own columns also list
  // cells the map leaves out, such as Visium spots off the tissue.
  const notes = [
    ...[...unmatched].flatMap(([columnId, count]) =>
      count > 0 && tableColumnIds.includes(columnId) && isImportedSetColumn(columnId)
        ? [
            `${count.toLocaleString()} cell IDs in ${resolveColumn(columnId)?.label ?? columnId} are not on the map.`,
          ]
        : [],
    ),
    ...(conditions.some((condition) => !isConditionComplete(condition))
      ? ['Conditions with no class chosen are left out until one is.']
      : []),
    ...savedSelections.flatMap((saved) =>
      saved.cells.status === 'ready' &&
      saved.cells.hitCellLimit &&
      tableColumnIds.includes(setColumnId(SELECTIONS_SET_ID))
        ? [`${saved.name} stopped at its cell limit.`]
        : [],
    ),
    ...imageOutsideNotes(
      tableColumnIds,
      columnKinds,
      imageSnapshot,
      imageChannelList,
      elementNoun,
    ),
  ]
  const errors = [
    ...(currentResult?.error === null || currentResult === null
      ? []
      : [currentResult.error]),
    ...addedColumnErrors,
    ...(exportError === null || exportError.url !== datasetUrl
      ? []
      : [exportError.message]),
  ]

  return {
    status: !active
      ? datasetReady
        ? 'Open a dataset with cells'
        : 'No dataset'
      : blocked
        ? 'A condition could not be read'
        : waitingColumns
          ? 'Waiting to measure'
          : measuringColumns
            ? 'Measuring'
            : matching || matchCount === null
              ? // The status line adds "…" while loading.
                'Matching'
              : activeConditions.length === 0
                ? `${totalCount.toLocaleString()} ${elementNoun}, no conditions`
                : cellQueryCountCopy(matchCount, totalCount, elementNoun),
    loading: matching || loadingColumns || exporting,
    elementNoun,
    columnOptions,
    conditions: conditionViews,
    onAddCondition,
    onConditionChange,
    onRemoveCondition,
    matchCount,
    totalCount,
    matching,
    notes,
    errors,
    table: {
      columns: tableColumns,
      rowCount: rows?.length ?? 0,
      cellIdAt,
      readValues,
      valuesKey,
      selectedCellId,
      onSelectRow,
      onSort,
      addColumnOptions: columnOptions.filter(
        (column) => !tableColumnIds.includes(column.id),
      ),
      onAddColumn,
      onRemoveColumn,
      resultKey: currentResult?.key ?? '',
      cellAt,
      pictures,
      pictureField,
      onPictureFieldChange,
    },
    saveName,
    saveNamePlaceholder,
    onSaveNameChange: setSaveName,
    canSave: resultIsCurrent && (rows?.length ?? 0) > 0,
    onSaveClass: handleSaveClass,
    exporting,
    canExport,
    onExportCsv: handleExportCsv,
    imageNote: active ? imageGroupNote(imageChannels) : null,
    tableMeasurements:
      tableMeasurements.length === 0 ? NO_MEASUREMENTS : tableMeasurements,
    imageProgress: measurements,
  }
}

function sessionEntry(
  entryRef: { current: SessionEntry | null },
  url: string,
  cells: readonly OverviewCellDatum[],
  rowsKey: string,
  createSession: () => CellQuerySession,
): SessionEntry {
  const current = entryRef.current
  if (current !== null && current.url === url && current.cells === cells) return current

  current?.session.dispose()
  const session = createSession()
  session.setRows(cells.map((cell) => cell.id))
  const entry: SessionEntry = { url, cells, rowsKey, session, sent: new Map() }
  entryRef.current = entry
  return entry
}

type PlacedCellIds = Pick<IdLookup<true>, 'has' | 'size'>

interface ColumnInputContext {
  readonly cells: readonly OverviewCellDatum[]
  // The IDs on the map, which a class's count is of.
  readonly placedCellIds: PlacedCellIds
  readonly cellColumns: ReturnType<typeof overviewCellColumns>
  readonly annotations: readonly Annotation<string>[]
  readonly datasetSetLoads: ReadonlyMap<
    string,
    OnDemandLoad<readonly Annotation<string>[]>
  >
  readonly savedSelections: readonly PlotSavedSelection[]
  readonly metadataTracks: readonly ContinuousCellMetadataTrack[]
  readonly trackLoads: ReadonlyMap<
    string,
    OnDemandLoad<readonly ContinuousCellMetadataValue[]>
  >
  readonly imageSnapshot: CellImageMeasurementsSnapshot
  // Image columns past the three channels measured at once, and why.
  readonly imageOverLimit: ReadonlyMap<string, string>
}

// A column's values as the worker takes them, once they are known.
function columnInput(column: CellQueryColumn, context: ColumnInputContext): ColumnInput {
  const { source } = column
  const { cells } = context

  if (source.kind === 'cell') {
    const key = `cells:${objectId(cells)}`
    if (source.field === 'segmentationMethod') {
      const labels = context.cellColumns.segmentationMethods
      return {
        status: 'ready',
        key,
        classes: labels.map((label) => ({ id: label, label, count: null })),
        request: () => ({
          type: 'category-column-by-row',
          columnId: column.id,
          codes: overviewSegmentationColumn(cells, labels),
          labels,
        }),
      }
    }
    const { field } = source
    return {
      status: 'ready',
      key,
      classes: EMPTY_CLASSES,
      request: () => ({
        type: 'number-column',
        columnId: column.id,
        values: overviewNumberColumn(cells, field),
      }),
    }
  }

  if (source.kind === 'image') {
    const overLimit = context.imageOverLimit.get(column.id)
    if (overLimit !== undefined) return { status: 'error', message: overLimit }
    if (source.spec.stat === 'above' && source.spec.threshold === undefined) {
      return { status: 'error', message: 'Set a threshold to measure.' }
    }
    const key = context.imageSnapshot.keyFor(column.id)
    const state = key === undefined ? undefined : context.imageSnapshot.state(key)
    switch (state?.status) {
      case 'ready': {
        const { result } = state
        return {
          status: 'ready',
          key: `image:${objectId(result)}`,
          classes: EMPTY_CLASSES,
          request: () => ({
            type: 'number-column',
            columnId: column.id,
            values: source.spec.stat === 'mean' ? result.mean : result.above,
          }),
        }
      }
      case 'error':
        return { status: 'error', message: state.message }
      case 'refused':
        return {
          status: 'error',
          message: `The read is over the limit (${formatCellImageReadSize(state.size)}).`,
        }
      case 'asking':
      case 'cancelled':
        return { status: 'waiting' }
      default:
        return { status: 'loading' }
    }
  }

  if (source.kind === 'track') {
    const track = context.metadataTracks.find(
      (candidate) => candidate.id === source.trackId,
    )
    if (track === undefined) {
      return { status: 'error', message: 'The dataset no longer lists this column.' }
    }
    const load = track.values === null ? context.trackLoads.get(track.id) : undefined
    const values = track.values ?? (load?.status === 'ready' ? load.value : null)
    if (values === null) {
      return load?.status === 'error'
        ? { status: 'error', message: load.message }
        : { status: 'loading' }
    }
    return {
      status: 'ready',
      key: `track:${objectId(values)}`,
      classes: EMPTY_CLASSES,
      request: () => ({
        type: 'number-column-by-id',
        columnId: column.id,
        cellIds: values.map((value) => value.cellId),
        values: Float64Array.from(values, (value) => value.value),
      }),
    }
  }

  if (source.setKind === 'selections') {
    const pending = context.savedSelections.some(
      (saved) => saved.cells.status === 'loading',
    )
    if (pending) return { status: 'loading' }
    const failed = context.savedSelections.flatMap((saved) =>
      saved.cells.status === 'error' ? [`${saved.name}: ${saved.cells.message}`] : [],
    )
    if (failed.length > 0) return { status: 'error', message: failed.join('; ') }

    return classesInput(
      column.id,
      context.placedCellIds,
      context.savedSelections.flatMap((saved) =>
        saved.cells.status === 'ready'
          ? [
              {
                id: `selection:${saved.id}`,
                label: saved.name,
                cellIds: saved.cells.cellIds,
              },
            ]
          : [],
      ),
    )
  }

  if (source.setKind === 'dataset') {
    const groupId = datasetSetGroupId(source.setId) ?? ''
    const load = context.datasetSetLoads.get(groupId)
    if (load === undefined || load.status === 'loading') return { status: 'loading' }
    if (load.status === 'error') return { status: 'error', message: load.message }
    return classesInput(column.id, context.placedCellIds, setClasses(load.value))
  }

  return classesInput(
    column.id,
    context.placedCellIds,
    setClasses(
      context.annotations.filter(
        (annotation) => annotationSetGrouping(annotation).id === source.setId,
      ),
    ),
  )
}

function setClasses(
  annotations: readonly Annotation<string>[],
): readonly CellQueryClassInput[] {
  return annotations.map((annotation) => ({
    id: annotation.id,
    label: annotationSetGrouping(annotation).rowLabel,
    cellIds: annotation.cellIds,
  }))
}

// The key holds the labels, so a renamed selection is sent again; the count
// is of the cells on the map, as Clusters and Plots count them.
function classesInput(
  columnId: string,
  placedCellIds: PlacedCellIds,
  classes: readonly CellQueryClassInput[],
): ColumnInput {
  return {
    status: 'ready',
    key: classes
      .map(
        (queryClass) =>
          `${queryClass.id}#${queryClass.label}#${objectId(queryClass.cellIds)}`,
      )
      .join('\u0000'),
    classes: classes.map((queryClass) => ({
      id: queryClass.id,
      label: queryClass.label,
      count:
        placedCellIds.size === 0
          ? queryClass.cellIds.length
          : queryClass.cellIds.reduce(
              (count, cellId) => (placedCellIds.has(cellId) ? count + 1 : count),
              0,
            ),
    })),
    request: () => ({ type: 'category-column', columnId, classes }),
  }
}

// A condition's dataset set that Clusters has since loaded keeps reading it
// alone, so the condition and the link stay as they were. So does a
// condition on the set Clusters showed once Clusters shows another: the
// loaded set's ID is `analysis:` and its name (annotationSetGrouping).
function unlistedDatasetSetColumn(
  columnId: string,
  groups: readonly { readonly id: string; readonly label: string }[],
): CellQueryColumn | null {
  const prefix = setColumnId(datasetSetOptionId(''))
  const datasetSet = columnId.startsWith(prefix)
  if (!datasetSet && !columnId.startsWith(setColumnId('analysis:'))) return null
  const setId = columnId.slice(datasetSet ? prefix.length : setColumnId('').length)
  const group = groups.find(
    (candidate) =>
      candidate.id === setId ||
      (!datasetSet && `analysis:${slug(candidate.label)}` === setId),
  )
  return group === undefined
    ? null
    : {
        id: columnId,
        label: group.label,
        kind: 'category',
        group: 'Classes',
        source: { kind: 'set', setKind: 'dataset', setId: datasetSetOptionId(group.id) },
      }
}

function pageTexts(
  count: number,
  values: CellQueryValues,
  columns: ReadonlyMap<string, CellQueryColumn | null>,
): CellQueryRowValues {
  return Array.from({ length: count }, (_, index) => {
    const texts: Record<string, string> = {}
    for (const [columnId, column] of Object.entries(values)) {
      texts[columnId] =
        column.kind === 'number'
          ? formatCellQueryNumber(column.values[index] ?? Number.NaN)
          : (column.labels[index] ?? '')
    }
    // Columns not read yet, or not held, show as empty.
    for (const columnId of columns.keys()) texts[columnId] ??= ''
    return texts
  })
}

async function exportCsv(
  session: CellQuerySession,
  rows: Uint32Array,
  cells: readonly OverviewCellDatum[],
  columns: readonly CellQueryTableColumn[],
  kinds: ReadonlyMap<string, CellQueryColumn | null>,
): Promise<string> {
  const valueColumns = columns.filter((column) => column.kind !== 'id')
  const header = [
    'cell_id',
    ...valueColumns.map((column) => {
      const unit = kinds.get(column.id)?.unit
      return unit === undefined ? column.label : `${column.label} (${unit})`
    }),
  ]
  const lines: string[][] = [header]

  for (let start = 0; start < rows.length; start += EXPORT_CHUNK) {
    const chunk = rows.slice(start, Math.min(rows.length, start + EXPORT_CHUNK))
    const values = await session.values(
      chunk,
      valueColumns.map((column) => column.id),
    )
    chunk.forEach((row, index) => {
      lines.push([
        cells[row]?.id ?? '',
        ...valueColumns.map((column) => {
          const columnValues = values[column.id]
          if (columnValues === undefined) return ''
          if (columnValues.kind === 'category') return columnValues.labels[index] ?? ''
          const value = columnValues.values[index] ?? Number.NaN
          return Number.isFinite(value) ? String(value) : ''
        }),
      ])
    })
  }

  return formatCsv(lines)
}

// The measurement an image column reads, if any.
function imageMeasurementState(
  snapshot: CellImageMeasurementsSnapshot,
  columnId: string,
) {
  const key = snapshot.keyFor(columnId)
  return key === undefined ? undefined : snapshot.state(key)
}

// An image column from a link before the image has loaded.
function isImageColumnWaiting(
  columnId: string,
  imageChannels: readonly CellQueryImageChannel[],
): boolean {
  return parseImageColumnId(columnId) !== null && imageChannels.length === 0
}

// Cells outside the image get no value (26-D3); one note per channel.
function imageOutsideNotes(
  columnIds: readonly string[],
  columns: ReadonlyMap<string, CellQueryColumn | null>,
  snapshot: CellImageMeasurementsSnapshot,
  channels: readonly CellQueryImageChannelOption[],
  noun: string,
): readonly string[] {
  const notes = new Map<string, string>()
  for (const id of columnIds) {
    const source = columns.get(id)?.source
    if (source?.kind !== 'image' || notes.has(source.spec.channelId)) continue
    const state = imageMeasurementState(snapshot, id)
    if (state?.status !== 'ready' || state.result.cellsWithoutValue === 0) continue
    const name =
      channels.find((channel) => channel.id === source.spec.channelId)?.name ??
      source.spec.channelId
    notes.set(
      source.spec.channelId,
      `${state.result.cellsWithoutValue.toLocaleString()} ${noun} have no ${name} value: they are outside the image, or cover no pixel at this resolution.`,
    )
  }
  return [...notes.values()]
}

function isImportedSetColumn(columnId: string): boolean {
  return columnId.startsWith(setColumnId('custom:'))
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)]
}

// JSON drops Infinity; the run key keeps it.
function numbersInJson(_key: string, value: unknown): unknown {
  return typeof value === 'number' && !Number.isFinite(value) ? String(value) : value
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof Error || error instanceof DOMException) &&
    error.name === 'AbortError'
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
