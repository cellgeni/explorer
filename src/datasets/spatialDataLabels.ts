import * as zarr from 'zarrita'
import {
  labelWindow,
  outerRing,
  traceLabelEdges,
  type PackedLabelTrace,
} from './spatialDataLabelTrace'
import { applyAffine, composeAffine, type Affine2D } from './spatialDataTransforms'
import { sharedZarrDecodePool, type ZarrDecodePool } from '../workers/zarrDecodePool'
import {
  ZarrChunkUnavailableError,
  zarrArrayMetadata,
  zarrChunkKey,
} from '../zarr/zarrStores'

// Reads SpatialData `labels` rasters (integer segmentation masks) and turns
// them into per-label outlines on demand. Outlines are traced per chunk along
// pixel edges; edges on a chunk border cancel against the neighbouring chunk's
// edges when both are loaded, so cells spanning chunks close up correctly.

export interface SpatialDataLabelPoint {
  readonly x: number
  readonly y: number
}

export interface SpatialDataLabelBounds {
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
}

export interface SpatialDataLabelLevel {
  readonly array: zarr.Array<zarr.DataType, zarr.Readable>
  readonly width: number
  readonly height: number
  readonly chunkWidth: number
  readonly chunkHeight: number
  readonly xAxis: number
  readonly yAxis: number
  // Level pixel -> element (level-0) coordinates.
  readonly scaleX: number
  readonly scaleY: number
}

export interface SpatialDataLabelChunkTrace extends PackedLabelTrace {
  readonly level: number
  readonly col: number
  readonly row: number
  readonly approximateBytes: number
}

export interface SpatialDataLabelOutline {
  readonly label: number
  // Outer ring in target coordinates as [x0, y0, x1, y1, ...]. The same array
  // is returned for a label until the chunks contributing to it change.
  readonly ring: Float64Array
}

// Decodes one chunk window and traces it, on the main thread or in a worker.
export interface SpatialDataLabelTraceRequest {
  readonly level: SpatialDataLabelLevel
  readonly coords: readonly number[]
  readonly x0: number
  readonly y0: number
  readonly width: number
  readonly height: number
  readonly signal?: AbortSignal
}

export type SpatialDataLabelTracer = (
  request: SpatialDataLabelTraceRequest,
) => Promise<PackedLabelTrace>

interface CachedRing {
  readonly contributions: readonly SpatialDataLabelChunkTrace[]
  readonly ring: Float64Array
}

const DEFAULT_MAX_TRACE_CACHE_BYTES = 192 * 1024 * 1024
const MAX_CACHED_RINGS = 250_000
// Outlines are simplified to within this many level pixels; smoothed
// staircases are straight, so this drops most points without clipping small
// cells.
const RING_TOLERANCE_PIXELS = 0.25

export const traceLabelChunkOnMainThread: SpatialDataLabelTracer = async (request) => {
  const { level } = request
  const chunk = await level.array.getChunk(
    [...request.coords],
    request.signal === undefined ? undefined : { signal: request.signal },
  )
  const labels = labelWindow(
    chunk.data as unknown as ArrayLike<number | bigint>,
    chunk.stride,
    level.xAxis,
    level.yAxis,
    request.width,
    request.height,
  )

  return traceLabelEdges(
    labels,
    request.width,
    request.height,
    request.x0,
    request.y0,
    level.width,
  )
}

