import { describe, expect, it } from 'vitest'
import {
  IDLE_GRID_CELL_ASSIGNMENT_STATE,
  gridCellAssignmentFailed,
  gridCellAssignmentLoadStarted,
  gridCellAssignmentLocationLabel,
  gridCellAssignmentMissing,
  gridCellAssignmentReady,
  gridCellAssignmentStatusLabel,
  gridCellAssignmentUnavailable,
  summarizeGridCellAssignments,
} from './gridCellAssignmentModel'

describe('gridCellAssignmentModel', () => {
  it('constructs grid-cell assignment transitions', () => {
    const assignment = {
      cellId: 'aaaaaaaa-1',
      inNucleus: false,
      inCell: true,
      rowBudget: 2_000,
    }
    const error = {
      title: 'Assignment failed',
      message: 'Unable to read the assignment rows.',
    }

    expect(IDLE_GRID_CELL_ASSIGNMENT_STATE).toEqual({ status: 'idle' })
    expect(gridCellAssignmentUnavailable('Select a bin')).toEqual({
      status: 'unavailable',
      reason: 'Select a bin',
    })
    expect(gridCellAssignmentLoadStarted('BC-1', 2_000)).toEqual({
      status: 'loading',
      binId: 'BC-1',
      rowBudget: 2_000,
    })
    expect(gridCellAssignmentLoadStarted('BC-1', undefined)).not.toHaveProperty(
      'rowBudget',
    )
    expect(gridCellAssignmentReady('BC-1', assignment)).toEqual({
      status: 'ready',
      binId: 'BC-1',
      assignment,
    })
    expect(gridCellAssignmentMissing('BC-1', 2_000)).toEqual({
      status: 'missing',
      binId: 'BC-1',
      rowBudget: 2_000,
    })
    expect(gridCellAssignmentMissing('BC-1', undefined)).not.toHaveProperty('rowBudget')
    expect(gridCellAssignmentFailed('BC-1', error)).toEqual({
      status: 'error',
      binId: 'BC-1',
      error,
    })
  })

  it('gives a bin the cell holding most of its 2 µm barcodes', () => {
    const outside = { cellId: null, inNucleus: false, inCell: false }
    const inCell = (cellId: string, inNucleus = false) => ({
      cellId,
      inNucleus,
      inCell: true,
    })

    // The first barcode is outside every cell; cell B holds most of the bin.
    expect(
      summarizeGridCellAssignments([
        outside,
        inCell('A'),
        inCell('B'),
        inCell('B', true),
        inCell('B'),
        inCell('A'),
      ]),
    ).toEqual({
      cellId: 'B',
      inNucleus: true,
      inCell: true,
      barcodeCount: 3,
      mappedBarcodeCount: 6,
      cellCount: 2,
    })
    // A tie goes to the first cell seen.
    expect(summarizeGridCellAssignments([inCell('A'), inCell('B')])).toMatchObject({
      cellId: 'A',
      barcodeCount: 1,
    })
    expect(summarizeGridCellAssignments([outside, outside])).toEqual({
      cellId: null,
      inNucleus: false,
      inCell: false,
      barcodeCount: 0,
      mappedBarcodeCount: 2,
      cellCount: 0,
    })
    // A 2 µm bin is its own single row.
    expect(summarizeGridCellAssignments([inCell('A')])).toEqual(inCell('A'))
    expect(summarizeGridCellAssignments([])).toBeNull()
  })

  it('formats assignment status and location labels', () => {
    expect(gridCellAssignmentStatusLabel({ status: 'idle' })).toBe('Unavailable')
    expect(gridCellAssignmentStatusLabel(gridCellAssignmentUnavailable('No bin'))).toBe(
      'Unavailable',
    )
    expect(gridCellAssignmentStatusLabel(gridCellAssignmentLoadStarted('BC-1', 10))).toBe(
      'Loading',
    )
    expect(
      gridCellAssignmentStatusLabel(
        gridCellAssignmentReady('BC-1', {
          cellId: 'aaaaaaaa-1',
          inNucleus: true,
          inCell: true,
        }),
      ),
    ).toBe('Loaded')
    expect(gridCellAssignmentStatusLabel(gridCellAssignmentMissing('BC-1', 10))).toBe(
      'Not found',
    )
    expect(
      gridCellAssignmentStatusLabel(
        gridCellAssignmentFailed('BC-1', {
          title: 'Failed',
          message: 'Failed',
        }),
      ),
    ).toBe('Error')

    expect(gridCellAssignmentLocationLabel({ inNucleus: true, inCell: true })).toBe(
      'Nucleus',
    )
    expect(gridCellAssignmentLocationLabel({ inNucleus: false, inCell: true })).toBe(
      'Cell',
    )
    expect(gridCellAssignmentLocationLabel({ inNucleus: false, inCell: false })).toBe(
      'Outside cell',
    )
  })
})
