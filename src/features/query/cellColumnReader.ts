import type { Annotation } from '../../data/annotation'
import type {
  ContinuousCellMetadataTrack,
  ContinuousCellMetadataValue,
} from '../../data/customAnnotations'
import type { IdLookup } from '../../data/lazyIdLookup'
import type { OverviewCellDatum } from '../../rendering/deckLayerTypes'
import { isAbortError } from '../../utils/abort'
import { abortable } from '../../utils/abortable'
import type { CellQueryColumnRequest } from '../../workers/cellQueryMessages'
import { annotationSetGrouping } from '../annotations/annotationModel'
import type { CellMetadataTrackValuesLoader } from '../annotations/useCellMetadataTrackValues'
import type { AnnotationLoader } from '../app-shell/appDependencies'
import type { AppendDebugEvent } from '../app-shell/appRuntimeModel'
import { datasetSetGroupId, type PlotSavedSelection } from '../plots/plotsPanelModel'
import type { CellImageMeasurementsSnapshot } from './cellImageMeasurements'
import type { CellQueryClassInput } from './cellQuery'
import { formatCellImageReadSize } from './cellQueryImage'
import {
  overviewNumberColumn,
  overviewSegmentationColumn,
  type CellQueryColumn,
  type overviewCellColumns,
} from './cellQueryModel'

// The values of Cell Query's columns (plan 23-D2), outside React so the
// Python console (plan 29-B) reads them as the window does. The overview's
// columns, imported sets and tracks read so far are at hand; a dataset set
// Clusters has not loaded, or a track whose values were not read, is read
// the first time a column needs it and kept for the dataset. A failed read
// is kept only while it is needed: once nothing needs it, needing it again
// reads it again. Another dataset starts empty and stops the reads in
// flight.

export type OnDemandLoad<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'error'; readonly message: string }

export interface CellQueryClassOption {
  readonly id: string
  readonly label: string
  // Cells in the class, where known.
  readonly count: number | null
}

export type CellColumnState =
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

// The reads for one dataset so far; a new object whenever one changes.
export interface CellColumnLoads {
  readonly url: string | null
  readonly sets: ReadonlyMap<string, OnDemandLoad<readonly Annotation<string>[]>>
  readonly tracks: ReadonlyMap<
    string,
    OnDemandLoad<readonly ContinuousCellMetadataValue[]>
  >
}

type PlacedCellIds = Pick<IdLookup<true>, 'has' | 'size'>

export interface CellColumnContext {
  readonly datasetUrl: string | null
  readonly cells: readonly OverviewCellDatum[]
  // The IDs on the map, which a class's count is of.
  readonly placedCellIds: PlacedCellIds
  readonly cellColumns: ReturnType<typeof overviewCellColumns>
  readonly annotations: readonly Annotation<string>[]
  readonly savedSelections: readonly PlotSavedSelection[]
  readonly metadataTracks: readonly ContinuousCellMetadataTrack[]
  readonly loads: CellColumnLoads
  readonly imageSnapshot: CellImageMeasurementsSnapshot
  // Image columns past the three channels measured at once, and why.
  readonly imageOverLimit: ReadonlyMap<string, string>
}

export interface CellColumnLoaders {
  readonly loadSetAnnotations: AnnotationLoader
  readonly loadMetadataTrackValues: CellMetadataTrackValuesLoader
  readonly appendDebugEvent: AppendDebugEvent
}

// What columns read on demand: dataset sets by group and tracks whose
// values were not read with the dataset.
export interface CellColumnNeeds {
  readonly setGroupIds: readonly string[]
  readonly trackIds: readonly string[]
}

export function cellColumnNeeds(
  columns: readonly CellQueryColumn[],
  metadataTracks: readonly ContinuousCellMetadataTrack[],
): CellColumnNeeds {
  return {
    setGroupIds: columns.flatMap((column) =>
      column.source.kind === 'set' && column.source.setKind === 'dataset'
        ? [datasetSetGroupId(column.source.setId) ?? '']
        : [],
    ),
    trackIds: columns.flatMap(({ source }) =>
      source.kind === 'track' &&
      metadataTracks.find((track) => track.id === source.trackId)?.values === null
        ? [source.trackId]
        : [],
    ),
  }
}

// Until `setLoaders`: reads fail, and nothing is logged.
const NO_LOADERS: CellColumnLoaders = {
  loadSetAnnotations: () => Promise.reject(new Error('The dataset is not open yet.')),
  loadMetadataTrackValues: () =>
    Promise.reject(new Error('The dataset is not open yet.')),
  appendDebugEvent: () => undefined,
}

