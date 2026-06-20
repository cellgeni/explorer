import { isGeneFeature } from './geneFeatures'
import type { CellFeatureMatrixReadOptions, GexCell, GexResult } from './gexTypes'
import type {
  VisiumFeatureSliceWorkerRequest,
  VisiumFeatureSliceWorkerResponse,
  VisiumFeatureSliceWorkerSuccess,
} from '../workers/visiumFeatureSliceMessages'

type NumericArrayLike =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | BigInt64Array
  | BigUint64Array
  | Float32Array
  | Float64Array

export interface H5FileLike {
  get(path: string): unknown
  get_attribute(name: string, jsonCompatible: false): unknown
}

interface H5GroupLike {
  get(path: string): unknown
}

interface H5DatasetLike {
  readonly value: unknown
}

interface VisiumFeatureSliceCache {
  readonly file: H5FileLike
  readonly metadata: VisiumFeatureSliceMetadata
  readonly featureNames: readonly string[]
  readonly featureTypes: readonly string[]
  readonly geneFeaturesByKey: ReadonlyMap<string, VisiumFeatureSliceFeature>
}

interface VisiumFeatureSliceFeature {
  readonly index: number
  readonly name: string
}

export interface VisiumFeatureSliceMetadata {
  readonly nrows: number
  readonly ncols: number
  readonly spotPitchMicrometers: number
}

export interface VisiumFeatureSliceTarget<ElementId extends string = string> {
  readonly id: ElementId
  readonly row: number
  readonly col: number
}

export type VisiumFeatureSliceBackend = 'full-file' | 'lazy-range-worker'

export interface VisiumFeatureSliceWorkerLike {
  onmessage: ((event: MessageEvent<VisiumFeatureSliceWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: VisiumFeatureSliceWorkerRequest): void
  terminate(): void
}

export type VisiumFeatureSliceWorkerFactory = () => VisiumFeatureSliceWorkerLike

export interface VisiumFeatureSliceH5FileReadOptions {
  readonly binSizeMicrometers: number
  readonly signal?: AbortSignal
  readonly onStageTiming?: CellFeatureMatrixReadOptions['onStageTiming']
}

export interface VisiumFeatureSliceReadOptions extends CellFeatureMatrixReadOptions {
  readonly binSizeMicrometers: number
  readonly fetcher?: typeof fetch
  readonly backend?: VisiumFeatureSliceBackend
  readonly workerFactory?: VisiumFeatureSliceWorkerFactory
}

export class FeatureSliceFullFileBudgetExceededError extends Error {
  override readonly name = 'FeatureSliceFullFileBudgetExceededError'

