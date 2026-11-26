import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { micrometers, type DataPoint } from './coords'
import { roiSelectionContains, type RoiSelection } from './roiSelection'

// The fixture the Python package's fake bridge tests its `contains` with
// (src/python/tests), so the fake selects the same cells the app does.
interface ContainsFixture {
  readonly lasso: readonly (readonly [number, number])[]
  readonly box: {
    readonly minX: number
    readonly minY: number
    readonly maxX: number
    readonly maxY: number
  }
  readonly points: readonly {
    readonly x: number
    readonly y: number
    readonly lasso: boolean
    readonly box: boolean
    readonly note: string
  }[]
}

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'src/python/tests/fixtures/contains.json'), 'utf8'),
) as ContainsFixture

const point = (x: number, y: number): DataPoint => ({
  x: micrometers(x),
  y: micrometers(y),
})

const xs = fixture.lasso.map(([x]) => x)
const ys = fixture.lasso.map(([, y]) => y)
const lasso: RoiSelection = {
  kind: 'lasso',
  bbox: {
    minX: micrometers(Math.min(...xs)),
    maxX: micrometers(Math.max(...xs)),
    minY: micrometers(Math.min(...ys)),
    maxY: micrometers(Math.max(...ys)),
  },
  points: fixture.lasso.map(([x, y]) => point(x, y)),
}
const box: RoiSelection = {
  kind: 'box',
  bbox: {
    minX: micrometers(fixture.box.minX),
    maxX: micrometers(fixture.box.maxX),
    minY: micrometers(fixture.box.minY),
    maxY: micrometers(fixture.box.maxY),
  },
}

describe('the shared contains fixture', () => {
  it('has points both inside and outside each shape', () => {
    expect(fixture.points.length).toBeGreaterThanOrEqual(30)
    expect(new Set(fixture.points.map((entry) => entry.lasso))).toEqual(
      new Set([true, false]),
    )
    expect(new Set(fixture.points.map((entry) => entry.box))).toEqual(
      new Set([true, false]),
    )
  })

  it.each(fixture.points)('$note', (entry) => {
    expect(roiSelectionContains(lasso, point(entry.x, entry.y))).toBe(entry.lasso)
    expect(roiSelectionContains(box, point(entry.x, entry.y))).toBe(entry.box)
  })
})
