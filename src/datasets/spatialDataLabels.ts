import * as zarr from 'zarrita'
import { applyAffine, composeAffine, type Affine2D } from './spatialDataTransforms'

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

export interface SpatialDataLabelChunkTrace {
  readonly level: number
  readonly col: number
  readonly row: number
  // Directed pixel edges per label, encoded by `edgeKey`.
  readonly edgesByLabel: ReadonlyMap<number, readonly number[]>
  readonly pixelCounts: ReadonlyMap<number, number>
  readonly approximateBytes: number
}

export interface SpatialDataLabelOutline {
  readonly label: number
  // Outer ring in target coordinates.
  readonly ring: readonly SpatialDataLabelPoint[]
}

const RIGHT = 0
const DOWN = 1
const LEFT = 2
const UP = 3
const DEFAULT_MAX_TRACE_CACHE_BYTES = 192 * 1024 * 1024

export class SpatialDataLabelsReader {
  readonly levels: readonly SpatialDataLabelLevel[]
  // Element (level-0) coordinates -> target coordinates.
  readonly toTarget: Affine2D
  private readonly fromTarget: Affine2D
  private readonly traces = new Map<string, Promise<SpatialDataLabelChunkTrace>>()
  private readonly traceBytes = new Map<string, number>()
  private readonly maxTraceCacheBytes: number
  private cachedBytes = 0

  constructor(
    levels: readonly SpatialDataLabelLevel[],
    toTarget: Affine2D,
    options: { readonly maxTraceCacheBytes?: number } = {},
  ) {
    if (levels.length === 0) {
      throw new Error('SpatialData labels element has no readable levels.')
    }

    this.levels = levels
    this.toTarget = toTarget
    this.fromTarget = invertAffine(toTarget)
    this.maxTraceCacheBytes = options.maxTraceCacheBytes ?? DEFAULT_MAX_TRACE_CACHE_BYTES
  }