  constructor(
    readonly url: string,
    readonly byteLength: number,
    readonly maxBytes: number,
  ) {
    super(
      `Feature Slice H5 is ${formatByteCount(
        byteLength,
      )}, exceeding the interactive full-file budget of ${formatByteCount(maxBytes)}.`,
    )
  }
}

const METADATA_JSON_ATTR_NAME = 'metadata_json'
const FEATURE_SLICES_GROUP_NAME = '/feature_slices'
const FEATURE_NAME_DATASET = '/features/name'
const FEATURE_TYPE_DATASET = '/features/feature_type'
const featureSliceCache = new Map<string, Promise<VisiumFeatureSliceCache>>()
let nextFeatureSliceWorkerRequestId = 1

export async function gexFromVisiumFeatureSliceH5<ElementId extends string>(
  url: string,
  targets: readonly VisiumFeatureSliceTarget<ElementId>[],
  genes: readonly string[],
  options: VisiumFeatureSliceReadOptions,
): Promise<GexResult<ElementId>> {
  const selectedGenes = normalizeSelectedGeneList(genes)

  if (targets.length === 0 || selectedGenes.length === 0) {
    return {
      geneNames: selectedGenes,
      cells: emptyCellsFor(targets),
    }
  }

  if ((options.backend ?? 'full-file') === 'lazy-range-worker') {
    return gexFromVisiumFeatureSliceLazyRangeWorker(url, targets, selectedGenes, options)
  }

  const metadataStartedAt = Date.now()
  const matrix = await loadVisiumFeatureSliceH5(url, options)
  options.onStageTiming?.({
    stage: 'matrix-read',
    label: 'Feature Slice H5 metadata',
    durationMs: elapsedMs(metadataStartedAt),
    detail: `${matrix.featureNames.length.toLocaleString()} features`,
  })
  throwIfAborted(options.signal)

  return gexFromVisiumFeatureSliceLoadedH5(matrix, targets, selectedGenes, options)
}

export function gexFromVisiumFeatureSliceH5File<ElementId extends string>(
  file: H5FileLike,
  targets: readonly VisiumFeatureSliceTarget<ElementId>[],
  genes: readonly string[],
  options: VisiumFeatureSliceH5FileReadOptions,
): GexResult<ElementId> {
  const selectedGenes = normalizeSelectedGeneList(genes)

  if (targets.length === 0 || selectedGenes.length === 0) {
    return {
      geneNames: selectedGenes,
      cells: emptyCellsFor(targets),
    }
  }

  const metadataStartedAt = Date.now()
  const matrix = createVisiumFeatureSliceCache(file)
  options.onStageTiming?.({
    stage: 'matrix-read',
    label: 'Feature Slice H5 metadata',
    durationMs: elapsedMs(metadataStartedAt),
    detail: `${matrix.featureNames.length.toLocaleString()} features`,
  })
  throwIfAborted(options.signal)

  return gexFromVisiumFeatureSliceLoadedH5(matrix, targets, selectedGenes, options)
}

function gexFromVisiumFeatureSliceLoadedH5<ElementId extends string>(
  matrix: VisiumFeatureSliceCache,
  targets: readonly VisiumFeatureSliceTarget<ElementId>[],
  selectedGenes: readonly string[],
  options: VisiumFeatureSliceH5FileReadOptions,
): GexResult<ElementId> {
  const binningScale = featureSliceBinningScale(
    options.binSizeMicrometers,
    matrix.metadata.spotPitchMicrometers,
  )
  const targetIdsByBinnedPosition = targetIdsByPosition(targets)
  const cells = emptyMutableCellsFor(targets)
  const readStartedAt = Date.now()
  let matchedFeatureCount = 0

  for (const selectedGene of selectedGenes) {
    const feature = matrix.geneFeaturesByKey.get(selectedGene.toLowerCase())

    if (feature === undefined) {
      continue
    }

    const group = readOptionalH5Group(
      matrix.file,
      `${FEATURE_SLICES_GROUP_NAME}/${feature.index}`,
    )

    if (group === null) {
      continue
    }

    matchedFeatureCount += 1
    accumulateFeatureSliceGroup({
      group,
      gene: feature.name,
      binningScale,
      targetIdsByBinnedPosition,
      cells,
    })
    throwIfAborted(options.signal)
  }

  options.onStageTiming?.({
    stage: 'matrix-read',
    label: 'Feature Slice H5 selected genes',
    durationMs: elapsedMs(readStartedAt),
    detail: `${matchedFeatureCount.toLocaleString()} genes, ${targets.length.toLocaleString()} bins`,
  })

  return {
    geneNames: selectedGenes,
    cells,
  }
}

async function gexFromVisiumFeatureSliceLazyRangeWorker<ElementId extends string>(
  url: string,
  targets: readonly VisiumFeatureSliceTarget<ElementId>[],
  selectedGenes: readonly string[],
  options: VisiumFeatureSliceReadOptions,
): Promise<GexResult<ElementId>> {
  const worker = (options.workerFactory ?? createDefaultFeatureSliceWorker)()
  const requestId = nextFeatureSliceWorkerRequestId
  nextFeatureSliceWorkerRequestId += 1
  const startedAt = Date.now()
  const request: VisiumFeatureSliceWorkerRequest = {
    id: requestId,
    url,
    targets: targets.map((target) => ({
      id: target.id,
      row: target.row,
      col: target.col,
    })),
    genes: selectedGenes,
    binSizeMicrometers: options.binSizeMicrometers,
  }
  const signal = options.signal

  if (signal?.aborted === true) {
    worker.terminate()
    throw abortError(signal)
  }

  return new Promise((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      if (signal !== undefined) {
        signal.removeEventListener('abort', handleAbort)
      }

      worker.terminate()
    }
    const settle = (callback: () => void) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      callback()
    }
    const handleAbort = () => {
      if (signal === undefined) {
        return
      }

      settle(() => {
        reject(abortError(signal))
      })
    }

    worker.onmessage = (event) => {
      const response = event.data

      if (response.id !== requestId) {
        return
      }

      if (response.ok) {
        settle(() => {
          options.onStageTiming?.({
            stage: 'matrix-read',
            label: 'Feature Slice H5 lazy range read',
            durationMs: elapsedMs(startedAt),
            detail: `${selectedGenes.length.toLocaleString()} genes, ${targets.length.toLocaleString()} bins`,
          })
          resolve(gexResultFromWorkerResponse(response, targets))
        })
        return
      }

      settle(() => {
        const error = new Error(response.error)
        error.name = response.errorName ?? 'FeatureSliceLazyRangeWorkerError'
        reject(error)
      })
    }
    worker.onerror = (event) => {
      settle(() => {
        reject(new Error(event.message || 'Feature Slice H5 worker failed.'))
      })
    }

    if (signal !== undefined) {
      signal.addEventListener('abort', handleAbort, { once: true })
    }

    try {
      worker.postMessage(request)
    } catch (cause) {
      settle(() => {
        reject(cause instanceof Error ? cause : new Error(String(cause)))
      })
    }
  })
}

