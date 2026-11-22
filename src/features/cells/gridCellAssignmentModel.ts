export interface GridCellAssignmentErrorSummary {
  readonly title: string
  readonly message: string
}

export interface GridCellAssignment {
  // Null when no 2 µm barcode of the bin is in a cell.
  readonly cellId: string | null
  readonly inNucleus: boolean
  readonly inCell: boolean
  readonly rowBudget?: number
  // For a bin read as several 2 µm barcodes: how many of them the cell holds,
  // how many were read, and how many cells they fall in.
  readonly barcodeCount?: number
  readonly mappedBarcodeCount?: number
  readonly cellCount?: number
}

// One `barcode_mappings.parquet` row: a 2 µm barcode and the cell it is in.
export interface GridCellBarcodeAssignment {
  readonly cellId: string | null
  readonly inNucleus: boolean
  readonly inCell: boolean
}

// An 8 or 16 µm bin has a mapping row for each of its 16 or 64 2 µm barcodes,
// which can fall in different cells or in none. The bin is given the cell
// that holds most of them (the first such cell on a tie), and no cell only
// when none of them is in one. Null without rows.
export function summarizeGridCellAssignments(
  rows: readonly GridCellBarcodeAssignment[],
): GridCellAssignment | null {
  if (rows.length === 0) {
    return null
  }

  const cells = new Map<string, { barcodes: number; inNucleus: boolean }>()

  for (const row of rows) {
    if (row.cellId === null || row.cellId === '' || !(row.inCell || row.inNucleus)) {
      continue
    }

    const cell = cells.get(row.cellId)
    cells.set(row.cellId, {
      barcodes: (cell?.barcodes ?? 0) + 1,
      inNucleus: (cell?.inNucleus ?? false) || row.inNucleus,
    })
  }

  let best: {
    readonly cellId: string
    readonly barcodes: number
    readonly inNucleus: boolean
  } | null = null

  for (const [cellId, cell] of cells) {
    if (best === null || cell.barcodes > best.barcodes) {
      best = { cellId, ...cell }
    }
  }

  const assignment =
    best === null
      ? { cellId: null, inNucleus: false, inCell: false }
      : { cellId: best.cellId, inNucleus: best.inNucleus, inCell: true }

  return rows.length === 1
    ? assignment
    : {
        ...assignment,
        barcodeCount: best?.barcodes ?? 0,
        mappedBarcodeCount: rows.length,
        cellCount: cells.size,
      }
}

export type GridCellAssignmentState<
  ErrorType extends GridCellAssignmentErrorSummary = GridCellAssignmentErrorSummary,
> =
  | { readonly status: 'idle' }
  | { readonly status: 'unavailable'; readonly reason: string }
  | { readonly status: 'loading'; readonly binId: string; readonly rowBudget?: number }
  | {
      readonly status: 'ready'
      readonly binId: string
      readonly assignment: GridCellAssignment
    }
  | { readonly status: 'missing'; readonly binId: string; readonly rowBudget?: number }
  | { readonly status: 'error'; readonly binId: string; readonly error: ErrorType }

export const IDLE_GRID_CELL_ASSIGNMENT_STATE: GridCellAssignmentState<never> = {
  status: 'idle',
}

export function gridCellAssignmentUnavailable(
  reason: string,
): GridCellAssignmentState<never> {
  return { status: 'unavailable', reason }
}

export function gridCellAssignmentLoadStarted(
  binId: string,
  rowBudget: number | undefined,
): GridCellAssignmentState<never> {
  return {
    status: 'loading',
    binId,
    ...(rowBudget === undefined ? {} : { rowBudget }),
  }
}

export function gridCellAssignmentReady(
  binId: string,
  assignment: GridCellAssignment,
): GridCellAssignmentState<never> {
  return { status: 'ready', binId, assignment }
}

export function gridCellAssignmentMissing(
  binId: string,
  rowBudget: number | undefined,
): GridCellAssignmentState<never> {
  return {
    status: 'missing',
    binId,
    ...(rowBudget === undefined ? {} : { rowBudget }),
  }
}

export function gridCellAssignmentFailed<
  ErrorType extends GridCellAssignmentErrorSummary,
>(binId: string, error: ErrorType): GridCellAssignmentState<ErrorType> {
  return { status: 'error', binId, error }
}

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
