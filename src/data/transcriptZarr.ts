import { ZipFileStore } from '@zarrita/storage'
import * as zarr from 'zarrita'
import { micrometers } from './coords'
import type { BBox } from './coords'
import { notifyFallback, type FallbackNotifier } from './fallbackNotice'
import { isGeneFeature } from './gex'
import type {
  TranscriptAggregateBin,
  TranscriptAggregateFeatureSummary,
  TranscriptGroupSummary,
  TranscriptLodLevel,
  TranscriptPoint,
} from './transcriptOverlay'

const TRANSCRIPT_ZARR_EXACT_LEVEL = 0
const TRANSCRIPT_GRID_BASE_SIZE_MICROMETERS = 250
const TRANSCRIPT_DENSITY_DEFAULT_MAX_BINS = 1_500
const TRANSCRIPT_DENSITY_FEATURE_SUMMARY_LIMIT = 4
const TRANSCRIPT_FEATURE_CIRCLE_LIMIT = 8
const UNKNOWN_GENE_INDEX = 65_535
const UNKNOWN_CODEWORD_INDEX = 65_535

type NumericArray =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array

interface NumericMatrix {
  readonly data: NumericArray
  readonly shape: readonly number[]
  readonly stride: readonly number[]
}

export interface TranscriptZarrViewportOptions {
  readonly signal?: AbortSignal
  readonly pointLimit?: number
  readonly groupLimit?: number
  readonly minQv?: number
  readonly geneOnly?: boolean
  readonly featureNames?: readonly string[]
}

export interface TranscriptZarrGenePanelOptions {
  readonly onFallback?: FallbackNotifier
  readonly signal?: AbortSignal
}

interface TranscriptZarrMetadata {
  readonly root: zarr.Group<ZipFileStore>
  readonly grids: zarr.Group<ZipFileStore>
  readonly gridSize: number
  readonly gridKeys: readonly string[]
  readonly gridKeySet: ReadonlySet<string>
  readonly gridLevels: readonly TranscriptGridLevelMetadata[]
  readonly densityGene: TranscriptDensityGeneMetadata | null
  readonly geneNames: readonly string[]
  readonly codewordGeneNames: readonly string[]
  readonly fovNames: readonly string[]
  readonly numberRnas?: number
}

export interface TranscriptGridLevelMetadata {
  readonly level: number
  readonly tileSizeMicrometers: number
  readonly gridKeys: readonly string[]
  readonly transcriptCounts: readonly number[]
}

interface TranscriptDensityGeneMetadata {
  readonly data: ZarrArray
  readonly indices: ZarrArray
  readonly indptr: ZarrArray
  readonly rows: number
  readonly cols: number
  readonly gridSizeX: number
  readonly gridSizeY: number
  readonly originX: number
  readonly originY: number
  readonly geneNames: readonly string[]
  indptrDataPromise?: Promise<Uint32Array>
}

interface TranscriptTileArrays {
  readonly location: NumericMatrix
  readonly geneIdentity: NumericMatrix
  readonly id: NumericMatrix
  readonly qualityScore: NumericMatrix
  readonly valid?: NumericMatrix
  readonly codewordIdentity?: NumericMatrix
  readonly rowCount: number
}

interface DensityGeneRange {
  readonly start: number
  readonly end: number
  readonly row: number
  readonly geneName: string
}

interface TranscriptZarrAggregateOptions {
  readonly signal?: AbortSignal
  readonly mode?: 'density'
  readonly featureNames?: readonly string[]
  readonly maxBins?: number
}

type ZarrArray = Awaited<ReturnType<typeof openZarrArray>>

const transcriptZarrMetadataCache = new Map<string, Promise<TranscriptZarrMetadata>>()

export async function loadTranscriptZarrViewport(
  url: string,
  bbox: BBox,
  options: TranscriptZarrViewportOptions = {},
): Promise<{
  readonly points: readonly TranscriptPoint[]
  readonly groups: readonly TranscriptGroupSummary[]
  readonly hitPointLimit: boolean
}> {
  const metadata = await cachedTranscriptZarrMetadata(url)
  throwIfAborted(options.signal)

  const pointLimit = Math.max(1, Math.floor(options.pointLimit ?? 100_000))
  const groupLimit = Math.max(1, Math.floor(options.groupLimit ?? 18))
  const minQv = options.minQv ?? 20
  const geneOnly = options.geneOnly ?? true
  const featureFilter = new Set(normalizeFeatureNames(options.featureNames ?? []))
  const tileKeys = transcriptZarrTileKeysForViewport(
    bbox,
    metadata.gridSize,
    metadata.gridKeySet,
  )
  const points: TranscriptPoint[] = []
  let hitPointLimit = false

  for (const tileKey of tileKeys) {
    throwIfAborted(options.signal)

    const arrays = await loadTranscriptTileArrays(metadata.root, tileKey, !geneOnly)

    for (let row = 0; row < arrays.rowCount; row += 1) {
      const valid = arrays.valid === undefined ? 1 : readMatrixValue(arrays.valid, row, 0)

      if (valid === 0) {
        continue
      }

      const qv = readMatrixValue(arrays.qualityScore, row, 0)

      if (qv < minQv) {
        continue
      }

      const x = readMatrixValue(arrays.location, row, 0)
      const y = readMatrixValue(arrays.location, row, 1)

      if (x < bbox.minX || x > bbox.maxX || y < bbox.minY || y > bbox.maxY) {
        continue
      }

      const geneIndex = readMatrixValue(arrays.geneIdentity, row, 0)
      const isGene =
        Number.isInteger(geneIndex) &&
        geneIndex >= 0 &&
        geneIndex !== UNKNOWN_GENE_INDEX &&
        geneIndex < metadata.geneNames.length

      if (geneOnly && !isGene) {
        continue
      }

      const featureName = isGene
        ? metadata.geneNames[geneIndex]
        : featureNameFromCodeword(metadata, arrays, row)

      if (featureName === undefined) {
        continue
      }

      if (featureFilter.size > 0 && !featureFilter.has(featureName)) {
        continue
      }

      const transcriptId = readMatrixValue(arrays.id, row, 0)
      const fovIndex = readMatrixValue(arrays.id, row, 1)
      const fovName =
        Number.isInteger(fovIndex) && fovIndex >= 0
          ? (metadata.fovNames[fovIndex] ?? null)
          : null
      const zLocation = readMatrixValue(arrays.location, row, 2)

      points.push({
        id: `${fovName ?? fovIndex}:${transcriptId}`,
        transcriptId: String(transcriptId),
        cellId: null,
        cellAssignment: 'unavailable',
        featureName,
        fovName,
        position: {
          x: micrometers(x),
          y: micrometers(y),
        },
        zLocation,
        qv,
        isGene,
      })

      if (points.length > pointLimit) {
        hitPointLimit = true
        break
      }
    }

    if (hitPointLimit) {
      break
    }
  }

  const renderedPoints = points.slice(0, pointLimit)

  return {
    points: renderedPoints,
    groups: transcriptGroupsFromPoints(renderedPoints, groupLimit),
    hitPointLimit,
  }
}