function gexResultFromWorkerResponse<ElementId extends string>(
  response: VisiumFeatureSliceWorkerSuccess,
  targets: readonly VisiumFeatureSliceTarget<ElementId>[],
): GexResult<ElementId> {
  const cells = emptyMutableCellsFor(targets)

  for (const cell of response.cells) {
    cells.set(cell.id as ElementId, {
      geneNames: [...cell.geneNames],
      counts: [...cell.counts],
    })
  }

  return {
    geneNames: [...response.geneNames],
    cells,
  }
}

function createDefaultFeatureSliceWorker(): VisiumFeatureSliceWorkerLike {
  if (typeof Worker === 'undefined') {
    throw new Error('Feature Slice H5 lazy range reads require browser Worker support.')
  }

  return new Worker(new URL('../workers/visiumFeatureSlice.worker.ts', import.meta.url), {
    type: 'module',
  })
}

export function parseVisiumFeatureSliceMetadata(
  value: unknown,
): VisiumFeatureSliceMetadata {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value

  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('Expected feature_slice.h5 metadata_json to be an object.')
  }

  const source = parsed as Record<string, unknown>

  return {
    nrows: readFiniteNumber(source, 'nrows'),
    ncols: readFiniteNumber(source, 'ncols'),
    spotPitchMicrometers: readFiniteNumber(source, 'spot_pitch'),
  }
}

export function featureSliceBinningScale(
  binSizeMicrometers: number,
  spotPitchMicrometers: number,
): number {
  if (!Number.isFinite(binSizeMicrometers) || binSizeMicrometers <= 0) {
    throw new RangeError('Feature Slice bin size must be a positive finite number.')
  }

  if (!Number.isFinite(spotPitchMicrometers) || spotPitchMicrometers <= 0) {
    throw new RangeError('Feature Slice spot pitch must be a positive finite number.')
  }

  const scale = binSizeMicrometers / spotPitchMicrometers
  const roundedScale = Math.round(scale)

  if (Math.abs(scale - roundedScale) > 1e-6 || roundedScale < 1) {
    throw new RangeError(
      `Feature Slice bin size ${binSizeMicrometers} cannot be represented as an integer multiple of the ${spotPitchMicrometers} µm source pitch.`,
    )
  }

  return roundedScale
}

function accumulateFeatureSliceGroup<ElementId extends string>({
  group,
  gene,
  binningScale,
  targetIdsByBinnedPosition,
  cells,
}: {
  readonly group: H5GroupLike
  readonly gene: string
  readonly binningScale: number
  readonly targetIdsByBinnedPosition: ReadonlyMap<string, ElementId>
  readonly cells: Map<ElementId, { geneNames: string[]; counts: number[] }>
}): void {
  const rows = readNumericDataset(group, 'row')
  const cols = readNumericDataset(group, 'col')
  const data = readNumericDataset(group, 'data')
  const length = Math.min(rows.length, cols.length, data.length)

  for (let index = 0; index < length; index += 1) {
    const sourceRow = readNumericArrayValue(rows, index)
    const sourceCol = readNumericArrayValue(cols, index)
    const count = readNumericArrayValue(data, index)

    if (count <= 0) {
      continue
    }

    const binnedRow = Math.floor(sourceRow / binningScale)
    const binnedCol = Math.floor(sourceCol / binningScale)
    const targetId = targetIdsByBinnedPosition.get(positionKey(binnedRow, binnedCol))

    if (targetId === undefined) {
      continue
    }

    appendGeneCount(cells.get(targetId), gene, count)
  }
}