// Fetches the chunk on the main thread (so store error handling and missing
// chunk tracking apply) and decodes and traces it in a worker.
export function createWorkerLabelTracer(pool: ZarrDecodePool): SpatialDataLabelTracer {
  return async (request) => {
    const { level } = request
    const arrayMetadata = await zarrArrayMetadata(level.array)

    if (arrayMetadata === null) {
      return traceLabelChunkOnMainThread(request)
    }

    const chunkKey = zarrChunkKey(arrayMetadata.metadata, request.coords)
    const arrayPath = level.array.path === '/' ? '' : level.array.path
    const bytes = await level.array.store.get(
      `${arrayPath}/${chunkKey}` as `/${string}`,
      request.signal === undefined ? undefined : { signal: request.signal },
    )

    try {
      return await pool.traceLabels({
        source: { ...arrayMetadata, chunkKey, coords: request.coords },
        bytes,
        window: {
          xAxis: level.xAxis,
          yAxis: level.yAxis,
          x0: 0,
          y0: 0,
          width: request.width,
          height: request.height,
          fixedAxes: [],
        },
        levelX0: request.x0,
        levelY0: request.y0,
        levelWidth: level.width,
      })
    } catch (error) {
      if (error instanceof ZarrChunkUnavailableError) {
        throw error
      }

      return traceLabelChunkOnMainThread(request)
    }
  }
}

// Worker tracing where workers exist, otherwise the main thread.
export function defaultLabelTracer(): SpatialDataLabelTracer {
  const pool = sharedZarrDecodePool()
  return pool === null ? traceLabelChunkOnMainThread : createWorkerLabelTracer(pool)
}

export class SpatialDataLabelsReader {
  readonly levels: readonly SpatialDataLabelLevel[]
  // Element (level-0) coordinates -> target coordinates.
  readonly toTarget: Affine2D
  private readonly fromTarget: Affine2D
  private readonly tracer: SpatialDataLabelTracer
  private readonly traces = new Map<string, Promise<SpatialDataLabelChunkTrace>>()
  private readonly traceBytes = new Map<string, number>()
  private readonly traceLabelIndexes = new WeakMap<
    SpatialDataLabelChunkTrace,
    ReadonlyMap<number, number>
  >()
  private readonly rings = new Map<number, Map<number, CachedRing>>()
  private readonly maxTraceCacheBytes: number
  private cachedBytes = 0

  constructor(
    levels: readonly SpatialDataLabelLevel[],
    toTarget: Affine2D,
    options: {
      readonly maxTraceCacheBytes?: number
      readonly tracer?: SpatialDataLabelTracer
    } = {},
  ) {
    if (levels.length === 0) {
      throw new Error('SpatialData labels element has no readable levels.')
    }

    this.levels = levels
    this.toTarget = toTarget
    this.fromTarget = invertAffine(toTarget)
    this.tracer = options.tracer ?? defaultLabelTracer()
    this.maxTraceCacheBytes = options.maxTraceCacheBytes ?? DEFAULT_MAX_TRACE_CACHE_BYTES
  }

  static async open(
    store: zarr.Readable,
    zarrFormat: 2 | 3,
    elementPath: string,
    attrs: Readonly<Record<string, unknown>>,
    toTarget: Affine2D,
    options: { readonly tracer?: SpatialDataLabelTracer } = {},
  ): Promise<SpatialDataLabelsReader> {
    const multiscale = firstMultiscale(attrs)
    const axes = axisNames(multiscale?.axes)
    const datasets = Array.isArray(multiscale?.datasets) ? multiscale.datasets : []
    const levels: SpatialDataLabelLevel[] = []
    let baseScale: { readonly x: number; readonly y: number } | null = null

    for (const dataset of datasets) {
      const record = recordOrNull(dataset)
      const path = typeof record?.path === 'string' ? record.path : undefined

      if (path === undefined) {
        continue
      }

      const location = zarr.root(store).resolve(`${elementPath}/${path}`)
      const array =
        zarrFormat === 3
          ? await zarr.open.v3(location, { kind: 'array' })
          : await zarr.open.v2(location, { kind: 'array' })
      const names =
        axes.length === array.shape.length
          ? axes
          : array.shape.length === 2
            ? ['y', 'x']
            : array.shape.map((_size, index) =>
                index === array.shape.length - 1
                  ? 'x'
                  : index === array.shape.length - 2
                    ? 'y'
                    : `d${index}`,
              )
      const xAxis = names.indexOf('x')
      const yAxis = names.indexOf('y')

      if (xAxis < 0 || yAxis < 0) {
        continue
      }

      const scale = datasetScale(record?.coordinateTransformations, names)
      baseScale ??= scale
      levels.push({
        array,
        width: array.shape[xAxis] ?? 0,
        height: array.shape[yAxis] ?? 0,
        chunkWidth: array.chunks[xAxis] ?? 1,
        chunkHeight: array.chunks[yAxis] ?? 1,
        xAxis,
        yAxis,
        // Level 0 defines the element coordinates.
        scaleX: scale.x / baseScale.x,
        scaleY: scale.y / baseScale.y,
      })
    }

    return new SpatialDataLabelsReader(levels, toTarget, options)
  }