export async function loadTranscriptZarrGenePanel(
  url: string,
  options: TranscriptZarrGenePanelOptions = {},
): Promise<readonly string[]> {
  const store = ZipFileStore.fromUrl(
    url,
    options.signal === undefined ? {} : { overrides: { signal: options.signal } },
  )
  const root = await zarr.open(store, { kind: 'group' })
  const rootGenes = parseTranscriptZarrGenePanelAttrs(root.attrs)

  if (rootGenes.length > 0) {
    return rootGenes
  }

  try {
    const densityGene = await zarr.open(root.resolve('density/gene'), {
      kind: 'group',
    })
    const densityGenes = parseTranscriptZarrGenePanelAttrs(densityGene.attrs)

    if (densityGenes.length > 0) {
      notifyFallback(options.onFallback, {
        source: 'Gene panel',
        message:
          'transcripts.zarr.zip root gene metadata was unavailable, so the app switched to density/gene metadata.',
        action:
          'Gene search can continue, but the gene list came from the transcript density metadata path.',
        coalesceKey: `gene-panel-transcript-zarr-density:${url}`,
      })
      return densityGenes
    }
  } catch {
    // Root attributes are the primary source; density/gene is only a fallback.
  }

  throw new Error('transcripts.zarr.zip does not expose gene_names metadata.')
}

export function parseTranscriptZarrGenePanelAttrs(
  attrs: Record<string, unknown>,
): readonly string[] {
  const geneNames = readOptionalStringArrayAttribute(attrs, 'gene_names')

  if (geneNames.length === 0) {
    return []
  }

  const geneCategories = readOptionalGeneCategoryAttribute(attrs, geneNames.length)
  const genes = new Set<string>()

  for (let index = 0; index < geneNames.length; index += 1) {
    const name = geneNames[index]
    const category = geneCategories[index]
    const normalizedName = name?.trim() ?? ''

    if (normalizedName.length > 0 && isGeneFeature(normalizedName, category)) {
      genes.add(normalizedName)
    }
  }

  return [...genes].sort((left, right) => left.localeCompare(right))
}

export async function loadTranscriptZarrAggregates(
  url: string,
  bbox: BBox,
  options: TranscriptZarrAggregateOptions = {},
): Promise<{
  readonly bins: readonly TranscriptAggregateBin[]
  readonly level: TranscriptLodLevel
  readonly source: 'native-zarr'
  readonly selectedFeatureNames: readonly string[]
  readonly scaleMax?: number
}> {
  const metadata = await cachedTranscriptZarrMetadata(url)
  throwIfAborted(options.signal)

  const mode = options.mode ?? 'density'
  const maxBins = options.maxBins ?? TRANSCRIPT_DENSITY_DEFAULT_MAX_BINS
  const selectedFeatureNames = normalizeFeatureNames(options.featureNames ?? [])

  if (selectedFeatureNames.length > 0) {
    if (metadata.densityGene === null) {
      throw new Error(
        'transcripts.zarr.zip is missing density/gene metadata for selected-feature aggregate bins.',
      )
    }

    const densityLevel = transcriptDensityLevelForBbox(
      bbox,
      mode,
      maxBins,
      nativeDensityBaseBinSize(metadata.densityGene),
    )
    const bins = await transcriptZarrDensityGeneBins(metadata, bbox, {
      mode,
      maxBins,
      selectedFeatureNames,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })

    return {
      bins,
      level: transcriptLodLevelFromBins(
        bins,
        densityLevel.level,
        densityLevel.tileSizeMicrometers,
      ),
      source: 'native-zarr',
      selectedFeatureNames,
      scaleMax: maxTranscriptAggregateCount(bins),
    }
  }

  const level = chooseTranscriptGridLevel(metadata.gridLevels, bbox, maxBins)
  const bins = transcriptZarrGridLevelBins(level, bbox)

  return {
    bins,
    level: {
      level: level.level,
      gridSizeMicrometers: level.tileSizeMicrometers,
      gridKeys: bins.map((bin) => `${bin.binX},${bin.binY}`),
      transcriptCounts: bins.map((bin) => bin.count),
    },
    source: 'native-zarr',
    selectedFeatureNames,
    scaleMax: maxNumericValue(level.transcriptCounts),
  }
}

export function transcriptZarrTileKeysForViewport(
  bbox: BBox,
  gridSize: number,
  availableKeys: ReadonlySet<string>,
): readonly string[] {
  if (!Number.isFinite(gridSize) || gridSize <= 0) {
    throw new Error('transcripts.zarr.zip has an invalid grid size.')
  }

  const minTileX = Math.floor(bbox.minX / gridSize)
  const maxTileX = Math.floor(bbox.maxX / gridSize)
  const minTileY = Math.floor(bbox.minY / gridSize)
  const maxTileY = Math.floor(bbox.maxY / gridSize)
  const keys: string[] = []

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const key = `${tileX},${tileY}`

      if (availableKeys.has(key)) {
        keys.push(key)
      }
    }
  }

  return keys
}

