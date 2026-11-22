import { micrometers, type BBox, type DataPoint } from '../data/coords'
import { MAX_BOUNDARY_VIEWPORT_CELL_LIMIT } from '../rendering/boundaryViewport'
import { LABEL_OUTLINE_MAX_PIXELS } from './spatialDataLabelTrace'
import type { LabelLevelGeometry, LabelOutlineReader } from './spatialDataLabels'
import { shapeRing, type SpatialDataShapes } from './spatialDataShapes'
import type { Affine2D } from './spatialDataTransforms'
import type { ElementBatch, SpatialElement } from './spatialDataset'
import {
  isLabelSegmentationFormat,
  segmentationSourceName,
  type SegmentationSource,
} from './segmentationSource'
import type { VectorSegmentationReader } from './vectorSegmentationWorker'

// A segmentation imported onto an image-only source: its outlines, read for
// the view as the viewer's cell boundaries are. It has no table, so it is
// outlines only: each shape's ID is its label value or the file's ID.

// The image the segmentation was drawn on, which places it.
export interface SegmentationPlacement {
  readonly micrometersPerPixel: number
  // Full-resolution size in pixels.
  readonly imageWidth: number
  readonly imageHeight: number
}

export interface ImportedSegmentation {
  readonly source: SegmentationSource
  // The file name.
  readonly name: string
  // Polygons in the file; unknown for a label mask, whose labels are only
  // seen as they are traced.
  readonly shapeCount?: number
  // The mask's full-resolution size, for a label mask.
  readonly maskSize?: { readonly width: number; readonly height: number }
  // Something about the placement worth checking, such as outlines reaching
  // beyond the image.
  readonly warning?: string
  // About how many outlines meet `bbox`: exact for polygons; for a mask,
  // from the density of the labels traced so far, or 1 before any are.
  estimateCount(bbox: BBox): number
  // The outlines meeting `bbox`, or none and `overLimit` when there are more
  // than can be drawn, or the mask cannot be traced finely enough there. A
  // mask, whose count is only known once traced, also stops at `cellLimit`.
  outlines(
    bbox: BBox,
    options?: { readonly signal?: AbortSignal; readonly cellLimit?: number },
  ): Promise<ElementBatch>
}

// The parts of a label outline reader a mask segmentation uses, whatever
// reads its chunks.
type LabelOutlines = Pick<
  LabelOutlineReader<LabelLevelGeometry>,
  'levels' | 'levelForBounds' | 'windowPixels' | 'outlines'
>

// A mask is traced only from pyramid levels at most this much coarser than
// its full resolution; coarser, cells are a few pixels and not worth
// outlining.
export const MAX_LABEL_TRACE_DOWNSAMPLE = 4

export interface OpenImportedSegmentationOptions {
  readonly signal?: AbortSignal
  // Polygons read so far, while a polygon file is read.
  readonly onProgress?: (shapeCount: number) => void
  readonly readVector?: VectorSegmentationReader
}

export async function openImportedSegmentation(
  source: SegmentationSource,
  placement: SegmentationPlacement,
  options: OpenImportedSegmentationOptions = {},
): Promise<ImportedSegmentation> {
  if (isLabelSegmentationFormat(source.format)) {
    return openLabelSegmentation(source, placement, options)
  }

  const readVector =
    options.readVector ??
    (await import('./vectorSegmentationWorker')).readVectorSegmentationInWorker
  const shapes = await readVector({
    file:
      source.file === undefined
        ? { kind: 'url', url: source.url }
        : { kind: 'file', file: source.file },
    format: source.format as 'geojson' | 'wkt' | 'parquet',
    micrometersPerUnit:
      source.coordinates === 'micrometers' ? 1 : placement.micrometersPerPixel,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
  })

  return new VectorSegmentation(source, shapes, placement)
}

async function openLabelSegmentation(
  source: SegmentationSource,
  placement: SegmentationPlacement,
  options: OpenImportedSegmentationOptions,
): Promise<ImportedSegmentation> {
  const signalOptions = options.signal === undefined ? {} : { signal: options.signal }
  let reader: LabelOutlines

  if (source.format === 'label-tiff') {
    const { openTiffLabelLoader, tiffLabelOutlineReader } = await import('./tiffLabels')
    const loader = await openTiffLabelLoader(tiffLabelUrl(source), {
      ...signalOptions,
      ...(source.file === undefined
        ? {}
        : { bytes: new Uint8Array(await source.file.arrayBuffer()) }),
    })
    reader = tiffLabelOutlineReader(
      loader,
      maskToMicrometers(placement, loader.imageWidth, loader.imageHeight),
    )
  } else {
    if (source.file !== undefined) {
      throw new Error('A Zarr label image is opened from its URL, not as a file.')
    }

    const { openOmeZarrLabels, SpatialDataLabelsReader } =
      await import('./spatialDataLabels')
    const opened = await openOmeZarrLabels(source.url, signalOptions)
    const base = opened.levels[0]

    if (base === undefined) {
      throw new Error('The label image has no readable levels.')
    }

    reader = new SpatialDataLabelsReader(
      opened.levels,
      maskToMicrometers(placement, base.width, base.height),
    )
  }

  return new LabelSegmentation(source, reader, placement)
}

