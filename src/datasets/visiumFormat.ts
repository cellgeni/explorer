// Standard Visium (v1/v2, 55 µm spots): Space Ranger `outs/` file names, scale
// factors, tissue positions, and how pixel coordinates become micrometres.
// The same rules apply to an AnnData file that carries the Visium layout in
// `uns/spatial/<library>` (scanpy, squidpy, CELLxGENE).

import { micrometers, type DataPoint } from '../data/coords'
import { fitGridBasis } from './spatialGrid'
import { estimateUnitsFromVisiumSpots } from './spatialDataUnits'

// Capture spots are 55 µm across, 100 µm apart centre to centre, on a
// hexagonal lattice. `array_col` steps by 2 between neighbours in a row and
// rows are offset by one column, so one column index is 50 µm and one row is
// 100 × √3 / 2 µm.
export const VISIUM_SPOT_DIAMETER_MICROMETERS = 55
export const VISIUM_SPOT_PITCH_MICROMETERS = 100
const VISIUM_COLUMN_STEP_MICROMETERS = VISIUM_SPOT_PITCH_MICROMETERS / 2
const VISIUM_ROW_STEP_MICROMETERS = (VISIUM_SPOT_PITCH_MICROMETERS * Math.sqrt(3)) / 2
// `spot_diameter_fullres` spans a nominal 65 µm spot drawn for visualization
// (10x documents 60-70 µm), not the 55 µm capture area.
export const VISIUM_SPOT_DIAMETER_FULLRES_MICROMETERS = 65
export const VISIUM_SPOT_AREA_SQUARE_MICROMETERS =
  Math.PI * (VISIUM_SPOT_DIAMETER_MICROMETERS / 2) ** 2

// Files a manifest can relocate, with the Space Ranger name used otherwise.
export const VISIUM_FILE_DEFAULTS = {
  tissuePositions: 'spatial/tissue_positions.csv',
  scalefactors: 'spatial/scalefactors_json.json',
  filteredMatrix: 'filtered_feature_bc_matrix.h5',
  hiresImage: 'spatial/tissue_hires_image.png',
  lowresImage: 'spatial/tissue_lowres_image.png',
} as const

export type VisiumFileRole = keyof typeof VISIUM_FILE_DEFAULTS

// The filtered matrix is read whole into memory; the same limit as .h5ad files.
export const VISIUM_MATRIX_MAX_BYTES = 300 * 1024 * 1024

// Space Ranger 1.x name for the positions table, which has no header row.
export const VISIUM_LEGACY_TISSUE_POSITIONS = 'spatial/tissue_positions_list.csv'

// Secondary analysis files; Space Ranger 2.0 added the `gene_expression_`
// prefix. A manifest can name one file per key instead.
export const VISIUM_ANALYSIS_FILE_CANDIDATES = {
  clusters: [
    'analysis/clustering/gene_expression_graphclust/clusters.csv',
    'analysis/clustering/graphclust/clusters.csv',
  ],
  umap: [
    'analysis/umap/gene_expression_2_components/projection.csv',
    'analysis/umap/2_components/projection.csv',
  ],
  tsne: [
    'analysis/tsne/gene_expression_2_components/projection.csv',
    'analysis/tsne/2_components/projection.csv',
  ],
  pca: [
    'analysis/pca/gene_expression_10_components/projection.csv',
    'analysis/pca/10_components/projection.csv',
  ],
} as const

export type VisiumAnalysisFileKey = keyof typeof VISIUM_ANALYSIS_FILE_CANDIDATES

export const VISIUM_OPTIONAL_FILES = Object.keys(
  VISIUM_ANALYSIS_FILE_CANDIDATES,
) as readonly VisiumAnalysisFileKey[]

export type VisiumImageKind = 'hires' | 'lowres'

export interface VisiumScalefactors {
  readonly spotDiameterFullres?: number
  readonly fiducialDiameterFullres?: number
  readonly tissueHiresScalef?: number
  readonly tissueLowresScalef?: number
  // Written for Visium HD; standard Visium outputs usually leave it out.
  readonly micronsPerPixel?: number
}

const SCALEFACTOR_KEYS = {
  spot_diameter_fullres: 'spotDiameterFullres',
  fiducial_diameter_fullres: 'fiducialDiameterFullres',
  tissue_hires_scalef: 'tissueHiresScalef',
  tissue_lowres_scalef: 'tissueLowresScalef',
  microns_per_pixel: 'micronsPerPixel',
} as const satisfies Record<string, keyof VisiumScalefactors>

export const VISIUM_SCALEFACTOR_NAMES = Object.keys(SCALEFACTOR_KEYS)

