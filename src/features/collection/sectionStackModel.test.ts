import { describe, expect, it } from 'vitest'
import { parseDatasetCollection } from '../../datasets/datasetCollection'
import type { PreviewCells } from './collectionPreviewData'
import type { PreviewEntry } from './collectionPreviewStore'
import {
  cellViewStatus,
  MAX_STACK_DEPTH_SCALE_LOG2,
  openingStackDepthScaleLog2,
  sectionModelMatrix,
  stackDepths,
  stackFrame,
  stackSections,
  stackStatus,
} from './sectionStackModel'

const COLLECTION = parseDatasetCollection(
  {
    version: 1,
    datasets: [
      { dataset: 'p1-s3.zarr', name: 'S3', coordinateSystem: 'patient-1', z: 20 },
      { dataset: 'p1-s1.zarr', name: 'S1', coordinateSystem: 'patient-1', z: 0 },
      { dataset: 'p1-s2.zarr', name: 'S2', coordinateSystem: 'patient-1', z: 10 },
      { dataset: 'p2-s1.zarr', coordinateSystem: 'patient-2', z: 0 },
      { dataset: 'p3-s1.zarr', coordinateSystem: 'patient-3' },
      { dataset: 'p3-s2.zarr', coordinateSystem: 'patient-3' },
      { dataset: 'atlas.zarr' },
    ],
  },
  'https://example.test/study/collection.json',
)
const url = (path: string) => `https://example.test/study/${path}`

const READY: PreviewEntry = {
  cells: {} as PreviewCells,
  scores: null,
  classes: null,
  values: null,
  loading: false,
  unavailable: null,
  error: null,
}

describe('section stack', () => {
  it('stacks the open dataset’s coordinate system by depth', () => {
    const sections = stackSections(COLLECTION, url('p1-s2.zarr'))

    expect(sections.map(({ entry, z }) => [entry.name, z])).toEqual([
      ['S1', 0],
      ['S2', 10],
      ['S3', 20],
    ])
  })

  it('stacks nothing without depths, a second section or a collection', () => {
    expect(stackSections(COLLECTION, url('p2-s1.zarr'))).toEqual([])
    expect(stackSections(COLLECTION, url('p3-s1.zarr'))).toEqual([])
    expect(stackSections(COLLECTION, url('atlas.zarr'))).toEqual([])
    expect(stackSections(COLLECTION, null)).toEqual([])
    expect(stackSections(null, url('p1-s1.zarr'))).toEqual([])
  })

  it('frames the read sections’ cells and every section’s depth', () => {
    expect(
      stackFrame(
        [0, 10, 40],
        [
          { minX: 0, maxX: 100, minY: 0, maxY: 50 },
          null,
          { minX: 20, maxX: 200, minY: -10, maxY: 30 },
        ],
      ),
    ).toEqual({
      centerX: 100,
      centerY: 20,
      centerZ: 20,
      width: 200,
      height: 60,
      depth: 40,
    })
    expect(stackFrame([0, 10], [null, null])).toBeNull()
  })

  it('opens stretched to about a quarter as deep as wide, never flattened', () => {
    const frame = { centerX: 0, centerY: 0, centerZ: 0, width: 4000, height: 2000 }

    // 18 sections 10 µm apart: 170 µm deep, so 1,000 µm wants ×5.9, ×8.
    expect(openingStackDepthScaleLog2({ ...frame, depth: 170 })).toBe(3)
    // Already deep enough.
    expect(openingStackDepthScaleLog2({ ...frame, depth: 3000 })).toBe(0)
    // Two sections 1 µm apart: as far as the control goes.
    expect(openingStackDepthScaleLog2({ ...frame, depth: 1 })).toBe(
      MAX_STACK_DEPTH_SCALE_LOG2,
    )
    expect(openingStackDepthScaleLog2({ ...frame, depth: 0 })).toBe(0)
    expect(openingStackDepthScaleLog2(null)).toBe(0)
  })

  it('centres a section on the frame at its stretched depth', () => {
    const frame = {
      centerX: 100,
      centerY: 20,
      centerZ: 20,
      width: 200,
      height: 60,
      depth: 40,
    }
    const matrix = sectionModelMatrix(frame, 40, 4)

    // Drawn at (x, -y): the frame's centre (100, -20) goes to the origin.
    expect([...matrix.slice(12)]).toEqual([-100, 20, 80, 1])
    // A cell's own z, for cells placed in 3D, is stretched too.
    expect([...matrix.slice(0, 12)]).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 4, 0])
  })

  it('spans the depths of cells placed in 3D above their section', () => {
    const sections = stackSections(COLLECTION, url('p1-s1.zarr'))
    const deep: PreviewEntry = {
      ...READY,
      cells: {
        ...READY.cells,
        depths: { values: Float32Array.of(2, 7), min: 2, max: 7 },
      } as PreviewCells,
    }

    expect(stackDepths(sections, [READY, deep, null])).toEqual([0, 12, 17, 20])
  })

  it('says what the 3D view of one dataset’s cells is reading or cannot show', () => {
    expect(cellViewStatus(null, false)).toEqual({
      reading: 'Reading cells',
      missing: null,
      uncolored: null,
    })
    expect(cellViewStatus(READY, false)).toEqual({
      reading: null,
      missing: null,
      uncolored: null,
    })
    expect(cellViewStatus({ ...READY, loading: true }, true).reading).toBe(
      'Reading colours',
    )
    expect(
      cellViewStatus(
        { ...READY, cells: null, unavailable: 'No cells to preview.' },
        true,
      ),
    ).toEqual({
      reading: null,
      missing: 'Not shown: no cells to preview',
      uncolored: null,
    })
    expect(cellViewStatus({ ...READY, cells: null, error: 'HTTP 403' }, false)).toEqual({
      reading: null,
      missing: 'Not shown: the cells could not be read',
      uncolored: null,
    })
  })

  it('counts the sections read, and names those it cannot show', () => {
    const sections = stackSections(COLLECTION, url('p1-s1.zarr'))

    expect(stackStatus(sections, [READY, READY, READY], false)).toEqual({
      reading: null,
      missing: null,
      uncolored: null,
    })
    expect(
      stackStatus(
        sections,
        [
          READY,
          { ...READY, cells: null, unavailable: 'No cells to preview.' },
          { ...READY, cells: null, error: 'HTTP 403' },
        ],
        false,
      ),
    ).toEqual({
      reading: null,
      missing: 'Not shown: S2 (no cells to preview), S3 (could not be read)',
      uncolored: null,
    })
    // Cells read, then the colours failed: the section is drawn (EXP-248).
    expect(
      stackStatus(sections, [READY, { ...READY, error: 'HTTP 503' }, READY], true),
    ).toEqual({
      reading: null,
      missing: null,
      uncolored: 'Colours could not be read: S2',
    })
    // Cells read but the genes' scores still loading.
    expect(
      stackStatus(sections, [READY, { ...READY, loading: true }, null], true).reading,
    ).toBe('Reading sections: 1 of 3')
    expect(
      stackStatus(sections, [READY, { ...READY, loading: true }, READY], false),
    ).toEqual({
      reading: null,
      missing: null,
      uncolored: null,
    })
  })
})
