import { describe, expect, it } from 'vitest'
import { micrometers, type DataPoint } from '../data/coords'
import { roiSelectionFromLasso, simplifyLassoPoints } from './viewerRoiInteraction'

function point(x: number, y: number): DataPoint {
  return { x: micrometers(x), y: micrometers(y) }
}

// A circle of radius 150 with a point every 4 units, as the pointer adds them.
const circle = Array.from({ length: 236 }, (_, index) => {
  const angle = (index / 236) * 2 * Math.PI
  return point(150 + 150 * Math.cos(angle), 150 + 150 * Math.sin(angle))
})

function distanceToPolyline(target: DataPoint, line: readonly DataPoint[]): number {
  let best = Number.POSITIVE_INFINITY

  for (let index = 0; index + 1 < line.length; index += 1) {
    const start = line[index] as DataPoint
    const end = line[index + 1] as DataPoint
    const deltaX = end.x - start.x
    const deltaY = end.y - start.y
    const along = Math.max(
      0,
      Math.min(
        1,
        ((target.x - start.x) * deltaX + (target.y - start.y) * deltaY) /
          (deltaX * deltaX + deltaY * deltaY),
      ),
    )
    best = Math.min(
      best,
      Math.hypot(
        target.x - (start.x + along * deltaX),
        target.y - (start.y + along * deltaY),
      ),
    )
  }

  return best
}

describe('simplifyLassoPoints', () => {
  it('keeps every drawn point within the tolerance of the simplified path', () => {
    const simplified = simplifyLassoPoints(circle, 1)

    expect(simplified.length).toBeLessThan(circle.length / 4)
    expect(simplified[0]).toBe(circle[0])
    expect(simplified.at(-1)).toBe(circle.at(-1))
    expect(
      Math.max(...circle.map((drawn) => distanceToPolyline(drawn, simplified))),
    ).toBeLessThanOrEqual(1)
  })

  it('leaves a lasso alone without a tolerance, and keeps at least a triangle', () => {
    expect(simplifyLassoPoints(circle, 0)).toBe(circle)
    expect(
      simplifyLassoPoints([point(0, 0), point(5, 0.1), point(10, 0)], 1),
    ).toHaveLength(3)
  })

  it('builds the selection from the simplified points', () => {
    const selection = roiSelectionFromLasso(circle, 1)

    expect(selection?.kind).toBe('lasso')
    expect(selection?.kind === 'lasso' ? selection.points.length : 0).toBeLessThan(60)
  })
})
