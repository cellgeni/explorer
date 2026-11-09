// File layout and decoders for 10x Atera Onboard Analysis output bundles.
// The bundle has no Parquet files: cells, boundaries, the cell-feature matrix,
// and transcripts are all zipped Zarr v2 stores, listed in experiment.spatial.
// See docs/modalities/atera.md.

import { micrometers, type BBox, type DataPoint } from '../data/coords'

export const ATERA_EXPERIMENT_FILE = 'experiment.spatial'

// Standard file names, used when neither a dataset manifest nor
// experiment.spatial's `explorer_files` names the file.
export const ATERA_FILE_DEFAULTS = {
  experiment: ATERA_EXPERIMENT_FILE,
  cells: 'cells.zarr.zip',
  cellFeatureMatrix: 'cell_feature_matrix.zarr.zip',
  cscCellFeatureMatrix: 'csc_cell_feature_matrix.zarr.zip',
  transcripts: 'transcripts.zarr.zip',
  binnedTranscripts: 'binned_transcripts.zarr.zip',
} as const

export type AteraFileRole = keyof typeof ATERA_FILE_DEFAULTS

// The morphology image has no standard name; it comes from experiment.spatial,
// and its `.zchunkstore` sidecar is looked for next to it.
export const ATERA_OPTIONAL_FILES = ['morphology', 'morphologyZchunkstore'] as const

export type AteraManifestFileKey = AteraFileRole | (typeof ATERA_OPTIONAL_FILES)[number]

const ATERA_EXPLORER_FILE_KEYS: Readonly<Record<string, AteraFileRole>> = {
  cells_zarr_filepath: 'cells',
  cell_feature_zarr_filepath: 'cellFeatureMatrix',
  cell_feature_viz_zarr_filepath: 'cscCellFeatureMatrix',
  transcripts_zarr_filepath: 'transcripts',
  transcripts_viz_zarr_filepath: 'binnedTranscripts',
}

export const ATERA_GENE_FEATURE_TYPE = 'Gene Expression'

export interface AteraExperiment {
  readonly micrometersPerPixel?: number
  // 2D multi-focus morphology image (multi-file OME-TIFF). The 3D DAPI stack is
  // not used: it is much larger and the viewer shows one plane.
  readonly morphologyPath?: string
  readonly files: Readonly<Partial<Record<AteraFileRole, string>>>
  readonly cellCount?: number
  readonly transcriptCount?: number
  readonly panelName?: string
  readonly regionName?: string
  readonly analysisVersion?: string
}

export function parseAteraExperiment(json: unknown): AteraExperiment {
  if (!isRecord(json)) {
    throw new Error(`${ATERA_EXPERIMENT_FILE} is not a JSON object.`)
  }

  const files: Partial<Record<AteraFileRole, string>> = {}
  const explorerFiles = isRecord(json.explorer_files) ? json.explorer_files : {}

  for (const [key, role] of Object.entries(ATERA_EXPLORER_FILE_KEYS)) {
    const path = nonEmptyString(explorerFiles[key])

    if (path !== undefined) {
      files[role] = path
    }
  }

  const images = isRecord(json.images) ? json.images : {}
  const panel = isRecord(json.panel_wta) ? json.panel_wta : {}
  const micrometersPerPixel = positiveNumber(json.pixel_size)
  const morphologyPath = nonEmptyString(images.morphology_2d_filepath)
  const cellCount = positiveNumber(json.num_cells)
  const transcriptCount = positiveNumber(json.num_transcripts)
  const panelName = nonEmptyString(panel.panel_name)
  const regionName = nonEmptyString(json.region_name)
  const analysisVersion = nonEmptyString(json.analysis_sw_version)

  return {
    files,
    ...(micrometersPerPixel === undefined ? {} : { micrometersPerPixel }),
    ...(morphologyPath === undefined ? {} : { morphologyPath }),
    ...(cellCount === undefined ? {} : { cellCount }),
    ...(transcriptCount === undefined ? {} : { transcriptCount }),
    ...(panelName === undefined ? {} : { panelName }),
    ...(regionName === undefined ? {} : { regionName }),
    ...(analysisVersion === undefined ? {} : { analysisVersion }),
  }
}

