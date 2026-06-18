import { micrometers, type BBox, type DataPoint } from '../data/coords'
import { datasetFileUrl } from '../data/datasetFiles'
import type {
  SegmentationInfo,
  SpatialElement,
  SpatialElementMetadata,
} from './spatialDataset'

export interface VisiumHdSegmentedOutputPaths {
  readonly scalefactorsPath?: string
  readonly filteredFeatureCellMatrixH5Path?: string
  readonly rawFeatureCellMatrixH5Path?: string
  readonly cellSegmentationsGeojsonPath?: string
  readonly nucleusSegmentationsGeojsonPath?: string
  readonly nucleusInstanceMaskTiffPath?: string
  readonly graphclustAnnotatedCellSegmentationsGeojsonPath?: string
  readonly graphclustAnnotatedNucleusSegmentationsGeojsonPath?: string
}

export type VisiumHdSegmentationKind = 'cell' | 'nucleus'

export interface VisiumHdSegmentationScalefactors {
  readonly micronsPerPixel: number
}

export interface ReadVisiumHdSegmentationElementsOptions {
  readonly path: string
  readonly scalefactors: VisiumHdSegmentationScalefactors
  readonly kind?: VisiumHdSegmentationKind
  readonly bbox?: BBox
  readonly maxFullFileBytes?: number
  readonly streamGeojson?: boolean
  readonly fetcher?: typeof fetch
  readonly maskRasterReader?: VisiumHdNucleusInstanceMaskRasterReader
  readonly signal?: AbortSignal
}

export interface ParseVisiumHdSegmentationGeojsonOptions {
  readonly scalefactors: VisiumHdSegmentationScalefactors
  readonly kind?: VisiumHdSegmentationKind
  readonly bbox?: BBox
}

export interface VisiumHdNucleusInstanceMaskRaster {
  readonly data: ArrayLike<number | bigint>
  readonly width: number
  readonly height: number
  readonly originRow?: number
  readonly originCol?: number
}

export interface ReadVisiumHdNucleusInstanceMaskRasterOptions {
  readonly bbox: BBox
  readonly scalefactors: VisiumHdSegmentationScalefactors
  readonly signal?: AbortSignal
}

export type VisiumHdNucleusInstanceMaskRasterReader = (
  url: string,
  options: ReadVisiumHdNucleusInstanceMaskRasterOptions,
) => Promise<VisiumHdNucleusInstanceMaskRaster>

export interface ParseVisiumHdNucleusInstanceMaskOptions {
  readonly scalefactors: VisiumHdSegmentationScalefactors
  readonly bbox?: BBox
}

export class VisiumHdSegmentationGeojsonBudgetExceededError extends Error {
  override readonly name = 'VisiumHdSegmentationGeojsonBudgetExceededError'

  constructor(
    readonly url: string,
    readonly byteLength: number,
    readonly maxBytes: number,
  ) {
    super(
      `Visium HD segmentation GeoJSON is ${formatByteCount(
        byteLength,
      )}, exceeding the interactive full-file budget of ${formatByteCount(maxBytes)}.`,
    )
  }
}

type GeojsonPolygon = readonly (readonly (readonly number[])[])[]
type GeojsonMultiPolygon = readonly GeojsonPolygon[]
interface MaskEdge {
  readonly start: MaskVertex
  readonly end: MaskVertex
}

interface MaskVertex {
  readonly col: number
  readonly row: number
}

interface MaskPixelEdgeContext {
  readonly raster: VisiumHdNucleusInstanceMaskRaster
  readonly localRow: number
  readonly localCol: number
  readonly row: number
  readonly col: number
}