  // Finest level whose pixels covering `bounds` fit the budget.
  levelForBounds(bounds: SpatialDataLabelBounds, maxPixels: number): number {
    for (let level = 0; level < this.levels.length; level += 1) {
      const window = this.pixelWindow(level, bounds)

      if (window.width * window.height <= maxPixels) {
        return level
      }
    }

    return this.levels.length - 1
  }

  chunksForBounds(
    level: number,
    bounds: SpatialDataLabelBounds,
  ): readonly { readonly col: number; readonly row: number }[] {
    const meta = this.levelMeta(level)
    const window = this.pixelWindow(level, bounds)
    const chunks: { col: number; row: number }[] = []

    if (window.width <= 0 || window.height <= 0) {
      return chunks
    }

    const col0 = Math.floor(window.x0 / meta.chunkWidth)
    const col1 = Math.floor((window.x0 + window.width - 1) / meta.chunkWidth)
    const row0 = Math.floor(window.y0 / meta.chunkHeight)
    const row1 = Math.floor((window.y0 + window.height - 1) / meta.chunkHeight)

    for (let row = row0; row <= row1; row += 1) {
      for (let col = col0; col <= col1; col += 1) {
        chunks.push({ col, row })
      }
    }

    return chunks
  }

  // Chunk at `level` that contains a point given in element coordinates.
  chunkAtElementPoint(
    level: number,
    point: SpatialDataLabelPoint,
  ): { readonly col: number; readonly row: number } | null {
    const meta = this.levelMeta(level)
    const x = Math.floor(point.x / meta.scaleX)
    const y = Math.floor(point.y / meta.scaleY)

    if (x < 0 || y < 0 || x >= meta.width || y >= meta.height) {
      return null
    }

    return { col: Math.floor(x / meta.chunkWidth), row: Math.floor(y / meta.chunkHeight) }
  }

  // Area of one level pixel in target units².
  pixelArea(level: number): number {
    const affine = this.levelToTarget(level)
    return Math.abs(affine.a * affine.e - affine.b * affine.d)
  }

  trace(
    level: number,
    col: number,
    row: number,
    signal?: AbortSignal,
  ): Promise<SpatialDataLabelChunkTrace> {
    const key = `${level.toString()}/${col.toString()}/${row.toString()}`
    const existing = this.traces.get(key)

    if (existing !== undefined) {
      // Refresh recency.
      this.traces.delete(key)
      this.traces.set(key, existing)
      return existing
    }

    const promise = this.readAndTrace(level, col, row, signal).then(
      (trace) => {
        this.traceBytes.set(key, trace.approximateBytes)
        this.cachedBytes += trace.approximateBytes
        this.evict()
        return trace
      },
      (error: unknown) => {
        this.traces.delete(key)
        throw error
      },
    )
    this.traces.set(key, promise)
    return promise
  }