// cells.zarr.zip `gridded_polygon_sets/<set>`: polygons tiled by centroid
// into square tiles, `grid_size` µm at level 0 and doubling per level. Every
// level holds every polygon once; coarser levels have fewer vertices.
export interface AteraPolygonGrid {
  readonly levels: readonly AteraPolygonGridLevel[]
}

export interface AteraPolygonGridLevel {
  readonly level: number
  readonly tileSize: number
  readonly tiles: readonly AteraPolygonGridTile[]
}

export interface AteraPolygonGridTile {
  // Zarr group name, `<x>,<y>`.
  readonly key: string
  readonly x: number
  readonly y: number
  readonly objectCount: number
}

export function parseAteraPolygonGridAttrs(attrs: unknown): AteraPolygonGrid {
  if (!isRecord(attrs)) {
    throw new Error('Atera gridded polygon set has no attributes.')
  }

  const gridSize = Array.isArray(attrs.grid_size) ? attrs.grid_size[0] : attrs.grid_size
  const baseTileSize = positiveNumber(gridSize)
  const keysByLevel = Array.isArray(attrs.grid_keys) ? attrs.grid_keys : []
  const countsByLevel = Array.isArray(attrs.grid_number_objects)
    ? attrs.grid_number_objects
    : []

  if (baseTileSize === undefined || keysByLevel.length === 0) {
    throw new Error('Atera gridded polygon set is missing grid_size or grid_keys.')
  }

  return {
    levels: keysByLevel.map((levelKeys: unknown, level) => {
      const counts: unknown = countsByLevel[level]
      const tiles: AteraPolygonGridTile[] = []

      if (Array.isArray(levelKeys)) {
        levelKeys.forEach((key: unknown, index) => {
          const tile = parseTileKey(key)

          if (tile !== null) {
            tiles.push({
              ...tile,
              objectCount: Array.isArray(counts) ? Number(counts[index] ?? 0) : 0,
            })
          }
        })
      }

      return { level, tileSize: baseTileSize * 2 ** level, tiles }
    }),
  }
}

// Coarser levels once the request spans many level-0 tiles, so a whole-slide
// request reads a few simplified tiles instead of hundreds of detailed ones.
const POLYGON_GRID_TILES_ACROSS = 4

export function ateraPolygonGridLevelForBbox(grid: AteraPolygonGrid, bbox: BBox): number {
  const span = Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY)
  const baseTileSize = grid.levels[0]?.tileSize ?? 1
  const level = Math.floor(Math.log2(span / (baseTileSize * POLYGON_GRID_TILES_ACROSS)))

  return Math.min(Math.max(level, 0), Math.max(grid.levels.length - 1, 0))
}

// Tiles whose polygons can reach the box. Polygons are tiled by centroid, so
// the box is padded by the largest polygon extent.
export function ateraPolygonGridTilesForBbox(
  level: AteraPolygonGridLevel,
  bbox: BBox,
  padding: number,
): readonly AteraPolygonGridTile[] {
  const { tileSize } = level

  return level.tiles.filter((tile) => {
    const minX = tile.x * tileSize - padding
    const minY = tile.y * tileSize - padding
    const maxX = (tile.x + 1) * tileSize + padding
    const maxY = (tile.y + 1) * tileSize + padding

    return (
      tile.objectCount > 0 &&
      minX <= bbox.maxX &&
      maxX >= bbox.minX &&
      minY <= bbox.maxY &&
      maxY >= bbox.minY
    )
  })
}

export interface AteraDecodedPolygon {
  readonly cellIndex: number
  readonly ring: readonly DataPoint[]
}

