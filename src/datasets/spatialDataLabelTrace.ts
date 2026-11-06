// Pure label-raster tracing used on the main thread and in the Zarr decode
// worker. Edges are pixel sides in level-pixel vertex coordinates, encoded as
// `vertexKey * 4 + direction` with `vertexKey = y * (levelWidth + 1) + x`.

export interface PackedLabelTrace {
  // One entry per label with pixels in the chunk window.
  readonly labels: Int32Array
  // Edges of label `i` are `edges[edgeOffsets[i] .. edgeOffsets[i + 1]]`.
  readonly edgeOffsets: Uint32Array
  readonly edges: Float64Array
  // minX, minY, maxX, maxY per label, in level-pixel vertex coordinates.
  readonly bounds: Int32Array
  readonly pixelCounts: Uint32Array
}

const RIGHT = 0
const DOWN = 1
const LEFT = 2
const UP = 3

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
// every non-zero label, with per-label bounds and pixel counts.
export function traceLabelEdges(
  labels: Int32Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  levelWidth: number,
): PackedLabelTrace {
  const slots = new Map<number, number>()
  const slotLabels: number[] = []
  const slotEdges: number[][] = []
  const slotBounds: number[] = []
  const slotCounts: number[] = []
  const stride = levelWidth + 1
  let lastLabel = 0
  let lastSlot = -1
  let runLabel = 0
  let runLength = 0

  const slotFor = (label: number): number => {
    if (label === lastLabel && lastSlot >= 0) {
      return lastSlot
    }

    let slot = slots.get(label)

    if (slot === undefined) {
      slot = slotLabels.length
      slots.set(label, slot)
      slotLabels.push(label)
      slotEdges.push([])
      slotBounds.push(Infinity, Infinity, -Infinity, -Infinity)
      slotCounts.push(0)
    }

    lastLabel = label
    lastSlot = slot
    return slot
  }
  const flushRun = () => {
    if (runLabel !== 0 && runLength > 0) {
      const slot = slotFor(runLabel)
      slotCounts[slot] = (slotCounts[slot] ?? 0) + runLength
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

      const slot = slotFor(label)
      const edges = slotEdges[slot] ?? []
      const vx = x0 + x
      const vy = y0 + y
      const topLeft = vy * stride + vx
      const boundsOffset = slot * 4

      slotBounds[boundsOffset] = Math.min(slotBounds[boundsOffset] ?? Infinity, vx)
      slotBounds[boundsOffset + 1] = Math.min(
        slotBounds[boundsOffset + 1] ?? Infinity,
        vy,
      )
      slotBounds[boundsOffset + 2] = Math.max(
        slotBounds[boundsOffset + 2] ?? -Infinity,
        vx + 1,
      )
      slotBounds[boundsOffset + 3] = Math.max(
        slotBounds[boundsOffset + 3] ?? -Infinity,
        vy + 1,
      )

      if (up !== label) {
        edges.push(topLeft * 4 + RIGHT)
      }

      if (right !== label) {
        edges.push((topLeft + 1) * 4 + DOWN)
      }

      if (down !== label) {
        edges.push((topLeft + stride + 1) * 4 + LEFT)
      }

      if (left !== label) {
        edges.push((topLeft + stride) * 4 + UP)
      }
    }

    flushRun()
    runLabel = 0
    runLength = 0
  }

  const edgeOffsets = new Uint32Array(slotLabels.length + 1)

  slotEdges.forEach((edges, slot) => {
    edgeOffsets[slot + 1] = (edgeOffsets[slot] ?? 0) + edges.length
  })

  const edges = new Float64Array(edgeOffsets[slotLabels.length] ?? 0)

  slotEdges.forEach((list, slot) => {
    edges.set(list, edgeOffsets[slot] ?? 0)
  })

  return {
    labels: Int32Array.from(slotLabels),
    edgeOffsets,
    edges,
    bounds: Int32Array.from(slotBounds, (value) => (Number.isFinite(value) ? value : 0)),
    pixelCounts: Uint32Array.from(slotCounts),
  }
}

