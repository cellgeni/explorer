// Atera transcripts, read per selected gene. binned_transcripts.zarr.zip gives
// each gene's 5 µm counts (density and the viewport estimate);
// transcripts.zarr.zip gives exact points from each gene's rows in the
// visible tiles. See docs/modalities/atera.md.

import { ZipFileStore } from '@zarrita/storage'
import * as zarr from 'zarrita'
import { intToCellId } from '../data/cellid'
import { micrometers, type BBox } from '../data/coords'
import type {
  TranscriptAggregateBin,
  TranscriptAggregateResult,
  TranscriptCapabilities,
  TranscriptPoint,
  TranscriptViewportResult,
} from '../data/transcriptOverlay'
import { transcriptGroupsFromPoints } from '../data/transcriptZarr'
import { mapWithConcurrency } from '../utils/mapWithConcurrency'
import {
  aggregateAteraBinnedTiles,
  ateraDensityBinSize,
  ateraGeneIndexes,
  ateraTranscriptGridTilesForBbox,
  halfFloatToNumber,
  isAteraUnassignedCell,
  parseAteraTranscriptGrid,
  type AteraBinnedTile,
  type AteraDensityBin,
  type AteraTranscriptGrid,
  type AteraTranscriptGridTile,
} from './ateraFormat'

export interface AteraTranscriptFile {
  readonly url: string
  readonly label: string
}

export interface AteraTranscriptsOptions {
  readonly binned: () => Promise<AteraTranscriptFile>
  readonly transcripts: () => Promise<AteraTranscriptFile>
  readonly openZipStore: (url: string) => Promise<{ readonly store: zarr.AsyncReadable }>
}

export interface AteraTranscriptAggregateOptions {
  readonly featureNames: readonly string[]
  readonly maxBins?: number
  readonly signal?: AbortSignal
}

export interface AteraTranscriptViewportOptions {
  readonly featureNames: readonly string[]
  readonly pointLimit?: number
  readonly groupLimit?: number
  readonly minQv?: number
  readonly signal?: AbortSignal
}

type Store = zarr.AsyncReadable
type ZarrArray = zarr.Array<zarr.DataType, Store>
type ZarrChunk = zarr.Chunk<zarr.DataType>

interface BinnedStore {
  readonly store: Store
  readonly label: string
  readonly geneNames: readonly string[]
  readonly grid: AteraTranscriptGrid
}

interface BinnedGene {
  readonly name: string
  readonly root: zarr.Location<Store> | null
  readonly rows: number
  readonly cols: number
  readonly tileKeys: ReadonlySet<string>
  readonly tiles: Map<string, Promise<AteraBinnedTile>>
}

interface TranscriptStore {
  readonly root: zarr.Location<Store>
  readonly label: string
  readonly geneNames: readonly string[]
  readonly grid: AteraTranscriptGrid
  // Arrays whose float16 dtype is read as raw uint16 bits.
  readonly halfFloatArrays: ReadonlySet<string>
}

interface GeneRange {
  readonly tile: AteraTranscriptGridTile
  readonly gene: { readonly index: number; readonly name: string }
  readonly start: number
  readonly end: number
}

const DEFAULT_MAX_BINS = 1_500
const DEFAULT_POINT_LIMIT = 100_000
const DEFAULT_GROUP_LIMIT = 18
const DEFAULT_MIN_QV = 20
const BINNED_GENE_CACHE_LIMIT = 32
const LOCATION_CACHE_LIMIT = 48
const READ_CONCURRENCY = 6
const DENSITY_FEATURE_SUMMARY_LIMIT = 4

export class AteraTranscripts {
  private readonly options: AteraTranscriptsOptions
  private binnedPromise: Promise<BinnedStore> | null = null
  private transcriptsPromise: Promise<TranscriptStore> | null = null
  private readonly binnedGenes = new Map<number, Promise<BinnedGene>>()
  private readonly tileArrays = new Map<string, Promise<ZarrArray>>()
  private readonly geneOffsets = new Map<string, Promise<ZarrChunk>>()
  private readonly locations = new Map<string, Promise<ZarrChunk>>()

  constructor(options: AteraTranscriptsOptions) {
    this.options = options
  }