let pickedFileCount = 0

// A picked file's name as it is; the last part of a URL, decoded.
function importedSegmentationName(source: SegmentationSource): string {
  return source.file === undefined ? segmentationSourceName(source.url) : source.url
}

// The TIFF reader keys files and their strip bands by URL, so a picked file
// gets one of its own, even when another picked file had the same name.
function tiffLabelUrl(source: SegmentationSource): string {
  if (source.file === undefined) {
    return source.url
  }

  pickedFileCount += 1
  return `picked-file://${pickedFileCount.toString()}/${encodeURIComponent(source.url)}`
}

// Mask pixels -> µm: the mask covers the image, so a mask on the image's own
// pixel grid lines up pixel for pixel and a downsampled one is stretched.
function maskToMicrometers(
  placement: SegmentationPlacement,
  maskWidth: number,
  maskHeight: number,
): Affine2D {
  return {
    a: (placement.micrometersPerPixel * placement.imageWidth) / maskWidth,
    b: 0,
    c: 0,
    d: 0,
    e: (placement.micrometersPerPixel * placement.imageHeight) / maskHeight,
    f: 0,
  }
}

class VectorSegmentation implements ImportedSegmentation {
  readonly source: SegmentationSource
  readonly name: string
  readonly shapeCount: number
  readonly warning?: string
  private readonly shapes: SpatialDataShapes
  // The last request's elements by shape, reused while they stay in view.
  private elements = new Map<number, SpatialElement>()

  constructor(
    source: SegmentationSource,
    shapes: SpatialDataShapes,
    placement: SegmentationPlacement,
  ) {
    this.source = source
    this.name = importedSegmentationName(source)
    this.shapes = shapes
    this.shapeCount = shapes.ids.length
    const warning = vectorPlacementWarning(shapes, placement, source)

    if (warning !== undefined) {
      this.warning = warning
    }
  }

  estimateCount(bbox: BBox): number {
    const { bounds } = this.shapes
    let count = 0

    for (let offset = 0; offset < bounds.length; offset += 4) {
      if (boundsMeet(bounds, offset, bbox)) {
        count += 1
      }
    }

    return count
  }

  async outlines(bbox: BBox): Promise<ElementBatch> {
    const { bounds } = this.shapes
    const selected: number[] = []
    let count = 0

    for (let shape = 0, offset = 0; offset < bounds.length; shape += 1, offset += 4) {
      if (!boundsMeet(bounds, offset, bbox)) {
        continue
      }

      count += 1

      if (count <= MAX_BOUNDARY_VIEWPORT_CELL_LIMIT) {
        selected.push(shape)
      }
    }

    if (count > MAX_BOUNDARY_VIEWPORT_CELL_LIMIT) {
      return { elements: [], overLimit: { count } }
    }

    const elements = new Map<number, SpatialElement>()

    for (const shape of selected) {
      elements.set(shape, this.elements.get(shape) ?? this.element(shape))
    }

    this.elements = elements
    return { elements: Array.from(elements.values()) }
  }

  private element(shape: number): SpatialElement {
    const ring = shapeRing(this.shapes, shape)
    const points: DataPoint[] = []

    for (let offset = 0; offset < ring.length; offset += 2) {
      points.push({
        x: micrometers(ring[offset] ?? 0),
        y: micrometers(ring[offset + 1] ?? 0),
      })
    }

    return {
      id: this.shapes.ids[shape] ?? shape.toString(),
      geometry: { kind: 'polygon', rings: [points] },
    }
  }
}

class LabelSegmentation implements ImportedSegmentation {
  readonly source: SegmentationSource
  readonly name: string
  readonly maskSize: { readonly width: number; readonly height: number }
  readonly warning?: string
  private readonly reader: LabelOutlines
  private readonly extent: BBox
  // Labels per µm² in the last area traced; null before any.
  private density: number | null = null
  private readonly elementsByRing = new WeakMap<Float64Array, SpatialElement>()