const LOADING = { status: 'loading' } as const
const EMPTY_CLASSES: readonly CellQueryClassOption[] = []

export class CellColumnReader {
  #loaders: CellColumnLoaders
  readonly #sets: OnDemandLoads<readonly Annotation<string>[]>
  readonly #tracks: OnDemandLoads<readonly ContinuousCellMetadataValue[]>
  readonly #listeners = new Set<() => void>()
  #snapshot: CellColumnLoads = { url: null, sets: new Map(), tracks: new Map() }

  constructor(loaders: CellColumnLoaders = NO_LOADERS) {
    this.#loaders = loaders
    const changed = () => {
      this.#changed()
    }
    this.#sets = new OnDemandLoads(
      (url, groupId, signal) =>
        this.#loaders.loadSetAnnotations(url, { groupId, signal }),
      (groupId) => `annotation set ${groupId}`,
      (message) => {
        this.#loaders.appendDebugEvent(message)
      },
      changed,
    )
    this.#tracks = new OnDemandLoads(
      (url, trackId, signal) =>
        this.#loaders.loadMetadataTrackValues(url, trackId, { signal }),
      (trackId) => `metadata track ${trackId}`,
      (message) => {
        this.#loaders.appendDebugEvent(message)
      },
      changed,
    )
  }

  // Later reads use these; reads in flight keep theirs.
  setLoaders(loaders: CellColumnLoaders): void {
    this.#loaders = loaders
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  readonly getSnapshot = (): CellColumnLoads => this.#snapshot

  // The dataset the reads are for, and what the columns in use need: read
  // when `read` is set (the window is open), and failed reads nothing needs
  // any more forgotten.
  sync(url: string | null, needs: CellColumnNeeds, read: boolean): void {
    this.#sets.setDataset(url)
    this.#tracks.setDataset(url)
    this.#sets.retain(needs.setGroupIds)
    this.#tracks.retain(needs.trackIds)
    if (!read) return
    for (const groupId of needs.setGroupIds) this.#sets.start(groupId)
    for (const trackId of needs.trackIds) this.#tracks.start(trackId)
  }

  // A column's values, reading what it needs first; a failed read is tried
  // again. Rejects when the column cannot be read, or is still measuring.
  // The reads are shared: `signal` stops the wait, not the read.
  async read(
    column: CellQueryColumn,
    context: () => Omit<CellColumnContext, 'loads'>,
    signal?: AbortSignal,
  ): Promise<CellQueryColumnRequest> {
    if (this.#sets.url === null) throw new Error('No dataset is open.')
    const needs = cellColumnNeeds([column], context().metadataTracks)
    const reads = await abortable(
      Promise.allSettled([
        ...needs.setGroupIds.map((groupId) => this.#sets.load(groupId)),
        ...needs.trackIds.map((trackId) => this.#tracks.load(trackId)),
      ]),
      signal,
    )
    // Another dataset opened while reading.
    for (const read of reads) {
      if (read.status === 'rejected' && isAbortError(read.reason)) throw read.reason
    }
    const state = cellColumnState(column, { ...context(), loads: this.#snapshot })
    switch (state.status) {
      case 'ready':
        return state.request()
      case 'error':
        throw new Error(state.message)
      case 'waiting':
        throw new Error(`${column.label} is waiting to be measured.`)
      case 'loading':
        throw new Error(`${column.label} is still being read.`)
    }
  }

  // Stops the reads in flight and forgets them.
  dispose(): void {
    this.#sets.setDataset(null)
    this.#tracks.setDataset(null)
  }

  #changed(): void {
    this.#snapshot = {
      url: this.#sets.url,
      sets: this.#sets.snapshot(),
      tracks: this.#tracks.snapshot(),
    }
    for (const listener of this.#listeners) listener()
  }
}

// Keyed reads for one dataset.
class OnDemandLoads<T> {
  #url: string | null = null
  readonly #loads = new Map<string, OnDemandLoad<T>>()
  readonly #inFlight = new Map<
    string,
    { readonly controller: AbortController; readonly promise: Promise<T> }
  >()

  constructor(
    private readonly read: (url: string, key: string, signal: AbortSignal) => Promise<T>,
    // Names a key in the debug log, such as "annotation set leiden".
    private readonly describe: (key: string) => string,
    private readonly log: (message: string) => void,
    private readonly onChange: () => void,
  ) {}

  get url(): string | null {
    return this.#url
  }

  snapshot(): ReadonlyMap<string, OnDemandLoad<T>> {
    return new Map(this.#loads)
  }

  // Tells only when reads are forgotten, so opening a dataset with nothing
  // read renders nothing; until a read settles, the snapshot's URL is the
  // old one, and its reads count as not started.
  setDataset(url: string | null): void {
    if (url === this.#url) return
    for (const { controller } of this.#inFlight.values()) controller.abort()
    this.#inFlight.clear()
    const forgotten = this.#loads.size > 0
    this.#loads.clear()
    this.#url = url
    if (forgotten) this.onChange()
  }

  retain(keys: readonly string[]): void {
    const needed = new Set(keys)
    let dropped = false
    for (const [key, load] of this.#loads) {
      if (load.status === 'error' && !needed.has(key)) {
        this.#loads.delete(key)
        dropped = true
      }
    }
    if (dropped) this.onChange()
  }

  // Starts reading `key` unless it is read, being read, or failed.
  start(key: string): void {
    if (this.#url === null || this.#inFlight.has(key) || this.#loads.has(key)) return
    void this.#begin(this.#url, key)
  }

  // `key`'s value: the one read, the read in flight, or a new read, a
  // failed one included.
  load(key: string): Promise<T> {
    if (this.#url === null) return Promise.reject(new Error('No dataset is open.'))
    const inFlight = this.#inFlight.get(key)
    if (inFlight !== undefined) return inFlight.promise
    const known = this.#loads.get(key)
    if (known?.status === 'ready') return Promise.resolve(known.value)
    if (known !== undefined) {
      this.#loads.delete(key)
      this.onChange()
    }
    return this.#begin(this.#url, key)
  }

  #begin(url: string, key: string): Promise<T> {
    const controller = new AbortController()
    this.log(`Cell query: reading ${this.describe(key)}`)

    const settle = (loaded: OnDemandLoad<T>): boolean => {
      if (this.#inFlight.get(key)?.controller !== controller) return false
      this.#inFlight.delete(key)
      this.#loads.set(key, loaded)
      this.onChange()
      return true
    }
    const promise = this.read(url, key, controller.signal).then(
      (value) => {
        if (!settle({ status: 'ready', value })) throw abortedRead()
        return value
      },
      (error: unknown) => {
        if (controller.signal.aborted) throw abortedRead()
        const message = error instanceof Error ? error.message : String(error)
        if (settle({ status: 'error', message })) {
          this.log(`Cell query: ${this.describe(key)} failed: ${message}`)
        }
        throw error
      },
    )
    // Callers that never wait, such as the window, leave nothing unhandled.
    promise.catch(() => undefined)
    this.#inFlight.set(key, { controller, promise })
    return promise
  }
}

function abortedRead(): Error {
  const error = new Error('Another dataset was opened.')
  error.name = 'AbortError'
  return error
}

// A column's values as the query worker takes them, once they are known.
export function cellColumnState(
  column: CellQueryColumn,
  context: CellColumnContext,
): CellColumnState {
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

  // Reads for another dataset count as not started.
  const loads = context.loads.url === context.datasetUrl ? context.loads : null

  if (source.kind === 'track') {
    const track = context.metadataTracks.find(
      (candidate) => candidate.id === source.trackId,
    )
    if (track === undefined) {
      return { status: 'error', message: 'The dataset no longer lists this column.' }
    }
    const load =
      track.values === null ? (loads?.tracks.get(track.id) ?? LOADING) : undefined
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

    return classesState(
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
    const load = loads?.sets.get(groupId)
    if (load === undefined || load.status === 'loading') return { status: 'loading' }
    if (load.status === 'error') return { status: 'error', message: load.message }
    return classesState(column.id, context.placedCellIds, setClasses(load.value))
  }

  return classesState(
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
function classesState(
  columnId: string,
  placedCellIds: PlacedCellIds,
  classes: readonly CellQueryClassInput[],
): CellColumnState {
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

// Ids for objects, so a key changes when a list is replaced.
const objectIds = new WeakMap<object, number>()
let nextObjectId = 0

export function objectId(value: object): number {
  let id = objectIds.get(value)
  if (id === undefined) {
    nextObjectId += 1
    id = nextObjectId
    objectIds.set(value, id)
  }
  return id
}