interface NucleusMaskWindow {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

interface StreamedGeojsonFeatureScanner {
  buffer: string
  elements: SpatialElement[]
  featureIndex: number
  mode: 'find-features' | 'read-features' | 'done'
}

interface JsonStringToken {
  readonly value: string
  readonly end: number
}

const ANNOTATION_LABEL_PROPERTY_KEYS = [
  'annotation',
  'annotation_label',
  'annotationLabel',
  'label',
  'Label',
  'classification',
  'classification_name',
  'classificationName',
  'class',
  'Class',
  'cluster',
  'cluster_id',
  'cluster_name',
  'graphclust',
  'Graphclust',
  'group',
  'name',
  'cell_type',
  'cellType',
] as const
const ANNOTATION_COLOR_PROPERTY_KEYS = [
  'color',
  'Color',
  'colour',
  'fill',
  'fill_color',
  'fillColor',
  'stroke',
  'stroke_color',
  'strokeColor',
  'line_color',
  'lineColor',
] as const
const ANNOTATION_FILL_COLOR_PROPERTY_KEYS = [
  'fill',
  'fill_color',
  'fillColor',
  'color',
  'Color',
  'colour',
] as const
const ANNOTATION_LINE_COLOR_PROPERTY_KEYS = [
  'stroke',
  'stroke_color',
  'strokeColor',
  'line_color',
  'lineColor',
  'color',
  'Color',
  'colour',
] as const

export function visiumHdSegmentationInfos(
  paths: VisiumHdSegmentedOutputPaths | undefined,
): readonly SegmentationInfo[] {
  if (paths === undefined) {
    return []
  }

  const segmentations: SegmentationInfo[] = []

  appendSegmentationInfo(segmentations, {
    id: 'visium-hd-cell-segmentations',
    kind: 'cell',
    label: 'Cell segmentations',
    sourceKind: 'geojson',
    path: paths.cellSegmentationsGeojsonPath,
  })
  appendSegmentationInfo(segmentations, {
    id: 'visium-hd-nucleus-segmentations',
    kind: 'nucleus',
    label: 'Nucleus segmentations',
    sourceKind: 'geojson',
    path: paths.nucleusSegmentationsGeojsonPath,
  })
  appendSegmentationInfo(segmentations, {
    id: 'visium-hd-graphclust-cell-segmentations',
    kind: 'cell',
    label: 'Graphclust cell segmentations',
    sourceKind: 'geojson',
    path: paths.graphclustAnnotatedCellSegmentationsGeojsonPath,
    annotated: true,
  })
  appendSegmentationInfo(segmentations, {
    id: 'visium-hd-graphclust-nucleus-segmentations',
    kind: 'nucleus',
    label: 'Graphclust nucleus segmentations',
    sourceKind: 'geojson',
    path: paths.graphclustAnnotatedNucleusSegmentationsGeojsonPath,
    annotated: true,
  })
  appendSegmentationInfo(segmentations, {
    id: 'visium-hd-nucleus-instance-mask',
    kind: 'nucleus',
    label: 'Nucleus instance mask',
    sourceKind: 'tiff',
    path: paths.nucleusInstanceMaskTiffPath,
  })

  return segmentations
}

export async function readVisiumHdSegmentationElements(
  baseUrl: string,
  options: ReadVisiumHdSegmentationElementsOptions,
): Promise<readonly SpatialElement[]> {
  const url = datasetFileUrl(baseUrl, options.path)
  const fetcher = options.fetcher ?? fetch

  if (isTiffPath(options.path)) {
    return readVisiumHdNucleusInstanceMaskElements(url, options)
  }

  if (options.maxFullFileBytes !== undefined) {
    await assertSegmentationGeojsonWithinBudget(
      url,
      options.maxFullFileBytes,
      fetcher,
      options.signal,
    )
  }

  throwIfAborted(options.signal)
  const response = await fetcher(url, {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })

  if (!response.ok) {
    throw new Error(
      `Unable to read Visium HD segmentation GeoJSON at ${url}: HTTP ${response.status}`,
    )
  }

  if (options.streamGeojson === true && response.body !== null) {
    return parseVisiumHdSegmentationGeojsonStream(response.body, options)
  }

  const geojson = (await response.json()) as unknown
  throwIfAborted(options.signal)

  return parseVisiumHdSegmentationGeojson(geojson, options)
}

export async function readVisiumHdNucleusInstanceMaskElements(
  url: string,
  options: ReadVisiumHdSegmentationElementsOptions,
): Promise<readonly SpatialElement[]> {
  if ((options.kind ?? 'nucleus') !== 'nucleus') {
    throw new Error(
      'Visium HD nucleus instance-mask TIFF can only provide nucleus elements.',
    )
  }

  if (options.bbox === undefined) {
    throw new Error('Visium HD nucleus instance-mask TIFF reads require a viewport bbox.')
  }

  const raster = await (
    options.maskRasterReader ?? readVisiumHdNucleusInstanceMaskRasterFromTiff
  )(url, {
    bbox: options.bbox,
    scalefactors: options.scalefactors,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })

  throwIfAborted(options.signal)

  return parseVisiumHdNucleusInstanceMaskRaster(raster, {
    bbox: options.bbox,
    scalefactors: options.scalefactors,
  })
}

export function parseVisiumHdSegmentationGeojson(
  value: unknown,
  options: ParseVisiumHdSegmentationGeojsonOptions,
): readonly SpatialElement[] {
  assertPositiveMicronsPerPixel(options.scalefactors.micronsPerPixel)
  const source = expectObject(value, 'Visium HD segmentation GeoJSON')

  if (source.type !== 'FeatureCollection') {
    throw new Error('Expected Visium HD segmentation GeoJSON to be a FeatureCollection.')
  }

  if (!Array.isArray(source.features)) {
    throw new Error('Expected Visium HD segmentation GeoJSON features to be an array.')
  }

  const elements: SpatialElement[] = []
  const kind = options.kind ?? 'cell'

  for (let featureIndex = 0; featureIndex < source.features.length; featureIndex += 1) {
    const feature = expectObject(
      source.features[featureIndex],
      `Visium HD segmentation feature ${featureIndex}`,
    )
    const featureElements = segmentationFeatureToElements(feature, featureIndex, {
      kind,
      scalefactors: options.scalefactors,
    })

    for (const element of featureElements) {
      elements.push(element)
    }
  }

  return options.bbox === undefined
    ? elements
    : filterVisiumHdSegmentationElementsByBbox(elements, options.bbox)
}

async function parseVisiumHdSegmentationGeojsonStream(
  stream: ReadableStream<Uint8Array>,
  options: ParseVisiumHdSegmentationGeojsonOptions & { readonly signal?: AbortSignal },
): Promise<readonly SpatialElement[]> {
  assertPositiveMicronsPerPixel(options.scalefactors.micronsPerPixel)
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const scanner: StreamedGeojsonFeatureScanner = {
    buffer: '',
    elements: [],
    featureIndex: 0,
    mode: 'find-features',
  }

  try {
    while (true) {
      throwIfAborted(options.signal)
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      scanner.buffer += decoder.decode(value, { stream: true })
      drainStreamedGeojsonFeatureScanner(scanner, options)

      if (scanner.mode === 'done') {
        await reader.cancel().catch(() => undefined)
        return scanner.elements
      }
    }
  } finally {
    reader.releaseLock()
  }

  scanner.buffer += decoder.decode()
  drainStreamedGeojsonFeatureScanner(scanner, options)
  assertStreamedGeojsonFeatureScannerComplete(scanner)
  return scanner.elements
}

export function parseVisiumHdNucleusInstanceMaskRaster(
  raster: VisiumHdNucleusInstanceMaskRaster,
  options: ParseVisiumHdNucleusInstanceMaskOptions,
): readonly SpatialElement[] {
  assertPositiveMicronsPerPixel(options.scalefactors.micronsPerPixel)

  if (!Number.isInteger(raster.width) || raster.width < 0) {
    throw new Error('Expected nucleus instance-mask raster width to be non-negative.')
  }

  if (!Number.isInteger(raster.height) || raster.height < 0) {
    throw new Error('Expected nucleus instance-mask raster height to be non-negative.')
  }

  if (raster.width === 0 || raster.height === 0) {
    return []
  }

  const expectedLength = raster.width * raster.height

  if (raster.data.length !== expectedLength) {
    throw new Error(
      `Expected nucleus instance-mask raster to contain ${expectedLength.toLocaleString()} pixels, received ${raster.data.length.toLocaleString()}.`,
    )
  }

  const originRow = normalizeRasterOrigin(raster.originRow, 'originRow')
  const originCol = normalizeRasterOrigin(raster.originCol, 'originCol')
  const edgesByLabel = new Map<number, MaskEdge[]>()

  for (let row = 0; row < raster.height; row += 1) {
    for (let col = 0; col < raster.width; col += 1) {
      const label = readMaskLabel(raster, row, col)

      if (label === 0) {
        continue
      }

      appendMaskPixelEdges(edgesByLabel, label, {
        col: originCol + col,
        localCol: col,
        localRow: row,
        raster,
        row: originRow + row,
      })
    }
  }

  const elements: SpatialElement[] = []

  for (const [label, edges] of edgesByLabel) {
    const rings = traceMaskBoundaryRings(edges, options.scalefactors)

    for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
      const ring = rings[ringIndex]

      if (ring === undefined || ring.length < 4) {
        continue
      }

      elements.push({
        id:
          ringIndex === 0
            ? formatVisiumHdNucleusInstanceMaskId(label)
            : `${formatVisiumHdNucleusInstanceMaskId(label)}#${ringIndex + 1}`,
        geometry: {
          kind: 'polygon',
          rings: [ring],
        },
        metadata: {
          segmentation: {
            kind: 'nucleus',
          },
        },
      })
    }
  }