  static async open(
    store: zarr.Readable,
    zarrFormat: 2 | 3,
    elementPath: string,
    attrs: Readonly<Record<string, unknown>>,
    toTarget: Affine2D,
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

    return new SpatialDataLabelsReader(levels, toTarget)
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
    const col0 = Math.floor(window.x0 / meta.chunkWidth)
    const col1 = Math.floor(
      Math.max(window.x0, window.x0 + window.width - 1) / meta.chunkWidth,
    )
    const row0 = Math.floor(window.y0 / meta.chunkHeight)
    const row1 = Math.floor(
      Math.max(window.y0, window.y0 + window.height - 1) / meta.chunkHeight,
    )
    const chunks: { col: number; row: number }[] = []

    if (window.width <= 0 || window.height <= 0) {
      return chunks
    }

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

  async outlines(
    bounds: SpatialDataLabelBounds,
    options: {
      readonly maxPixels: number
      readonly signal?: AbortSignal
      readonly include?: (label: number) => boolean
    },
  ): Promise<readonly SpatialDataLabelOutline[]> {
    const level = this.levelForBounds(bounds, options.maxPixels)
    const chunks = this.chunksForBounds(level, bounds)
    const traces = await Promise.all(
      chunks.map((chunk) => this.trace(level, chunk.col, chunk.row, options.signal)),
    )
    const edgesByLabel = new Map<number, (readonly number[])[]>()

    for (const trace of traces) {
      for (const [label, edges] of trace.edgesByLabel) {
        if (options.include !== undefined && !options.include(label)) {
          continue
        }

        const lists = edgesByLabel.get(label)

        if (lists === undefined) {
          edgesByLabel.set(label, [edges])
        } else {
          lists.push(edges)
        }
      }
    }

    const meta = this.levelMeta(level)
    const affine = this.levelToTarget(level)
    const outlines: SpatialDataLabelOutline[] = []

    for (const [label, lists] of edgesByLabel) {
      const ring = outerRing(lists, meta.width)

      if (ring.length < 3) {
        continue
      }

      const target = ring.map((point) => applyAffine(affine, point.x, point.y))

      if (ringIntersects(target, bounds)) {
        outlines.push({ label, ring: target })
      }
    }

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
    const coords = meta.array.shape.map((_size, axis) =>
      axis === meta.xAxis ? col : axis === meta.yAxis ? row : 0,
    )
    const chunk = await meta.array.getChunk(
      coords,
      signal === undefined ? undefined : { signal },
    )
    const x0 = col * meta.chunkWidth
    const y0 = row * meta.chunkHeight
    const width = Math.max(0, Math.min(meta.chunkWidth, meta.width - x0))
    const height = Math.max(0, Math.min(meta.chunkHeight, meta.height - y0))
    const labels = labelWindow(
      chunk.data as unknown as ArrayLike<number | bigint>,
      chunk.stride,
      meta.xAxis,
      meta.yAxis,
      width,
      height,
    )

    return {
      level,
      col,
      row,
      ...traceLabelEdges(labels, width, height, x0, y0, meta.width),
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

// Copies the 2D x/y window of a decoded chunk into Int32 labels. 64-bit label
// arrays are read through their low 32-bit words, which hold every label id a
// segmentation realistically uses.
export function labelWindow(
  data: ArrayLike<number | bigint>,
  stride: readonly number[],
  xAxis: number,
  yAxis: number,
  width: number,
  height: number,
): Int32Array {
  const output = new Int32Array(width * height)
  const strideX = stride[xAxis] ?? 1
  const strideY = stride[yAxis] ?? width
  const words = int64LowWords(data)

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * strideY
    const outputOffset = y * width

    for (let x = 0; x < width; x += 1) {
      const index = rowOffset + x * strideX

      if (words !== null) {
        const high = words[index * 2 + 1] ?? 0
        output[outputOffset + x] =
          high === 0
            ? (words[index * 2] ?? 0)
            : Number((data as BigInt64Array)[index] ?? 0n)
      } else {
        output[outputOffset + x] = Number(data[index] ?? 0)
      }
    }
  }

  return output
}

// Emits directed pixel edges (interior on the right, y pointing down) for
// every non-zero label, in level-pixel coordinates, and counts label pixels.
export function traceLabelEdges(
  labels: Int32Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  levelWidth: number,
): Omit<SpatialDataLabelChunkTrace, 'level' | 'col' | 'row'> {
  const edgesByLabel = new Map<number, number[]>()
  const pixelCounts = new Map<number, number>()
  const stride = levelWidth + 1
  let edgeCount = 0
  let currentLabel = 0
  let currentEdges: number[] | undefined
  let runLabel = 0
  let runLength = 0

  const flushRun = () => {
    if (runLabel !== 0 && runLength > 0) {
      pixelCounts.set(runLabel, (pixelCounts.get(runLabel) ?? 0) + runLength)
    }
  }

  for (let y = 0; y < height; y += 1) {
    const row = y * width

    for (let x = 0; x < width; x += 1) {
      const label = labels[row + x] ?? 0

      if (label !== runLabel) {
        flushRun()
        runLabel = label
        runLength = 0
      }

      runLength += 1

      if (label === 0) {
        continue
      }

      const up = y > 0 ? labels[row - width + x] : -1
      const down = y < height - 1 ? labels[row + width + x] : -1
      const left = x > 0 ? labels[row + x - 1] : -1
      const right = x < width - 1 ? labels[row + x + 1] : -1

      if (up === label && down === label && left === label && right === label) {
        continue
      }

      if (label !== currentLabel || currentEdges === undefined) {
        currentLabel = label
        currentEdges = edgesByLabel.get(label)

        if (currentEdges === undefined) {
          currentEdges = []
          edgesByLabel.set(label, currentEdges)
        }
      }

      const vx = x0 + x
      const vy = y0 + y
      const topLeft = vy * stride + vx

      if (up !== label) {
        currentEdges.push(topLeft * 4 + RIGHT)
        edgeCount += 1
      }

      if (right !== label) {
        currentEdges.push((topLeft + 1) * 4 + DOWN)
        edgeCount += 1
      }

      if (down !== label) {
        currentEdges.push((topLeft + stride + 1) * 4 + LEFT)
        edgeCount += 1
      }

      if (left !== label) {
        currentEdges.push((topLeft + stride) * 4 + UP)
        edgeCount += 1
      }
    }

    flushRun()
    runLabel = 0
    runLength = 0
  }

  return {
    edgesByLabel,
    pixelCounts,
    approximateBytes: edgeCount * 8 + edgesByLabel.size * 96 + pixelCounts.size * 48,
  }
}

// Joins one label's edges from every loaded chunk into its outer ring, in
// level-pixel coordinates. Opposite edges on shared chunk borders cancel.
export function outerRing(
  edgeLists: readonly (readonly number[])[],
  levelWidth: number,
): readonly SpatialDataLabelPoint[] {
  const stride = levelWidth + 1
  const delta = [1, stride, -1, -stride]
  const remaining = new Set<number>()

  for (const edges of edgeLists) {
    for (const edge of edges) {
      const dir = edge & 3
      const start = (edge - dir) / 4
      const opposite = (start + (delta[dir] ?? 0)) * 4 + ((dir + 2) & 3)

      if (remaining.has(opposite)) {
        remaining.delete(opposite)
      } else {
        remaining.add(edge)
      }
    }
  }

  let best: SpatialDataLabelPoint[] = []
  let bestArea = 0

  while (remaining.size > 0) {
    const first = remaining.values().next().value as number
    const corners: SpatialDataLabelPoint[] = []
    let edge: number | undefined = first
    let previousDir = -1

    while (edge !== undefined && remaining.has(edge)) {
      remaining.delete(edge)
      const dir: number = edge & 3
      const start: number = (edge - dir) / 4

      if (dir !== previousDir) {
        corners.push({ x: start % stride, y: Math.floor(start / stride) })
        previousDir = dir
      }

      const end: number = start + (delta[dir] ?? 0)
      edge = undefined

      // Turn right first so diagonally touching pixels form separate rings.
      for (const turn of [1, 0, 3]) {
        const candidate: number = end * 4 + ((dir + turn) & 3)

        if (remaining.has(candidate)) {
          edge = candidate
          break
        }
      }
    }

    const area = Math.abs(ringArea(corners))

    if (area > bestArea) {
      best = corners
      bestArea = area
    }
  }

  return smoothRing(best)
}

// Cuts each staircase corner by up to half a pixel along both sides. One-pixel
// steps become diagonals while long straight sides keep their shape.
function smoothRing(corners: readonly SpatialDataLabelPoint[]): SpatialDataLabelPoint[] {
  if (corners.length < 4) {
    return [...corners]
  }

  const smoothed: SpatialDataLabelPoint[] = []
  const push = (point: SpatialDataLabelPoint) => {
    const last = smoothed.at(-1)

    if (last === undefined || last.x !== point.x || last.y !== point.y) {
      smoothed.push(point)
    }
  }

  corners.forEach((corner, index) => {
    const previous = corners[(index + corners.length - 1) % corners.length] ?? corner
    const next = corners[(index + 1) % corners.length] ?? corner
    push(towards(corner, previous))
    push(towards(corner, next))
  })

  const first = smoothed[0]
  const last = smoothed.at(-1)

  if (
    first !== undefined &&
    last !== undefined &&
    first.x === last.x &&
    first.y === last.y
  ) {
    smoothed.pop()
  }

  return smoothed
}

function towards(
  from: SpatialDataLabelPoint,
  to: SpatialDataLabelPoint,
): SpatialDataLabelPoint {
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  const fraction = length === 0 ? 0 : Math.min(0.5, 0.5 / length)
  return {
    x: from.x + (to.x - from.x) * fraction,
    y: from.y + (to.y - from.y) * fraction,
  }
}

function ringArea(ring: readonly SpatialDataLabelPoint[]): number {
  let area = 0

  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index]
    const next = ring[(index + 1) % ring.length]

    if (current !== undefined && next !== undefined) {
      area += current.x * next.y - next.x * current.y
    }
  }

  return area / 2
}

function ringIntersects(
  ring: readonly SpatialDataLabelPoint[],
  bounds: SpatialDataLabelBounds,
): boolean {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  for (const point of ring) {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }

  return (
    minX <= bounds.maxX &&
    maxX >= bounds.minX &&
    minY <= bounds.maxY &&
    maxY >= bounds.minY
  )
}

function int64LowWords(data: ArrayLike<number | bigint>): Int32Array | null {
  if (data instanceof BigInt64Array || data instanceof BigUint64Array) {
    return new Int32Array(data.buffer, data.byteOffset, data.length * 2)
  }

  return null
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
