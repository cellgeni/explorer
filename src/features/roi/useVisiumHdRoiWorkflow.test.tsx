import { act, render, waitFor } from '@testing-library/react'
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RoiDrawMode } from '../../components/ViewerCore'
import { micrometers } from '../../data/coords'
import type { RoiSelection } from '../../data/roiSelection'
import type { GridCellDatum } from '../../rendering/deckLayers'
import type { SpatialDatasetLoader } from '../app-shell/appDependencies'
import type { DatasetLoadState } from '../dataset/datasetLoadModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import { IDLE_VISIUM_HD_ROI_STATE, type VisiumHdRoiState } from './visiumHdRoiModel'
import type { RoiGeneStatsState } from './roiModel'
import { useVisiumHdRoiWorkflow } from './useVisiumHdRoiWorkflow'

const selection: RoiSelection = {
  kind: 'box',
  bbox: {
    minX: micrometers(0),
    minY: micrometers(0),
    maxX: micrometers(20),
    maxY: micrometers(20),
  },
}

const readyLoadState: DatasetLoadState<StructuredLoadError> = {
  status: 'ready',
  url: 'https://example.test/visium',
  cellCount: 1,
}

const selectedGridCells: readonly GridCellDatum[] = [
  gridCellDatum('s_008um_1_1', [
    [0, 0, 0],
    [10, 0, 0],
    [10, -10, 0],
    [0, -10, 0],
  ]),
  gridCellDatum('s_008um_9_9', [
    [40, -40, 0],
    [50, -40, 0],
    [50, -50, 0],
    [40, -50, 0],
  ]),
]

const readyVisiumHdRoiState: VisiumHdRoiState = {
  status: 'ready',
  url: 'https://example.test/visium',
  binSizeMicrometers: 8,
  bbox: selection.bbox,
  selection,
  bins: [
    {
      barcode: 's_008um_1_1',
      gridId: 'visium-hd-8um',
      row: 1,
      col: 1,
      center: { x: micrometers(5), y: micrometers(5) },
      binSizeMicrometers: 8,
    },
  ],
  hitBinLimit: false,
}

interface Snapshot {
  readonly debugMessages: readonly string[]
  readonly initialSharedSelection: RoiSelection | null
  readonly roiGeneStatsState: RoiGeneStatsState<StructuredLoadError>
  readonly roiMode: RoiDrawMode
  readonly roiName: string
  readonly visiumHdRoiState: VisiumHdRoiState
}

let api: ReturnType<typeof useVisiumHdRoiWorkflow>
let snapshot: Snapshot

afterEach(() => {
  vi.restoreAllMocks()
})

function Probe({
  clearRoi = vi.fn(),
  getSpatialDataset = defaultSpatialDatasetLoader(),
  initialSharedSelection = null,
  initialVisiumHdRoiState = IDLE_VISIUM_HD_ROI_STATE,
  isVisiumHdDataset = true,
  loadState = readyLoadState,
  onReady,
  roiName: initialRoiName = 'ROI 1',
}: {
  readonly clearRoi?: () => void
  readonly getSpatialDataset?: SpatialDatasetLoader
  readonly initialSharedSelection?: RoiSelection | null
  readonly initialVisiumHdRoiState?: VisiumHdRoiState
  readonly isVisiumHdDataset?: boolean
  readonly loadState?: DatasetLoadState<StructuredLoadError>
  readonly onReady: (
    nextApi: ReturnType<typeof useVisiumHdRoiWorkflow>,
    nextSnapshot: Snapshot,
  ) => void
  readonly roiName?: string
}) {
  const [roiMode, setRoiMode] = React.useState<RoiDrawMode>('box')
  const [roiName, setRoiName] = React.useState(initialRoiName)
  const [visiumHdRoiState, setVisiumHdRoiState] = React.useState(initialVisiumHdRoiState)
  const [roiGeneStatsState, setRoiGeneStatsState] = React.useState<
    RoiGeneStatsState<StructuredLoadError>
  >({ status: 'idle' })
  const debugMessagesRef = React.useRef<string[]>([])
  const initialSharedRoiSelectionRef = React.useRef<RoiSelection | null>(
    initialSharedSelection,
  )
  const roiGeneAbortRef = React.useRef<AbortController | null>(null)
  const roiGeneRequestIdRef = React.useRef(0)
  const roiIdRef = React.useRef(0)

  const nextApi = useVisiumHdRoiWorkflow({
    callbacks: {
      appendDebugEvent: (message) => {
        debugMessagesRef.current.push(message)
      },
      clearRoi,
    },
    controls: {
      activeBinSize: 8,
      isVisiumHdDataset,
      roiName,
    },
    data: {
      activeRoiState: visiumHdRoiState,
      gridCells: selectedGridCells,
      loadState,
    },
    loaders: {
      getSpatialDataset,
    },
    refs: {
      initialSharedRoiSelectionRef,
      roiGeneAbortRef,
      roiGeneRequestIdRef,
      roiIdRef,
    },
    setters: {
      setRoiGeneStatsState,
      setRoiMode,
      setRoiName,
      setVisiumHdRoiState,
    },
  })

  React.useEffect(() => {
    onReady(nextApi, {
      debugMessages: debugMessagesRef.current,
      initialSharedSelection: initialSharedRoiSelectionRef.current,
      roiGeneStatsState,
      roiMode,
      roiName,
      visiumHdRoiState,
    })
  })

  return null
}

function defaultSpatialDatasetLoader(): SpatialDatasetLoader {
  return vi.fn(async () => ({
    matrix: vi.fn(async () => ({
      geneNames: ['A2M', 'GAD1'],
      cells: new Map([
        [
          's_008um_1_1',
          {
            geneNames: ['A2M', 'GAD1'],
            counts: [7, 2],
          },
        ],
      ]),
    })),
  })) as unknown as SpatialDatasetLoader
}