  return options.bbox === undefined
    ? elements
    : filterVisiumHdSegmentationElementsByBbox(elements, options.bbox)
}

export function normalizeVisiumHdGeojsonCellId(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      return null
    }

    return formatVisiumHdMatrixCellId(value)
  }

  if (typeof value === 'bigint') {
    if (value < 0n) {
      return null
    }

    return formatVisiumHdMatrixCellId(value)
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()

  if (trimmed.length === 0) {
    return null
  }

  if (/^\d+$/.test(trimmed)) {
    return formatVisiumHdMatrixCellId(BigInt(trimmed))
  }

  const matrixId = /^cellid_(\d+)(-\d+)?$/i.exec(trimmed)

  if (matrixId !== null) {
    const digits = matrixId[1] ?? ''
    const suffix = matrixId[2] ?? '-1'
    return `cellid_${digits.padStart(9, '0')}${suffix}`
  }

  return trimmed
}

export function filterVisiumHdSegmentationElementsByBbox(
  elements: readonly SpatialElement[],
  bbox: BBox,
): readonly SpatialElement[] {
  return elements.filter((element) => elementIntersectsBbox(element, bbox))
}

async function readVisiumHdNucleusInstanceMaskRasterFromTiff(
  url: string,
  options: ReadVisiumHdNucleusInstanceMaskRasterOptions,
): Promise<VisiumHdNucleusInstanceMaskRaster> {
  assertPositiveMicronsPerPixel(options.scalefactors.micronsPerPixel)
  const { fromUrl } = await import('geotiff')
  const tiff = await fromUrl(url, { allowFullFile: false }, options.signal)
  const image = await tiff.getImage(0)
  const window = nucleusMaskWindowForBbox(
    options.bbox,
    options.scalefactors,
    image.getWidth(),
    image.getHeight(),
  )

  if (window === null) {
    return {
      data: [],
      width: 0,
      height: 0,
      originRow: 0,
      originCol: 0,
    }
  }

  const raster = await image.readRasters({
    window: [window.left, window.top, window.right, window.bottom],
    samples: [0],
    interleave: true,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })

  return {
    data: readSingleRasterSample(raster),
    width: window.right - window.left,
    height: window.bottom - window.top,
    originRow: window.top,
    originCol: window.left,
  }
}