export function chooseTranscriptGridLevel(
  levels: readonly TranscriptGridLevelMetadata[],
  bbox: BBox,
  maxBins: number,
): TranscriptGridLevelMetadata {
  if (levels.length === 0) {
    throw new Error('transcripts.zarr.zip does not expose aggregate grid levels.')
  }

  const normalizedMaxBins = Math.max(1, Math.floor(maxBins))
  let fallback = levels[levels.length - 1]

  if (fallback === undefined) {
    throw new Error('transcripts.zarr.zip does not expose aggregate grid levels.')
  }

  for (const level of levels) {
    const visibleCount = countVisibleGridKeys(level, bbox)

    if (visibleCount > 0) {
      fallback = level
    }

    if (visibleCount > 0 && visibleCount <= normalizedMaxBins) {
      return level
    }
  }

  return fallback
}

export function transcriptZarrGridLevelBins(
  level: TranscriptGridLevelMetadata,
  bbox: BBox,
): readonly TranscriptAggregateBin[] {
  const bins: TranscriptAggregateBin[] = []

  for (let index = 0; index < level.gridKeys.length; index += 1) {
    const key = level.gridKeys[index]
    const tile = parseGridKey(key)

    if (tile === null || !gridTileIntersectsBbox(tile, level.tileSizeMicrometers, bbox)) {
      continue
    }

    const count = level.transcriptCounts[index] ?? 0

    if (count <= 0) {
      continue
    }

    bins.push({
      id: `native-zarr-grid:${level.level}:${tile.x}:${tile.y}`,
      source: 'native-zarr',
      level: level.level,
      binX: tile.x,
      binY: tile.y,
      position: {
        x: micrometers((tile.x + 0.5) * level.tileSizeMicrometers),
        y: micrometers((tile.y + 0.5) * level.tileSizeMicrometers),
      },
      radiusMicrometers: level.tileSizeMicrometers * 0.42,
      binSizeMicrometers: level.tileSizeMicrometers,
      count,
    })
  }

  return bins
}

function countVisibleGridKeys(level: TranscriptGridLevelMetadata, bbox: BBox): number {
  let visibleCount = 0

  for (const key of level.gridKeys) {
    const tile = parseGridKey(key)

    if (tile !== null && gridTileIntersectsBbox(tile, level.tileSizeMicrometers, bbox)) {
      visibleCount += 1
    }
  }

  return visibleCount
}

function parseGridKey(
  key: string | undefined,
): { readonly x: number; readonly y: number } | null {
  if (key === undefined) {
    return null
  }

  const [xText, yText] = key.split(',', 2)
  const x = Number(xText)
  const y = Number(yText)

  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return null
  }

  return { x, y }
}

function gridTileIntersectsBbox(
  tile: { readonly x: number; readonly y: number },
  tileSizeMicrometers: number,
  bbox: BBox,
): boolean {
  const minX = tile.x * tileSizeMicrometers
  const minY = tile.y * tileSizeMicrometers
  const maxX = minX + tileSizeMicrometers
  const maxY = minY + tileSizeMicrometers

  return minX <= bbox.maxX && maxX >= bbox.minX && minY <= bbox.maxY && maxY >= bbox.minY
}

async function transcriptZarrDensityGeneBins(
  metadata: TranscriptZarrMetadata,
  bbox: BBox,
  options: {
    readonly mode: 'density'
    readonly maxBins: number
    readonly selectedFeatureNames: readonly string[]
    readonly signal?: AbortSignal
  },
): Promise<readonly TranscriptAggregateBin[]> {
  const densityGene = metadata.densityGene

  if (densityGene === null) {
    return []
  }

  const geneIndexes =
    options.selectedFeatureNames.length === 0
      ? allDensityGeneIndexes(densityGene.geneNames)
      : selectedGeneIndexes(densityGene.geneNames, options.selectedFeatureNames)

  if (geneIndexes.length === 0) {
    return []
  }

  const densityLevel = transcriptDensityLevelForBbox(
    bbox,
    options.mode,
    options.maxBins,
    nativeDensityBaseBinSize(densityGene),
  )
  const rowRange = densityRowRangeForBbox(densityGene, bbox)
  const colRange = densityColRangeForBbox(densityGene, bbox)

  if (rowRange === null || colRange === null) {
    return []
  }

  const indptr = await readDensityGeneIndptr(densityGene)
  throwIfAborted(options.signal)

  const binMap = new Map<
    string,
    {
      binX: number
      binY: number
      count: number
      featureCounts: Map<string, number>
    }
  >()
  const dataChunkCache = new Map<
    number,
    Promise<{
      readonly start: number
      readonly data: NumericArray
      readonly indices: NumericArray
    }>
  >()

  if (options.selectedFeatureNames.length > 0) {
    const ranges = collectDensityGeneRanges(densityGene, indptr, rowRange, geneIndexes)
    await prefetchDensityGeneDataChunks(
      densityGene,
      ranges,
      dataChunkCache,
      options.signal,
    )

    for (const range of ranges) {
      throwIfAborted(options.signal)
      await addDensityGeneRangeToBins({
        densityGene,
        start: range.start,
        end: range.end,
        row: range.row,
        colRange,
        geneName: range.geneName,
        binSizeMicrometers: densityLevel.tileSizeMicrometers,
        binMap,
        dataChunkCache,
      })
    }
  } else {
    for (let row = rowRange.start; row <= rowRange.end; row += 1) {
      throwIfAborted(options.signal)

      for (const gene of geneIndexes) {
        const pointerIndex = row * densityGene.geneNames.length + gene.index
        const start = indptr[pointerIndex] ?? 0
        const end = indptr[pointerIndex + 1] ?? start

        if (end <= start) {
          continue
        }

        await addDensityGeneRangeToBins({
          densityGene,
          start,
          end,
          row,
          colRange,
          geneName: gene.name,
          binSizeMicrometers: densityLevel.tileSizeMicrometers,
          binMap,
          dataChunkCache,
        })
      }
    }
  }

  if (options.selectedFeatureNames.length > 0) {
    return densityBinMapToFeatureCircleBins(
      binMap,
      densityLevel.level,
      densityLevel.tileSizeMicrometers,
    )
  }

  return densityBinMapToAggregateBins(
    binMap,
    densityLevel.level,
    densityLevel.tileSizeMicrometers,
  )
}

