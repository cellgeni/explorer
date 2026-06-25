import { act, render, waitFor } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { GexResult } from '../../data/gexTypes'
import type { VisiumHdBarcodeMapping } from '../../datasets/visiumHdBarcodeMappings'
import type { GridCellDatum } from '../../rendering/deckLayers'
import type { SpatialDatasetLoader } from './appDependencies'
import type {
  CellExpressionProfileSelection,
  CellExpressionProfileState,
} from '../cells/cellExpressionProfileModel'
import type { DatasetLoadState } from '../dataset/datasetLoadModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import { useVisiumHdExpressionProfileWorkflow } from './useVisiumHdExpressionProfileWorkflow'

const gridCell: GridCellDatum = {
  id: 's_008um_1_1',
  gridId: 'visium-hd-8um',
  row: 1,
  col: 1,
  binSizeMicrometers: 8,
  polygon: [],
  fillColor: [0, 0, 0, 255],
  lineColor: [255, 255, 255, 255],
}

const readyLoadState: DatasetLoadState<StructuredLoadError> = {
  status: 'ready',
  url: 'https://example.test/visium',
  cellCount: 1,
}

const mappings: readonly VisiumHdBarcodeMapping[] = [
  {
    square002um: 's_002um_1_1',
    square008um: 's_008um_1_1',
    square016um: 's_016um_1_1',
    cellId: 'cell-1',
    inCell: true,
    inNucleus: false,
  },
  {
    square002um: 's_002um_1_2',
    square008um: 's_008um_1_2',
    square016um: 's_016um_1_2',
    cellId: 'cell-1',
    inCell: false,
    inNucleus: true,
  },
]

interface Snapshot {
  readonly debugMessages: readonly string[]
  readonly requestId: number
  readonly state: CellExpressionProfileState<StructuredLoadError>
}

let api: ReturnType<typeof useVisiumHdExpressionProfileWorkflow>
let snapshot: Snapshot

function Probe({
  activeSelection,
  getSpatialDataset,
  isVisiumHdDataset = true,
  onReady,
}: {
  readonly activeSelection: CellExpressionProfileSelection | null
  readonly getSpatialDataset: SpatialDatasetLoader
  readonly isVisiumHdDataset?: boolean
  readonly onReady: (
    nextApi: ReturnType<typeof useVisiumHdExpressionProfileWorkflow>,
    nextSnapshot: Snapshot,
  ) => void
}) {
  const [state, setState] = React.useState<
    CellExpressionProfileState<StructuredLoadError>
  >({ status: 'idle' })
  const abortRef = React.useRef<AbortController | null>(null)
  const requestIdRef = React.useRef(0)
  const debugMessagesRef = React.useRef<string[]>([])

  const nextApi = useVisiumHdExpressionProfileWorkflow({
    callbacks: {
      appendDebugEvent: (message) => {
        debugMessagesRef.current.push(message)
      },
    },
    controls: {
      activeBinSize: undefined,
      isVisiumHdDataset,
      rowBudget: 50,
    },
    data: {
      activeSelection,
      loadState: readyLoadState,
      selectedGridCell: gridCell,
    },
    loaders: { getSpatialDataset },
    refs: {
      abortRef,
      requestIdRef,
    },
    setters: { setExpressionProfileState: setState },
  })

  React.useEffect(() => {
    onReady(nextApi, {
      debugMessages: debugMessagesRef.current,
      requestId: requestIdRef.current,
      state,
    })
  })

  return null
}