// `relative_vertices` holds interleaved x,y bytes scaled to the cell's
// bounding box (`bboxes`, [minX, minY, maxX, maxY] per cell, in µm). Rings do
// not repeat their first vertex.
export function decodeAteraGriddedPolygons(input: {
  readonly cellIndex: ArrayLike<number>
  readonly numVertices: ArrayLike<number>
  readonly relativeVertices: ArrayLike<number>
  readonly bboxes: ArrayLike<number>
}): readonly AteraDecodedPolygon[] {
  const { cellIndex, numVertices, relativeVertices, bboxes } = input
  const polygons: AteraDecodedPolygon[] = []
  let offset = 0

  for (let polygon = 0; polygon < cellIndex.length; polygon += 1) {
    const cell = cellIndex[polygon] ?? 0
    const vertexCount = Math.max(0, numVertices[polygon] ?? 0)
    const minX = bboxes[cell * 4] ?? 0
    const minY = bboxes[cell * 4 + 1] ?? 0
    const width = (bboxes[cell * 4 + 2] ?? minX) - minX
    const height = (bboxes[cell * 4 + 3] ?? minY) - minY
    const ring: DataPoint[] = []

    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const relativeX = relativeVertices[offset + vertex * 2] ?? 0
      const relativeY = relativeVertices[offset + vertex * 2 + 1] ?? 0
      ring.push({
        x: micrometers(minX + (relativeX / 255) * width),
        y: micrometers(minY + (relativeY / 255) * height),
      })
    }

    offset += vertexCount * 2

    if (ring.length >= 3) {
      polygons.push({ cellIndex: cell, ring })
    }
  }

  return polygons
}

// Largest bounding-box side over all cells, in µm.
export function ateraMaxPolygonExtent(bboxes: ArrayLike<number>): number {
  let extent = 0

  for (let index = 0; index + 3 < bboxes.length; index += 4) {
    const width = (bboxes[index + 2] ?? 0) - (bboxes[index] ?? 0)
    const height = (bboxes[index + 3] ?? 0) - (bboxes[index + 1] ?? 0)

    if (Number.isFinite(width) && Number.isFinite(height)) {
      extent = Math.max(extent, width, height)
    }
  }

  return extent
}

// binned_transcripts.zarr.zip and transcripts.zarr.zip both split the slide
// into `grid_size` µm square tiles keyed `<x>,<y>` (keys can be negative), at
// `origin` when the store gives one.
export interface AteraTranscriptGrid {
  readonly tileSize: number
  readonly originX: number
  readonly originY: number
  readonly tiles: readonly AteraTranscriptGridTile[]
}

export interface AteraTranscriptGridTile {
  readonly key: string
  readonly x: number
  readonly y: number
}

export function parseAteraTranscriptGrid(
  attrs: unknown,
  label: string,
): AteraTranscriptGrid {
  const record = isRecord(attrs) ? attrs : {}
  const tileSize = positiveNumber(
    Array.isArray(record.grid_size) ? record.grid_size[0] : record.grid_size,
  )
  const keys = Array.isArray(record.grid_keys) ? record.grid_keys : null

  if (tileSize === undefined || keys === null) {
    throw new Error(`${label} is missing grid_size or grid_keys.`)
  }

  const origin = isRecord(record.origin) ? record.origin : {}
  const tiles: AteraTranscriptGridTile[] = []

  for (const key of keys) {
    const tile = parseTileKey(key)

    if (tile !== null) {
      tiles.push(tile)
    }
  }

  return {
    tileSize,
    originX: finiteNumber(origin.x) ?? 0,
    originY: finiteNumber(origin.y) ?? 0,
    tiles,
  }
}