  // Outlines of labels that overlap `bounds`. Only overlapping labels are
  // joined, and joined rings are reused while their source chunks stay
  // loaded, so panning only joins labels that newly come into view.
  async outlines(
    bounds: SpatialDataLabelBounds,
    options: {
      readonly maxPixels: number
      readonly signal?: AbortSignal
      readonly include?: (label: number) => boolean
    },
  ): Promise<readonly SpatialDataLabelOutline[]> {
    const level = this.levelForBounds(bounds, options.maxPixels)
    const window = this.pixelWindow(level, bounds)
    const traces = await Promise.all(
      this.chunksForBounds(level, bounds).map((chunk) =>
        this.trace(level, chunk.col, chunk.row, options.signal),
      ),
    )
    const visible = new Set<number>()

    for (const trace of traces) {
      const { labels, bounds: labelBounds } = trace

      for (let index = 0; index < labels.length; index += 1) {
        const label = labels[index] ?? 0
        const offset = index * 4

        if (
          (labelBounds[offset] ?? 0) <= window.x0 + window.width &&
          (labelBounds[offset + 2] ?? 0) >= window.x0 &&
          (labelBounds[offset + 1] ?? 0) <= window.y0 + window.height &&
          (labelBounds[offset + 3] ?? 0) >= window.y0 &&
          (options.include === undefined || options.include(label))
        ) {
          visible.add(label)
        }
      }
    }

    const meta = this.levelMeta(level)
    const affine = this.levelToTarget(level)
    const rings = this.ringCache(level)
    const outlines: SpatialDataLabelOutline[] = []

    for (const label of visible) {
      const contributions = traces.filter((trace) => this.labelIndex(trace).has(label))
      const cached = rings.get(label)

      if (cached !== undefined && sameTraces(cached.contributions, contributions)) {
        rings.delete(label)
        rings.set(label, cached)
        outlines.push({ label, ring: cached.ring })
        continue
      }

      const ring = outerRing(
        contributions.map((trace) =>
          labelEdges(trace, this.labelIndex(trace).get(label)),
        ),
        meta.width,
        RING_TOLERANCE_PIXELS,
      )

      if (ring.length < 6) {
        continue
      }

      for (let index = 0; index < ring.length; index += 2) {
        const point = applyAffine(affine, ring[index] ?? 0, ring[index + 1] ?? 0)
        ring[index] = point.x
        ring[index + 1] = point.y
      }

      rings.set(label, { contributions, ring })
      outlines.push({ label, ring })
    }

    this.evictRings(rings)
    return outlines
  }

  levelToTarget(level: number): Affine2D {
    const meta = this.levelMeta(level)
    return composeAffine(this.toTarget, {
      a: meta.scaleX,
      b: 0,
      c: 0,
      d: 0,
      e: meta.scaleY,
      f: 0,
    })
  }

  private labelIndex(trace: SpatialDataLabelChunkTrace): ReadonlyMap<number, number> {
    let index = this.traceLabelIndexes.get(trace)

    if (index === undefined) {
      index = new Map(Array.from(trace.labels, (label, position) => [label, position]))
      this.traceLabelIndexes.set(trace, index)
    }

    return index
  }

  private ringCache(level: number): Map<number, CachedRing> {
    let rings = this.rings.get(level)

    if (rings === undefined) {
      rings = new Map()
      this.rings.set(level, rings)
    }

    return rings
  }

  private evictRings(rings: Map<number, CachedRing>): void {
    for (const label of rings.keys()) {
      if (rings.size <= MAX_CACHED_RINGS) {
        return
      }

      rings.delete(label)
    }
  }

  private levelMeta(level: number): SpatialDataLabelLevel {
    const meta = this.levels[level]

    if (meta === undefined) {
      throw new Error(`SpatialData labels level ${level.toString()} does not exist.`)
    }

    return meta
  }