// Reads `scalefactors_json.json`, or the `scalefactors` mapping of an AnnData
// `uns/spatial/<library>`. Unknown and non-positive values are left out.
export function parseVisiumScalefactors(
  value: Readonly<Record<string, unknown>>,
): VisiumScalefactors {
  const scalefactors: Partial<Record<keyof VisiumScalefactors, number>> = {}

  for (const [name, key] of Object.entries(SCALEFACTOR_KEYS)) {
    const raw = value[name]
    const parsed = typeof raw === 'string' ? Number(raw) : raw

    if (typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0) {
      scalefactors[key] = parsed
    }
  }

  return scalefactors
}

export function visiumImageScalefactor(
  scalefactors: VisiumScalefactors,
  kind: VisiumImageKind,
): number | undefined {
  return kind === 'hires'
    ? scalefactors.tissueHiresScalef
    : scalefactors.tissueLowresScalef
}

export interface VisiumTissuePositions {
  readonly barcodes: readonly string[]
  readonly inTissue: Uint8Array
  readonly arrayRows: Int32Array
  readonly arrayCols: Int32Array
  // Full-resolution image pixels: `pxl_col_in_fullres` is x and
  // `pxl_row_in_fullres` is y.
  readonly pixelX: Float64Array
  readonly pixelY: Float64Array
}

const TISSUE_POSITION_COLUMNS = [
  'barcode',
  'in_tissue',
  'array_row',
  'array_col',
  'pxl_row_in_fullres',
  'pxl_col_in_fullres',
] as const

// `tissue_positions.csv` (Space Ranger 2.0+, with a header) or
// `tissue_positions_list.csv` (1.x, the same columns without one).
export function parseVisiumTissuePositions(text: string): VisiumTissuePositions {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
  const firstFields = splitCsvLine(lines[0] ?? '')
  const hasHeader = firstFields.some((field) =>
    (TISSUE_POSITION_COLUMNS as readonly string[]).includes(field.trim().toLowerCase()),
  )
  const header = hasHeader
    ? firstFields.map((field) => field.trim().toLowerCase())
    : [...TISSUE_POSITION_COLUMNS]
  const columnIndex = Object.fromEntries(
    TISSUE_POSITION_COLUMNS.map((name) => [name, header.indexOf(name)]),
  ) as Record<(typeof TISSUE_POSITION_COLUMNS)[number], number>
  const missing = TISSUE_POSITION_COLUMNS.filter((name) => columnIndex[name] < 0)

  if (missing.length > 0) {
    throw new Error(
      `Visium tissue positions are missing the ${missing.join(', ')} column${missing.length === 1 ? '' : 's'}.`,
    )
  }

  const rows = hasHeader ? lines.slice(1) : lines

  if (rows.length === 0) {
    throw new Error('Visium tissue positions list no spots.')
  }

  const barcodes: string[] = []
  const inTissue = new Uint8Array(rows.length)
  const arrayRows = new Int32Array(rows.length)
  const arrayCols = new Int32Array(rows.length)
  const pixelX = new Float64Array(rows.length)
  const pixelY = new Float64Array(rows.length)

  rows.forEach((line, index) => {
    const fields = splitCsvLine(line)
    const number = (name: (typeof TISSUE_POSITION_COLUMNS)[number]) => {
      const value = Number(fields[columnIndex[name]])

      if (!Number.isFinite(value)) {
        throw new Error(
          `Visium tissue positions row ${(index + 1).toLocaleString()} has no numeric ${name}.`,
        )
      }

      return value
    }

    barcodes.push((fields[columnIndex.barcode] ?? '').trim())
    inTissue[index] = number('in_tissue') === 0 ? 0 : 1
    arrayRows[index] = number('array_row')
    arrayCols[index] = number('array_col')
    pixelX[index] = number('pxl_col_in_fullres')
    pixelY[index] = number('pxl_row_in_fullres')
  })

  return { barcodes, inTissue, arrayRows, arrayCols, pixelX, pixelY }
}

export type VisiumUnitsSource =
  | 'scalefactors'
  | 'spot-grid'
  | 'spot-pitch'
  | 'spot-diameter'
  | 'unknown'

export interface VisiumUnits {
  readonly micrometersPerPixel: number
  readonly source: VisiumUnitsSource
  readonly detail: string
}

export interface VisiumLatticeSample {
  readonly row: number
  readonly col: number
  readonly x: number
  readonly y: number
}

const MIN_LATTICE_SAMPLES = 20
const MAX_LATTICE_SAMPLES = 20_000
// Row and column pitches must agree this closely for the array indices to be
// the Visium hexagonal lattice.
const LATTICE_AGREEMENT_TOLERANCE = 0.05