export function transcriptFeatureCircleOffset(
  index: number,
  count: number,
  binSizeMicrometers: number,
): { readonly x: number; readonly y: number } {
  const normalizedBinSize = Math.max(1, binSizeMicrometers)
  const normalizedCount = Math.max(
    1,
    Math.min(TRANSCRIPT_FEATURE_CIRCLE_LIMIT, Math.floor(count)),
  )
  const normalizedIndex = Math.max(0, Math.floor(index)) % normalizedCount
  const unitOffset = featureCircleUnitOffset(normalizedIndex, normalizedCount)

  return {
    x: unitOffset.x * normalizedBinSize,
    y: unitOffset.y * normalizedBinSize,
  }
}

export function transcriptDensityLevelForBbox(
  bbox: BBox,
  _mode: 'density',
  maxBins: number,
  baseBinSizeMicrometers = TRANSCRIPT_GRID_BASE_SIZE_MICROMETERS,
): { readonly level: number; readonly tileSizeMicrometers: number } {
  const normalizedMaxBins = Math.max(1, Math.floor(maxBins))
  const normalizedBaseBinSize = Math.max(1, baseBinSizeMicrometers)
  const maxLevel = 8

  for (let level = 0; level <= maxLevel; level += 1) {
    const tileSizeMicrometers = normalizedBaseBinSize * 2 ** level
    const xBins = Math.max(1, Math.ceil((bbox.maxX - bbox.minX) / tileSizeMicrometers))
    const yBins = Math.max(1, Math.ceil((bbox.maxY - bbox.minY) / tileSizeMicrometers))
    const visibleBins = xBins * yBins

    if (visibleBins <= normalizedMaxBins) {
      return { level, tileSizeMicrometers }
    }
  }

  return {
    level: maxLevel,
    tileSizeMicrometers: normalizedBaseBinSize * 2 ** maxLevel,
  }
}

function nativeDensityBaseBinSize(densityGene: TranscriptDensityGeneMetadata): number {
  return Math.max(densityGene.gridSizeX, densityGene.gridSizeY, 1)
}

function allDensityGeneIndexes(
  geneNames: readonly string[],
): readonly { readonly index: number; readonly name: string }[] {
  return geneNames.flatMap((name, index) => (name === undefined ? [] : [{ index, name }]))
}

function selectedGeneIndexes(
  geneNames: readonly string[],
  selectedFeatureNames: readonly string[],
): readonly { readonly index: number; readonly name: string }[] {
  const indexByUpperName = new Map<string, number>()

  for (let index = 0; index < geneNames.length; index += 1) {
    const geneName = geneNames[index]

    if (geneName !== undefined) {
      indexByUpperName.set(geneName.toUpperCase(), index)
    }
  }

  return selectedFeatureNames.flatMap((featureName) => {
    const index = indexByUpperName.get(featureName.toUpperCase())
    const name = index === undefined ? undefined : geneNames[index]

    return index === undefined || name === undefined ? [] : [{ index, name }]
  })
}

function densityRowRangeForBbox(
  densityGene: TranscriptDensityGeneMetadata,
  bbox: BBox,
): { readonly start: number; readonly end: number } | null {
  return boundedDensityRange(
    bbox.minY,
    bbox.maxY,
    densityGene.originY,
    densityGene.gridSizeY,
    densityGene.rows,
  )
}

function densityColRangeForBbox(
  densityGene: TranscriptDensityGeneMetadata,
  bbox: BBox,
): { readonly start: number; readonly end: number } | null {
  return boundedDensityRange(
    bbox.minX,
    bbox.maxX,
    densityGene.originX,
    densityGene.gridSizeX,
    densityGene.cols,
  )
}

function boundedDensityRange(
  minValue: number,
  maxValue: number,
  origin: number,
  gridSize: number,
  size: number,
): { readonly start: number; readonly end: number } | null {
  if (!Number.isFinite(gridSize) || gridSize <= 0 || size <= 0) {
    return null
  }

  const start = Math.max(0, Math.floor((minValue - origin) / gridSize))
  const end = Math.min(size - 1, Math.floor((maxValue - origin) / gridSize))

  return end < start ? null : { start, end }
}

async function readDensityGeneIndptr(
  densityGene: TranscriptDensityGeneMetadata,
): Promise<Uint32Array> {
  densityGene.indptrDataPromise ??= readWholeZarrArray(densityGene.indptr).then(
    (matrix) => {
      if (!(matrix.data instanceof Uint32Array)) {
        throw new Error('transcripts.zarr.zip density/gene indptr must be uint32.')
      }

      return matrix.data
    },
  )

  return densityGene.indptrDataPromise
}

function collectDensityGeneRanges(
  densityGene: TranscriptDensityGeneMetadata,
  indptr: Uint32Array,
  rowRange: { readonly start: number; readonly end: number },
  geneIndexes: readonly { readonly index: number; readonly name: string }[],
): readonly DensityGeneRange[] {
  const ranges: DensityGeneRange[] = []

  for (let row = rowRange.start; row <= rowRange.end; row += 1) {
    for (const gene of geneIndexes) {
      const pointerIndex = row * densityGene.geneNames.length + gene.index
      const start = indptr[pointerIndex] ?? 0
      const end = indptr[pointerIndex + 1] ?? start

      if (end > start) {
        ranges.push({
          start,
          end,
          row,
          geneName: gene.name,
        })
      }
    }
  }

  return ranges
}

