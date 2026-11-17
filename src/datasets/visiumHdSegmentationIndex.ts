import { micrometers, type BBox, type DataPoint } from '../data/coords'
import type { SpatialElement, SpatialElementMetadata } from './spatialDataset'

// A Visium HD segmentation GeoJSON read once into columns, so each viewport
// selects its polygons from memory instead of streaming the file again.
// Elements are built only for the polygons a request returns.
export interface VisiumHdSegmentationIndex {
  // Element id per polygon; a MultiPolygon's later polygons end in #2, #3, ...
  readonly ids: readonly string[]
  // minX, minY, maxX, maxY per polygon, in µm.
  readonly bounds: Float64Array
  // Polygon i's rings are rings polygonRingOffsets[i] up to
  // polygonRingOffsets[i + 1].
  readonly polygonRingOffsets: Uint32Array
  // Ring j is coords[ringOffsets[j]] up to coords[ringOffsets[j + 1]], as
  // interleaved x, y in µm. Float32 keeps the reference dataset's 182,560
  // cells (2.4 million vertices) near 20 MB.
  readonly ringOffsets: Uint32Array
  readonly coords: Float32Array
  // Polygon i's metadata is metadata[metadataIndexes[i]]; entry 0 is none.
  // Annotated files repeat a few label and colour combinations, so each is
  // stored once.
  readonly metadataIndexes: Uint32Array
  readonly metadata: readonly (SpatialElementMetadata | undefined)[]
  // The cell each nucleus belongs to, kept out of the shared metadata; absent
  // when no polygon names one.
  readonly cellIds?: readonly (string | undefined)[]
}

// Collects polygons into index columns as a file is parsed.
export class VisiumHdSegmentationIndexBuilder {
  private readonly ids: string[] = []
  private readonly bounds = new GrowableColumn((length) => new Float64Array(length))
  private readonly polygonRingOffsets = new GrowableColumn(
    (length) => new Uint32Array(length),
  )
  private readonly ringOffsets = new GrowableColumn((length) => new Uint32Array(length))
  private readonly coords = new GrowableColumn((length) => new Float32Array(length))
  private readonly metadataIndexes = new GrowableColumn(
    (length) => new Uint32Array(length),
  )
  private readonly metadata: (SpatialElementMetadata | undefined)[] = [undefined]
  private readonly metadataIndexesByKey = new Map<string, number>()
  private readonly cellIds: (string | undefined)[] = []
  private hasCellIds = false

  constructor() {
    this.polygonRingOffsets.push(0)
    this.ringOffsets.push(0)
  }

  add(element: SpatialElement): void {
    if (element.geometry.kind !== 'polygon') {
      return
    }

    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY

    for (const ring of element.geometry.rings) {
      for (const point of ring) {
        this.coords.push(point.x)
        this.coords.push(point.y)
        minX = Math.min(minX, point.x)
        minY = Math.min(minY, point.y)
        maxX = Math.max(maxX, point.x)
        maxY = Math.max(maxY, point.y)
      }

      this.ringOffsets.push(this.coords.length)
    }

    this.ids.push(element.id)
    this.bounds.push(minX)
    this.bounds.push(minY)
    this.bounds.push(maxX)
    this.bounds.push(maxY)
    this.polygonRingOffsets.push(this.ringOffsets.length - 1)
    const { metadata, cellId } = splitSegmentationCellId(element.metadata)
    this.cellIds.push(cellId)
    this.hasCellIds ||= cellId !== undefined
    this.metadataIndexes.push(this.metadataIndex(metadata))
  }

  finish(): VisiumHdSegmentationIndex {
    return {
      ids: this.ids,
      bounds: this.bounds.toArray(),
      polygonRingOffsets: this.polygonRingOffsets.toArray(),
      ringOffsets: this.ringOffsets.toArray(),
      coords: this.coords.toArray(),
      metadataIndexes: this.metadataIndexes.toArray(),
      metadata: this.metadata,
      ...(this.hasCellIds ? { cellIds: this.cellIds } : {}),
    }
  }

  private metadataIndex(metadata: SpatialElementMetadata | undefined): number {
    if (metadata === undefined) {
      return 0
    }

    const key = JSON.stringify(metadata)
    const existing = this.metadataIndexesByKey.get(key)

    if (existing !== undefined) {
      return existing
    }

    const index = this.metadata.length
    this.metadata.push(metadata)
    this.metadataIndexesByKey.set(key, index)
    return index
  }
}

