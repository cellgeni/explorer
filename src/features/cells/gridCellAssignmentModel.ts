export interface GridCellAssignmentErrorSummary {
  readonly title: string
  readonly message: string
}

export interface GridCellAssignment {
  readonly cellId: string
  readonly inNucleus: boolean
  readonly inCell: boolean
  readonly rowBudget: number
}

export type GridCellAssignmentState<
  ErrorType extends GridCellAssignmentErrorSummary = GridCellAssignmentErrorSummary,
> =
  | { readonly status: 'idle' }
  | { readonly status: 'unavailable'; readonly reason: string }
  | { readonly status: 'loading'; readonly binId: string; readonly rowBudget: number }
  | {
      readonly status: 'ready'
      readonly binId: string
      readonly assignment: GridCellAssignment
    }
  | { readonly status: 'missing'; readonly binId: string; readonly rowBudget: number }
  | { readonly status: 'error'; readonly binId: string; readonly error: ErrorType }

export function gridCellAssignmentStatusLabel(state: GridCellAssignmentState): string {
  switch (state.status) {
    case 'idle':
      return 'Unavailable'
    case 'unavailable':
      return 'Unavailable'
    case 'loading':
      return 'Loading'
    case 'ready':
      return 'Loaded'
    case 'missing':
      return 'Not found'
    case 'error':
      return 'Error'
  }
}

export function gridCellAssignmentLocationLabel(
  assignment: Pick<GridCellAssignment, 'inNucleus' | 'inCell'>,
): string {
  if (assignment.inNucleus) {
    return 'Nucleus'
  }

  if (assignment.inCell) {
    return 'Cell'
  }

  return 'Outside cell'
}