async function prefetchDensityGeneDataChunks(
  densityGene: TranscriptDensityGeneMetadata,
  ranges: readonly DensityGeneRange[],
  dataChunkCache: Map<
    number,
    Promise<{
      readonly start: number
      readonly data: NumericArray
      readonly indices: NumericArray
    }>
  >,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (ranges.length === 0) {
    return
  }

  const chunkSize = densityGeneDataChunkSize(densityGene)
  const chunkIndexes = new Set<number>()

  for (const range of ranges) {
    for (const chunkIndex of densityGeneDataChunkIndexes(
      range.start,
      range.end,
      chunkSize,
    )) {
      chunkIndexes.add(chunkIndex)
    }
  }

  const sortedChunkIndexes = [...chunkIndexes].sort((left, right) => left - right)
  const workerCount = Math.min(6, sortedChunkIndexes.length)
  let nextIndex = 0

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < sortedChunkIndexes.length) {
        throwIfAborted(signal)
        const chunkIndex = sortedChunkIndexes[nextIndex]
        nextIndex += 1

        if (chunkIndex !== undefined) {
          await readDensityGeneDataChunk(densityGene, chunkIndex, dataChunkCache)
        }
      }
    }),
  )
}

async function addDensityGeneRangeToBins(options: {
  readonly densityGene: TranscriptDensityGeneMetadata
  readonly start: number
  readonly end: number
  readonly row: number
  readonly colRange: { readonly start: number; readonly end: number }
  readonly geneName: string
  readonly binSizeMicrometers: number
  readonly binMap: Map<
    string,
    {
      binX: number
      binY: number
      count: number
      featureCounts: Map<string, number>
    }
  >
  readonly dataChunkCache: Map<
    number,
    Promise<{
      readonly start: number
      readonly data: NumericArray
      readonly indices: NumericArray
    }>
  >
}): Promise<void> {
  const chunkSize = densityGeneDataChunkSize(options.densityGene)
  const firstChunk = Math.floor(options.start / chunkSize)
  const lastChunk = Math.floor((options.end - 1) / chunkSize)

  for (let chunkIndex = firstChunk; chunkIndex <= lastChunk; chunkIndex += 1) {
    const chunk = await readDensityGeneDataChunk(
      options.densityGene,
      chunkIndex,
      options.dataChunkCache,
    )
    const localStart = Math.max(options.start, chunk.start)
    const localEnd = Math.min(options.end, chunk.start + chunk.data.length)

    for (let pointer = localStart; pointer < localEnd; pointer += 1) {
      const localPointer = pointer - chunk.start
      const col = chunk.indices[localPointer] ?? -1

      if (col < options.colRange.start || col > options.colRange.end) {
        continue
      }

      const count = chunk.data[localPointer] ?? 0

      if (count <= 0) {
        continue
      }

      const x = options.densityGene.originX + (col + 0.5) * options.densityGene.gridSizeX
      const y =
        options.densityGene.originY + (options.row + 0.5) * options.densityGene.gridSizeY
      const binX = Math.floor(x / options.binSizeMicrometers)
      const binY = Math.floor(y / options.binSizeMicrometers)
      const key = `${binX},${binY}`
      let bin = options.binMap.get(key)

      if (bin === undefined) {
        bin = { binX, binY, count: 0, featureCounts: new Map() }
        options.binMap.set(key, bin)
      }

      bin.count += count
      bin.featureCounts.set(
        options.geneName,
        (bin.featureCounts.get(options.geneName) ?? 0) + count,
      )
    }
  }
}

async function readDensityGeneDataChunk(
  densityGene: TranscriptDensityGeneMetadata,
  chunkIndex: number,
  cache: Map<
    number,
    Promise<{
      readonly start: number
      readonly data: NumericArray
      readonly indices: NumericArray
    }>
  >,
): Promise<{
  readonly start: number
  readonly data: NumericArray
  readonly indices: NumericArray
}> {
  const cached = cache.get(chunkIndex)

  if (cached !== undefined) {
    return cached
  }

  const chunkSize = densityGeneDataChunkSize(densityGene)
  const start = chunkIndex * chunkSize
  const dataLength = densityGene.data.shape[0] ?? 0
  const stop = Math.min(dataLength, start + chunkSize)
  const promise = Promise.all([
    zarr.get(densityGene.data, [{ start, stop, step: 1 }]),
    zarr.get(densityGene.indices, [{ start, stop, step: 1 }]),
  ]).then(([dataChunk, indicesChunk]) => {
    const dataResult = dataChunk as { readonly data: unknown }
    const indicesResult = indicesChunk as { readonly data: unknown }

    return {
      start,
      data: expectNumericArray(dataResult.data, densityGene.data.path),
      indices: expectNumericArray(indicesResult.data, densityGene.indices.path),
    }
  })

  cache.set(chunkIndex, promise)
  return promise
}

function densityGeneDataChunkSize(densityGene: TranscriptDensityGeneMetadata): number {
  return Math.max(1, densityGene.data.chunks[0] ?? 2_000_000)
}

function densityGeneDataChunkIndexes(
  start: number,
  end: number,
  chunkSize: number,
): readonly number[] {
  if (end <= start) {
    return []
  }

  const firstChunk = Math.floor(start / chunkSize)
  const lastChunk = Math.floor((end - 1) / chunkSize)
  const indexes: number[] = []

  for (let chunkIndex = firstChunk; chunkIndex <= lastChunk; chunkIndex += 1) {
    indexes.push(chunkIndex)
  }

  return indexes
}

function maxTranscriptAggregateCount(bins: readonly TranscriptAggregateBin[]): number {
  let maxCount = 0

  for (const bin of bins) {
    maxCount = Math.max(maxCount, bin.count)
  }

  return Math.max(1, maxCount)
}

function maxNumericValue(values: readonly number[]): number {
  let maxValue = 0

  for (const value of values) {
    if (Number.isFinite(value)) {
      maxValue = Math.max(maxValue, value)
    }
  }

  return Math.max(1, maxValue)
}

