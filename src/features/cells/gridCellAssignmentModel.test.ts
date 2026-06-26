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
