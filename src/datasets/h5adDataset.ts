import { micrometers, type BBox, type DataPoint } from '../data/coords'
import type { CellFeatureMatrixReadOptions, GexResult } from '../data/gex'
import type { RoiSelectionInput } from '../data/roiSelection'
import { normalizeRoiSelection } from '../data/roiSelection'
import { slug } from '../utils/slug'
import type { ContinuousCellMetadataTrack } from '../data/customAnnotations'
import type { CellOverviewPoint } from '../data/hyparquetCells'
import {
  analysisEmbeddingLabel,
  type AnalysisEmbedding,
} from '../data/analysisEmbeddings'
import type {
  Annotation,
  DatasetMeta,
  ElementBatch,
  ImageSource,
  SpatialDataset,
  SpatialElementId,
} from './spatialDataset'
import type { DatasetCell, GeneExpressionBatch } from './xeniumDataset'

export interface AnnDataH5adDatasetOptions {
  readonly url: string
  readonly fetcher?: typeof fetch
}

interface H5adCache {
  readonly url: string
  readonly cellIds: readonly string[]
  readonly geneNames: readonly string[]
  readonly coordinates: readonly DataPoint[]
  readonly embeddings: readonly AnalysisEmbedding[]
  readonly categoricalTracks: readonly H5adCategoricalTrack[]
  readonly continuousTracks: readonly H5adContinuousTrack[]
  readonly matrix: H5adMatrix
  readonly extent: BBox
}

interface H5adCategoricalTrack {
  readonly id: string
  readonly label: string
  readonly values: readonly (string | null)[]
}

interface H5adContinuousTrack {
  readonly id: string
  readonly label: string
  readonly values: readonly number[]
  readonly min: number
  readonly max: number
}

type H5adMatrix =
  | {
      readonly kind: 'dense'
      readonly values: NumericArrayLike
      readonly rows: number
      readonly cols: number
    }
  | {
      readonly kind: 'csr'
      readonly data: NumericArrayLike
      readonly indices: NumericArrayLike
      readonly indptr: NumericArrayLike
      readonly rows: number
      readonly cols: number
    }
  | {
      readonly kind: 'csc'
      readonly data: NumericArrayLike
      readonly indices: NumericArrayLike
      readonly indptr: NumericArrayLike
      readonly rows: number
      readonly cols: number
    }

type NumericArrayLike =
  | readonly number[]
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array

interface H5AttributeLike {
  readonly value: unknown
}

interface H5EntityLike {
  readonly attrs?: Readonly<Record<string, H5AttributeLike>>
}

interface H5DatasetLike extends H5EntityLike {
  readonly shape: readonly number[] | null
  readonly value: unknown
}

interface H5GroupLike extends H5EntityLike {
  keys(): string[]
  get(path: string): unknown
}

const DEFAULT_H5AD_UNITS = {
  dataUnit: 'micrometer',
  imageUnit: 'pixel',
  micrometersPerPixel: micrometers(1),
  origin: 'top-left',
  imageYAxis: 'down',
} as const

const H5AD_COORDINATE_KEYS = [
  'X_spatial',
  'spatial',
  'X_umap',
  'umap',
  'X_tsne',
  'X_tSNE',
  'tsne',
  'X_pca',
] as const

const H5AD_EMBEDDING_DISPLAY_KEYS = [
  'X_umap',
  'umap',
  'X_tsne',
  'X_tSNE',
  'tsne',
  'X_pca',
  'X_spatial',
  'spatial',
] as const

const H5AD_FETCH_TIMEOUT_MS = 60_000
const H5AD_MAX_FILE_BYTES = 300 * 1024 * 1024

export class H5adFileSizeLimitExceededError extends Error {
  readonly url: string
  readonly byteLength: number
  readonly maxBytes: number

  constructor(url: string, byteLength: number, maxBytes = H5AD_MAX_FILE_BYTES) {
    super(
      `H5AD file is ${formatByteCount(
        byteLength,
      )}, exceeding the browser load limit of ${formatByteCount(maxBytes)}.`,
    )
    this.name = 'H5adFileSizeLimitExceededError'
    this.url = url
    this.byteLength = byteLength
    this.maxBytes = maxBytes
  }
}

export class AnnDataH5adDataset implements SpatialDataset<SpatialElementId> {
  readonly url: string
  private readonly fetcher: typeof fetch
  private cachePromise: Promise<H5adCache> | null = null

