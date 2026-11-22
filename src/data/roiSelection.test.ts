import { describe, expect, it } from 'vitest'
import { micrometers, type DataPoint } from './coords'
import { roiSelectionArea, roiSelectionContains, type RoiSelection } from './roiSelection'

function lasso(points: readonly (readonly [number, number])[]): RoiSelection {
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  return {
    kind: 'lasso',
    bbox: {
      minX: micrometers(Math.min(...xs)),
      maxX: micrometers(Math.max(...xs)),
      minY: micrometers(Math.min(...ys)),
      maxY: micrometers(Math.max(...ys)),
    },
    points: points.map(([x, y]): DataPoint => ({ x: micrometers(x), y: micrometers(y) })),
  }
}

// The area roiSelectionContains selects, counted on a 1 µm grid.
function selectedArea(selection: RoiSelection): number {
  const { minX, minY, maxX, maxY } = selection.bbox
  let cells = 0

  for (let x = minX + 0.5; x < maxX; x += 1) {
    for (let y = minY + 0.5; y < maxY; y += 1) {
      if (roiSelectionContains(selection, { x: micrometers(x), y: micrometers(y) })) {
        cells += 1
      }
    }
  }

  return cells
}

describe('selection area', () => {
  it('is the box, or a simple lasso’s polygon, whichever way it winds', () => {
    expect(
      roiSelectionArea({
        kind: 'box',
        bbox: {
          minX: micrometers(10),
          minY: micrometers(0),
          maxX: micrometers(30),
          maxY: micrometers(5),
        },
      }),
    ).toBe(100)
    const square = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ] as const
    expect(roiSelectionArea(lasso(square))).toBeCloseTo(10_000)
    expect(roiSelectionArea(lasso([...square].reverse()))).toBeCloseTo(10_000)
    // An L shape, with an edge along x at a vertex's height.
    expect(
      roiSelectionArea(
        lasso([
          [0, 0],
          [60, 0],
          [60, 20],
          [20, 20],
          [20, 50],
          [0, 50],
        ]),
      ),
    ).toBeCloseTo(60 * 20 + 20 * 30)
  })

  it('counts each lobe of a lasso that crosses itself, as it selects them', () => {
    // A bow-tie: two triangles of 10,000 µm², wound opposite ways.
    const bowTie = lasso([
      [0, 0],
      [200, 200],
      [200, 0],
      [0, 200],
    ])
    expect(roiSelectionArea(bowTie)).toBeCloseTo(20_000)
    // Lobes of 13,333.3 and 53,333.3 µm².
    const uneven = lasso([
      [0, 0],
      [400, 400],
      [400, 0],
      [0, 200],
    ])
    expect(roiSelectionArea(uneven)).toBeCloseTo(200_000 / 3)
    expect(Math.abs(selectedArea(uneven) - 200_000 / 3)).toBeLessThan(700)
  })

  it('leaves out a loop the lasso goes round twice', () => {
    // A star drawn in one stroke: its centre is inside twice, so not selected.
    const star = lasso([
      [100, 0],
      [159, 181],
      [5, 69],
      [195, 69],
      [41, 181],
    ])
    expect(Math.abs(roiSelectionArea(star) - selectedArea(star))).toBeLessThan(150)
    expect(roiSelectionContains(star, { x: micrometers(100), y: micrometers(100) })).toBe(
      false,
    )
  })
})
