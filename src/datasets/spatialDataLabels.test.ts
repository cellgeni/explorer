import { describe, expect, it } from 'vitest'
import { labelWindow, outerRing, traceLabelEdges } from './spatialDataLabels'

describe('SpatialData labels', () => {
  it('reads 64-bit label chunks through their low words', () => {
    const data = new BigInt64Array([0n, 7n, 70_000n, 2n, 0n, 9n])
    // Chunk shape (2, 3) with C strides; read a 2x2 window.
    expect(Array.from(labelWindow(data, [3, 1], 1, 0, 2, 2))).toEqual([0, 7, 2, 0])
  })

  it('traces label outlines and joins cells split across chunks', () => {
    // Level is 6 x 3 pixels, split into two 3 x 3 chunks.
    const left = Int32Array.from([1, 1, 1, 1, 1, 1, 0, 0, 0])
    const right = Int32Array.from([1, 0, 2, 1, 0, 2, 0, 0, 0])
    const leftTrace = traceLabelEdges(left, 3, 3, 0, 0, 6)
    const rightTrace = traceLabelEdges(right, 3, 3, 3, 0, 6)

    expect(leftTrace.pixelCounts.get(1)).toBe(6)
    expect(rightTrace.pixelCounts.get(1)).toBe(2)

    const joined = outerRing(
      [leftTrace.edgesByLabel.get(1) ?? [], rightTrace.edgesByLabel.get(1) ?? []],
      6,
    )
    const xs = joined.map((point) => point.x)
    const ys = joined.map((point) => point.y)

    // One 4 x 2 pixel rectangle with half-pixel chamfered corners.
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([
      0, 4, 0, 2,
    ])
    expect(joined).toHaveLength(8)

    // Without the neighbouring chunk the outline closes at the chunk edge.
    const clipped = outerRing([leftTrace.edgesByLabel.get(1) ?? []], 6)
    expect(Math.max(...clipped.map((point) => point.x))).toBe(3)
  })
})