function appendGeneCount(
  cell: { geneNames: string[]; counts: number[] } | undefined,
  gene: string,
  count: number,
): void {
  if (cell === undefined) {
    return
  }

  const existingIndex = cell.geneNames.indexOf(gene)

  if (existingIndex >= 0) {
    cell.counts[existingIndex] = (cell.counts[existingIndex] ?? 0) + count
    return
  }

  cell.geneNames.push(gene)
  cell.counts.push(count)
}

function loadVisiumFeatureSliceH5(
  url: string,
  options: VisiumFeatureSliceReadOptions,
): Promise<VisiumFeatureSliceCache> {
  const cached = featureSliceCache.get(url)

  if (cached !== undefined) {
    return cached
  }

  const promise = loadVisiumFeatureSliceH5Uncached(url, options).catch(
    (error: unknown) => {
      if (featureSliceCache.get(url) === promise) {
        featureSliceCache.delete(url)
      }

      throw error
    },
  )

  featureSliceCache.set(url, promise)
  return promise
}

async function loadVisiumFeatureSliceH5Uncached(
  url: string,
  options: VisiumFeatureSliceReadOptions,
): Promise<VisiumFeatureSliceCache> {
  if (options.maxFullFileBytes !== undefined) {
    await assertFeatureSliceFullFileReadWithinBudget(
      url,
      options.maxFullFileBytes,
      options.fetcher,
      options.signal,
    )
  }

  const h5wasm = (await import('h5wasm')).default
  const { FS } = await h5wasm.ready
  throwIfAborted(options.signal)

  const response = await (options.fetcher ?? fetch)(url, {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })

  if (!response.ok) {
    throw new Error(`feature_slice.h5 returned HTTP ${response.status}.`)
  }

  const bytes = new Uint8Array(await response.arrayBuffer())
  throwIfAborted(options.signal)

  const fileName = `/visium-feature-slice-${hashString(url)}.h5`
  try {
    FS.unlink(fileName)
  } catch {
    // The file is only present when this URL was loaded in a previous app session.
  }

  FS.writeFile(fileName, bytes)

  try {
    const file = new h5wasm.File(fileName, 'r') as H5FileLike
    return createVisiumFeatureSliceCache(file)
  } catch (error) {
    try {
      FS.unlink(fileName)
    } catch {
      // Best-effort cleanup; the original error is more useful.
    }

    throw error
  }
}

function createVisiumFeatureSliceCache(file: H5FileLike): VisiumFeatureSliceCache {
  const metadata = parseVisiumFeatureSliceMetadata(
    file.get_attribute(METADATA_JSON_ATTR_NAME, false),
  )
  const featureNames = expectStringArray(
    readH5Dataset(file, FEATURE_NAME_DATASET).value,
    FEATURE_NAME_DATASET,
  )
  const featureTypes = expectStringArray(
    readH5Dataset(file, FEATURE_TYPE_DATASET).value,
    FEATURE_TYPE_DATASET,
  )

  return {
    file,
    metadata,
    featureNames,
    featureTypes,
    geneFeaturesByKey: geneFeaturesByKey(featureNames, featureTypes),
  }
}

async function assertFeatureSliceFullFileReadWithinBudget(
  url: string,
  maxBytes: number,
  fetcher: typeof fetch | undefined,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (!Number.isFinite(maxBytes) || maxBytes < 0) {
    throw new RangeError(`Feature Slice full-file budget must be non-negative.`)
  }

  const response = await (fetcher ?? fetch)(url, {
    method: 'HEAD',
    ...(signal === undefined ? {} : { signal }),
  })

  if (!response.ok) {
    throw new Error(`feature_slice.h5 HEAD returned HTTP ${response.status}.`)
  }

  const contentLength = response.headers.get('content-length')

  if (contentLength === null) {
    throw new Error(
      'Feature Slice H5 size is not exposed through Content-Length, so the interactive full-file read budget cannot be verified.',
    )
  }

  const byteLength = Number(contentLength)

  if (!Number.isFinite(byteLength) || byteLength < 0) {
    throw new Error(`Feature Slice H5 returned invalid Content-Length ${contentLength}.`)
  }

  if (byteLength > maxBytes) {
    throw new FeatureSliceFullFileBudgetExceededError(url, byteLength, maxBytes)
  }
}

function geneFeaturesByKey(
  featureNames: readonly string[],
  featureTypes: readonly string[],
): ReadonlyMap<string, VisiumFeatureSliceFeature> {
  const features = new Map<string, VisiumFeatureSliceFeature>()

  for (let index = 0; index < featureNames.length; index += 1) {
    const name = featureNames[index]

    if (name === undefined || !isGeneFeature(name, featureTypes[index])) {
      continue
    }

    const key = name.toLowerCase()

    if (!features.has(key)) {
      features.set(key, { index, name })
    }
  }

  return features
}