  // Density and the exact-path estimate need the binned store; exact points
  // need transcripts.zarr.zip. Opening both here also reads their zip
  // directories ahead of the first request.
  async capabilities(): Promise<TranscriptCapabilities> {
    const [binned, transcripts] = await Promise.allSettled([
      this.binned(),
      this.transcripts(),
    ])

    return {
      rawParquet: false,
      nativeZarr: binned.status === 'fulfilled',
      geneRanges: transcripts.status === 'fulfilled',
      ...(binned.status === 'rejected'
        ? { nativeZarrError: errorMessage(binned.reason) }
        : {}),
      ...(transcripts.status === 'rejected'
        ? { geneRangesError: errorMessage(transcripts.reason) }
        : {}),
    }
  }

  // Density squares summing the selected genes, coarsened from 5 µm until the
  // box spans at most `maxBins` squares, and the selected-gene count in the box.
  async aggregates(
    bbox: BBox,
    options: AteraTranscriptAggregateOptions,
  ): Promise<TranscriptAggregateResult> {
    const binned = await this.binned()
    throwIfAborted(options.signal)
    const genes = ateraGeneIndexes(binned.geneNames, options.featureNames)
    const openedGenes = await Promise.all(
      genes.map((gene) => this.binnedGene(binned, gene)),
    )
    throwIfAborted(options.signal)
    const nativeBinSize =
      binned.grid.tileSize / Math.max(1, openedGenes.find(hasTiles)?.cols ?? 1)
    const { level, binSize } = ateraDensityBinSize(
      bbox,
      nativeBinSize,
      options.maxBins ?? DEFAULT_MAX_BINS,
    )
    const covered: BBox = {
      minX: micrometers(Math.floor(bbox.minX / binSize) * binSize),
      minY: micrometers(Math.floor(bbox.minY / binSize) * binSize),
      maxX: micrometers((Math.floor(bbox.maxX / binSize) + 1) * binSize),
      maxY: micrometers((Math.floor(bbox.maxY / binSize) + 1) * binSize),
    }
    const tiles = ateraTranscriptGridTilesForBbox(binned.grid, covered)
    const geneTiles = await Promise.all(
      openedGenes.map(async (gene) => ({
        name: gene.name,
        tiles: await Promise.all(
          tiles
            .filter((tile) => gene.tileKeys.has(tile.key))
            .map((tile) => this.binnedTile(gene, tile)),
        ),
      })),
    )
    throwIfAborted(options.signal)
    const { bins, visibleCount } = aggregateAteraBinnedTiles({
      genes: geneTiles,
      grid: binned.grid,
      bbox,
      binSize,
    })
    const aggregateBins = [...bins.values()]
      .sort((left, right) => left.binY - right.binY || left.binX - right.binX)
      .map((bin) => densityBinToAggregateBin(bin, level, binSize))

    return {
      bins: aggregateBins,
      level: {
        level,
        gridSizeMicrometers: binSize,
        gridKeys: aggregateBins.map((bin) => `${bin.binX},${bin.binY}`),
        transcriptCounts: aggregateBins.map((bin) => bin.count),
      },
      source: 'native-zarr',
      selectedFeatureNames: genes.map((gene) => gene.name),
      scaleMax: Math.max(1, ...aggregateBins.map((bin) => bin.count)),
      visibleTranscriptCount: visibleCount,
      sourceFile: binned.label,
    }
  }