  constructor(options: AnnDataH5adDatasetOptions) {
    this.url = options.url
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  }

  async meta(): Promise<DatasetMeta> {
    const cache = await this.cache()

    return {
      platform: 'h5ad',
      units: DEFAULT_H5AD_UNITS,
      extent: cache.extent,
      capabilities: {
        transcripts: false,
        cellBoundaries: false,
        pyramidImage: false,
        multiChannel: false,
      },
    }
  }

  elements(): Promise<ElementBatch<SpatialElementId>> {
    return Promise.resolve({ elements: [] })
  }

  async overview(): Promise<readonly CellOverviewPoint[]> {
    const cache = await this.cache()

    return cache.cellIds.map((cellId, index) => ({
      cellId: cellId as never,
      position: cache.coordinates[index] ?? { x: micrometers(0), y: micrometers(0) },
      transcriptCount: 0,
      metadata: h5adCellMetadata(cache, index),
    }))
  }

  async matrix(ids: readonly SpatialElementId[]): Promise<GexResult<SpatialElementId>> {
    const cache = await this.cache()
    return h5adMatrixForCells(cache, ids, cache.geneNames)
  }

  async geneExpression(
    bbox: BBox,
    genes: readonly string[],
    options: CellFeatureMatrixReadOptions & { readonly limit?: number } = {},
  ): Promise<GeneExpressionBatch> {
    const cache = await this.cache()
    throwIfAborted(options.signal)
    const selectedCells = h5adCellsInBbox(cache, bbox, options.limit)
    const matrix = h5adMatrixForCells(
      cache,
      selectedCells.map((cell) => cell.id),
      genes,
    )
    const elements = selectedCells.map((cell) => {
      const expression = matrix.cells.get(cell.id)
      const count = expression?.counts.reduce((sum, value) => sum + value, 0) ?? 0

      return {
        id: cell.id,
        position: cell.position,
        count,
      }
    })
    let maxCount = 0

    for (const element of elements) {
      maxCount = Math.max(maxCount, element.count)
    }

    return {
      elements,
      genes,
      maxCount,
    }
  }

  async annotations(): Promise<readonly Annotation<SpatialElementId>[]> {
    const cache = await this.cache()
    const annotations: Annotation<SpatialElementId>[] = []

    for (const track of cache.categoricalTracks) {
      const cellIdsByLabel = new Map<string, string[]>()

      for (let index = 0; index < track.values.length; index += 1) {
        const label = track.values[index]
        const cellId = cache.cellIds[index]

        if (label === null || label === undefined || cellId === undefined) {
          continue
        }

        const cellIds = cellIdsByLabel.get(label) ?? []
        cellIds.push(cellId)
        cellIdsByLabel.set(label, cellIds)
      }

      for (const [label, cellIds] of cellIdsByLabel) {
        annotations.push({
          id: `analysis:${slug(track.label)}:${slug(label)}`,
          label: `${track.label}: ${label}`,
          cellIds,
        })
      }
    }

    return annotations
  }

  async metadataTracks(): Promise<readonly ContinuousCellMetadataTrack[]> {
    const cache = await this.cache()

    return cache.continuousTracks.map((track) => ({
      id: `h5ad:${slug(track.id)}`,
      label: track.label,
      values: track.values.map((value, index) => ({
        cellId: cache.cellIds[index] as never,
        value,
      })),
      min: track.min,
      max: track.max,
    }))
  }