export function ateraTranscriptGridTilesForBbox(
  grid: AteraTranscriptGrid,
  bbox: BBox,
): readonly AteraTranscriptGridTile[] {
  return grid.tiles.filter((tile) => {
    const minX = grid.originX + tile.x * grid.tileSize
    const minY = grid.originY + tile.y * grid.tileSize

    return (
      minX <= bbox.maxX &&
      minX + grid.tileSize >= bbox.minX &&
      minY <= bbox.maxY &&
      minY + grid.tileSize >= bbox.minY
    )
  })
}

// Store gene indexes of the requested genes, matched exactly and then ignoring
// case. Both transcript stores list `gene_names` in matrix feature order.
export function ateraGeneIndexes(
  geneNames: readonly string[],
  featureNames: readonly string[],
): readonly { readonly index: number; readonly name: string }[] {
  const indexByName = new Map<string, number>()
  const indexByUpperName = new Map<string, number>()

  geneNames.forEach((name, index) => {
    indexByName.set(name, index)

    if (!indexByUpperName.has(name.toUpperCase())) {
      indexByUpperName.set(name.toUpperCase(), index)
    }
  })

  const genes: { index: number; name: string }[] = []
  const seen = new Set<number>()

  for (const featureName of featureNames) {
    const index =
      indexByName.get(featureName) ?? indexByUpperName.get(featureName.toUpperCase())
    const name = index === undefined ? undefined : geneNames[index]

    if (index !== undefined && name !== undefined && !seen.has(index)) {
      seen.add(index)
      genes.push({ index, name })
    }
  }

  return genes
}

const ATERA_DENSITY_MAX_LEVEL = 16

// The finest density bins that fit: the native bin size doubles until the box
// spans at most `maxBins` bins. Bins are aligned to the coordinate origin, so
// panning keeps bin edges in place.
export function ateraDensityBinSize(
  bbox: BBox,
  nativeBinSize: number,
  maxBins: number,
): { readonly level: number; readonly binSize: number } {
  const limit = Math.max(1, Math.floor(maxBins))
  const base = Math.max(Number.EPSILON, nativeBinSize)
  let level = 0

  while (level < ATERA_DENSITY_MAX_LEVEL) {
    const binSize = base * 2 ** level

    if (ateraDensityBinCount(bbox, binSize) <= limit) {
      return { level, binSize }
    }

    level += 1
  }

  return { level, binSize: base * 2 ** level }
}

function ateraDensityBinCount(bbox: BBox, binSize: number): number {
  const columns = Math.floor(bbox.maxX / binSize) - Math.floor(bbox.minX / binSize) + 1
  const rows = Math.floor(bbox.maxY / binSize) - Math.floor(bbox.minY / binSize) + 1
  return columns * rows
}

// One gene's 5 µm counts in one binned_transcripts tile: a CSR matrix whose
// rows are y bins and columns x bins, starting at the tile corner.
export interface AteraBinnedTile {
  readonly x: number
  readonly y: number
  readonly rows: number
  readonly cols: number
  readonly indptr: ArrayLike<number>
  readonly indices: ArrayLike<number>
  readonly data: ArrayLike<number>
}

export interface AteraDensityBin {
  readonly binX: number
  readonly binY: number
  count: number
  readonly featureCounts: Map<string, number>
}

