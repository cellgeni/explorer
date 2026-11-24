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
  readonly cellId: string | null
  readonly inNucleus: boolean
  readonly inCell: boolean
}

const DEFAULT_GRID_CELL = gridCellDatum()

function Probe({
  getSpatialDataset,
  rowBudget,
  selectedGridCell = DEFAULT_GRID_CELL,
  loadStateVersion = 0,
  onReady,
}: {
  readonly getSpatialDataset: Parameters<
    typeof useGridCellAssignmentWorkflow
  >[0]['loaders']['getSpatialDataset']
  readonly rowBudget: number | undefined
  readonly selectedGridCell?: GridCellDatum | null
  // A new, equal ready state for each version, as the level of detail makes.
  readonly loadStateVersion?: number
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
      // The same count for every version: only the object is new.
      cellCount: 1 + loadStateVersion * 0,
    }),
    [loadStateVersion],
  )

  useGridCellAssignmentWorkflow({
    callbacks: { appendDebugEvent },
    controls: {
      isVisiumHdDataset: true,
      rowBudget,
      selectedBinSize: 16,
    },
    data: {
      loadState,
      selectedGridCell,
    },
    loaders: { getSpatialDataset },
    refs: {
      gridCellAssignmentAbortRef,
      gridCellAssignmentRequestIdRef,
    },
    setters: { setGridCellAssignmentState },
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

  it('reads a bin once while the ready state is replaced by an equal one', async () => {
    const barcodeMappingAssignments = vi.fn(async () => [
      { binId: 'BC-1', cellId: 'cellid_000000001-1', inNucleus: false, inCell: true },
    ])
    const getSpatialDataset: SpatialDatasetLoader = vi.fn(
      async () =>
        ({
          barcodeMappingAssignments,
        }) as unknown as Awaited<ReturnType<SpatialDatasetLoader>>,
    )
    const snapshots: Snapshot[] = []
    const probe = (version: number) => (
      <Probe
        getSpatialDataset={getSpatialDataset}
        rowBudget={undefined}
        loadStateVersion={version}
        onReady={(nextSnapshot) => {
          snapshots.push(nextSnapshot)
        }}
      />
    )
    const { rerender } = render(probe(0))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    // Zooming across the level-of-detail threshold.
    rerender(probe(1))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(barcodeMappingAssignments).toHaveBeenCalledTimes(1)
    expect(snapshots.at(-1)?.assignmentState.status).toBe('ready')
  })

  it("names the cell holding most of a coarse bin's 2 µm barcodes", async () => {
    // A 16 µm bin's first 2 µm barcode is outside every cell.
    const barcodeMappingAssignments = vi.fn(async () => [
      { binId: 'BC-1', cellId: null, inNucleus: false, inCell: false },
      { binId: 'BC-1', cellId: 'cell-a', inNucleus: false, inCell: true },
      { binId: 'BC-1', cellId: 'cell-b', inNucleus: true, inCell: true },
      { binId: 'BC-1', cellId: 'cell-b', inNucleus: false, inCell: true },
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

    expect(snapshots.at(-1)?.assignmentState).toEqual({
      status: 'ready',
      binId: 'BC-1',
      assignment: {
        cellId: 'cell-b',
        inNucleus: true,
        inCell: true,
        barcodeCount: 2,
        mappedBarcodeCount: 4,
        cellCount: 2,
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
