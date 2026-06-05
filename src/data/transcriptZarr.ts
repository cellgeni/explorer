import { ZipFileStore } from '@zarrita/storage'
import * as zarr from 'zarrita'
import { micrometers } from './coords'
import type { BBox } from './coords'
import type { TranscriptGroupSummary, TranscriptPoint } from './transcriptOverlay'

const TRANSCRIPT_ZARR_EXACT_LEVEL = 0
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

interface TranscriptZarrMetadata {
  readonly root: zarr.Group<ZipFileStore>
  readonly grids: zarr.Group<ZipFileStore>
  readonly gridSize: number
  readonly gridKeys: readonly string[]
  readonly gridKeySet: ReadonlySet<string>
  readonly geneNames: readonly string[]
  readonly codewordGeneNames: readonly string[]
  readonly fovNames: readonly string[]
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

  const pointLimit = Math.max(1, Math.floor(options.pointLimit ?? 25_000))
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
      const valid =
        arrays.valid === undefined
          ? 1
          : readMatrixValue(arrays.valid, row, 0)

      if (valid === 0) {
        continue
      }

      const qv = readMatrixValue(
        arrays.qualityScore,
        row,
        0,
      )

      if (qv < minQv) {
        continue
      }

      const x = readMatrixValue(arrays.location, row, 0)
      const y = readMatrixValue(arrays.location, row, 1)

      if (x < bbox.minX || x > bbox.maxX || y < bbox.minY || y > bbox.maxY) {
        continue
      }

      const geneIndex = readMatrixValue(
        arrays.geneIdentity,
        row,
        0,
      )
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
          ? metadata.fovNames[fovIndex] ?? null
          : null
      const zLocation = readMatrixValue(arrays.location, row, 2)

      points.push({
        id: `${fovName ?? fovIndex}:${transcriptId}`,
        cellId: null,
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

  if (gridKeys.length === 0) {
    throw new Error('transcripts.zarr.zip does not expose exact transcript grid keys.')
  }

  return {
    root,
    grids,
    gridSize: readGridSize(grids.attrs),
    gridKeys,
    gridKeySet: new Set(gridKeys),
    geneNames: readStringArrayAttribute(root.attrs, 'gene_names'),
    codewordGeneNames: readStringArrayAttribute(root.attrs, 'codeword_gene_names'),
    fovNames: readStringArrayAttribute(root.attrs, 'fov_names'),
  }
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
    array.shape.length === 1
      ? [null]
      : [null, ...array.shape.slice(1).map(() => null)]
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

  const codewordIndex = readMatrixValue(
    arrays.codewordIdentity,
    row,
    0,
  )

  if (
    !Number.isInteger(codewordIndex) ||
    codewordIndex < 0 ||
    codewordIndex === UNKNOWN_CODEWORD_INDEX
  ) {
    return undefined
  }

  return metadata.codewordGeneNames[codewordIndex] ?? `Codeword ${codewordIndex}`
}

function readMatrixValue(
  matrix: NumericMatrix,
  row: number,
  column: number,
): number {
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

function readNestedStringArrayAttribute(
  attrs: Record<string, unknown>,
  key: string,
): readonly (readonly string[])[] {
  const value = attrs[key]

  if (
    !Array.isArray(value) ||
    value.some(
      (level) =>
        !Array.isArray(level) || level.some((item) => typeof item !== 'string'),
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
