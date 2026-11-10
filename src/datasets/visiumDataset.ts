// Standard Visium (v1/v2) Space Ranger `outs/` folder, read into an in-memory
// AnnData table laid out the way scanpy's `read_visium` writes one: obs per
// spot, `/X` from the filtered feature-barcode matrix, obsm `spatial` in
// full-resolution pixels, and `uns/spatial/<library>/scalefactors`. The
// AnnData reader then handles spots, units, expression, annotations, and
// embeddings exactly as for a Visium .h5ad file. Tissue images stay hosted
// PNGs.

import { parseAnalysisEmbeddingCsv } from '../data/analysisEmbeddings'
import { isListedAsMissing } from '../data/folderListing'
import { readMaybeGzipText } from '../data/readMaybeGzipText'
import {
  AnnDataH5adDataset,
  type AnnDataMemoryColumn,
  type AnnDataMemoryTable,
  type H5adLoadProgressReporter,
} from './h5adDataset'
import {
  parseVisiumClustersCsv,
  parseVisiumTissuePositions,
  VISIUM_MATRIX_MAX_BYTES,
  VISIUM_SCALEFACTOR_NAMES,
  type VisiumAnalysisFileKey,
  type VisiumImageKind,
  type VisiumTissuePositions,
} from './visiumFormat'

export interface VisiumFileUrls {
  // Tried in order; Space Ranger 1.x writes the headerless list instead.
  readonly tissuePositions: readonly string[]
  readonly scalefactors: string
  readonly filteredMatrix: string
  readonly images: Readonly<Partial<Record<VisiumImageKind, string>>>
  // Candidate URLs per analysis output, tried in order.
  readonly analysis: Readonly<Partial<Record<VisiumAnalysisFileKey, readonly string[]>>>
}

export interface VisiumDatasetOptions {
  readonly baseUrl: string
  readonly files: VisiumFileUrls
  readonly fetcher?: typeof fetch
  readonly onProgress?: H5adLoadProgressReporter
}

const DEFAULT_LIBRARY_ID = 'visium'
const EMBEDDING_OBSM_KEYS: Readonly<
  Record<Exclude<VisiumAnalysisFileKey, 'clusters'>, string>
> = {
  umap: 'X_umap',
  tsne: 'X_tsne',
  pca: 'X_pca',
}

export class VisiumMatrixTooLargeError extends Error {
  readonly url: string
  readonly byteLength: number

  constructor(url: string, byteLength: number) {
    super(
      `Visium filtered matrix is ${formatMegabytes(byteLength)}, above the ${formatMegabytes(
        VISIUM_MATRIX_MAX_BYTES,
      )} browser load limit.`,
    )
    this.name = 'VisiumMatrixTooLargeError'
    this.url = url
    this.byteLength = byteLength
  }
}

export function createVisiumDataset(options: VisiumDatasetOptions): AnnDataH5adDataset {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)

  return new AnnDataH5adDataset({
    url: options.baseUrl,
    fetcher,
    ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
    memorySource: {
      label: 'Visium Space Ranger output',
      load: (onProgress) => readSpaceRangerVisium(options.files, fetcher, onProgress),
    },
    visiumImageUrls: options.files.images,
  })
}

export interface FeatureBarcodeMatrix {
  readonly barcodes: readonly string[]
  readonly featureNames: readonly string[]
  readonly featureIds: readonly string[]
  readonly featureTypes: readonly string[]
  // Per-barcode sparse rows (10x stores features x barcodes in CSC, which is
  // barcodes x features in CSR).
  readonly data: Float32Array | Int32Array
  readonly indices: Int32Array
  readonly indptr: Float64Array
  readonly libraryId?: string
  readonly chemistry?: string
  readonly softwareVersion?: string
}

export async function readSpaceRangerVisium(
  files: VisiumFileUrls,
  fetcher: typeof fetch,
  onProgress?: H5adLoadProgressReporter,
): Promise<AnnDataMemoryTable> {
  onProgress?.('Visium spot positions, scale factors, and matrix loading')
  const [positions, scalefactors, matrix, analysis] = await Promise.all([
    readTissuePositions(files.tissuePositions, fetcher),
    readScalefactorsJson(files.scalefactors, fetcher),
    fetchMatrixBytes(files.filteredMatrix, fetcher).then((bytes) => {
      onProgress?.(`Visium filtered matrix loaded (${formatMegabytes(bytes.byteLength)})`)
      return readFeatureBarcodeMatrixH5(bytes, files.filteredMatrix)
    }),
    readAnalysisFiles(files.analysis, fetcher),
  ])

  onProgress?.(
    `Visium output read: ${positions.barcodes.length.toLocaleString()} array spots, ${matrix.barcodes.length.toLocaleString()} matrix barcodes, ${matrix.featureNames.length.toLocaleString()} features`,
  )

  return visiumAnnDataTable({
    positions,
    scalefactors,
    matrix,
    analysis,
    ...(onProgress === undefined ? {} : { onProgress }),
  })
}