  async embeddings(
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<readonly AnalysisEmbedding[]> {
    throwIfAborted(options.signal)
    const cache = await this.cache()
    throwIfAborted(options.signal)

    return cache.embeddings
  }

  async genePanel(): Promise<readonly string[]> {
    const cache = await this.cache()
    return cache.geneNames
  }

  async cells(
    selection: RoiSelectionInput,
    options: { readonly limit?: number } = {},
  ): Promise<readonly DatasetCell[]> {
    const cache = await this.cache()
    const normalizedSelection = normalizeRoiSelection(selection)
    const candidates = h5adCellsInBbox(cache, normalizedSelection.bbox, options.limit)
    const selected =
      normalizedSelection.kind === 'box'
        ? candidates
        : candidates.filter((cell) =>
            pointInPolygon(cell.position, normalizedSelection.points),
          )

    return selected.map((cell) => ({
      id: cell.id as never,
      position: cell.position,
    }))
  }

  image(): Promise<ImageSource | null> {
    return Promise.resolve(null)
  }

  private cache(): Promise<H5adCache> {
    if (this.cachePromise === null) {
      this.cachePromise = readH5ad(this.url, {
        fetcher: this.fetcher,
      }).catch((error: unknown) => {
        this.cachePromise = null
        throw error
      })
    }

    return this.cachePromise
  }
}

async function readH5ad(
  url: string,
  options: { readonly fetcher: typeof fetch },
): Promise<H5adCache> {
  const response = await fetchH5adFile(url, options.fetcher)

  if (!response.ok) {
    throw new Error(`H5AD file returned HTTP ${response.status}.`)
  }

  const bytes = await readH5adResponseBytes(url, response)
  const h5wasm = (await import('h5wasm')).default
  const { FS } = await h5wasm.ready
  const fileName = `/anndata-${hashString(url)}.h5ad`

  try {
    FS.unlink(fileName)
  } catch {
    // No previous virtual file exists for this H5AD URL.
  }

  FS.writeFile(fileName, bytes)

  const file = new h5wasm.File(fileName, 'r') as H5GroupLike & { close(): unknown }

  try {
    const obs = expectGroup(file.get('/obs'), '/obs')
    const varGroup = expectGroup(file.get('/var'), '/var')
    const cellIds = uniqueNames(
      readDataframeIndex(obs, 'obs').map((id, index) =>
        id.length === 0 ? `obs-${index}` : id,
      ),
      'obs',
    )
    const geneNames = uniqueNames(readGeneNames(varGroup), 'var')
    const embeddings = readObsmEmbeddings(file, cellIds)
    const coordinates = selectOverviewCoordinates(embeddings)
    const observationTracks = readObservationTracks(obs, cellIds.length)
    const matrix = readMatrix(file, cellIds.length, geneNames.length)

    return {
      url,
      cellIds,
      geneNames,
      coordinates,
      embeddings,
      categoricalTracks: observationTracks.categoricalTracks,
      continuousTracks: observationTracks.continuousTracks,
      matrix,
      extent: bboxForPoints(coordinates),
    }
  } catch (error) {
    try {
      file.close()
    } catch {
      // The schema error is more useful than cleanup failure.
    }
    throw error
  }
}

function readDataframeIndex(group: H5GroupLike, label: string): readonly string[] {
  const indexKey = readStringAttribute(group, '_index')
  const candidateKeys = [
    indexKey,
    '_index',
    'index',
    `${label}_names`,
    label === 'obs' ? 'cell_id' : 'gene_ids',
  ].filter((key): key is string => key !== undefined)

  for (const key of candidateKeys) {
    const dataset = group.get(key)

    if (isDataset(dataset)) {
      return readStringArray(dataset.value, `/${label}/${key}`)
    }
  }

  throw new Error(`H5AD /${label} dataframe does not expose a readable index column.`)
}

function readGeneNames(varGroup: H5GroupLike): readonly string[] {
  const indexNames = readDataframeIndex(varGroup, 'var')

  for (const key of ['gene_symbols', 'gene_symbol', 'feature_name', 'name']) {
    const dataset = varGroup.get(key)

    if (!isDataset(dataset)) {
      continue
    }

    const values = readStringArray(dataset.value, `/var/${key}`)

    if (values.length === indexNames.length && values.some((value) => value !== '')) {
      return values
    }
  }

  return indexNames
}

function readObsmEmbeddings(
  file: H5GroupLike,
  cellIds: readonly string[],
): readonly AnalysisEmbedding[] {
  const obsm = expectGroup(file.get('/obsm'), '/obsm')
  const embeddings: AnalysisEmbedding[] = []

  for (const key of obsm.keys()) {
    const dataset = obsm.get(key)

    if (!isDataset(dataset)) {
      continue
    }

    const embedding = readObsmEmbedding(key, dataset, cellIds)

    if (embedding === null) {
      continue
    }

    embeddings.push(embedding)
  }

  return embeddings.sort(compareH5adEmbeddings)
}

function readObsmEmbedding(
  key: string,
  dataset: H5DatasetLike,
  cellIds: readonly string[],
): AnalysisEmbedding | null {
  const shape = dataset.shape

  if (shape === null || shape.length !== 2) {
    return null
  }

  const rows = readShapeDimension(shape, 0, `/obsm/${key}`)
  const cols = readShapeDimension(shape, 1, `/obsm/${key}`)

  if (rows !== cellIds.length || cols < 2) {
    return null
  }

  const values = readNumericArray(dataset.value, `/obsm/${key}`)

  if (values.length < rows * cols) {
    throw new Error(`H5AD /obsm/${key} is shorter than its declared shape.`)
  }

  const points = cellIds.map((cellId, row) => {
    const x = numericValue(values, row * cols)
    const y = numericValue(values, row * cols + 1)

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`H5AD /obsm/${key} contains non-finite coordinates.`)
    }

    return { id: cellId, x, y }
  })

  return {
    kind: key,
    label: analysisEmbeddingLabel(key),
    sourcePath: `/obsm/${key}`,
    points,
  }
}