// Sums native bins into `binSize` squares covering the box, so edge squares
// are whole. `visibleCount` counts native bins whose centre is in the box.
export function aggregateAteraBinnedTiles(input: {
  readonly genes: readonly {
    readonly name: string
    readonly tiles: readonly AteraBinnedTile[]
  }[]
  readonly grid: Pick<AteraTranscriptGrid, 'tileSize' | 'originX' | 'originY'>
  readonly bbox: BBox
  readonly binSize: number
}): {
  readonly bins: ReadonlyMap<string, AteraDensityBin>
  readonly visibleCount: number
} {
  const { bbox, binSize, grid } = input
  const minBinX = Math.floor(bbox.minX / binSize)
  const maxBinX = Math.floor(bbox.maxX / binSize)
  const minBinY = Math.floor(bbox.minY / binSize)
  const maxBinY = Math.floor(bbox.maxY / binSize)
  const coveredMinY = minBinY * binSize
  const coveredMaxY = (maxBinY + 1) * binSize
  const bins = new Map<string, AteraDensityBin>()
  let visibleCount = 0

  for (const gene of input.genes) {
    for (const tile of gene.tiles) {
      const tileMinX = grid.originX + tile.x * grid.tileSize
      const tileMinY = grid.originY + tile.y * grid.tileSize
      const binWidth = grid.tileSize / Math.max(1, tile.cols)
      const binHeight = grid.tileSize / Math.max(1, tile.rows)
      const firstRow = Math.max(0, Math.floor((coveredMinY - tileMinY) / binHeight))
      const lastRow = Math.min(
        tile.rows - 1,
        Math.floor((coveredMaxY - tileMinY) / binHeight),
      )

      for (let row = firstRow; row <= lastRow; row += 1) {
        const y = tileMinY + (row + 0.5) * binHeight
        const binY = Math.floor(y / binSize)

        if (binY < minBinY || binY > maxBinY) {
          continue
        }

        const start = tile.indptr[row] ?? 0
        const end = tile.indptr[row + 1] ?? start
        const rowInBox = y >= bbox.minY && y <= bbox.maxY

        for (let pointer = start; pointer < end; pointer += 1) {
          const count = tile.data[pointer] ?? 0

          if (count <= 0) {
            continue
          }

          const x = tileMinX + ((tile.indices[pointer] ?? 0) + 0.5) * binWidth
          const binX = Math.floor(x / binSize)

          if (binX < minBinX || binX > maxBinX) {
            continue
          }

          if (rowInBox && x >= bbox.minX && x <= bbox.maxX) {
            visibleCount += count
          }

          const key = `${binX},${binY}`
          let bin = bins.get(key)

          if (bin === undefined) {
            bin = { binX, binY, count: 0, featureCounts: new Map() }
            bins.set(key, bin)
          }

          bin.count += count
          bin.featureCounts.set(
            gene.name,
            (bin.featureCounts.get(gene.name) ?? 0) + count,
          )
        }
      }
    }
  }

  return { bins, visibleCount }
}

// transcripts.zarr.zip `cell_id` holds (prefix, dataset suffix) pairs; both
// are UINT32_MAX for transcripts outside cells.
const ATERA_UNASSIGNED_CELL_PART = 0xffff_ffff

export function isAteraUnassignedCell(prefix: number, suffix: number): boolean {
  return prefix === ATERA_UNASSIGNED_CELL_PART || suffix === ATERA_UNASSIGNED_CELL_PART
}

// IEEE 754 half-precision bits to a number. `quality_score` is float16, which
// is read as raw uint16 so browsers without Float16Array can decode it.
export function halfFloatToNumber(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1
  const exponent = (bits >> 10) & 0x1f
  const fraction = bits & 0x3ff

  if (exponent === 0) {
    return sign * 2 ** -14 * (fraction / 1024)
  }

  if (exponent === 0x1f) {
    return fraction === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN
  }

  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024)
}

export function bboxesIntersect(left: BBox, right: BBox): boolean {
  return (
    left.minX <= right.maxX &&
    left.maxX >= right.minX &&
    left.minY <= right.maxY &&
    left.maxY >= right.minY
  )
}

function parseTileKey(value: unknown): { key: string; x: number; y: number } | null {
  const parts = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : null
  const x = Number(parts?.[0])
  const y = Number(parts?.[1])

  return parts?.length === 2 && Number.isInteger(x) && Number.isInteger(y)
    ? { key: `${x},${y}`, x, y }
    : null
}

function positiveNumber(value: unknown): number | undefined {
  const number = typeof value === 'string' ? Number(value) : value
  return typeof number === 'number' && Number.isFinite(number) && number > 0
    ? number
    : undefined
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