function nucleusMaskWindowForBbox(
  bbox: BBox,
  scalefactors: VisiumHdSegmentationScalefactors,
  imageWidth: number,
  imageHeight: number,
): NucleusMaskWindow | null {
  if (!Number.isFinite(imageWidth) || imageWidth <= 0) {
    return null
  }

  if (!Number.isFinite(imageHeight) || imageHeight <= 0) {
    return null
  }

  const paddingPixels = 1
  const left = Math.max(
    0,
    Math.floor(bbox.minX / scalefactors.micronsPerPixel) - paddingPixels,
  )
  const right = Math.min(
    Math.ceil(imageWidth),
    Math.ceil(bbox.maxX / scalefactors.micronsPerPixel) + paddingPixels,
  )
  const top = Math.max(
    0,
    Math.floor(bbox.minY / scalefactors.micronsPerPixel) - paddingPixels,
  )
  const bottom = Math.min(
    Math.ceil(imageHeight),
    Math.ceil(bbox.maxY / scalefactors.micronsPerPixel) + paddingPixels,
  )

  if (right <= left || bottom <= top) {
    return null
  }

  return { left, top, right, bottom }
}

function readSingleRasterSample(value: unknown): ArrayLike<number | bigint> {
  if (isRasterArray(value)) {
    return value
  }

  if (Array.isArray(value)) {
    const firstSample = value[0]

    if (isRasterArray(firstSample)) {
      return firstSample
    }
  }

  throw new Error('Expected nucleus instance-mask TIFF to decode to one numeric raster.')
}

function isRasterArray(value: unknown): value is ArrayLike<number | bigint> {
  if (value === null || typeof value !== 'object') {
    return false
  }

  if (!('length' in value) || typeof value.length !== 'number') {
    return false
  }

  return Array.isArray(value) || ArrayBuffer.isView(value)
}

async function assertSegmentationGeojsonWithinBudget(
  url: string,
  maxBytes: number,
  fetcher: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (!Number.isFinite(maxBytes) || maxBytes < 0) {
    throw new RangeError('Segmentation GeoJSON full-file budget must be non-negative.')
  }

  const response = await fetcher(url, {
    method: 'HEAD',
    ...(signal === undefined ? {} : { signal }),
  })

  if (!response.ok) {
    throw new Error(`segmentation GeoJSON HEAD returned HTTP ${response.status}.`)
  }

  const contentLength = response.headers.get('content-length')

  if (contentLength === null) {
    throw new Error(
      'Segmentation GeoJSON size is not exposed through Content-Length, so the interactive full-file read budget cannot be verified.',
    )
  }

  const byteLength = Number(contentLength)

  if (!Number.isFinite(byteLength) || byteLength < 0) {
    throw new Error(
      `Segmentation GeoJSON returned invalid Content-Length ${contentLength}.`,
    )
  }

  if (byteLength > maxBytes) {
    throw new VisiumHdSegmentationGeojsonBudgetExceededError(url, byteLength, maxBytes)
  }
}

function appendMaskPixelEdges(
  edgesByLabel: Map<number, MaskEdge[]>,
  label: number,
  context: MaskPixelEdgeContext,
): void {
  const edges = readOrCreateMaskEdges(edgesByLabel, label)
  const { col, localCol, localRow, raster, row } = context

  if (readMaskLabel(raster, localRow - 1, localCol) !== label) {
    edges.push({
      start: { col, row },
      end: { col: col + 1, row },
    })
  }

  if (readMaskLabel(raster, localRow, localCol + 1) !== label) {
    edges.push({
      start: { col: col + 1, row },
      end: { col: col + 1, row: row + 1 },
    })
  }

  if (readMaskLabel(raster, localRow + 1, localCol) !== label) {
    edges.push({
      start: { col: col + 1, row: row + 1 },
      end: { col, row: row + 1 },
    })
  }

  if (readMaskLabel(raster, localRow, localCol - 1) !== label) {
    edges.push({
      start: { col, row: row + 1 },
      end: { col, row },
    })
  }
}

function readOrCreateMaskEdges(
  edgesByLabel: Map<number, MaskEdge[]>,
  label: number,
): MaskEdge[] {
  const existing = edgesByLabel.get(label)

  if (existing !== undefined) {
    return existing
  }

  const edges: MaskEdge[] = []
  edgesByLabel.set(label, edges)
  return edges
}