  // Exact points for the selected genes. Rows within a gene are not sorted
  // spatially, so each gene's whole row range in each visible tile is read,
  // then filtered by box and QV. Cell ids and nucleus overlap are read only
  // for the rows that remain. Over the point limit, the first `pointLimit`
  // points are returned, as the Xenium reader does.
  async viewport(
    bbox: BBox,
    options: AteraTranscriptViewportOptions,
  ): Promise<TranscriptViewportResult> {
    const transcripts = await this.transcripts()
    throwIfAborted(options.signal)
    const pointLimit = Math.max(1, Math.floor(options.pointLimit ?? DEFAULT_POINT_LIMIT))
    const minQv = options.minQv ?? DEFAULT_MIN_QV
    const genes = ateraGeneIndexes(transcripts.geneNames, options.featureNames)
    const tiles = ateraTranscriptGridTilesForBbox(transcripts.grid, bbox)
    const offsets = await Promise.all(
      tiles.map((tile) => this.tileGeneOffsets(transcripts, tile)),
    )
    throwIfAborted(options.signal)
    const ranges: GeneRange[] = []

    tiles.forEach((tile, tileIndex) => {
      const offset = offsets[tileIndex]

      for (const gene of genes) {
        const start = offset === undefined ? 0 : matrixValue(offset, gene.index, 0)
        const end = offset === undefined ? 0 : matrixValue(offset, gene.index, 1)

        if (end > start) {
          ranges.push({ tile, gene, start, end })
        }
      }
    })

    const inBox = await mapWithConcurrency(ranges, READ_CONCURRENCY, async (range) => {
      throwIfAborted(options.signal)
      const location = await this.geneLocations(transcripts, range)
      const rows: number[] = []

      for (let row = 0; row < range.end - range.start; row += 1) {
        const x = matrixValue(location, row, 0)
        const y = matrixValue(location, row, 1)

        if (x >= bbox.minX && x <= bbox.maxX && y >= bbox.minY && y <= bbox.maxY) {
          rows.push(row)
        }
      }

      return { range, location, rows }
    })
    throwIfAborted(options.signal)
    const qualified = await mapWithConcurrency(
      inBox.filter((entry) => entry.rows.length > 0),
      READ_CONCURRENCY,
      async (entry) => {
        throwIfAborted(options.signal)
        const span = rowSpan(entry.range, entry.rows)
        const qualities = await this.readColumn(
          transcripts,
          entry.range.tile,
          'quality_score',
          span,
        )
        const rows: number[] = []
        const qvs: number[] = []

        for (const row of entry.rows) {
          const qv = qualities[entry.range.start + row - span.start] ?? 0

          if (qv >= minQv) {
            rows.push(row)
            qvs.push(qv)
          }
        }

        return { ...entry, rows, qvs }
      },
    )
    throwIfAborted(options.signal)
    const pointCount = qualified.reduce((total, entry) => total + entry.rows.length, 0)
    const kept = keepFirstRows(qualified, pointLimit)

    const pointBatches = await mapWithConcurrency(
      kept,
      READ_CONCURRENCY,
      async ({ range, location, rows, qvs }) => {
        throwIfAborted(options.signal)
        const span = rowSpan(range, rows)
        const [cellIds, overlapsNucleus] = await Promise.all([
          this.readOptionalChunk(transcripts, range.tile, 'cell_id', span),
          this.readOptionalChunk(transcripts, range.tile, 'overlaps_nucleus', span),
        ])

        return rows.map((row, index): TranscriptPoint => {
          const spanRow = range.start + row - span.start
          const cellId =
            cellIds === null
              ? null
              : ateraCellId(
                  matrixValue(cellIds, spanRow, 0),
                  matrixValue(cellIds, spanRow, 1),
                )
          const overlaps =
            overlapsNucleus === null
              ? undefined
              : matrixValue(overlapsNucleus, spanRow, 0)

          return {
            id: `${range.tile.key}:${range.start + row}`,
            cellId,
            cellAssignment:
              cellIds === null ? 'unavailable' : cellId === null ? 'unassigned' : 'known',
            featureName: range.gene.name,
            fovName: null,
            position: {
              x: micrometers(matrixValue(location, row, 0)),
              y: micrometers(matrixValue(location, row, 1)),
            },
            zLocation: matrixValue(location, row, 2),
            qv: qvs[index] ?? 0,
            ...(overlaps === undefined ? {} : { overlapsNucleus: overlaps !== 0 }),
            isGene: true,
          }
        })
      },
    )
    throwIfAborted(options.signal)
    const points = pointBatches.flat()

    return {
      points,
      groups: transcriptGroupsFromPoints(
        points,
        options.groupLimit ?? DEFAULT_GROUP_LIMIT,
      ),
      hitPointLimit: pointCount > pointLimit,
    }
  }