function selectOverviewCoordinates(
  embeddings: readonly AnalysisEmbedding[],
): readonly DataPoint[] {
  for (const key of H5AD_COORDINATE_KEYS) {
    const embedding = embeddings.find((candidate) => candidate.kind === key)

    if (embedding !== undefined) {
      return embedding.points.map((point) => ({
        x: micrometers(point.x),
        y: micrometers(point.y),
      }))
    }
  }

  throw new Error(
    `H5AD file needs a 2D coordinate matrix at one of ${H5AD_COORDINATE_KEYS.map(
      (key) => `/obsm/${key}`,
    ).join(', ')}.`,
  )
}

function compareH5adEmbeddings(
  left: AnalysisEmbedding,
  right: AnalysisEmbedding,
): number {
  const leftRank = h5adEmbeddingDisplayRank(left.kind)
  const rightRank = h5adEmbeddingDisplayRank(right.kind)

  if (leftRank !== rightRank) {
    return leftRank - rightRank
  }

  return left.kind.localeCompare(right.kind)
}

function h5adEmbeddingDisplayRank(kind: string): number {
  const index = H5AD_EMBEDDING_DISPLAY_KEYS.findIndex((key) => key === kind)
  return index < 0 ? H5AD_EMBEDDING_DISPLAY_KEYS.length : index
}

function readObservationTracks(
  obs: H5GroupLike,
  rowCount: number,
): {
  readonly categoricalTracks: readonly H5adCategoricalTrack[]
  readonly continuousTracks: readonly H5adContinuousTrack[]
} {
  const indexKey = readStringAttribute(obs, '_index')
  const columnOrder = readStringArrayAttribute(obs, 'column-order')
  const keys =
    columnOrder.length > 0
      ? columnOrder
      : obs
          .keys()
          .filter((key) => key !== indexKey && key !== '_index' && !key.startsWith('__'))
  const categoricalTracks: H5adCategoricalTrack[] = []
  const continuousTracks: H5adContinuousTrack[] = []

  for (const key of keys) {
    const entity = obs.get(key)

    if (entity === null || entity === undefined || key === indexKey) {
      continue
    }

    if (isCategoricalGroup(entity)) {
      const codes = readNumericArray(
        expectDataset(entity.get('codes'), `/obs/${key}/codes`).value,
        `/obs/${key}/codes`,
      )
      const categories = readStringArray(
        expectDataset(entity.get('categories'), `/obs/${key}/categories`).value,
        `/obs/${key}/categories`,
      )

      if (codes.length !== rowCount) {
        continue
      }

      categoricalTracks.push({
        id: key,
        label: key,
        values: Array.from({ length: rowCount }, (_value, index) => {
          const code = Math.trunc(numericValue(codes, index))
          return code < 0 ? null : (categories[code] ?? null)
        }),
      })
      continue
    }

    if (!isDataset(entity)) {
      continue
    }

    const shape = entity.shape

    if (shape === null || readShapeDimension(shape, 0, `/obs/${key}`) !== rowCount) {
      continue
    }

    const categories = readDataframeCategories(obs, key)

    if (categories !== null && isNumericArray(entity.value)) {
      const codes = readNumericArray(entity.value, `/obs/${key}`)

      categoricalTracks.push({
        id: key,
        label: key,
        values: Array.from({ length: rowCount }, (_value, index) => {
          const code = Math.trunc(numericValue(codes, index))
          return code < 0 ? null : (categories[code] ?? null)
        }),
      })
      continue
    }

    if (isNumericArray(entity.value)) {
      const values = numericArrayToNumbers(readNumericArray(entity.value, `/obs/${key}`))
      const finiteValues = values.filter(Number.isFinite)

      if (finiteValues.length === 0) {
        continue
      }

      continuousTracks.push({
        id: key,
        label: key,
        values,
        min: Math.min(...finiteValues),
        max: Math.max(...finiteValues),
      })
      continue
    }

    const labels = readStringArray(entity.value, `/obs/${key}`)

    if (labels.length === rowCount) {
      categoricalTracks.push({
        id: key,
        label: key,
        values: labels.map((value) => (value.length === 0 ? null : value)),
      })
    }
  }

  return { categoricalTracks, continuousTracks }
}