function traceMaskBoundaryRings(
  edges: readonly MaskEdge[],
  scalefactors: VisiumHdSegmentationScalefactors,
): readonly DataPoint[][] {
  const unusedEdges = new Set<number>()
  const outgoingEdges = new Map<string, number[]>()

  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index]

    if (edge === undefined) {
      continue
    }

    unusedEdges.add(index)
    const key = maskVertexKey(edge.start)
    const outgoing = outgoingEdges.get(key)

    if (outgoing === undefined) {
      outgoingEdges.set(key, [index])
    } else {
      outgoing.push(index)
    }
  }

  const rings: DataPoint[][] = []

  while (unusedEdges.size > 0) {
    const firstEdgeIndex = unusedEdges.values().next().value

    if (typeof firstEdgeIndex !== 'number') {
      break
    }

    const ring = traceMaskBoundaryRing(
      firstEdgeIndex,
      edges,
      outgoingEdges,
      unusedEdges,
      scalefactors,
    )

    if (ring.length >= 4) {
      rings.push(ring)
    }
  }

  return rings
}

function traceMaskBoundaryRing(
  firstEdgeIndex: number,
  edges: readonly MaskEdge[],
  outgoingEdges: ReadonlyMap<string, readonly number[]>,
  unusedEdges: Set<number>,
  scalefactors: VisiumHdSegmentationScalefactors,
): DataPoint[] {
  const firstEdge = edges[firstEdgeIndex]

  if (firstEdge === undefined) {
    unusedEdges.delete(firstEdgeIndex)
    return []
  }

  unusedEdges.delete(firstEdgeIndex)
  const vertices: MaskVertex[] = [firstEdge.start, firstEdge.end]
  const startKey = maskVertexKey(firstEdge.start)
  let current = firstEdge.end

  while (maskVertexKey(current) !== startKey) {
    const nextEdgeIndex = takeNextMaskEdgeIndex(current, outgoingEdges, unusedEdges)

    if (nextEdgeIndex === null) {
      break
    }

    const nextEdge = edges[nextEdgeIndex]

    if (nextEdge === undefined) {
      unusedEdges.delete(nextEdgeIndex)
      break
    }

    unusedEdges.delete(nextEdgeIndex)
    current = nextEdge.end
    vertices.push(current)
  }

  if (maskVertexKey(vertices.at(-1) ?? firstEdge.start) !== startKey) {
    return []
  }

  return vertices.map((vertex) => maskVertexToDataPoint(vertex, scalefactors))
}

function takeNextMaskEdgeIndex(
  vertex: MaskVertex,
  outgoingEdges: ReadonlyMap<string, readonly number[]>,
  unusedEdges: ReadonlySet<number>,
): number | null {
  const candidates = outgoingEdges.get(maskVertexKey(vertex))

  if (candidates === undefined) {
    return null
  }

  for (const candidate of candidates) {
    if (unusedEdges.has(candidate)) {
      return candidate
    }
  }

  return null
}

function readMaskLabel(
  raster: VisiumHdNucleusInstanceMaskRaster,
  row: number,
  col: number,
): number {
  if (row < 0 || col < 0 || row >= raster.height || col >= raster.width) {
    return 0
  }

  const value = raster.data[row * raster.width + col]

  if (value === undefined) {
    throw new Error(`Missing nucleus instance-mask pixel at row ${row}, column ${col}.`)
  }

  if (typeof value === 'bigint') {
    if (value <= 0n) {
      return 0
    }

    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(
        `Nucleus instance-mask label ${value.toString()} exceeds the safe integer range.`,
      )
    }

    return Number(value)
  }

  if (!Number.isFinite(value) || value <= 0) {
    return 0
  }

  if (!Number.isInteger(value)) {
    throw new Error(`Nucleus instance-mask label ${value} is not an integer.`)
  }

  return value
}

function normalizeRasterOrigin(value: number | undefined, label: string): number {
  if (value === undefined) {
    return 0
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `Expected nucleus instance-mask ${label} to be a non-negative integer.`,
    )
  }

  return value
}

function maskVertexToDataPoint(
  vertex: MaskVertex,
  scalefactors: VisiumHdSegmentationScalefactors,
): DataPoint {
  return {
    x: micrometers(vertex.col * scalefactors.micronsPerPixel),
    y: micrometers(vertex.row * scalefactors.micronsPerPixel),
  }
}

function maskVertexKey(vertex: MaskVertex): string {
  return `${vertex.col},${vertex.row}`
}

function formatVisiumHdNucleusInstanceMaskId(label: number): string {
  return `nucleus_${label.toString().padStart(9, '0')}`
}