  private binned(): Promise<BinnedStore> {
    if (this.binnedPromise === null) {
      this.binnedPromise = this.readBinned().catch((error: unknown) => {
        this.binnedPromise = null
        throw error
      })
    }

    return this.binnedPromise
  }

  private async readBinned(): Promise<BinnedStore> {
    const { url, label } = await this.options.binned()
    const { store } = await this.options.openZipStore(url)
    const group = await zarr.open.v2(zarr.root(store), { kind: 'group' })

    return {
      store,
      label,
      geneNames: stringArrayAttr(group.attrs.gene_names, `${label} gene_names`),
      grid: parseAteraTranscriptGrid(group.attrs, label),
    }
  }

  private binnedGene(
    binned: BinnedStore,
    gene: { readonly index: number; readonly name: string },
  ): Promise<BinnedGene> {
    const cached = this.binnedGenes.get(gene.index)

    if (cached !== undefined) {
      this.binnedGenes.delete(gene.index)
      this.binnedGenes.set(gene.index, cached)
      return cached
    }

    const promise = this.readBinnedGene(binned, gene).catch((error: unknown) => {
      this.binnedGenes.delete(gene.index)
      throw error
    })
    this.binnedGenes.set(gene.index, promise)
    evictOldest(this.binnedGenes, BINNED_GENE_CACHE_LIMIT)
    return promise
  }

  // Each gene is a zip stored inside the binned zip (`gene/<index>.zip`, about
  // 50–150 KB), read in one request and opened in memory. Genes without
  // transcripts have no entry.
  private async readBinnedGene(
    binned: BinnedStore,
    gene: { readonly index: number; readonly name: string },
  ): Promise<BinnedGene> {
    const bytes = await binned.store.get(`/gene/${gene.index}.zip`)

    if (bytes === undefined) {
      return {
        name: gene.name,
        root: null,
        rows: 0,
        cols: 0,
        tileKeys: new Set(),
        tiles: new Map(),
      }
    }

    const root = zarr.root(new ZipFileStore(new MemoryReader(bytes)))
    const grid = await zarr.open.v2(root.resolve('grid'), { kind: 'group' })
    const label = `${binned.label} gene/${gene.index}.zip`
    const rows = positiveInteger(grid.attrs.rows, `${label} rows`)
    const cols = positiveInteger(grid.attrs.cols, `${label} cols`)
    const tileKeys = parseAteraTranscriptGrid(
      { grid_size: binned.grid.tileSize, grid_keys: grid.attrs.grid_keys },
      label,
    ).tiles.map((tile) => tile.key)

    return {
      name: gene.name,
      root,
      rows,
      cols,
      tileKeys: new Set(tileKeys),
      tiles: new Map(),
    }
  }

  private binnedTile(
    gene: BinnedGene,
    tile: AteraTranscriptGridTile,
  ): Promise<AteraBinnedTile> {
    const cached = gene.tiles.get(tile.key)

    if (cached !== undefined) {
      return cached
    }

    const promise = this.readBinnedTile(gene, tile).catch((error: unknown) => {
      gene.tiles.delete(tile.key)
      throw error
    })
    gene.tiles.set(tile.key, promise)
    return promise
  }

  private async readBinnedTile(
    gene: BinnedGene,
    tile: AteraTranscriptGridTile,
  ): Promise<AteraBinnedTile> {
    const { root } = gene

    if (root === null) {
      throw new Error(`No binned transcripts for ${gene.name}.`)
    }

    const read = async (name: string) =>
      numericData(
        await zarr.get(
          await zarr.open.v2(root.resolve(`grid/${tile.key}/${name}`), { kind: 'array' }),
          [null],
        ),
      )
    const [indptr, indices, data] = await Promise.all([
      read('indptr'),
      read('indices'),
      read('data'),
    ])

    return {
      x: tile.x,
      y: tile.y,
      rows: gene.rows,
      cols: gene.cols,
      indptr,
      indices,
      data,
    }
  }

  private transcripts(): Promise<TranscriptStore> {
    if (this.transcriptsPromise === null) {
      this.transcriptsPromise = this.readTranscripts().catch((error: unknown) => {
        this.transcriptsPromise = null
        throw error
      })
    }

    return this.transcriptsPromise
  }