async function fetchH5adFile(url: string, fetcher: typeof fetch): Promise<Response> {
  const controller = new AbortController()
  let timedOut = false
  const timeout = globalThis.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, H5AD_FETCH_TIMEOUT_MS)

  try {
    return await fetcher(url, { signal: controller.signal })
  } catch (error) {
    if (timedOut) {
      throw new Error(
        `H5AD file request timed out after ${H5AD_FETCH_TIMEOUT_MS.toLocaleString()} ms.`,
        { cause: error },
      )
    }

    throw error
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

async function readH5adResponseBytes(
  url: string,
  response: Response,
): Promise<Uint8Array> {
  const declaredByteLength = readContentLength(response.headers)

  if (declaredByteLength !== null) {
    throwIfH5adFileTooLarge(url, declaredByteLength)
  }

  if (response.body === null) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    throwIfH5adFileTooLarge(url, bytes.byteLength)
    return bytes
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    byteLength += value.byteLength

    if (byteLength > H5AD_MAX_FILE_BYTES) {
      try {
        await reader.cancel()
      } catch {
        // The size-limit error is more useful than a stream cleanup failure.
      }

      throw new H5adFileSizeLimitExceededError(url, byteLength)
    }

    chunks.push(value)
  }

  const bytes = new Uint8Array(byteLength)
  let offset = 0

  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return bytes
}

function readContentLength(headers: Headers): number | null {
  const value = headers.get('content-length')

  if (value === null) {
    return null
  }

  const byteLength = Number(value)
  return Number.isFinite(byteLength) && byteLength >= 0 ? byteLength : null
}