function drainStreamedGeojsonFeatureScanner(
  scanner: StreamedGeojsonFeatureScanner,
  options: ParseVisiumHdSegmentationGeojsonOptions,
): void {
  if (scanner.mode === 'find-features') {
    const featuresStart = findGeojsonFeaturesArrayStart(scanner.buffer)

    if (featuresStart === null) {
      return
    }

    scanner.buffer = scanner.buffer.slice(featuresStart)
    scanner.mode = 'read-features'
  }

  while (scanner.mode === 'read-features') {
    const valueStart = skipJsonWhitespace(scanner.buffer, 0)

    if (valueStart >= scanner.buffer.length) {
      scanner.buffer = ''
      return
    }

    const nextChar = scanner.buffer[valueStart]

    if (nextChar === ']') {
      scanner.buffer = scanner.buffer.slice(valueStart + 1)
      scanner.mode = 'done'
      return
    }

    if (nextChar === ',') {
      scanner.buffer = scanner.buffer.slice(valueStart + 1)
      continue
    }

    if (nextChar !== '{') {
      throw new Error(
        `Expected Visium HD segmentation GeoJSON feature ${scanner.featureIndex} to be an object.`,
      )
    }

    const valueEnd = findJsonObjectEnd(scanner.buffer, valueStart)

    if (valueEnd === null) {
      scanner.buffer = scanner.buffer.slice(valueStart)
      return
    }

    const feature = expectObject(
      JSON.parse(scanner.buffer.slice(valueStart, valueEnd)) as unknown,
      `Visium HD segmentation feature ${scanner.featureIndex}`,
    )
    const featureElements = segmentationFeatureToElements(
      feature,
      scanner.featureIndex,
      {
        kind: options.kind ?? 'cell',
        scalefactors: options.scalefactors,
      },
    )

    scanner.elements.push(
      ...(options.bbox === undefined
        ? featureElements
        : filterVisiumHdSegmentationElementsByBbox(featureElements, options.bbox)),
    )
    scanner.featureIndex += 1
    scanner.buffer = scanner.buffer.slice(valueEnd)
  }
}

function assertStreamedGeojsonFeatureScannerComplete(
  scanner: StreamedGeojsonFeatureScanner,
): void {
  if (scanner.mode === 'done') {
    return
  }

  if (scanner.mode === 'find-features') {
    throw new Error('Expected Visium HD segmentation GeoJSON to be a FeatureCollection.')
  }

  throw new Error('Unexpected end of Visium HD segmentation GeoJSON feature stream.')
}

function findGeojsonFeaturesArrayStart(buffer: string): number | null {
  let cursor = 0
  let depth = 0

  while (cursor < buffer.length) {
    const char = buffer[cursor]

    if (char === '"') {
      const token = readJsonStringToken(buffer, cursor)

      if (token === null) {
        return null
      }

      if (depth === 1 && token.value === 'features') {
        const colonIndex = skipJsonWhitespace(buffer, token.end)

        if (colonIndex >= buffer.length) {
          return null
        }

        if (buffer[colonIndex] === ':') {
          const valueIndex = skipJsonWhitespace(buffer, colonIndex + 1)

          if (valueIndex >= buffer.length) {
            return null
          }

          if (buffer[valueIndex] !== '[') {
            throw new Error(
              'Expected Visium HD segmentation GeoJSON features to be an array.',
            )
          }

          return valueIndex + 1
        }
      }

      cursor = token.end
      continue
    }

    if (char === '{' || char === '[') {
      depth += 1
    } else if (char === '}' || char === ']') {
      depth -= 1
    }

    cursor += 1
  }

  return null
}

function findJsonObjectEnd(buffer: string, start: number): number | null {
  let cursor = start
  let depth = 0

  while (cursor < buffer.length) {
    const char = buffer[cursor]

    if (char === '"') {
      const token = readJsonStringToken(buffer, cursor)

      if (token === null) {
        return null
      }

      cursor = token.end
      continue
    }

    if (char === '{' || char === '[') {
      depth += 1
    } else if (char === '}' || char === ']') {
      depth -= 1

      if (depth === 0) {
        return cursor + 1
      }
    }

    cursor += 1
  }

  return null
}

function readJsonStringToken(buffer: string, start: number): JsonStringToken | null {
  let cursor = start + 1
  let escaped = false

  while (cursor < buffer.length) {
    const char = buffer[cursor]

    if (escaped) {
      escaped = false
      cursor += 1
      continue
    }

    if (char === '\\') {
      escaped = true
      cursor += 1
      continue
    }

    if (char === '"') {
      const end = cursor + 1
      return { value: JSON.parse(buffer.slice(start, end)) as string, end }
    }

    cursor += 1
  }

  return null
}

function skipJsonWhitespace(buffer: string, start: number): number {
  let cursor = start

  while (cursor < buffer.length && /\s/.test(buffer[cursor] ?? '')) {
    cursor += 1
  }

  return cursor
}

function segmentationFeatureToElements(
  feature: Record<string, unknown>,
  featureIndex: number,
  options: {
    readonly kind: VisiumHdSegmentationKind
    readonly scalefactors: VisiumHdSegmentationScalefactors
  },
): readonly SpatialElement[] {
  if (feature.type !== 'Feature') {
    throw new Error(
      `Expected Visium HD segmentation feature ${featureIndex} to be a Feature.`,
    )
  }

  const geometry = expectObject(
    feature.geometry,
    `Visium HD segmentation feature ${featureIndex} geometry`,
  )
  const polygonRings = readGeometryPolygons(geometry, featureIndex, options.scalefactors)
  const baseId = readSegmentationFeatureId(feature, featureIndex, options.kind)
  const metadata = readSegmentationFeatureMetadata(feature, featureIndex, options.kind)
  const elements: SpatialElement[] = []

  for (let polygonIndex = 0; polygonIndex < polygonRings.length; polygonIndex += 1) {
    const rings = polygonRings[polygonIndex]

    if (rings === undefined || rings.length === 0) {
      continue
    }

    elements.push({
      id: polygonIndex === 0 ? baseId : `${baseId}#${polygonIndex + 1}`,
      geometry: { kind: 'polygon', rings },
      ...(metadata === undefined ? {} : { metadata }),
    })
  }

  return elements
}