interface VisiumAnalysisTexts {
  readonly clusters?: string
  readonly umap?: string
  readonly tsne?: string
  readonly pca?: string
}

// Joins the matrix barcodes to their array positions. Barcodes the positions
// file does not list cannot be placed and are left out.
export function visiumAnnDataTable(input: {
  readonly positions: VisiumTissuePositions
  readonly scalefactors: Readonly<Record<string, unknown>>
  readonly matrix: FeatureBarcodeMatrix
  readonly analysis?: VisiumAnalysisTexts
  readonly onProgress?: H5adLoadProgressReporter
}): AnnDataMemoryTable {
  const { positions, matrix } = input
  const positionIndex = new Map<string, number>()

  positions.barcodes.forEach((barcode, index) => {
    positionIndex.set(barcode, index)
  })

  const rows: {
    readonly barcode: string
    readonly matrixRow: number
    readonly position: number
  }[] = []

  matrix.barcodes.forEach((barcode, matrixRow) => {
    const position = positionIndex.get(barcode)

    if (position !== undefined) {
      rows.push({ barcode, matrixRow, position })
    }
  })

  if (rows.length === 0) {
    throw new Error(
      'None of the filtered matrix barcodes are in the Visium tissue positions file.',
    )
  }

  if (rows.length < matrix.barcodes.length) {
    input.onProgress?.(
      `Visium: ${(matrix.barcodes.length - rows.length).toLocaleString()} matrix barcodes are not in the tissue positions file and are not shown`,
    )
  }

  const rowCount = rows.length
  const keptNonZeros = rows.reduce(
    (sum, row) =>
      sum +
      ((matrix.indptr[row.matrixRow + 1] ?? 0) - (matrix.indptr[row.matrixRow] ?? 0)),
    0,
  )
  const data =
    matrix.data instanceof Int32Array
      ? new Int32Array(keptNonZeros)
      : new Float32Array(keptNonZeros)
  const indices = new Int32Array(keptNonZeros)
  const indptr = new Float64Array(rowCount + 1)
  const inTissue = new Uint8Array(rowCount)
  const arrayRow = new Int32Array(rowCount)
  const arrayCol = new Int32Array(rowCount)
  const totalCounts = new Float64Array(rowCount)
  const genesDetected = new Int32Array(rowCount)
  const spatial = new Float64Array(rowCount * 2)
  let offset = 0

  rows.forEach((row, index) => {
    const start = matrix.indptr[row.matrixRow] ?? 0
    const end = matrix.indptr[row.matrixRow + 1] ?? start
    let total = 0

    for (let source = start; source < end; source += 1) {
      const value = matrix.data[source] ?? 0
      data[offset] = value
      indices[offset] = matrix.indices[source] ?? 0
      total += value
      offset += 1
    }

    indptr[index + 1] = offset
    inTissue[index] = positions.inTissue[row.position] ?? 0
    arrayRow[index] = positions.arrayRows[row.position] ?? 0
    arrayCol[index] = positions.arrayCols[row.position] ?? 0
    totalCounts[index] = total
    genesDetected[index] = end - start
    spatial[index * 2] = positions.pixelX[row.position] ?? Number.NaN
    spatial[index * 2 + 1] = positions.pixelY[row.position] ?? Number.NaN
  })

  const barcodes = rows.map((row) => row.barcode)
  const obs: AnnDataMemoryColumn[] = [
    { name: 'in_tissue', kind: 'numeric', values: inTissue },
    { name: 'array_row', kind: 'numeric', values: arrayRow },
    { name: 'array_col', kind: 'numeric', values: arrayCol },
    { name: 'total_counts', kind: 'numeric', values: totalCounts },
    { name: 'n_genes_by_counts', kind: 'numeric', values: genesDetected },
  ]
  const clusters =
    input.analysis?.clusters === undefined
      ? null
      : categoricalColumn(
          'graphclust',
          barcodes,
          parseVisiumClustersCsv(input.analysis.clusters),
        )

  if (clusters !== null) {
    obs.push(clusters)
  }

  const obsm: Record<string, { values: Float64Array; columns: number }> = {
    spatial: { values: spatial, columns: 2 },
  }

  for (const [key, obsmKey] of Object.entries(EMBEDDING_OBSM_KEYS)) {
    const text = input.analysis?.[key as keyof VisiumAnalysisTexts]
    const values =
      text === undefined
        ? null
        : embeddingColumns(barcodes, parseAnalysisEmbeddingCsv(text, key))

    if (values !== null) {
      obsm[obsmKey] = { values, columns: 2 }
    }
  }

  const scalefactors: Record<string, number> = {}

  for (const name of VISIUM_SCALEFACTOR_NAMES) {
    const value = Number(input.scalefactors[name])

    if (Number.isFinite(value)) {
      scalefactors[name] = value
    }
  }

  return {
    obsNames: barcodes,
    obs,
    varNames: matrix.featureNames,
    var: [
      { name: 'gene_ids', kind: 'string', values: matrix.featureIds },
      { name: 'feature_types', kind: 'string', values: matrix.featureTypes },
    ],
    X: { kind: 'csr', data, indices, indptr },
    obsm,
    uns: {
      spatial: {
        [matrix.libraryId ?? DEFAULT_LIBRARY_ID]: {
          scalefactors,
          metadata: {
            ...(matrix.chemistry === undefined
              ? {}
              : { chemistry_description: matrix.chemistry }),
            ...(matrix.softwareVersion === undefined
              ? {}
              : { software_version: matrix.softwareVersion }),
          },
        },
      },
    },
  }
}