  private async readTranscripts(): Promise<TranscriptStore> {
    const { url, label } = await this.options.transcripts()
    const { store } = await this.options.openZipStore(url)
    const halfFloatArrays = new Set<string>()
    const root = zarr.root(float16AsUint16(store, halfFloatArrays))
    const [group, grid] = await Promise.all([
      zarr.open.v2(root, { kind: 'group' }),
      zarr.open.v2(root.resolve('grid'), { kind: 'group' }),
    ])

    return {
      root,
      label,
      geneNames: stringArrayAttr(group.attrs.gene_names, `${label} gene_names`),
      grid: parseAteraTranscriptGrid(grid.attrs, `${label} grid`),
      halfFloatArrays,
    }
  }

  private tileArray(
    transcripts: TranscriptStore,
    tile: AteraTranscriptGridTile,
    name: string,
  ): Promise<ZarrArray> {
    const key = `${tile.key}/${name}`
    const cached = this.tileArrays.get(key)

    if (cached !== undefined) {
      return cached
    }

    const promise = zarr.open
      .v2(transcripts.root.resolve(`grid/${tile.key}/${name}`), { kind: 'array' })
      .catch((error: unknown) => {
        this.tileArrays.delete(key)
        throw error
      })
    this.tileArrays.set(key, promise)
    return promise
  }

  // `gene_offset` [genes, 2]: each gene's [start, end) rows in the tile.
  private tileGeneOffsets(
    transcripts: TranscriptStore,
    tile: AteraTranscriptGridTile,
  ): Promise<ZarrChunk> {
    const cached = this.geneOffsets.get(tile.key)

    if (cached !== undefined) {
      return cached
    }

    const promise = this.tileArray(transcripts, tile, 'gene_offset')
      .then((array) => zarr.get(array, [null, null]))
      .catch((error: unknown) => {
        this.geneOffsets.delete(tile.key)
        throw error
      })
    this.geneOffsets.set(tile.key, promise)
    return promise
  }

  private geneLocations(
    transcripts: TranscriptStore,
    range: GeneRange,
  ): Promise<ZarrChunk> {
    const key = `${range.tile.key}/${range.gene.index}`
    const cached = this.locations.get(key)

    if (cached !== undefined) {
      this.locations.delete(key)
      this.locations.set(key, cached)
      return cached
    }

    const promise = this.tileArray(transcripts, range.tile, 'location')
      .then((array) => zarr.get(array, [zarr.slice(range.start, range.end), null]))
      .catch((error: unknown) => {
        this.locations.delete(key)
        throw error
      })
    this.locations.set(key, promise)
    evictOldest(this.locations, LOCATION_CACHE_LIMIT)
    return promise
  }

  private async readColumn(
    transcripts: TranscriptStore,
    tile: AteraTranscriptGridTile,
    name: string,
    span: { readonly start: number; readonly end: number },
  ): Promise<readonly number[]> {
    const array = await this.tileArray(transcripts, tile, name)
    const chunk = await zarr.get(array, [zarr.slice(span.start, span.end), 0])
    const values = Array.from(numericData(chunk))

    return transcripts.halfFloatArrays.has(array.path)
      ? values.map(halfFloatToNumber)
      : values
  }

  // Cell ids and nucleus overlap enrich hover details; a store without them
  // still shows points.
  private async readOptionalChunk(
    transcripts: TranscriptStore,
    tile: AteraTranscriptGridTile,
    name: string,
    span: { readonly start: number; readonly end: number },
  ): Promise<ZarrChunk | null> {
    try {
      const array = await this.tileArray(transcripts, tile, name)
      return await zarr.get(array, [zarr.slice(span.start, span.end), null])
    } catch (error) {
      if (zarr.isZarritaError(error, 'NotFoundError')) {
        return null
      }

      throw error
    }
  }
}