function targetIdsByPosition<ElementId extends string>(
  targets: readonly VisiumFeatureSliceTarget<ElementId>[],
): ReadonlyMap<string, ElementId> {
  const ids = new Map<string, ElementId>()

  for (const target of targets) {
    ids.set(positionKey(target.row, target.col), target.id)
  }

  return ids
}

function positionKey(row: number, col: number): string {
  return `${row}:${col}`
}

function emptyCellsFor<ElementId extends string>(
  targets: readonly VisiumFeatureSliceTarget<ElementId>[],
): ReadonlyMap<ElementId, GexCell> {
  return emptyMutableCellsFor(targets)
}

function emptyMutableCellsFor<ElementId extends string>(
  targets: readonly VisiumFeatureSliceTarget<ElementId>[],
): Map<ElementId, { geneNames: string[]; counts: number[] }> {
  return new Map(targets.map((target) => [target.id, { geneNames: [], counts: [] }]))
}

function normalizeSelectedGeneList(genes: readonly string[]): readonly string[] {
  const selectedGenes: string[] = []
  const seenGenes = new Set<string>()

  for (const gene of genes) {
    const normalizedGene = gene.trim()
    const key = normalizedGene.toLowerCase()

    if (normalizedGene.length === 0 || seenGenes.has(key)) {
      continue
    }

    selectedGenes.push(normalizedGene)
    seenGenes.add(key)
  }

  return selectedGenes
}

function readNumericDataset(group: H5GroupLike, name: string): NumericArrayLike {
  return expectNumericArrayLike(readH5Dataset(group, name).value, name)
}

function readH5Dataset(group: H5GroupLike, path: string): H5DatasetLike {
  return expectH5Dataset(group.get(path), path)
}

function readOptionalH5Group(group: H5GroupLike, path: string): H5GroupLike | null {
  const value = group.get(path)

  if (value === null || value === undefined) {
    return null
  }

  return expectH5Group(value, path)
}

function expectH5Group(value: unknown, path: string): H5GroupLike {
  if (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { get?: unknown }).get === 'function'
  ) {
    return value as H5GroupLike
  }

  throw new Error(`Expected ${path} to be an HDF5 group.`)
}

function expectH5Dataset(value: unknown, path: string): H5DatasetLike {
  if (value !== null && typeof value === 'object' && 'value' in value) {
    return value as H5DatasetLike
  }

  throw new Error(`Expected ${path} to be an HDF5 dataset.`)
}

function expectStringArray(value: unknown, path: string): readonly string[] {
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value
  }

  throw new Error(`Expected ${path} to be a string dataset.`)
}

function expectNumericArrayLike(value: unknown, path: string): NumericArrayLike {
  if (
    value instanceof Int8Array ||
    value instanceof Uint8Array ||
    value instanceof Int16Array ||
    value instanceof Uint16Array ||
    value instanceof Int32Array ||
    value instanceof Uint32Array ||
    value instanceof BigInt64Array ||
    value instanceof BigUint64Array ||
    value instanceof Float32Array ||
    value instanceof Float64Array
  ) {
    return value
  }

  throw new Error(`Expected ${path} to be a numeric typed-array dataset.`)
}

function readNumericArrayValue(array: NumericArrayLike, index: number): number {
  const value = array[index]

  if (typeof value === 'bigint') {
    return Number(value)
  }

  return value ?? 0
}

function readFiniteNumber(source: Record<string, unknown>, key: string): number {
  const value = source[key]

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  throw new Error(`Expected feature_slice.h5 metadata_json ${key} to be a number.`)
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortError(signal)
  }
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason
  }

  const error = new Error('Feature Slice H5 request aborted.')
  error.name = 'AbortError'
  return error
}

function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt
}

function hashString(value: string): string {
  let hash = 0

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }

  return hash.toString(16)
}

function formatByteCount(byteLength: number): string {
  if (byteLength >= 1024 * 1024 * 1024) {
    return `${(byteLength / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  if (byteLength >= 1024 * 1024) {
    return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`
  }

  if (byteLength >= 1024) {
    return `${(byteLength / 1024).toFixed(1)} KB`
  }

  return `${byteLength.toLocaleString()} B`
}