function densityBinMapToAggregateBins(
  binMap: ReadonlyMap<
    string,
    {
      readonly binX: number
      readonly binY: number
      readonly count: number
      readonly featureCounts: ReadonlyMap<string, number>
    }
  >,
  level: number,
  binSizeMicrometers: number,
): readonly TranscriptAggregateBin[] {
  return [...binMap.entries()]
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([, bin]) => {
      const topFeatures = topFeatureSummaries(bin.featureCounts)

      return {
        id: `native-zarr-density:${level}:${bin.binX}:${bin.binY}`,
        source: 'native-zarr',
        glyphType: 'density',
        level,
        binX: bin.binX,
        binY: bin.binY,
        position: {
          x: micrometers((bin.binX + 0.5) * binSizeMicrometers),
          y: micrometers((bin.binY + 0.5) * binSizeMicrometers),
        },
        radiusMicrometers: binSizeMicrometers * 0.42,
        binSizeMicrometers,
        count: bin.count,
        ...(topFeatures.length === 0 ? {} : { topFeatures }),
      }
    })
}

function densityBinMapToFeatureCircleBins(
  binMap: ReadonlyMap<
    string,
    {
      readonly binX: number
      readonly binY: number
      readonly count: number
      readonly featureCounts: ReadonlyMap<string, number>
    }
  >,
  level: number,
  binSizeMicrometers: number,
): readonly TranscriptAggregateBin[] {
  return [...binMap.entries()]
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .flatMap(([, bin]) => {
      const topFeatures = topFeatureSummaries(
        bin.featureCounts,
        TRANSCRIPT_FEATURE_CIRCLE_LIMIT,
      )

      if (topFeatures.length === 0) {
        return []
      }

      const visibleTranscriptCount = topFeatures.reduce(
        (total, feature) => total + feature.count,
        0,
      )
      const omittedFeatureCount = Math.max(0, bin.featureCounts.size - topFeatures.length)
      const omittedTranscriptCount = Math.max(0, bin.count - visibleTranscriptCount)

      return topFeatures.map((feature, index) => {
        const offset = transcriptFeatureCircleOffset(
          index,
          topFeatures.length,
          binSizeMicrometers,
        )

        return {
          id: `native-zarr-feature-circle:${level}:${bin.binX}:${bin.binY}:${feature.featureName}`,
          source: 'native-zarr',
          glyphType: 'feature-circle',
          level,
          binX: bin.binX,
          binY: bin.binY,
          position: {
            x: micrometers((bin.binX + 0.5) * binSizeMicrometers + offset.x),
            y: micrometers((bin.binY + 0.5) * binSizeMicrometers + offset.y),
          },
          radiusMicrometers: featureCircleRadiusMicrometers(
            topFeatures.length,
            binSizeMicrometers,
          ),
          binSizeMicrometers,
          count: feature.count,
          binTotalCount: bin.count,
          selectedGeneCount: bin.count,
          topFeatures,
          featureName: feature.featureName,
          ...(omittedFeatureCount === 0 ? {} : { omittedFeatureCount }),
          ...(omittedTranscriptCount === 0 ? {} : { omittedTranscriptCount }),
        }
      })
    })
}

function transcriptLodLevelFromBins(
  bins: readonly TranscriptAggregateBin[],
  level: number,
  gridSizeMicrometers: number,
): TranscriptLodLevel {
  return {
    level,
    gridSizeMicrometers,
    gridKeys: bins.map((bin) => `${bin.binX},${bin.binY}`),
    transcriptCounts: bins.map((bin) => bin.count),
  }
}

function topFeatureSummaries(
  featureCounts: ReadonlyMap<string, number>,
  limit = TRANSCRIPT_DENSITY_FEATURE_SUMMARY_LIMIT,
): readonly TranscriptAggregateFeatureSummary[] {
  return [...featureCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, Math.max(0, Math.floor(limit)))
    .map(([featureName, count]) => ({ featureName, count }))
}

function featureCircleUnitOffset(
  index: number,
  count: number,
): { readonly x: number; readonly y: number } {
  if (count <= 1) {
    return { x: 0, y: 0 }
  }

  if (count === 2) {
    return index === 0 ? { x: -0.22, y: 0 } : { x: 0.22, y: 0 }
  }

  if (count === 3) {
    const offsets = [
      { x: 0, y: -0.24 },
      { x: -0.21, y: 0.18 },
      { x: 0.21, y: 0.18 },
    ]

    return offsets[index] ?? offsets[0]!
  }

  if (count === 4) {
    const offsets = [
      { x: -0.2, y: -0.2 },
      { x: 0.2, y: -0.2 },
      { x: -0.2, y: 0.2 },
      { x: 0.2, y: 0.2 },
    ]

    return offsets[index] ?? offsets[0]!
  }

  const radius = 0.28
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / count

  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  }
}

function featureCircleRadiusMicrometers(
  count: number,
  binSizeMicrometers: number,
): number {
  const normalizedBinSize = Math.max(1, binSizeMicrometers)

  if (count <= 1) {
    return Math.max(2, normalizedBinSize * 0.2)
  }

  if (count <= 2) {
    return Math.max(2, normalizedBinSize * 0.15)
  }

  if (count <= 4) {
    return Math.max(2, normalizedBinSize * 0.12)
  }

  return Math.max(2, normalizedBinSize * 0.09)
}

export function transcriptGroupsFromPoints(
  points: readonly TranscriptPoint[],
  limit: number,
): readonly TranscriptGroupSummary[] {
  const groups = new Map<
    string,
    {
      readonly featureName: string
      readonly fovName: string | null
      count: number
      qvTotal: number
    }
  >()

  for (const point of points) {
    const key = `${point.featureName}\u0000${point.fovName ?? ''}`
    let group = groups.get(key)

    if (group === undefined) {
      group = {
        featureName: point.featureName,
        fovName: point.fovName,
        count: 0,
        qvTotal: 0,
      }
      groups.set(key, group)
    }

    group.count += 1
    group.qvTotal += point.qv
  }

  return [...groups.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, Math.max(0, Math.floor(limit)))
    .map((group) => ({
      featureName: group.featureName,
      fovName: group.fovName,
      count: group.count,
      meanQv: group.qvTotal / group.count,
    }))
}

