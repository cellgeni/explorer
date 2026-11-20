// SHL: Cell card shape metrics (major/minor axis, eccentricity) for the same
// polygon placed at the slide origin and at realistic slide coordinates.
// Oracle: second moments computed independently about the polygon's own
// centroid (vertices shifted to the centroid first), so they do not depend
// on the absolute position.
import { describe, expect, it } from 'vitest'
import { summarizeCellShape } from '../../../../../../src/features/cells/cellDetailModel'
import type { SpatialElement } from '../../../../../../src/datasets/spatialDataset'
import type { OverviewCellDatum } from '../../../../../../src/rendering/deckLayers'

function ellipse(cx: number, cy: number, a: number, b: number, n: number) {
  return Array.from({ length: n }, (_unused, index) => {
    const t = (2 * Math.PI * index) / n
    // Float32 like Xenium boundary vertices.
    return { x: Math.fround(cx + a * Math.cos(t)), y: Math.fround(cy + b * Math.sin(t)) }
  })
}

// Independent: shoelace moments about the vertex mean (no large offsets).
function oracle(points: readonly { x: number; y: number }[]) {
  const mx = points.reduce((s, p) => s + p.x, 0) / points.length
  const my = points.reduce((s, p) => s + p.y, 0) / points.length
  const q = points.map((p) => ({ x: p.x - mx, y: p.y - my }))
  let a2 = 0
  let cxn = 0
  let cyn = 0
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (let i = 0; i < q.length; i += 1) {
    const p = q[i]!
    const r = q[(i + 1) % q.length]!
    const c = p.x * r.y - r.x * p.y
    a2 += c
    cxn += (p.x + r.x) * c
    cyn += (p.y + r.y) * c
    sxx += (p.x * p.x + p.x * r.x + r.x * r.x) * c
    syy += (p.y * p.y + p.y * r.y + r.y * r.y) * c
    sxy += (2 * p.x * p.y + p.x * r.y + r.x * p.y + 2 * r.x * r.y) * c
  }
  const A = a2 / 2
  const cx = cxn / (6 * A)
  const cy = cyn / (6 * A)
  const vx = sxx / 12 / A - cx * cx
  const vy = syy / 12 / A - cy * cy
  const cov = sxy / 24 / A - cx * cy
  const d = Math.sqrt((vx - vy) ** 2 + 4 * cov * cov)
  const l1 = (vx + vy + d) / 2
  const l2 = (vx + vy - d) / 2
  return {
    major: 4 * Math.sqrt(l1),
    minor: 4 * Math.sqrt(l2),
    ecc: Math.sqrt(1 - l2 / l1),
  }
}

function metrics(points: readonly { x: number; y: number }[]) {
  const element = {
    id: 'cell-1',
    geometry: { kind: 'polygon', rings: [points] },
  } as unknown as SpatialElement
  const cell = { id: 'cell-1', position: [0, 0, 0] } as unknown as OverviewCellDatum
  return summarizeCellShape(cell, element)
}

describe('cell shape metrics vs slide position', () => {
  for (const [cx, cy] of [
    [0, 0],
    [2_000, 2_000],
    [10_000, 8_000],
    [25_000, 25_000],
  ] as const) {
    it(`8 x 5 µm ellipse (12 vertices) at (${cx}, ${cy})`, () => {
      const points = ellipse(cx, cy, 4, 2.5, 12)
      const got = metrics(points)
      const want = oracle(points)
      console.log(
        JSON.stringify({
          at: [cx, cy],
          major: [got.majorAxisMicrometers, want.major],
          minor: [got.minorAxisMicrometers, want.minor],
          eccentricity: [got.eccentricity, want.ecc],
        }),
      )
      expect(got.majorAxisMicrometers).toBeCloseTo(want.major, 3)
      expect(got.minorAxisMicrometers).toBeCloseTo(want.minor, 3)
      expect(got.eccentricity).toBeCloseTo(want.ecc, 3)
    })
  }
})