function readGeometryPolygons(
  geometry: Record<string, unknown>,
  featureIndex: number,
  scalefactors: VisiumHdSegmentationScalefactors,
): readonly (readonly DataPoint[][])[] {
  if (geometry.type === 'Polygon') {
    return [
      readPolygonRings(
        expectGeojsonPolygon(geometry.coordinates, featureIndex),
        featureIndex,
        0,
        scalefactors,
      ),
    ]
  }

  if (geometry.type === 'MultiPolygon') {
    const polygons = expectGeojsonMultiPolygon(geometry.coordinates, featureIndex)
    return polygons.map((polygon, polygonIndex) =>
      readPolygonRings(polygon, featureIndex, polygonIndex, scalefactors),
    )
  }

  throw new Error(
    `Expected Visium HD segmentation feature ${featureIndex} geometry to be Polygon or MultiPolygon.`,
  )
}

function readPolygonRings(
  polygon: GeojsonPolygon,
  featureIndex: number,
  polygonIndex: number,
  scalefactors: VisiumHdSegmentationScalefactors,
): readonly DataPoint[][] {
  const rings: DataPoint[][] = []

  for (let ringIndex = 0; ringIndex < polygon.length; ringIndex += 1) {
    const ring = polygon[ringIndex]

    if (!Array.isArray(ring)) {
      throw new Error(
        `Expected Visium HD segmentation feature ${featureIndex} polygon ${polygonIndex} ring ${ringIndex} to be an array.`,
      )
    }

    const points = ring.map((coordinate, pointIndex) =>
      readGeojsonPosition(coordinate, {
        featureIndex,
        polygonIndex,
        ringIndex,
        pointIndex,
        scalefactors,
      }),
    )

    if (points.length >= 3) {
      rings.push(points)
    }
  }

  return rings
}

function readGeojsonPosition(
  coordinate: readonly number[],
  context: {
    readonly featureIndex: number
    readonly polygonIndex: number
    readonly ringIndex: number
    readonly pointIndex: number
    readonly scalefactors: VisiumHdSegmentationScalefactors
  },
): DataPoint {
  if (!Array.isArray(coordinate) || coordinate.length < 2) {
    throw new Error(
      `Expected Visium HD segmentation feature ${context.featureIndex} polygon ${context.polygonIndex} ring ${context.ringIndex} point ${context.pointIndex} to be a coordinate pair.`,
    )
  }

  const x = coordinate[0]
  const y = coordinate[1]

  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    throw new Error(
      `Expected Visium HD segmentation feature ${context.featureIndex} polygon ${context.polygonIndex} ring ${context.ringIndex} point ${context.pointIndex} to contain finite coordinates.`,
    )
  }

  return {
    x: micrometers(x * context.scalefactors.micronsPerPixel),
    y: micrometers(y * context.scalefactors.micronsPerPixel),
  }
}

function appendSegmentationInfo(
  segmentations: SegmentationInfo[],
  info: Omit<SegmentationInfo, 'path'> & { readonly path: string | undefined },
): void {
  if (info.path === undefined) {
    return
  }

  segmentations.push({
    id: info.id,
    kind: info.kind,
    label: info.label,
    sourceKind: info.sourceKind,
    path: info.path,
    ...(info.annotated === undefined ? {} : { annotated: info.annotated }),
  })
}

function readSegmentationFeatureId(
  feature: Record<string, unknown>,
  featureIndex: number,
  kind: VisiumHdSegmentationKind,
): string {
  const properties =
    feature.properties === null || feature.properties === undefined
      ? {}
      : expectObject(
          feature.properties,
          `Visium HD segmentation feature ${featureIndex} properties`,
        )
  const preferredValue =
    kind === 'cell'
      ? readFirstProperty(properties, ['cell_id', 'Cell_id', 'cellId', 'CellID'])
      : readFirstProperty(properties, [
          'nucleus_id',
          'Nucleus_id',
          'nucleusId',
          'NucleusID',
        ])
  const normalizedId =
    kind === 'cell' ? normalizeVisiumHdGeojsonCellId(preferredValue) : null

  if (normalizedId !== null) {
    return normalizedId
  }

  const fallbackId = preferredValue ?? feature.id

  if (typeof fallbackId === 'string' && fallbackId.trim().length > 0) {
    return fallbackId.trim()
  }

  if (typeof fallbackId === 'number' && Number.isFinite(fallbackId)) {
    return `${kind}_${Math.trunc(fallbackId).toString().padStart(9, '0')}`
  }

  if (typeof fallbackId === 'bigint') {
    return `${kind}_${fallbackId.toString().padStart(9, '0')}`
  }

  return `${kind}_${featureIndex.toString().padStart(9, '0')}`
}