export function visiumHdSegmentationIndexFromElements(
  elements: readonly SpatialElement[],
): VisiumHdSegmentationIndex {
  const builder = new VisiumHdSegmentationIndexBuilder()

  for (const element of elements) {
    builder.add(element)
  }

  return builder.finish()
}

// The polygons whose bounds meet `bbox`, by polygon index in file order.
// Elements in `previous` are reused, so polygons still in view keep the same
// objects across viewport requests.
export function selectVisiumHdSegmentationIndexElements(
  index: VisiumHdSegmentationIndex,
  bbox: BBox,
  previous: ReadonlyMap<number, SpatialElement> = new Map(),
): Map<number, SpatialElement> {
  const { bounds } = index
  const selected = new Map<number, SpatialElement>()

  for (let polygon = 0; polygon < index.ids.length; polygon += 1) {
    const offset = polygon * 4

    if (
      (bounds[offset] ?? 0) > bbox.maxX ||
      (bounds[offset + 1] ?? 0) > bbox.maxY ||
      (bounds[offset + 2] ?? 0) < bbox.minX ||
      (bounds[offset + 3] ?? 0) < bbox.minY
    ) {
      continue
    }

    selected.set(
      polygon,
      previous.get(polygon) ?? segmentationIndexElement(index, polygon),
    )
  }

  return selected
}

export function visiumHdSegmentationIndexTransferables(
  index: VisiumHdSegmentationIndex,
): ArrayBuffer[] {
  return [
    index.bounds,
    index.polygonRingOffsets,
    index.ringOffsets,
    index.coords,
    index.metadataIndexes,
  ].map((column) => column.buffer as ArrayBuffer)
}

function segmentationIndexElement(
  index: VisiumHdSegmentationIndex,
  polygon: number,
): SpatialElement {
  const { coords, ringOffsets } = index
  const rings: DataPoint[][] = []
  const firstRing = index.polygonRingOffsets[polygon] ?? 0
  const endRing = index.polygonRingOffsets[polygon + 1] ?? firstRing

  for (let ring = firstRing; ring < endRing; ring += 1) {
    const end = ringOffsets[ring + 1] ?? 0
    const points: DataPoint[] = []

    for (let offset = ringOffsets[ring] ?? end; offset < end; offset += 2) {
      points.push({
        x: micrometers(coords[offset] ?? 0),
        y: micrometers(coords[offset + 1] ?? 0),
      })
    }

    rings.push(points)
  }

  const metadata = withSegmentationCellId(
    index.metadata[index.metadataIndexes[polygon] ?? 0],
    index.cellIds?.[polygon],
  )

  return {
    id: index.ids[polygon] ?? String(polygon),
    geometry: { kind: 'polygon', rings },
    ...(metadata === undefined ? {} : { metadata }),
  }
}

// Each nucleus names its own cell, so the cell ID would make every metadata
// entry unique; it is stored in its own column instead.
function splitSegmentationCellId(metadata: SpatialElementMetadata | undefined): {
  readonly metadata: SpatialElementMetadata | undefined
  readonly cellId: string | undefined
} {
  const segmentation = metadata?.segmentation

  if (segmentation?.cellId === undefined) {
    return { metadata, cellId: undefined }
  }

  const { cellId, ...rest } = segmentation
  const shared = rest.annotation === undefined ? undefined : { segmentation: rest }

  return { metadata: shared, cellId }
}

function withSegmentationCellId(
  metadata: SpatialElementMetadata | undefined,
  cellId: string | undefined,
): SpatialElementMetadata | undefined {
  if (cellId === undefined) {
    return metadata
  }

  return {
    ...metadata,
    segmentation: { ...(metadata?.segmentation ?? { kind: 'nucleus' }), cellId },
  }
}

// A typed column that doubles its capacity as values are pushed.
class GrowableColumn<T extends Float32Array | Float64Array | Uint32Array> {
  private values: T
  length = 0

  constructor(private readonly allocate: (length: number) => T) {
    this.values = allocate(1024)
  }

  push(value: number): void {
    if (this.length === this.values.length) {
      const next = this.allocate(this.values.length * 2)
      next.set(this.values)
      this.values = next
    }

    this.values[this.length] = value
    this.length += 1
  }

  toArray(): T {
    const result = this.allocate(this.length)
    result.set(this.values.subarray(0, this.length))
    return result
  }
}