  private pixelWindow(
    level: number,
    bounds: SpatialDataLabelBounds,
  ): {
    readonly x0: number
    readonly y0: number
    readonly width: number
    readonly height: number
  } {
    const meta = this.levelMeta(level)
    const corners = [
      applyAffine(this.fromTarget, bounds.minX, bounds.minY),
      applyAffine(this.fromTarget, bounds.maxX, bounds.minY),
      applyAffine(this.fromTarget, bounds.minX, bounds.maxY),
      applyAffine(this.fromTarget, bounds.maxX, bounds.maxY),
    ]
    const xs = corners.map((corner) => corner.x / meta.scaleX)
    const ys = corners.map((corner) => corner.y / meta.scaleY)
    const x0 = Math.max(0, Math.floor(Math.min(...xs)))
    const y0 = Math.max(0, Math.floor(Math.min(...ys)))
    const x1 = Math.min(meta.width, Math.ceil(Math.max(...xs)))
    const y1 = Math.min(meta.height, Math.ceil(Math.max(...ys)))

    return { x0, y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) }
  }

  private async readAndTrace(
    level: number,
    col: number,
    row: number,
    signal?: AbortSignal,
  ): Promise<SpatialDataLabelChunkTrace> {
    const meta = this.levelMeta(level)
    const x0 = col * meta.chunkWidth
    const y0 = row * meta.chunkHeight
    const packed = await this.tracer({
      level: meta,
      coords: meta.array.shape.map((_size, axis) =>
        axis === meta.xAxis ? col : axis === meta.yAxis ? row : 0,
      ),
      x0,
      y0,
      width: Math.max(0, Math.min(meta.chunkWidth, meta.width - x0)),
      height: Math.max(0, Math.min(meta.chunkHeight, meta.height - y0)),
      ...(signal === undefined ? {} : { signal }),
    })

    return {
      ...packed,
      level,
      col,
      row,
      approximateBytes:
        packed.edges.byteLength +
        packed.labels.byteLength * 4 +
        packed.bounds.byteLength +
        packed.labels.length * 64,
    }
  }

  private evict(): void {
    for (const [key] of this.traces) {
      if (this.cachedBytes <= this.maxTraceCacheBytes || this.traces.size <= 1) {
        return
      }

      const bytes = this.traceBytes.get(key)

      if (bytes === undefined) {
        // Still loading.
        continue
      }

      this.traces.delete(key)
      this.traceBytes.delete(key)
      this.cachedBytes -= bytes
    }
  }
}

function labelEdges(
  trace: SpatialDataLabelChunkTrace,
  index: number | undefined,
): Float64Array {
  return index === undefined
    ? new Float64Array(0)
    : trace.edges.subarray(
        trace.edgeOffsets[index] ?? 0,
        trace.edgeOffsets[index + 1] ?? 0,
      )
}

function sameTraces(
  left: readonly SpatialDataLabelChunkTrace[],
  right: readonly SpatialDataLabelChunkTrace[],
): boolean {
  return (
    left.length === right.length && left.every((trace, index) => trace === right[index])
  )
}

export function invertAffine(affine: Affine2D): Affine2D {
  const determinant = affine.a * affine.e - affine.b * affine.d

  if (!Number.isFinite(determinant) || determinant === 0) {
    throw new Error('SpatialData labels transformation is not invertible.')
  }

  return {
    a: affine.e / determinant,
    b: -affine.b / determinant,
    c: (affine.b * affine.f - affine.e * affine.c) / determinant,
    d: -affine.d / determinant,
    e: affine.a / determinant,
    f: (affine.d * affine.c - affine.a * affine.f) / determinant,
  }
}

function datasetScale(
  transformations: unknown,
  axes: readonly string[],
): { readonly x: number; readonly y: number } {
  let x = 1
  let y = 1

  if (Array.isArray(transformations)) {
    for (const transformation of transformations) {
      const record = recordOrNull(transformation)

      if (record?.type !== 'scale' || !Array.isArray(record.scale)) {
        continue
      }

      const scaleX = record.scale[axes.indexOf('x')]
      const scaleY = record.scale[axes.indexOf('y')]
      x *= typeof scaleX === 'number' && scaleX > 0 ? scaleX : 1
      y *= typeof scaleY === 'number' && scaleY > 0 ? scaleY : 1
    }
  }

  return { x, y }
}

function firstMultiscale(
  attrs: Readonly<Record<string, unknown>>,
): Record<string, unknown> | null {
  const root = recordOrNull(attrs.ome) ?? attrs
  return Array.isArray(root.multiscales) ? recordOrNull(root.multiscales[0]) : null
}

function axisNames(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.map((axis) =>
        typeof axis === 'string' ? axis : String(recordOrNull(axis)?.name ?? ''),
      )
    : []
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