// The first `limit` rows across entries, in entry order, dropping empty ones.
function keepFirstRows<Entry extends { readonly rows: number[]; readonly qvs: number[] }>(
  entries: readonly Entry[],
  limit: number,
): Entry[] {
  const kept: Entry[] = []
  let remaining = limit

  for (const entry of entries) {
    if (remaining <= 0) {
      break
    }

    if (entry.rows.length === 0) {
      continue
    }

    const count = Math.min(entry.rows.length, remaining)
    kept.push(
      count === entry.rows.length
        ? entry
        : { ...entry, rows: entry.rows.slice(0, count), qvs: entry.qvs.slice(0, count) },
    )
    remaining -= count
  }

  return kept
}

function densityBinToAggregateBin(
  bin: AteraDensityBin,
  level: number,
  binSize: number,
): TranscriptAggregateBin {
  const topFeatures = [...bin.featureCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, DENSITY_FEATURE_SUMMARY_LIMIT)
    .map(([featureName, count]) => ({ featureName, count }))

  return {
    id: `atera-binned:${level}:${bin.binX}:${bin.binY}`,
    source: 'native-zarr',
    glyphType: 'density',
    level,
    binX: bin.binX,
    binY: bin.binY,
    position: {
      x: micrometers((bin.binX + 0.5) * binSize),
      y: micrometers((bin.binY + 0.5) * binSize),
    },
    radiusMicrometers: binSize * 0.42,
    binSizeMicrometers: binSize,
    count: bin.count,
    selectedGeneCount: bin.count,
    topFeatures,
  }
}

function ateraCellId(prefix: number, suffix: number): TranscriptPoint['cellId'] {
  return isAteraUnassignedCell(prefix, suffix) ? null : intToCellId(prefix, suffix)
}

function rowSpan(
  range: GeneRange,
  rows: readonly number[],
): { readonly start: number; readonly end: number } {
  return {
    start: range.start + (rows[0] ?? 0),
    end: range.start + (rows[rows.length - 1] ?? 0) + 1,
  }
}

// Element (row, column) of a 1D or 2D chunk, honouring C or F order.
function matrixValue(chunk: ZarrChunk, row: number, column: number): number {
  const [rowStride = 1, columnStride = 0] = chunk.stride
  return Number(
    (chunk.data as ArrayLike<number>)[row * rowStride + column * columnStride],
  )
}

function numericData(chunk: { readonly data: unknown }): ArrayLike<number> {
  const { data } = chunk

  if (data instanceof BigInt64Array || data instanceof BigUint64Array) {
    return Array.from(data, (value) => Number(value))
  }

  if (ArrayBuffer.isView(data) || Array.isArray(data)) {
    return data as ArrayLike<number>
  }

  throw new Error('Expected a numeric Zarr array.')
}

function hasTiles(gene: BinnedGene): boolean {
  return gene.root !== null
}

// The transcript store's float16 arrays (`quality_score`) are opened as
// uint16 and their bits decoded with halfFloatToNumber, since zarrita needs
// Float16Array for float16 and not every browser has it.
function float16AsUint16(store: Store, halfFloatArrays: Set<string>): Store {
  return {
    async get(key, options) {
      const bytes = await store.get(key, options)

      if (bytes === undefined || !key.endsWith('/.zarray')) {
        return bytes
      }

      const metadata: unknown = JSON.parse(new TextDecoder().decode(bytes))

      if (!isRecord(metadata) || metadata.dtype !== '<f2') {
        return bytes
      }

      halfFloatArrays.add(key.slice(0, -'/.zarray'.length))
      return new TextEncoder().encode(JSON.stringify({ ...metadata, dtype: '<u2' }))
    },
  }
}

class MemoryReader {
  constructor(private readonly bytes: Uint8Array) {}

  async getLength(): Promise<number> {
    return this.bytes.byteLength
  }

  async read(offset: number, size: number): Promise<Uint8Array<ArrayBuffer>> {
    return this.bytes.slice(offset, offset + size)
  }
}

function stringArrayAttr(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} is missing.`)
  }

  return value.map((item) => String(item))
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value
  }

  throw new Error(`${label} must be a positive integer.`)
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function evictOldest<Key, Value>(cache: Map<Key, Value>, limit: number): void {
  while (cache.size > limit) {
    const oldest = cache.keys().next()

    if (oldest.done === true) {
      return
    }

    cache.delete(oldest.value)
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : Object.assign(new Error('Transcript request aborted.'), { name: 'AbortError' })
  }
}