// Joins one label's edges from every loaded chunk into its outer ring, in
// level-pixel coordinates, as a flat [x0, y0, x1, y1, ...] array. Opposite
// edges on shared chunk borders cancel. The ring is smoothed and simplified
// by `tolerance` level pixels.
export function outerRing(
  edgeLists: readonly ArrayLike<number>[],
  levelWidth: number,
  tolerance = 0,
): Float64Array {
  const stride = levelWidth + 1
  const delta = [1, stride, -1, -stride]
  const remaining = new Set<number>()

  for (const edges of edgeLists) {
    for (let index = 0; index < edges.length; index += 1) {
      const edge = edges[index] ?? 0
      const dir = edge % 4
      const start = (edge - dir) / 4
      const opposite = (start + (delta[dir] ?? 0)) * 4 + ((dir + 2) % 4)

      if (remaining.has(opposite)) {
        remaining.delete(opposite)
      } else {
        remaining.add(edge)
      }
    }
  }

  let best: number[] = []
  let bestArea = 0

  while (remaining.size > 0) {
    const first = remaining.values().next().value as number
    const corners: number[] = []
    let edge: number | undefined = first
    let previousDir = -1

    while (edge !== undefined && remaining.has(edge)) {
      remaining.delete(edge)
      const dir: number = edge % 4
      const start: number = (edge - dir) / 4

      if (dir !== previousDir) {
        corners.push(start % stride, Math.floor(start / stride))
        previousDir = dir
      }

      const end: number = start + (delta[dir] ?? 0)
      edge = undefined

      // Turn right first so diagonally touching pixels form separate rings.
      for (const turn of [1, 0, 3]) {
        const candidate: number = end * 4 + ((dir + turn) % 4)

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

  const smoothed = smoothRing(best)
  return tolerance > 0 ? simplifyClosedRing(smoothed, tolerance) : smoothed
}

// Cuts each staircase corner by up to half a pixel along both sides. One-pixel
// steps become diagonals while long straight sides keep their shape.
function smoothRing(corners: readonly number[]): Float64Array {
  const count = corners.length / 2

  if (count < 4) {
    return Float64Array.from(corners)
  }

  const smoothed: number[] = []
  const push = (x: number, y: number) => {
    const length = smoothed.length

    if (length < 2 || smoothed[length - 2] !== x || smoothed[length - 1] !== y) {
      smoothed.push(x, y)
    }
  }

  for (let index = 0; index < count; index += 1) {
    const x = corners[index * 2] ?? 0
    const y = corners[index * 2 + 1] ?? 0
    const previous = ((index + count - 1) % count) * 2
    const next = ((index + 1) % count) * 2
    const [inX, inY] = towards(x, y, corners[previous] ?? x, corners[previous + 1] ?? y)
    const [outX, outY] = towards(x, y, corners[next] ?? x, corners[next + 1] ?? y)
    push(inX, inY)
    push(outX, outY)
  }

  const length = smoothed.length

  if (
    length >= 4 &&
    smoothed[0] === smoothed[length - 2] &&
    smoothed[1] === smoothed[length - 1]
  ) {
    smoothed.length = length - 2
  }

  return Float64Array.from(smoothed)
}

function towards(x: number, y: number, toX: number, toY: number): [number, number] {
  const length = Math.hypot(toX - x, toY - y)
  const fraction = length === 0 ? 0 : Math.min(0.5, 0.5 / length)
  return [x + (toX - x) * fraction, y + (toY - y) * fraction]
}

// Douglas-Peucker simplification of a closed flat ring.
export function simplifyClosedRing(ring: Float64Array, tolerance: number): Float64Array {
  const count = ring.length / 2

  if (count <= 4) {
    return ring
  }

  const x = (index: number) => ring[(index % count) * 2] ?? 0
  const y = (index: number) => ring[(index % count) * 2 + 1] ?? 0
  let far = 0
  let farDistance = -1

  for (let index = 1; index < count; index += 1) {
    const distance = (x(index) - x(0)) ** 2 + (y(index) - y(0)) ** 2

    if (distance > farDistance) {
      far = index
      farDistance = distance
    }
  }

  const keep = new Uint8Array(count)
  const toleranceSquared = tolerance * tolerance
  const stack: [number, number][] = [
    [0, far],
    [far, count],
  ]
  keep[0] = 1
  keep[far] = 1

  while (stack.length > 0) {
    const [start, end] = stack.pop() ?? [0, 0]
    let maxDistance = -1
    let maxIndex = -1

    for (let index = start + 1; index < end; index += 1) {
      const distance = segmentDistanceSquared(
        x(index),
        y(index),
        x(start),
        y(start),
        x(end),
        y(end),
      )

      if (distance > maxDistance) {
        maxDistance = distance
        maxIndex = index
      }
    }

    if (maxIndex >= 0 && maxDistance > toleranceSquared) {
      keep[maxIndex] = 1
      stack.push([start, maxIndex], [maxIndex, end])
    }
  }

  const output: number[] = []

  for (let index = 0; index < count; index += 1) {
    if (keep[index] === 1) {
      output.push(x(index), y(index))
    }
  }

  return output.length >= 6 ? Float64Array.from(output) : ring
}

function segmentDistanceSquared(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
  return (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
}

function ringArea(flat: readonly number[]): number {
  const count = flat.length / 2
  let area = 0

  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count
    area +=
      (flat[index * 2] ?? 0) * (flat[next * 2 + 1] ?? 0) -
      (flat[next * 2] ?? 0) * (flat[index * 2 + 1] ?? 0)
  }

  return area / 2
}

function int64LowWords(data: ArrayLike<number | bigint>): Int32Array | null {
  if (data instanceof BigInt64Array || data instanceof BigUint64Array) {
    return new Int32Array(data.buffer, data.byteOffset, data.length * 2)
  }

  return null
}