function categoricalColumn(
  name: string,
  barcodes: readonly string[],
  labels: ReadonlyMap<string, string>,
): AnnDataMemoryColumn | null {
  if (labels.size === 0) {
    return null
  }

  const categories = Array.from(new Set(labels.values())).sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true }),
  )
  const codeByCategory = new Map(categories.map((category, index) => [category, index]))
  const codes = new Int32Array(barcodes.length)

  barcodes.forEach((barcode, index) => {
    const label = labels.get(barcode)
    codes[index] = label === undefined ? -1 : (codeByCategory.get(label) ?? -1)
  })

  return { name, kind: 'categorical', codes, categories }
}

// Two columns per barcode, or null unless every barcode has a point.
function embeddingColumns(
  barcodes: readonly string[],
  points: readonly { readonly id: string; readonly x: number; readonly y: number }[],
): Float64Array | null {
  const byId = new Map(points.map((point) => [point.id, point]))
  const values = new Float64Array(barcodes.length * 2)

  for (let index = 0; index < barcodes.length; index += 1) {
    const point = byId.get(barcodes[index] ?? '')

    if (point === undefined) {
      return null
    }

    values[index * 2] = point.x
    values[index * 2 + 1] = point.y
  }

  return values
}

async function readTissuePositions(
  urls: readonly string[],
  fetcher: typeof fetch,
): Promise<VisiumTissuePositions> {
  const failures: string[] = []

  for (const url of urls) {
    if (isListedAsMissing(url)) {
      failures.push(`${url} (not in the folder listing)`)
      continue
    }

    const response = await fetcher(url)

    if (!response.ok) {
      failures.push(`${url} (HTTP ${response.status})`)
      continue
    }

    return parseVisiumTissuePositions(await readMaybeGzipText(response))
  }

  throw new Error(`Visium tissue positions could not be read: ${failures.join('; ')}.`)
}

async function readScalefactorsJson(
  url: string,
  fetcher: typeof fetch,
): Promise<Readonly<Record<string, unknown>>> {
  const response = await fetcher(url)

  if (!response.ok) {
    throw new Error(`Visium scalefactors_json.json returned HTTP ${response.status}.`)
  }

  const json: unknown = JSON.parse(await readMaybeGzipText(response))

  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new Error('Visium scalefactors_json.json is not a JSON object.')
  }

  return json as Record<string, unknown>
}

async function readAnalysisFiles(
  candidates: VisiumFileUrls['analysis'],
  fetcher: typeof fetch,
): Promise<VisiumAnalysisTexts> {
  const entries = await Promise.all(
    Object.entries(candidates).map(async ([key, urls]) => {
      for (const url of urls ?? []) {
        if (isListedAsMissing(url)) {
          continue
        }

        const response = await fetcher(url).catch(() => null)

        if (response?.ok === true) {
          return [key, await readMaybeGzipText(response)] as const
        }
      }

      return null
    }),
  )

  return Object.fromEntries(
    entries.filter((entry): entry is readonly [string, string] => entry !== null),
  )
}

async function fetchMatrixBytes(url: string, fetcher: typeof fetch): Promise<Uint8Array> {
  const response = await fetcher(url)

  if (!response.ok) {
    throw new Error(
      `Visium filtered_feature_bc_matrix.h5 returned HTTP ${response.status}.`,
    )
  }

  const declared = Number(response.headers.get('Content-Length'))

  if (Number.isFinite(declared) && declared > VISIUM_MATRIX_MAX_BYTES) {
    await response.body?.cancel()
    throw new VisiumMatrixTooLargeError(url, declared)
  }

  const bytes = new Uint8Array(await response.arrayBuffer())

  if (bytes.byteLength > VISIUM_MATRIX_MAX_BYTES) {
    throw new VisiumMatrixTooLargeError(url, bytes.byteLength)
  }

  return bytes
}