describe('useVisiumHdExpressionProfileWorkflow', () => {
  it('auto-loads selected bin expression profiles', async () => {
    const matrix = vi.fn(async () => matrixResult('s_008um_1_1', 'VIM', 12))
    const getSpatialDataset = spatialDatasetLoader({ matrix })

    render(
      <Probe
        activeSelection={{ id: 's_008um_1_1', kind: 'bin' }}
        getSpatialDataset={getSpatialDataset}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    await waitFor(() => {
      expect(snapshot.state.status).toBe('ready')
    })

    expect(matrix).toHaveBeenCalledWith(['s_008um_1_1'], 8, {
      signal: expect.any(AbortSignal),
    })
    expect(snapshot.state).toMatchObject({
      status: 'ready',
      selectionId: 's_008um_1_1',
      selectionKind: 'bin',
      sourceLabel: 'Selected bin',
      expression: {
        genes: [{ gene: 'VIM', count: 12, percentTotal: 100 }],
        totalCount: 12,
        hitGeneLimit: false,
      },
    })
    expect(snapshot.debugMessages).toContain(
      'Loaded Visium HD bin expression profile: 1 genes',
    )
    void api
  })

  it('loads selected segmented-cell profiles from mapped Visium HD bins', async () => {
    const matrix = vi.fn(async () =>
      matrixResult(['s_008um_1_1', 's_008um_1_2'], 'DCN', 5),
    )
    const barcodeMappingsForCell = vi.fn(async () => mappings)
    const getSpatialDataset = spatialDatasetLoader({
      barcodeMappingsForCell,
      matrix,
    })

    render(
      <Probe
        activeSelection={{ id: 'cell-1', kind: 'cell' }}
        getSpatialDataset={getSpatialDataset}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    await act(async () => {
      api.handleLoadVisiumHdExpressionProfile()
    })

    await waitFor(() => {
      expect(snapshot.state.status).toBe('ready')
    })

    expect(barcodeMappingsForCell).toHaveBeenCalledWith('cell-1', {
      signal: expect.any(AbortSignal),
    })
    expect(matrix).toHaveBeenCalledWith(['s_008um_1_1', 's_008um_1_2'], 8, {
      signal: expect.any(AbortSignal),
    })
    expect(snapshot.state).toMatchObject({
      status: 'ready',
      selectionId: 'cell-1',
      selectionKind: 'cell',
      sourceLabel: '2 mapped bins',
      expression: {
        genes: [{ gene: 'DCN', count: 10, percentTotal: 100 }],
        totalCount: 10,
        hitGeneLimit: false,
      },
    })
  })

  it('ignores stale profile completions after a newer request starts', async () => {
    const firstMatrix = createDeferred<GexResult<string>>()
    const secondMatrix = createDeferred<GexResult<string>>()
    const signals: AbortSignal[] = []
    const matrix = vi.fn(
      (
        ids: readonly string[],
        _binSize?: number,
        options?: { readonly signal?: AbortSignal },
      ) => {
        signals.push(options?.signal as AbortSignal)
        return ids[0] === 'first-bin' ? firstMatrix.promise : secondMatrix.promise
      },
    )
    const getSpatialDataset = spatialDatasetLoader({ matrix })
    const view = render(
      <Probe
        activeSelection={{ id: 'first-bin', kind: 'bin' }}
        getSpatialDataset={getSpatialDataset}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    await waitFor(() => {
      expect(matrix).toHaveBeenCalledTimes(1)
    })

    view.rerender(
      <Probe
        activeSelection={{ id: 'second-bin', kind: 'bin' }}
        getSpatialDataset={getSpatialDataset}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    await waitFor(() => {
      expect(matrix).toHaveBeenCalledTimes(2)
    })

    expect(signals[0]?.aborted).toBe(true)

    await act(async () => {
      secondMatrix.resolve(matrixResult('second-bin', 'EEF2', 7))
    })

    expect(snapshot.state).toMatchObject({
      status: 'ready',
      selectionId: 'second-bin',
      expression: { totalCount: 7 },
    })

    await act(async () => {
      firstMatrix.resolve(matrixResult('first-bin', 'VIM', 99))
    })

    expect(snapshot.state).toMatchObject({
      status: 'ready',
      selectionId: 'second-bin',
      expression: { totalCount: 7 },
    })
    void api
  })
})

function spatialDatasetLoader({
  barcodeMappingsForCell = vi.fn(async () => []),
  matrix,
}: {
  readonly barcodeMappingsForCell?: (
    cellId: string,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<readonly VisiumHdBarcodeMapping[]>
  readonly matrix: (
    ids: readonly string[],
    binSizeMicrometers?: number,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<GexResult<string>>
}): SpatialDatasetLoader {
  return vi.fn(async () => ({
    barcodeMappingsForCell,
    matrix,
  })) as unknown as SpatialDatasetLoader
}

function matrixResult(
  ids: string | readonly string[],
  gene: string,
  count: number,
): GexResult<string> {
  const elementIds = typeof ids === 'string' ? [ids] : ids

  return {
    geneNames: [gene],
    cells: new Map<
      string,
      { readonly geneNames: readonly string[]; readonly counts: readonly number[] }
    >(
      elementIds.map((id) => [
        id,
        {
          geneNames: [gene],
          counts: [count],
        },
      ]),
    ),
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}