function throwIfH5adFileTooLarge(url: string, byteLength: number): void {
  if (byteLength > H5AD_MAX_FILE_BYTES) {
    throw new H5adFileSizeLimitExceededError(url, byteLength)
  }
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

function readDataframeCategories(
  obs: H5GroupLike,
  key: string,
): readonly string[] | null {
  const categoryGroup = obs.get('__categories')

  if (!isGroup(categoryGroup)) {
    return null
  }

  const categoryDataset = categoryGroup.get(key)

  if (!isDataset(categoryDataset)) {
    return null
  }

  const categories = readStringArray(categoryDataset.value, `/obs/__categories/${key}`)
  return categories.length === 0 ? null : categories
}

function readMatrix(file: H5GroupLike, rows: number, cols: number): H5adMatrix {
  const x = file.get('/X')

  if (isDataset(x)) {
    const shape = x.shape

    if (
      shape === null ||
      readShapeDimension(shape, 0, '/X') !== rows ||
      readShapeDimension(shape, 1, '/X') !== cols
    ) {
      throw new Error('H5AD /X dense matrix shape does not match obs x var.')
    }

    return {
      kind: 'dense',
      values: readNumericArray(x.value, '/X'),
      rows,
      cols,
    }
  }

  const group = expectGroup(x, '/X')
  const encodingType = readStringAttribute(group, 'encoding-type')
  const shape = readShapeAttribute(group, 'shape')
  const matrixRows = readShapeDimension(shape, 0, '/X.attrs.shape')
  const matrixCols = readShapeDimension(shape, 1, '/X.attrs.shape')

  if (matrixRows !== rows || matrixCols !== cols) {
    throw new Error('H5AD /X sparse matrix shape does not match obs x var.')
  }

  const matrix = {
    data: readNumericArray(expectDataset(group.get('data'), '/X/data').value, '/X/data'),
    indices: readNumericArray(
      expectDataset(group.get('indices'), '/X/indices').value,
      '/X/indices',
    ),
    indptr: readNumericArray(
      expectDataset(group.get('indptr'), '/X/indptr').value,
      '/X/indptr',
    ),
    rows,
    cols,
  }

  if (encodingType === 'csc_matrix') {
    return { kind: 'csc', ...matrix }
  }

  return { kind: 'csr', ...matrix }
}

function h5adMatrixForCells(
  cache: H5adCache,
  ids: readonly SpatialElementId[],
  genes: readonly string[],
): GexResult<SpatialElementId> {
  const rowByCellId = new Map<string, number>()
  const colByGeneName = new Map<string, number>()

  cache.cellIds.forEach((cellId, row) => {
    rowByCellId.set(cellId, row)
  })
  cache.geneNames.forEach((geneName, col) => {
    colByGeneName.set(geneName, col)
  })

  const requestedCols = genes
    .map((gene) => colByGeneName.get(gene))
    .filter((col): col is number => col !== undefined)
  const requestedGenes = requestedCols.map((col) => cache.geneNames[col] ?? '')
  const cells = new Map<SpatialElementId, { geneNames: string[]; counts: number[] }>()

  for (const id of ids) {
    const row = rowByCellId.get(id)

    if (row === undefined) {
      continue
    }

    const geneNames: string[] = []
    const counts: number[] = []

    for (const col of requestedCols) {
      const count = matrixValue(cache.matrix, row, col)

      if (count <= 0 && genes.length !== 1) {
        continue
      }

      geneNames.push(cache.geneNames[col] ?? `var-${col}`)
      counts.push(count)
    }

    cells.set(id, { geneNames, counts })
  }

  return {
    geneNames: requestedGenes,
    cells,
  }
}

function h5adCellsInBbox(
  cache: H5adCache,
  bbox: BBox,
  limit: number | undefined,
): readonly DatasetCell[] {
  const cells: DatasetCell[] = []
  const maxCells = limit === undefined ? Number.POSITIVE_INFINITY : Math.max(0, limit)

  for (let index = 0; index < cache.cellIds.length; index += 1) {
    const position = cache.coordinates[index]
    const id = cache.cellIds[index]

    if (position === undefined || id === undefined) {
      continue
    }

    if (
      position.x < bbox.minX ||
      position.x > bbox.maxX ||
      position.y < bbox.minY ||
      position.y > bbox.maxY
    ) {
      continue
    }

    cells.push({
      id: id as never,
      position,
    })

    if (cells.length >= maxCells) {
      break
    }
  }

  return cells
}

function matrixValue(matrix: H5adMatrix, row: number, col: number): number {
  if (matrix.kind === 'dense') {
    return numericValue(matrix.values, row * matrix.cols + col)
  }

  if (matrix.kind === 'csr') {
    const start = Math.trunc(numericValue(matrix.indptr, row))
    const end = Math.trunc(numericValue(matrix.indptr, row + 1))

    for (let index = start; index < end; index += 1) {
      if (Math.trunc(numericValue(matrix.indices, index)) === col) {
        return numericValue(matrix.data, index)
      }
    }

    return 0
  }

  const start = Math.trunc(numericValue(matrix.indptr, col))
  const end = Math.trunc(numericValue(matrix.indptr, col + 1))

  for (let index = start; index < end; index += 1) {
    if (Math.trunc(numericValue(matrix.indices, index)) === row) {
      return numericValue(matrix.data, index)
    }
  }

  return 0
}

function h5adCellMetadata(
  cache: H5adCache,
  row: number,
): Readonly<Record<string, string | number | boolean>> {
  const metadata: Record<string, string | number | boolean> = {}

  for (const track of cache.categoricalTracks) {
    const value = track.values[row]

    if (value !== null && value !== undefined) {
      metadata[track.label] = value
    }
  }

  for (const track of cache.continuousTracks) {
    const value = track.values[row]

    if (value !== undefined && Number.isFinite(value)) {
      metadata[track.label] = value
    }
  }

  return metadata
}

function pointInPolygon(point: DataPoint, polygon: readonly DataPoint[]): boolean {
  let inside = false

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const current = polygon[i]
    const previous = polygon[j]

    if (current === undefined || previous === undefined) {
      continue
    }

    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) +
          current.x

    if (intersects) {
      inside = !inside
    }
  }

  return inside
}