// Micrometres per full-resolution pixel, from, in order: a declared
// `microns_per_pixel`, an affine fit of spot pixels against array row and
// column, the median nearest-neighbour spot distance, then the nominal size
// behind `spot_diameter_fullres`. 10x recommends calibrated pixel sizes over
// the spot diameter, which is only an estimate.
export function resolveVisiumUnits(options: {
  readonly scalefactors: VisiumScalefactors
  readonly lattice?: readonly VisiumLatticeSample[] | null
  readonly centers?: readonly { readonly x: number; readonly y: number }[] | null
}): VisiumUnits {
  const { scalefactors } = options

  if (scalefactors.micronsPerPixel !== undefined) {
    return {
      micrometersPerPixel: scalefactors.micronsPerPixel,
      source: 'scalefactors',
      detail: 'microns_per_pixel',
    }
  }

  const fromGrid =
    options.lattice === undefined || options.lattice === null
      ? null
      : micrometersPerPixelFromLattice(options.lattice)

  if (fromGrid !== null) {
    return {
      micrometersPerPixel: fromGrid,
      source: 'spot-grid',
      detail: `array row/column fit (${VISIUM_SPOT_PITCH_MICROMETERS} µm spot pitch)`,
    }
  }

  const fromPitch =
    options.centers === undefined || options.centers === null
      ? null
      : estimateUnitsFromVisiumSpots(options.centers)

  if (fromPitch !== null) {
    return {
      micrometersPerPixel: fromPitch.micrometersPerUnit,
      source: 'spot-pitch',
      detail: `nearest-neighbour spot distance (${VISIUM_SPOT_PITCH_MICROMETERS} µm)`,
    }
  }

  if (scalefactors.spotDiameterFullres !== undefined) {
    return {
      micrometersPerPixel:
        VISIUM_SPOT_DIAMETER_FULLRES_MICROMETERS / scalefactors.spotDiameterFullres,
      source: 'spot-diameter',
      detail: `spot_diameter_fullres as ${VISIUM_SPOT_DIAMETER_FULLRES_MICROMETERS} µm`,
    }
  }

  return {
    micrometersPerPixel: 1,
    source: 'unknown',
    detail: 'no scale factor or spot lattice; 1 pixel shown as 1 µm',
  }
}

export function micrometersPerPixelFromLattice(
  samples: readonly VisiumLatticeSample[],
): number | null {
  const usable = samples.filter(
    (sample) =>
      Number.isFinite(sample.row) &&
      Number.isFinite(sample.col) &&
      Number.isFinite(sample.x) &&
      Number.isFinite(sample.y),
  )

  if (usable.length < MIN_LATTICE_SAMPLES) {
    return null
  }

  if (
    new Set(usable.map((sample) => sample.row)).size < 2 ||
    new Set(usable.map((sample) => sample.col)).size < 2
  ) {
    return null
  }

  const stride = Math.max(1, Math.ceil(usable.length / MAX_LATTICE_SAMPLES))
  const fitSamples = usable
    .filter((_sample, index) => index % stride === 0)
    .map((sample) => ({
      row: sample.row,
      col: sample.col,
      point: { x: micrometers(sample.x), y: micrometers(sample.y) },
    }))
  let basis: ReturnType<typeof fitGridBasis>

  try {
    basis = fitGridBasis(fitSamples)
  } catch {
    return null
  }

  const pixelsPerColumn = Math.hypot(basis.colStep.x, basis.colStep.y)
  const pixelsPerRow = Math.hypot(basis.rowStep.x, basis.rowStep.y)
  const fromColumns = VISIUM_COLUMN_STEP_MICROMETERS / pixelsPerColumn
  const fromRows = VISIUM_ROW_STEP_MICROMETERS / pixelsPerRow

  if (
    !Number.isFinite(fromColumns) ||
    !Number.isFinite(fromRows) ||
    fromColumns <= 0 ||
    fromRows <= 0 ||
    Math.abs(fromColumns - fromRows) / Math.max(fromColumns, fromRows) >
      LATTICE_AGREEMENT_TOLERANCE
  ) {
    return null
  }

  return (fromColumns + fromRows) / 2
}

export function formatVisiumUnits(units: VisiumUnits): string {
  if (units.source === 'unknown') {
    return `unknown (${units.detail})`
  }

  return `${units.micrometersPerPixel.toLocaleString(undefined, {
    maximumSignificantDigits: 4,
  })} µm per pixel (${units.detail})`
}

const SPOT_RING_SEGMENTS = 32