function readSegmentationFeatureMetadata(
  feature: Record<string, unknown>,
  featureIndex: number,
  kind: VisiumHdSegmentationKind,
): SpatialElementMetadata | undefined {
  const properties =
    feature.properties === null || feature.properties === undefined
      ? {}
      : expectObject(
          feature.properties,
          `Visium HD segmentation feature ${featureIndex} properties`,
        )
  const label = readAnnotationLabel(properties)
  const color = readColorProperty(properties, ANNOTATION_COLOR_PROPERTY_KEYS)
  const fillColor = readColorProperty(properties, ANNOTATION_FILL_COLOR_PROPERTY_KEYS)
  const lineColor = readColorProperty(properties, ANNOTATION_LINE_COLOR_PROPERTY_KEYS)

  if (
    label === undefined &&
    color === undefined &&
    fillColor === undefined &&
    lineColor === undefined
  ) {
    return undefined
  }

  return {
    segmentation: {
      kind,
      annotation: {
        ...(label === undefined ? {} : { label }),
        ...(color === undefined ? {} : { color }),
        ...(fillColor === undefined ? {} : { fillColor }),
        ...(lineColor === undefined ? {} : { lineColor }),
      },
    },
  }
}

function readAnnotationLabel(source: Record<string, unknown>): string | undefined {
  const value = readFirstProperty(source, ANNOTATION_LABEL_PROPERTY_KEYS)

  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length === 0 ? undefined : trimmed
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? value.toString() : value.toLocaleString()
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  return undefined
}

function readColorProperty(
  source: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const color = normalizeGeojsonColor(source[key])

    if (color !== undefined) {
      return color
    }
  }

  return undefined
}

function normalizeGeojsonColor(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()

    return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toLowerCase() : undefined
  }

  if (Array.isArray(value) && value.length >= 3) {
    const red = normalizeColorComponent(value[0])
    const green = normalizeColorComponent(value[1])
    const blue = normalizeColorComponent(value[2])

    if (red === null || green === null || blue === null) {
      return undefined
    }

    return `#${componentToHex(red)}${componentToHex(green)}${componentToHex(blue)}`
  }

  return undefined
}

function normalizeColorComponent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  return Math.max(0, Math.min(255, Math.round(value)))
}

function componentToHex(value: number): string {
  return value.toString(16).padStart(2, '0')
}

function readFirstProperty(
  source: Record<string, unknown>,
  keys: readonly string[],
): unknown {
  for (const key of keys) {
    if (key in source) {
      return source[key]
    }
  }

  return undefined
}

function elementIntersectsBbox(element: SpatialElement, bbox: BBox): boolean {
  if (element.geometry.kind !== 'polygon') {
    return false
  }

  for (const ring of element.geometry.rings) {
    for (const point of ring) {
      if (
        point.x >= bbox.minX &&
        point.x <= bbox.maxX &&
        point.y >= bbox.minY &&
        point.y <= bbox.maxY
      ) {
        return true
      }
    }
  }

  return polygonBboxIntersectsBbox(element.geometry.rings, bbox)
}

function polygonBboxIntersectsBbox(
  rings: readonly (readonly DataPoint[])[],
  bbox: BBox,
): boolean {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const ring of rings) {
    for (const point of ring) {
      minX = Math.min(minX, point.x)
      maxX = Math.max(maxX, point.x)
      minY = Math.min(minY, point.y)
      maxY = Math.max(maxY, point.y)
    }
  }

  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxY)
  ) {
    return false
  }

  return maxX >= bbox.minX && minX <= bbox.maxX && maxY >= bbox.minY && minY <= bbox.maxY
}

function expectGeojsonPolygon(value: unknown, featureIndex: number): GeojsonPolygon {
  if (Array.isArray(value)) {
    return value as GeojsonPolygon
  }

  throw new Error(
    `Expected Visium HD segmentation feature ${featureIndex} Polygon coordinates to be an array.`,
  )
}

function expectGeojsonMultiPolygon(
  value: unknown,
  featureIndex: number,
): GeojsonMultiPolygon {
  if (Array.isArray(value)) {
    return value as GeojsonMultiPolygon
  }

  throw new Error(
    `Expected Visium HD segmentation feature ${featureIndex} MultiPolygon coordinates to be an array.`,
  )
}

function expectObject(value: unknown, label: string): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  throw new Error(`Expected ${label} to be an object.`)
}

function assertPositiveMicronsPerPixel(value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `Visium HD segmentation microns_per_pixel must be positive, received ${value}.`,
    )
  }
}

function formatVisiumHdMatrixCellId(value: number | bigint): string {
  const digits =
    typeof value === 'bigint' ? value.toString() : Math.trunc(value).toString()
  return `cellid_${digits.padStart(9, '0')}-1`
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortError(signal)
  }
}

function isTiffPath(path: string): boolean {
  return /\.tiff?$/i.test(path)
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason
  }

  const error = new Error('Visium HD segmentation request aborted.')
  error.name = 'AbortError'
  return error
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
