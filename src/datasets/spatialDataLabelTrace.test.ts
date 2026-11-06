import { describe, expect, it } from 'vitest'
import {
  labelWindow,
  outerRing,
  simplifyClosedRing,
  traceLabelEdges,
} from './spatialDataLabelTrace'

describe('SpatialData label tracing', () => {
  it('reads 64-bit label chunks through their low words', () => {
    const data = new BigInt64Array([0n, 7n, 70_000n, 2n, 0n, 9n])
    // Chunk shape (2, 3) with C strides; read a 2x2 window.
    expect(Array.from(labelWindow(data, [3, 1], 1, 0, 2, 2))).toEqual([0, 7, 2, 0])
  })

  it('packs edges, bounds, and pixel counts per label', () => {
    const trace = traceLabelEdges(Int32Array.from([1, 1, 0, 1, 2, 2]), 3, 2, 10, 20, 100)

    expect(Array.from(trace.labels)).toEqual([1, 2])
    expect(Array.from(trace.pixelCounts)).toEqual([3, 2])
    expect(Array.from(trace.bounds)).toEqual([10, 20, 12, 22, 11, 21, 13, 22])
    expect(trace.edgeOffsets[2]).toBe(trace.edges.length)
  })

  it('joins cells split across chunks into one outline', () => {
    // Level is 6 x 3 pixels, split into two 3 x 3 chunks.
    const left = traceLabelEdges(
      Int32Array.from([1, 1, 1, 1, 1, 1, 0, 0, 0]),
      3,
      3,
      0,
      0,
      6,
    )
    const right = traceLabelEdges(
      Int32Array.from([1, 0, 2, 1, 0, 2, 0, 0, 0]),
      3,
      3,
      3,
      0,
      6,
    )
    const edgesOf = (trace: typeof left, label: number) => {
      const index = Array.from(trace.labels).indexOf(label)
      return trace.edges.subarray(trace.edgeOffsets[index], trace.edgeOffsets[index + 1])
    }
    const extent = (ring: Float64Array) => {
      const xs = ring.filter((_value, index) => index % 2 === 0)
      const ys = ring.filter((_value, index) => index % 2 === 1)
      return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    }

    const joined = outerRing([edgesOf(left, 1), edgesOf(right, 1)], 6)

    // One 4 x 2 pixel rectangle with half-pixel chamfered corners.
    expect(extent(joined)).toEqual([0, 4, 0, 2])
    expect(joined).toHaveLength(16)
    // Without the neighbouring chunk the outline closes at the chunk edge.
    expect(extent(outerRing([edgesOf(left, 1)], 6))[1]).toBe(3)
  })

  it('simplifies staircase outlines within the tolerance', () => {
    // A 1-pixel staircase from (0,0) to (8,8) closed back along the axes.
    const points: number[] = []

    for (let step = 0; step < 8; step += 1) {
      points.push(step, step, step + 1, step)
    }

    points.push(8, 8, 0, 8)
    const ring = Float64Array.from(points)
    const simplified = simplifyClosedRing(ring, 1)

    expect(simplified.length / 2).toBeLessThan(ring.length / 2)
    expect(simplified.length / 2).toBeGreaterThanOrEqual(3)
  })
})
