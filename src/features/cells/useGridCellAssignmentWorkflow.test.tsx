import { act, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { GridCellDatum } from '../../rendering/deckLayers'
import type { SpatialDatasetLoader } from '../app-shell/appDependencies'
import type { DatasetLoadState } from '../dataset/datasetLoadModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import type { GridCellAssignmentState } from './gridCellAssignmentModel'
import { useGridCellAssignmentWorkflow } from './useGridCellAssignmentWorkflow'

interface Snapshot {
  readonly assignmentState: GridCellAssignmentState<StructuredLoadError>
  readonly debugMessages: readonly string[]
}

interface SnapshotAssignment {
  readonly binId: string
  readonly cellId: string
  readonly inNucleus: boolean
  readonly inCell: boolean
}

const DEFAULT_GRID_CELL = gridCellDatum()

function Probe({
  getSpatialDataset,
  rowBudget,
  selectedGridCell = DEFAULT_GRID_CELL,
  onReady,
}: {
  readonly getSpatialDataset: Parameters<
    typeof useGridCellAssignmentWorkflow
  >[0]['getSpatialDataset']
  readonly rowBudget: number | undefined
  readonly selectedGridCell?: GridCellDatum | null
  readonly onReady: (snapshot: Snapshot) => void
}) {
  const [assignmentState, setGridCellAssignmentState] = React.useState<
    GridCellAssignmentState<StructuredLoadError>
  >({ status: 'idle' })
  const debugMessagesRef = React.useRef<string[]>([])
  const gridCellAssignmentAbortRef = React.useRef<AbortController | null>(null)
  const gridCellAssignmentRequestIdRef = React.useRef(0)
  const appendDebugEvent = React.useCallback((message: string) => {
    debugMessagesRef.current.push(message)
  }, [])
  const loadState = React.useMemo<DatasetLoadState<StructuredLoadError>>(
    () => ({
      status: 'ready',
      url: 'https://example.test/visium',
      cellCount: 1,
    }),
    [],
  )

  useGridCellAssignmentWorkflow({
    appendDebugEvent,
    getSpatialDataset,
    gridCellAssignmentAbortRef,
    gridCellAssignmentRequestIdRef,
    isVisiumHdDataset: true,
    loadState,
    rowBudget,
    selectedBinSize: 16,
    selectedGridCell,
    setGridCellAssignmentState,
  })

  React.useEffect(() => {
    onReady({
      assignmentState,
      debugMessages: debugMessagesRef.current,
    })
  })

  return null
}

describe('useGridCellAssignmentWorkflow', () => {
  it('loads selected bin cell assignment without a configured row budget', async () => {
    const barcodeMappingAssignments = vi.fn(async () => [
      {
        binId: 'BC-1',
        cellId: 'cellid_000000001-1',
        inNucleus: false,
        inCell: true,
      },
    ])
    const getSpatialDataset: SpatialDatasetLoader = vi.fn(
      async () =>
        ({
          barcodeMappingAssignments,
        }) as unknown as Awaited<ReturnType<SpatialDatasetLoader>>,
    )
    const snapshots: Snapshot[] = []

    render(
      <Probe
        getSpatialDataset={getSpatialDataset}
        rowBudget={undefined}
        onReady={(nextSnapshot) => {
          snapshots.push(nextSnapshot)
        }}
      />,
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getSpatialDataset).toHaveBeenCalledWith('https://example.test/visium')
    expect(barcodeMappingAssignments).toHaveBeenCalledWith(16, ['BC-1'], {
      signal: expect.any(AbortSignal),
    })
    const snapshot = snapshots.at(-1)
    expect(snapshot?.assignmentState).toEqual({
      status: 'ready',
      binId: 'BC-1',
      assignment: {
        cellId: 'cellid_000000001-1',
        inNucleus: false,
        inCell: true,
      },
    })
  })

  it('loads selected bin cell assignment with the configured row budget', async () => {
    const barcodeMappingAssignments = vi.fn(async () => [
      {
        binId: 'BC-1',
        cellId: 'cellid_000000001-1',
        inNucleus: false,
        inCell: true,
      },
    ])
    const getSpatialDataset: SpatialDatasetLoader = vi.fn(
      async () =>
        ({
          barcodeMappingAssignments,
        }) as unknown as Awaited<ReturnType<SpatialDatasetLoader>>,
    )
    const snapshots: Snapshot[] = []

    render(
      <Probe
        getSpatialDataset={getSpatialDataset}
        rowBudget={12_000_000}
        onReady={(nextSnapshot) => {
          snapshots.push(nextSnapshot)
        }}
      />,
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getSpatialDataset).toHaveBeenCalledWith('https://example.test/visium')
    expect(barcodeMappingAssignments).toHaveBeenCalledWith(16, ['BC-1'], {
      maxRows: 12_000_000,
      signal: expect.any(AbortSignal),
    })
    const snapshot = snapshots.at(-1)
    expect(snapshot?.assignmentState).toEqual({
      status: 'ready',
      binId: 'BC-1',
      assignment: {
        cellId: 'cellid_000000001-1',
        inNucleus: false,
        inCell: true,
        rowBudget: 12_000_000,
      },
    })
    expect(snapshot?.debugMessages).toEqual(
      expect.arrayContaining([expect.stringMatching(/^Bin assignment ready in /)]),
    )
  })

  it('ignores stale assignment results after the selected bin changes', async () => {
    const resolvers: Array<(assignments: readonly SnapshotAssignment[]) => void> = []
    const signals: AbortSignal[] = []
    const barcodeMappingAssignments = vi.fn(
      (
        _binSize: number,
        _binIds: readonly string[],
        options: { readonly signal?: AbortSignal },
      ) =>
        new Promise<readonly SnapshotAssignment[]>((resolve) => {
          if (options.signal !== undefined) {
            signals.push(options.signal)
          }
          resolvers.push(resolve)
        }),
    )
    const getSpatialDataset: SpatialDatasetLoader = vi.fn(
      async () =>
        ({
          barcodeMappingAssignments,
        }) as unknown as Awaited<ReturnType<SpatialDatasetLoader>>,
    )
    const snapshots: Snapshot[] = []
    const secondCell = gridCellDatum({ id: 'BC-2' })
    const { rerender } = render(
      <Probe
        getSpatialDataset={getSpatialDataset}
        rowBudget={undefined}
        selectedGridCell={DEFAULT_GRID_CELL}
        onReady={(nextSnapshot) => {
          snapshots.push(nextSnapshot)
        }}
      />,
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    rerender(
      <Probe
        getSpatialDataset={getSpatialDataset}
        rowBudget={undefined}
        selectedGridCell={secondCell}
        onReady={(nextSnapshot) => {
          snapshots.push(nextSnapshot)
        }}
      />,
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(signals[0]?.aborted).toBe(true)

    await act(async () => {
      resolvers[1]?.([
        {
          binId: 'BC-2',
          cellId: 'cell-2',
          inNucleus: true,
          inCell: true,
        },
      ])
      await Promise.resolve()
    })
    await act(async () => {
      resolvers[0]?.([
        {
          binId: 'BC-1',
          cellId: 'cell-1',
          inNucleus: false,
          inCell: true,
        },
      ])
      await Promise.resolve()
    })

    expect(snapshots.at(-1)?.assignmentState).toEqual({
      status: 'ready',
      binId: 'BC-2',
      assignment: {
        cellId: 'cell-2',
        inNucleus: true,
        inCell: true,
      },
    })
  })
})

function gridCellDatum(values: Partial<GridCellDatum> = {}): GridCellDatum {
  return {
    id: 'BC-1',
    gridId: 'grid-16um',
    row: 4,
    col: 7,
    binSizeMicrometers: 16,
    inTissue: true,
    fullresRow: 128,
    fullresCol: 256,
    polygon: [
      [0, 0, 0],
      [16, 0, 0],
      [16, -16, 0],
      [0, -16, 0],
    ],
    fillColor: [34, 120, 108, 28],
    lineColor: [22, 90, 82, 150],
    ...values,
  }
}
