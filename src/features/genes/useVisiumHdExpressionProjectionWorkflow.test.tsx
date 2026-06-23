import { act, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { micrometers } from '../../data/coords'
import type { SpatialElement } from '../../datasets/spatialDataset'
import type { GeneExpressionBatch } from '../../datasets/xeniumDataset'
import type { SpatialDatasetLoader } from '../app-shell/appDependencies'
import type { DatasetLoadState } from '../dataset/datasetLoadModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import {
  useVisiumHdExpressionProjectionWorkflow,
  type VisiumHdExpressionProjectionState,
} from './useVisiumHdExpressionProjectionWorkflow'

interface Snapshot {
  readonly state: VisiumHdExpressionProjectionState
  readonly debugMessages: readonly string[]
}

const DEFAULT_BOUNDARY_ELEMENTS: readonly SpatialElement[] = [
  boundaryElement('cell-a', 0, 0, 10, 10),
  boundaryElement('cell-b', 12, 0, 10, 10),
]

const DEFAULT_EXPRESSION_BATCH: GeneExpressionBatch = {
  cells: [
    {
      id: 'bin-1',
      position: { x: micrometers(5), y: micrometers(5) },
      count: 9,
    },
  ],
  genes: ['Actb'],
  maxCount: 9,
}

function Probe({
  boundaryElements = DEFAULT_BOUNDARY_ELEMENTS,
  expressionBatch = DEFAULT_EXPRESSION_BATCH,
  getSpatialDataset,
  rowBudget,
  onReady,
}: {
  readonly boundaryElements?: readonly SpatialElement[]
  readonly expressionBatch?: GeneExpressionBatch | null
  readonly getSpatialDataset: SpatialDatasetLoader
  readonly rowBudget: number | undefined
  readonly onReady: (snapshot: Snapshot) => void
}) {
  const debugMessagesRef = React.useRef<string[]>([])
  const appendDebugEvent = React.useCallback((message: string) => {
    debugMessagesRef.current.push(message)
  }, [])
  const loadState = React.useMemo<DatasetLoadState<StructuredLoadError>>(
    () => ({
      status: 'ready',
      url: 'https://example.test/visium',
      cellCount: 2,
    }),
    [],
  )
  const state = useVisiumHdExpressionProjectionWorkflow({
    appendDebugEvent,
    boundaryElements,
    geneExpressionBatch: expressionBatch,
    getSpatialDataset,
    isVisiumHdDataset: true,
    loadState,
    rowBudget,
    selectedBinSize: 16,
  })

  React.useEffect(() => {
    onReady({
      state,
      debugMessages: debugMessagesRef.current,
    })
  })

  return null
}

describe('useVisiumHdExpressionProjectionWorkflow', () => {
  it('projects expression without a configured mapping row budget', async () => {
    const barcodeMappingAssignments = vi.fn(async () => [
      {
        binId: 'bin-1',
        cellId: 'cell-a',
        inCell: true,
        inNucleus: false,
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
        onReady={(snapshot) => {
          snapshots.push(snapshot)
        }}
      />,
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getSpatialDataset).toHaveBeenCalledWith('https://example.test/visium')
    expect(barcodeMappingAssignments).toHaveBeenCalledWith(16, ['bin-1'], {
      signal: expect.any(AbortSignal),
    })
    expect(snapshots.at(-1)?.state).toMatchObject({
      status: 'ready',
      mappedBinCount: 1,
      mappedCellCount: 1,
    })
  })

  it('projects binned expression onto visible boundary cells with mappings', async () => {
    const barcodeMappingAssignments = vi.fn(async () => [
      {
        binId: 'bin-1',
        cellId: 'cell-a',
        inCell: true,
        inNucleus: false,
      },
      {
        binId: 'bin-1',
        cellId: 'cell-a',
        inCell: true,
        inNucleus: false,
      },
      {
        binId: 'bin-1',
        cellId: 'cell-b',
        inCell: true,
        inNucleus: false,
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
        onReady={(snapshot) => {
          snapshots.push(snapshot)
        }}
      />,
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getSpatialDataset).toHaveBeenCalledWith('https://example.test/visium')
    expect(barcodeMappingAssignments).toHaveBeenCalledWith(16, ['bin-1'], {
      maxRows: 12_000_000,
      signal: expect.any(AbortSignal),
    })
    const state = snapshots.at(-1)?.state

    expect(state?.status).toBe('ready')

    if (state?.status !== 'ready') {
      throw new Error('Expected ready projection state.')
    }

    expect(state.mappedBinCount).toBe(1)
    expect(state.mappedCellCount).toBe(2)
    expect(state.batch.cells.map((cell) => [cell.id, cell.count])).toEqual([
      ['cell-a', 6],
      ['cell-b', 3],
    ])
    expect(snapshots.at(-1)?.debugMessages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Visium HD expression cell projection ready:/),
      ]),
    )
  })

  it('colors visible boundary cells as zero expression without loading mappings when no bins are positive', async () => {
    const getSpatialDataset = vi.fn()
    const snapshots: Snapshot[] = []

    render(
      <Probe
        expressionBatch={{ cells: [], genes: ['Actb'], maxCount: 0 }}
        getSpatialDataset={getSpatialDataset}
        rowBudget={undefined}
        onReady={(snapshot) => {
          snapshots.push(snapshot)
        }}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(getSpatialDataset).not.toHaveBeenCalled()
    const state = snapshots.at(-1)?.state

    expect(state?.status).toBe('ready')

    if (state?.status !== 'ready') {
      throw new Error('Expected ready projection state.')
    }

    expect(state.batch.cells.map((cell) => [cell.id, cell.count])).toEqual([
      ['cell-a', 0],
      ['cell-b', 0],
    ])
  })
})

function boundaryElement(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
): SpatialElement {
  return {
    id,
    geometry: {
      kind: 'polygon',
      rings: [
        [
          { x: micrometers(x), y: micrometers(y) },
          { x: micrometers(x + width), y: micrometers(y) },
          { x: micrometers(x + width), y: micrometers(y + height) },
          { x: micrometers(x), y: micrometers(y + height) },
          { x: micrometers(x), y: micrometers(y) },
        ],
      ],
    },
  }
}