// Spot outline as a closed-by-convention polygon ring in micrometres.
export function visiumSpotRing(
  center: DataPoint,
  diameterMicrometers: number = VISIUM_SPOT_DIAMETER_MICROMETERS,
): readonly DataPoint[] {
  const radius = diameterMicrometers / 2

  return Array.from({ length: SPOT_RING_SEGMENTS }, (_value, index) => {
    const angle = (2 * Math.PI * index) / SPOT_RING_SEGMENTS
    return {
      x: micrometers(center.x + radius * Math.cos(angle)),
      y: micrometers(center.y + radius * Math.sin(angle)),
    }
  })
}

// `Barcode,Cluster` rows from Space Ranger `analysis/clustering/*/clusters.csv`.
export function parseVisiumClustersCsv(text: string): ReadonlyMap<string, string> {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
  const clusters = new Map<string, string>()
  const header = splitCsvLine(lines[0] ?? '').map((field) => field.trim().toLowerCase())
  const hasHeader = header[0] === 'barcode'

  for (const line of hasHeader ? lines.slice(1) : lines) {
    const [barcode, cluster] = splitCsvLine(line)
    const id = barcode?.trim() ?? ''
    const label = cluster?.trim() ?? ''

    if (id.length > 0 && label.length > 0) {
      clusters.set(id, label)
    }
  }

  return clusters
}

// Space Ranger CSVs quote only fields that need it.
function splitCsvLine(line: string): string[] {
  if (!line.includes('"')) {
    return line.split(',')
  }

  const fields: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]

    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      fields.push(field)
      field = ''
    } else {
      field += char
    }
  }

  fields.push(field)
  return fields
}

type ImageValues = ArrayLike<number | bigint>

// AnnData stores `uns/spatial/<library>/images/<kind>` as a (height, width,
// channels) array: uint8, or float in 0-1 when scanpy read the PNG with
// matplotlib. The browser draws images from URLs, so the array is written out
// as an uncompressed 24-bit BMP. Alpha is dropped and grayscale is repeated
// into RGB.
export function encodeImageArrayAsBmp(
  values: ImageValues,
  shape: readonly number[],
): Uint8Array<ArrayBuffer> {
  const [height, width, channelCount = 1] = shape

  if (
    shape.length < 2 ||
    shape.length > 3 ||
    height === undefined ||
    width === undefined ||
    !Number.isInteger(height) ||
    !Number.isInteger(width) ||
    height <= 0 ||
    width <= 0 ||
    ![1, 3, 4].includes(channelCount)
  ) {
    throw new Error(
      `Visium image array has shape [${shape.join(', ')}]; expected (height, width) or (height, width, 3 or 4).`,
    )
  }

  if (values.length < height * width * channelCount) {
    throw new Error('Visium image array is shorter than its shape.')
  }

  const scale = imageValueScale(values)
  const rowBytes = Math.ceil((width * 3) / 4) * 4
  const pixelBytes = rowBytes * height
  const headerBytes = 54
  const bytes = new Uint8Array(headerBytes + pixelBytes)
  const view = new DataView(bytes.buffer)

  bytes[0] = 0x42
  bytes[1] = 0x4d
  view.setUint32(2, bytes.length, true)
  view.setUint32(10, headerBytes, true)
  view.setUint32(14, 40, true)
  view.setInt32(18, width, true)
  // Negative height: rows run top to bottom.
  view.setInt32(22, -height, true)
  view.setUint16(26, 1, true)
  view.setUint16(28, 24, true)
  view.setUint32(34, pixelBytes, true)

  for (let row = 0; row < height; row += 1) {
    let offset = headerBytes + row * rowBytes

    for (let col = 0; col < width; col += 1) {
      const base = (row * width + col) * channelCount
      const red = byteValue(values[base], scale)
      const green = channelCount === 1 ? red : byteValue(values[base + 1], scale)
      const blue = channelCount === 1 ? red : byteValue(values[base + 2], scale)

      bytes[offset] = blue
      bytes[offset + 1] = green
      bytes[offset + 2] = red
      offset += 3
    }
  }

  return bytes
}

// Multiplier that maps stored values to 0-255.
function imageValueScale(values: ImageValues): number {
  if (values instanceof Uint8Array || values instanceof Uint8ClampedArray) {
    return 1
  }

  let max = 0
  const stride = Math.max(1, Math.floor(values.length / 1_000_000))

  for (let index = 0; index < values.length; index += stride) {
    const value = Number(values[index] ?? 0)

    if (Number.isFinite(value) && value > max) {
      max = value
    }
  }

  if (max <= 1) {
    return 255
  }

  return max <= 255 ? 1 : 255 / max
}

function byteValue(value: number | bigint | undefined, scale: number): number {
  const scaled = Number(value ?? 0) * scale
  return Number.isFinite(scaled) ? Math.max(0, Math.min(255, Math.round(scaled))) : 0
}
