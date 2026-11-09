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

// The morphology image has no standard name; it comes from experiment.spatial.
export const ATERA_OPTIONAL_FILES = ['morphology'] as const

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

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