function bboxForPoints(points: readonly DataPoint[]): BBox {
  if (points.length === 0) {
    return {
      minX: micrometers(0),
      maxX: micrometers(1),
      minY: micrometers(0),
      maxY: micrometers(1),
    }
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const point of points) {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }

  return {
    minX: micrometers(minX),
    maxX: micrometers(maxX),
    minY: micrometers(minY),
    maxY: micrometers(maxY),
  }
}

function uniqueNames(
  names: readonly string[],
  fallbackPrefix: string,
): readonly string[] {
  const seen = new Map<string, number>()

  return names.map((name, index) => {
    const fallback = `${fallbackPrefix}-${index}`
    const base = name.trim() === '' ? fallback : name.trim()
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)

    return count === 0 ? base : `${base}-${count + 1}`
  })
}

function readStringAttribute(group: H5EntityLike, name: string): string | undefined {
  const value = group.attrs?.[name]?.value

  return typeof value === 'string' ? value : undefined
}

function readStringArrayAttribute(group: H5EntityLike, name: string): readonly string[] {
  const value = group.attrs?.[name]?.value

  if (value === undefined) {
    return []
  }

  return readStringArray(value, `attrs.${name}`)
}

function readShapeAttribute(group: H5EntityLike, name: string): readonly number[] {
  const value = group.attrs?.[name]?.value

  if (value === undefined) {
    throw new Error(`Expected H5AD ${name} attribute to be present.`)
  }

  return Array.from(readNumericArray(value, `attrs.${name}`), Number)
}

function readStringArray(value: unknown, label: string): readonly string[] {
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value
  }

  throw new Error(`Expected H5AD ${label} to contain strings.`)
}

function readNumericArray(value: unknown, label: string): NumericArrayLike {
  if (isNumericArray(value)) {
    return value
  }

  throw new Error(`Expected H5AD ${label} to contain numeric values.`)
}

function isNumericArray(value: unknown): value is NumericArrayLike {
  return (
    (Array.isArray(value) && value.every((item) => typeof item === 'number')) ||
    value instanceof Int8Array ||
    value instanceof Uint8Array ||
    value instanceof Int16Array ||
    value instanceof Uint16Array ||
    value instanceof Int32Array ||
    value instanceof Uint32Array ||
    value instanceof Float32Array ||
    value instanceof Float64Array ||
    value instanceof BigInt64Array ||
    value instanceof BigUint64Array
  )
}

function numericValue(values: NumericArrayLike, index: number): number {
  const value = values[index]
  return typeof value === 'bigint' ? Number(value) : Number(value ?? 0)
}

function numericArrayToNumbers(values: NumericArrayLike): readonly number[] {
  const numbers: number[] = []

  for (let index = 0; index < values.length; index += 1) {
    numbers.push(numericValue(values, index))
  }

  return numbers
}

function readShapeDimension(
  shape: readonly number[],
  index: number,
  label: string,
): number {
  const value = shape[index]

  if (value === undefined || !Number.isInteger(value) || value < 0) {
    throw new Error(`Expected H5AD ${label} shape[${index}] to be valid.`)
  }

  return value
}

function isDataset(value: unknown): value is H5DatasetLike {
  return (
    typeof value === 'object' && value !== null && 'shape' in value && 'value' in value
  )
}

function isGroup(value: unknown): value is H5GroupLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'keys' in value &&
    typeof (value as { readonly keys?: unknown }).keys === 'function' &&
    'get' in value &&
    typeof (value as { readonly get?: unknown }).get === 'function'
  )
}

function isCategoricalGroup(value: unknown): value is H5GroupLike {
  return isGroup(value) && value.get('codes') !== null && value.get('categories') !== null
}

function expectDataset(value: unknown, label: string): H5DatasetLike {
  if (!isDataset(value)) {
    throw new Error(`Expected H5AD ${label} to be a dataset.`)
  }

  return value
}

function expectGroup(value: unknown, label: string): H5GroupLike {
  if (!isGroup(value)) {
    throw new Error(`Expected H5AD ${label} to be a group.`)
  }

  return value
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const error = new Error('H5AD request aborted.')
    error.name = 'AbortError'
    throw error
  }
}

function hashString(value: string): string {
  let hash = 0

  for (let index = 0; index < value.length; index += 1) {
    hash = (Math.imul(31, hash) + value.charCodeAt(index)) | 0
  }

  return (hash >>> 0).toString(16)
}