describe('useVisiumHdRoiWorkflow', () => {
  it('completes Visium HD ROI selections and loads bin-size ROI genes', async () => {
    const matrix = vi.fn(async () => ({
      geneNames: ['A2M', 'GAD1'],
      cells: new Map([['s_008um_1_1', { geneNames: ['A2M', 'GAD1'], counts: [7, 2] }]]),
    }))
    const getSpatialDataset = vi.fn(async () => ({
      matrix,
    })) as unknown as SpatialDatasetLoader

    render(
      <Probe
        getSpatialDataset={getSpatialDataset}
        roiName="   "
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      api.handleVisiumHdRoiComplete(selection)
    })

    expect(snapshot.roiMode).toBe('idle')
    expect(snapshot.roiName).toBe('ROI 1')
    expect(snapshot.visiumHdRoiState).toMatchObject({
      status: 'ready',
      url: 'https://example.test/visium',
      binSizeMicrometers: 8,
      bins: [
        expect.objectContaining({
          barcode: 's_008um_1_1',
          center: { x: micrometers(5), y: micrometers(5) },
        }),
      ],
      hitBinLimit: false,
    })
    expect(snapshot.debugMessages).toContain('ROI box drawn: 1 Visium HD bins')

    await waitFor(() => {
      expect(snapshot.roiGeneStatsState.status).toBe('ready')
    })
    expect(matrix).toHaveBeenCalledWith(
      ['s_008um_1_1'],
      8,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(snapshot.roiGeneStatsState).toMatchObject({
      status: 'ready',
      stats: {
        genes: [
          expect.objectContaining({ gene: 'A2M', count: 7 }),
          expect.objectContaining({ gene: 'GAD1', count: 2 }),
        ],
        cellCount: 1,
        sampledCellCount: 1,
        totalCount: 9,
      },
    })
  })

  it('replays an initial shared ROI selection once the Visium HD dataset is ready', async () => {
    render(
      <Probe
        initialSharedSelection={selection}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    await waitFor(() => {
      expect(snapshot.visiumHdRoiState.status).toBe('ready')
    })

    expect(snapshot.initialSharedSelection).toBeNull()
    expect(snapshot.roiName).toBe('Shared ROI')
    expect(snapshot.visiumHdRoiState).toMatchObject({
      status: 'ready',
      bins: [expect.objectContaining({ barcode: 's_008um_1_1' })],
    })
    await waitFor(() => {
      expect(snapshot.roiGeneStatsState.status).toBe('ready')
    })
    void api
  })

  it('exports ready Visium HD ROI barcodes', async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const revokeObjectUrl = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined)

    render(
      <Probe
        initialVisiumHdRoiState={readyVisiumHdRoiState}
        roiName="Tumor ROI"
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      api.handleExportVisiumHdRoiBarcodes()
    })

    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob))
    await expect(
      (createObjectUrl.mock.calls[0]?.[0] as Blob | undefined)?.text(),
    ).resolves.toContain('s_008um_1_1')
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:test')
    expect(snapshot.debugMessages).toContain('Exported ROI barcodes Tumor ROI')
  })

  it('exports ready Visium HD ROI geometry as GeoJSON', async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const revokeObjectUrl = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined)

    render(
      <Probe
        initialVisiumHdRoiState={readyVisiumHdRoiState}
        roiName="Tumor ROI"
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      api.handleExportVisiumHdRoiGeoJson()
    })

    const blob = createObjectUrl.mock.calls[0]?.[0] as Blob | undefined
    const geoJson = JSON.parse((await blob?.text()) ?? '{}')

    expect(blob?.type).toBe('application/geo+json;charset=utf-8')
    expect(geoJson.features[0]).toMatchObject({
      properties: {
        roi_name: 'Tumor ROI',
        dataset_platform: 'visium_hd',
        dataset_url: 'https://example.test/visium',
        selected_barcode_count: 1,
        hit_barcode_limit: false,
        bin_size_um: 8,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [20, 0],
            [20, 20],
            [0, 20],
            [0, 0],
          ],
        ],
      },
    })
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:test')
    expect(snapshot.debugMessages).toContain('Exported ROI GeoJSON Tumor ROI')
  })

  it('clears only the Visium HD ROI state for Visium HD datasets', () => {
    const clearRoi = vi.fn()

    render(
      <Probe
        clearRoi={clearRoi}
        initialVisiumHdRoiState={readyVisiumHdRoiState}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      api.handleClearActiveRoi()
    })

    expect(clearRoi).not.toHaveBeenCalled()
    expect(snapshot.roiMode).toBe('idle')
    expect(snapshot.visiumHdRoiState).toEqual({ status: 'idle' })
    expect(snapshot.roiGeneStatsState).toEqual({ status: 'idle' })
    expect(snapshot.debugMessages).toContain('Cleared ROI')
  })

  it('delegates active ROI clearing to the Xenium workflow outside Visium HD', () => {
    const clearRoi = vi.fn()

    render(
      <Probe
        clearRoi={clearRoi}
        initialVisiumHdRoiState={readyVisiumHdRoiState}
        isVisiumHdDataset={false}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      api.handleClearActiveRoi()
    })

    expect(clearRoi).toHaveBeenCalledTimes(1)
    expect(snapshot.visiumHdRoiState).toBe(readyVisiumHdRoiState)
  })
})

function gridCellDatum(id: string, polygon: GridCellDatum['polygon']): GridCellDatum {
  return {
    id,
    gridId: 'visium-hd-8um',
    row: 1,
    col: 1,
    binSizeMicrometers: 8,
    polygon,
    fillColor: [0, 0, 0, 255],
    lineColor: [255, 255, 255, 255],
  }
}