function cachedTranscriptZarrMetadata(url: string): Promise<TranscriptZarrMetadata> {
  const cached = transcriptZarrMetadataCache.get(url)

  if (cached !== undefined) {
    return cached
  }

  const promise = loadTranscriptZarrMetadata(url).catch((error: unknown) => {
    if (transcriptZarrMetadataCache.get(url) === promise) {
      transcriptZarrMetadataCache.delete(url)
    }

    throw error
  })

  transcriptZarrMetadataCache.set(url, promise)
  return promise
}

async function loadTranscriptZarrMetadata(url: string): Promise<TranscriptZarrMetadata> {
  const store = ZipFileStore.fromUrl(url)
  const root = await zarr.open(store, { kind: 'group' })
  const grids = await zarr.open(root.resolve('grids'), { kind: 'group' })
  const gridKeysByLevel = readNestedStringArrayAttribute(grids.attrs, 'grid_keys')
  const gridKeys = gridKeysByLevel[TRANSCRIPT_ZARR_EXACT_LEVEL] ?? []
  const densityGene = await loadDensityGeneMetadata(root)
  const numberRnas = readOptionalPositiveNumber(root.attrs, 'number_rnas')

  if (gridKeys.length === 0) {
    throw new Error('transcripts.zarr.zip does not expose exact transcript grid keys.')
  }

  return {
    root,
    grids,
    gridSize: readGridSize(grids.attrs),
    gridKeys,
    gridKeySet: new Set(gridKeys),
    gridLevels: readGridLevels(grids.attrs),
    densityGene,
    geneNames: readStringArrayAttribute(root.attrs, 'gene_names'),
    codewordGeneNames: readStringArrayAttribute(root.attrs, 'codeword_gene_names'),
    fovNames: readStringArrayAttribute(root.attrs, 'fov_names'),
    ...(numberRnas === undefined ? {} : { numberRnas }),
  }
}

async function loadDensityGeneMetadata(
  root: zarr.Group<ZipFileStore>,
): Promise<TranscriptDensityGeneMetadata | null> {
  try {
    const densityGene = await zarr.open(root.resolve('density/gene'), {
      kind: 'group',
    })
    const [data, indices, indptr] = await Promise.all([
      openZarrArray(root, 'density/gene/data'),
      openZarrArray(root, 'density/gene/indices'),
      openZarrArray(root, 'density/gene/indptr'),
    ])
    const gridSize = readGridSizePair(densityGene.attrs, 'grid_size')
    const origin = readOrigin(densityGene.attrs)

    return {
      data,
      indices,
      indptr,
      rows: readPositiveIntegerAttribute(densityGene.attrs, 'rows'),
      cols: readPositiveIntegerAttribute(densityGene.attrs, 'cols'),
      gridSizeX: gridSize.x,
      gridSizeY: gridSize.y,
      originX: origin.x,
      originY: origin.y,
      geneNames: readStringArrayAttribute(densityGene.attrs, 'gene_names'),
    }
  } catch {
    return null
  }
}

function readGridLevels(
  attrs: Record<string, unknown>,
): readonly TranscriptGridLevelMetadata[] {
  const gridKeysByLevel = readNestedStringArrayAttribute(attrs, 'grid_keys')
  const countsByLevel = readNestedNumberArrayAttribute(attrs, 'grid_number_objects')
  const baseGridSize = readGridSize(attrs)
  const levels: TranscriptGridLevelMetadata[] = []

  for (let level = 0; level < gridKeysByLevel.length; level += 1) {
    const gridKeys = gridKeysByLevel[level] ?? []
    const transcriptCounts = countsByLevel[level] ?? []

    if (gridKeys.length === 0 || transcriptCounts.length === 0) {
      continue
    }

    levels.push({
      level,
      tileSizeMicrometers: baseGridSize * 2 ** level,
      gridKeys,
      transcriptCounts,
    })
  }

  return levels
}

async function loadTranscriptTileArrays(
  root: zarr.Group<ZipFileStore>,
  tileKey: string,
  includeCodewordIdentity: boolean,
): Promise<TranscriptTileArrays> {
  const tilePath = `grids/${TRANSCRIPT_ZARR_EXACT_LEVEL}/${tileKey}`
  const [
    locationArray,
    geneIdentityArray,
    idArray,
    qualityScoreArray,
    validArray,
    codewordIdentityArray,
  ] = await Promise.all([
    openZarrArray(root, `${tilePath}/location`),
    openZarrArray(root, `${tilePath}/gene_identity`),
    openZarrArray(root, `${tilePath}/id`),
    openZarrArray(root, `${tilePath}/quality_score`),
    openOptionalZarrArray(root, `${tilePath}/valid`),
    includeCodewordIdentity
      ? openOptionalZarrArray(root, `${tilePath}/codeword_identity`)
      : Promise.resolve(null),
  ])
  const [location, geneIdentity, id, qualityScore, valid, codewordIdentity] =
    await Promise.all([
      readWholeZarrArray(locationArray),
      readWholeZarrArray(geneIdentityArray),
      readWholeZarrArray(idArray),
      readWholeZarrArray(qualityScoreArray),
      validArray === null ? Promise.resolve(null) : readWholeZarrArray(validArray),
      codewordIdentityArray === null
        ? Promise.resolve(null)
        : readWholeZarrArray(codewordIdentityArray),
    ])

  return {
    location,
    geneIdentity,
    id,
    qualityScore,
    ...(valid === null
      ? {}
      : {
          valid,
        }),
    ...(codewordIdentity === null
      ? {}
      : {
          codewordIdentity,
        }),
    rowCount: expectRowCount(location.shape),
  }
}

async function openZarrArray(root: zarr.Group<ZipFileStore>, path: string) {
  return zarr.open(root.resolve(path), { kind: 'array' })
}

async function openOptionalZarrArray(root: zarr.Group<ZipFileStore>, path: string) {
  try {
    return await openZarrArray(root, path)
  } catch {
    return null
  }
}