  constructor(
    source: SegmentationSource,
    reader: LabelOutlines,
    placement: SegmentationPlacement,
  ) {
    this.source = source
    this.name = importedSegmentationName(source)
    this.reader = reader
    const base = reader.levels[0]
    this.maskSize = { width: base?.width ?? 0, height: base?.height ?? 0 }
    this.extent = {
      minX: micrometers(0),
      minY: micrometers(0),
      maxX: micrometers(placement.imageWidth * placement.micrometersPerPixel),
      maxY: micrometers(placement.imageHeight * placement.micrometersPerPixel),
    }
    const warning = maskPlacementWarning(this.maskSize, placement)

    if (warning !== undefined) {
      this.warning = warning
    }
  }

  estimateCount(bbox: BBox): number {
    return this.density === null
      ? 1
      : Math.max(1, Math.round(this.density * overlapArea(bbox, this.extent)))
  }

  async outlines(
    bbox: BBox,
    options: { readonly signal?: AbortSignal; readonly cellLimit?: number } = {},
  ): Promise<ElementBatch> {
    const level = this.reader.levelForBounds(bbox, LABEL_OUTLINE_MAX_PIXELS)

    if (
      this.reader.windowPixels(level, bbox) > LABEL_OUTLINE_MAX_PIXELS ||
      (this.reader.levels[level]?.scaleX ?? 1) > MAX_LABEL_TRACE_DOWNSAMPLE
    ) {
      return { elements: [], overLimit: {} }
    }

    const outlines = await this.reader.outlines(bbox, {
      maxPixels: LABEL_OUTLINE_MAX_PIXELS,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    const area = overlapArea(bbox, this.extent)

    if (area > 0) {
      this.density = outlines.length / area
    }

    if (
      outlines.length >
      Math.min(options.cellLimit ?? Infinity, MAX_BOUNDARY_VIEWPORT_CELL_LIMIT)
    ) {
      return { elements: [], overLimit: { count: outlines.length } }
    }

    return {
      elements: outlines.map((outline) => {
        const cached = this.elementsByRing.get(outline.ring)

        if (cached !== undefined) {
          return cached
        }

        const points: DataPoint[] = []

        for (let offset = 0; offset < outline.ring.length; offset += 2) {
          points.push({
            x: micrometers(outline.ring[offset] ?? 0),
            y: micrometers(outline.ring[offset + 1] ?? 0),
          })
        }

        const element: SpatialElement = {
          id: outline.label.toString(),
          geometry: { kind: 'polygon', rings: [points] },
        }
        this.elementsByRing.set(outline.ring, element)
        return element
      }),
    }
  }
}

function boundsMeet(bounds: Float64Array, offset: number, bbox: BBox): boolean {
  return (
    (bounds[offset] ?? 0) <= bbox.maxX &&
    (bounds[offset + 1] ?? 0) <= bbox.maxY &&
    (bounds[offset + 2] ?? 0) >= bbox.minX &&
    (bounds[offset + 3] ?? 0) >= bbox.minY
  )
}

function overlapArea(left: BBox, right: BBox): number {
  const width = Math.min(left.maxX, right.maxX) - Math.max(left.minX, right.minX)
  const height = Math.min(left.maxY, right.maxY) - Math.max(left.minY, right.minY)
  return width > 0 && height > 0 ? width * height : 0
}

// Outlines far outside the image, or squeezed into its corner, usually mean
// the wrong coordinate units.
function vectorPlacementWarning(
  shapes: SpatialDataShapes,
  placement: SegmentationPlacement,
  source: SegmentationSource,
): string | undefined {
  const { bounds } = shapes
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (let offset = 0; offset < bounds.length; offset += 4) {
    maxX = Math.max(maxX, bounds[offset + 2] ?? 0)
    maxY = Math.max(maxY, bounds[offset + 3] ?? 0)
  }

  const width = placement.imageWidth * placement.micrometersPerPixel
  const height = placement.imageHeight * placement.micrometersPerPixel
  const other = source.coordinates === 'pixels' ? 'Micrometres' : 'Pixels'

  if (maxX > width * 1.05 || maxY > height * 1.05) {
    return `The outlines reach beyond the image. If they look too large, their coordinates may be in other units: choose ${other}.`
  }

  if (source.coordinates === 'pixels' && maxX < width / 2 && maxY < height / 2) {
    return 'The outlines cover only the top-left part of the image. If they look shrunk, their coordinates may be micrometres: choose Micrometres.'
  }

  return undefined
}

function maskPlacementWarning(
  maskSize: { readonly width: number; readonly height: number },
  placement: SegmentationPlacement,
): string | undefined {
  const maskAspect = maskSize.width / maskSize.height
  const imageAspect = placement.imageWidth / placement.imageHeight

  return Math.abs(maskAspect / imageAspect - 1) > 0.01
    ? `The mask is ${maskSize.width.toLocaleString()} × ${maskSize.height.toLocaleString()} pixels, not the image's shape (${placement.imageWidth.toLocaleString()} × ${placement.imageHeight.toLocaleString()}); it is stretched to cover the image.`
    : undefined
}