interface H5Node {
  readonly attrs?: Readonly<Record<string, { readonly value: unknown }>>
  readonly value?: unknown
  keys?(): string[]
  get?(path: string): unknown
}

// 10x feature-barcode HDF5: `/matrix` (Cell Ranger 3+ and every Space Ranger
// version) or a per-genome group with `genes`/`gene_names` (Cell Ranger 2).
export async function readFeatureBarcodeMatrixH5(
  bytes: Uint8Array,
  label: string,
): Promise<FeatureBarcodeMatrix> {
  const h5wasm = (await import('h5wasm')).default
  const { FS } = await h5wasm.ready
  const fileName = `/visium-matrix-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}.h5`

  FS.writeFile(fileName, bytes)

  const file = new h5wasm.File(fileName, 'r') as unknown as H5Node & {
    close(): unknown
  }

  try {
    const groupName =
      file.get?.('matrix') !== null && file.get?.('matrix') !== undefined
        ? 'matrix'
        : file.keys?.().find((key) => h5Child(file, `${key}/barcodes`) !== undefined)

    if (groupName === undefined) {
      throw new Error(`${label} is not a 10x feature-barcode matrix (no /matrix group).`)
    }

    const read = (path: string) => h5Child(file, `${groupName}/${path}`)?.value
    const barcodes = stringValues(read('barcodes'), `${label} barcodes`)
    const featureNames = stringValues(
      read('features/name') ?? read('gene_names'),
      `${label} feature names`,
    )
    const featureIds = optionalStringValues(read('features/id') ?? read('genes'))
    const featureTypes = optionalStringValues(read('features/feature_type'))
    const data = read('data')
    const indices = numericValues(read('indices'), `${label} indices`)
    const indptr = numericValues(read('indptr'), `${label} indptr`)

    if (indptr.length !== barcodes.length + 1) {
      throw new Error(`${label} indptr does not match its barcodes.`)
    }

    return {
      barcodes,
      featureNames,
      featureIds: featureIds ?? featureNames,
      featureTypes: featureTypes ?? featureNames.map(() => 'Gene Expression'),
      data:
        data instanceof Int32Array || data instanceof Float32Array
          ? data
          : Float32Array.from(numericValues(data, `${label} data`)),
      indices: Int32Array.from(indices),
      indptr: Float64Array.from(indptr),
      ...optionalAttribute(file, 'library_ids', 'libraryId'),
      ...optionalAttribute(file, 'chemistry_description', 'chemistry'),
      ...optionalAttribute(file, 'software_version', 'softwareVersion'),
    }
  } finally {
    try {
      file.close()
    } catch {
      // The read error is more useful than a cleanup failure.
    }

    FS.unlink(fileName)
  }
}

function h5Child(node: H5Node, path: string): H5Node | undefined {
  const child = node.get?.(path)
  return child === null || child === undefined ? undefined : (child as H5Node)
}

function optionalAttribute<Key extends string>(
  file: H5Node,
  name: string,
  key: Key,
): Partial<Record<Key, string>> {
  const value = file.attrs?.[name]?.value
  const first =
    Array.isArray(value) || ArrayBuffer.isView(value)
      ? Array.from(value as ArrayLike<unknown>)[0]
      : value

  return typeof first === 'string' && first.trim().length > 0
    ? ({ [key]: first.trim() } as Partial<Record<Key, string>>)
    : {}
}

function stringValues(value: unknown, label: string): readonly string[] {
  const strings = optionalStringValues(value)

  if (strings === null) {
    throw new Error(`Expected ${label} to be strings.`)
  }

  return strings
}

function optionalStringValues(value: unknown): readonly string[] | null {
  if (value === undefined || value === null || typeof value === 'string') {
    return null
  }

  if (typeof value === 'object' && Symbol.iterator in value) {
    const strings = Array.from(value as Iterable<unknown>)
    return strings.every((item) => typeof item === 'string') ? strings : null
  }

  return null
}

function numericValues(value: unknown, label: string): ArrayLike<number> {
  if (value instanceof BigInt64Array || value instanceof BigUint64Array) {
    return Float64Array.from(value, (item) => Number(item))
  }

  if (ArrayBuffer.isView(value) && 'length' in value) {
    return value as unknown as ArrayLike<number>
  }

  if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
    return value
  }

  throw new Error(`Expected ${label} to be numeric.`)
}

function formatMegabytes(byteLength: number): string {
  return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`
}