async function readWholeZarrArray(array: Awaited<ReturnType<typeof openZarrArray>>) {
  const selection =
    array.shape.length === 1 ? [null] : [null, ...array.shape.slice(1).map(() => null)]
  const chunk = await zarr.get(array, selection)

  return {
    data: expectNumericArray(chunk.data, array.path),
    shape: chunk.shape,
    stride: expectNumericStride(chunk.stride, array.path),
  }
}

function featureNameFromCodeword(
  metadata: TranscriptZarrMetadata,
  arrays: TranscriptTileArrays,
  row: number,
): string | undefined {
  if (arrays.codewordIdentity === undefined) {
    return undefined
  }

  const codewordIndex = readMatrixValue(arrays.codewordIdentity, row, 0)

  if (
    !Number.isInteger(codewordIndex) ||
    codewordIndex < 0 ||
    codewordIndex === UNKNOWN_CODEWORD_INDEX
  ) {
    return undefined
  }

  return metadata.codewordGeneNames[codewordIndex] ?? `Codeword ${codewordIndex}`
}

function readMatrixValue(matrix: NumericMatrix, row: number, column: number): number {
  const rowStride = matrix.stride[0] ?? 1
  const columnStride = matrix.stride[1] ?? 1

  return matrix.data[row * rowStride + column * columnStride] ?? 0
}

function expectRowCount(shape: readonly number[]): number {
  const rowCount = shape[0]

  if (rowCount === undefined || !Number.isInteger(rowCount) || rowCount < 0) {
    throw new Error('transcripts.zarr.zip grid tile has an invalid row count.')
  }

  return rowCount
}

function readGridSize(attrs: Record<string, unknown>): number {
  const gridSize = attrs.grid_size

  if (!Array.isArray(gridSize) || typeof gridSize[0] !== 'number' || gridSize[0] <= 0) {
    throw new Error('transcripts.zarr.zip grids are missing grid_size metadata.')
  }

  return gridSize[0]
}

function readGridSizePair(
  attrs: Record<string, unknown>,
  key: string,
): { readonly x: number; readonly y: number } {
  const value = attrs[key]

  if (
    !Array.isArray(value) ||
    typeof value[0] !== 'number' ||
    typeof value[1] !== 'number' ||
    value[0] <= 0 ||
    value[1] <= 0
  ) {
    throw new Error(`transcripts.zarr.zip is missing ${key} metadata.`)
  }

  return { x: value[0], y: value[1] }
}

function readOrigin(attrs: Record<string, unknown>): {
  readonly x: number
  readonly y: number
} {
  const value = attrs.origin

  if (
    value === null ||
    typeof value !== 'object' ||
    typeof (value as { x?: unknown }).x !== 'number' ||
    typeof (value as { y?: unknown }).y !== 'number'
  ) {
    throw new Error('transcripts.zarr.zip density/gene is missing origin metadata.')
  }

  return {
    x: (value as { x: number }).x,
    y: (value as { y: number }).y,
  }
}

function readPositiveIntegerAttribute(
  attrs: Record<string, unknown>,
  key: string,
): number {
  const value = attrs[key]

  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`transcripts.zarr.zip is missing ${key} metadata.`)
  }

  return value as number
}

function readOptionalPositiveNumber(
  attrs: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = attrs[key]

  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined
}

function readStringArrayAttribute(
  attrs: Record<string, unknown>,
  key: string,
): readonly string[] {
  const value = attrs[key]

  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`transcripts.zarr.zip is missing ${key} metadata.`)
  }

  return value
}

function readOptionalStringArrayAttribute(
  attrs: Record<string, unknown>,
  key: string,
): readonly string[] {
  const value = attrs[key]

  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : []
}

function readOptionalGeneCategoryAttribute(
  attrs: Record<string, unknown>,
  geneCount: number,
): readonly (string | undefined)[] {
  const categoryKeys = [
    'gene_category',
    'gene_categories',
    'feature_type',
    'feature_types',
    'category',
    'categories',
  ] as const

  for (const key of categoryKeys) {
    const categories = readOptionalStringArrayAttribute(attrs, key)

    if (categories.length === geneCount) {
      return categories
    }
  }

  return []
}

function readNestedNumberArrayAttribute(
  attrs: Record<string, unknown>,
  key: string,
): readonly (readonly number[])[] {
  const value = attrs[key]

  if (
    !Array.isArray(value) ||
    value.some(
      (level) =>
        !Array.isArray(level) ||
        level.some((item) => typeof item !== 'number' || !Number.isFinite(item)),
    )
  ) {
    throw new Error(`transcripts.zarr.zip is missing ${key} metadata.`)
  }

  return value
}

function readNestedStringArrayAttribute(
  attrs: Record<string, unknown>,
  key: string,
): readonly (readonly string[])[] {
  const value = attrs[key]

  if (
    !Array.isArray(value) ||
    value.some(
      (level) => !Array.isArray(level) || level.some((item) => typeof item !== 'string'),
    )
  ) {
    throw new Error(`transcripts.zarr.zip is missing ${key} metadata.`)
  }

  return value
}

function normalizeFeatureNames(featureNames: readonly string[]): readonly string[] {
  const names = new Set<string>()

  for (const featureName of featureNames) {
    const normalized = featureName.trim()

    if (normalized.length > 0) {
      names.add(normalized)
    }
  }

  return [...names].sort((left, right) => left.localeCompare(right))
}

function expectNumericArray(value: unknown, label: string): NumericArray {
  if (!ArrayBuffer.isView(value) || value instanceof DataView) {
    throw new Error(`Expected ${label} to be a numeric typed array.`)
  }

  return value as NumericArray
}

function expectNumericStride(value: unknown, label: string): readonly number[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => !Number.isInteger(item) || item < 0)
  ) {
    throw new Error(`Expected ${label} to provide numeric Zarr strides.`)
  }

  return value
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

  const error = new Error('Transcript Zarr request aborted.')
  error.name = 'AbortError'
  return error
}
