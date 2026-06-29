import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ViewerViewportDetail } from '../../components/ViewerCore'
import { micrometers } from '../../data/coords'
import type {
  DatasetMeta,
  GridCellBatch,
  SpatialGrid,
} from '../../datasets/spatialDataset'
import type {
  VisiumHdBinnedOverview,
  VisiumHdBinSizeMicrometers,
} from '../../datasets/visiumHdDataset'
import type { GridCellDatum } from '../../rendering/deckLayers'
import type { VisiumHdControlState } from '../dataset/visiumHdModel'
import { useVisiumHdGridLodWorkflow } from './useVisiumHdGridLodWorkflow'

type WorkflowOptions = Parameters<typeof useVisiumHdGridLodWorkflow>[0]

function Probe({
  currentViewportDetail,
  getSpatialDataset,
  spatialGridCells,
  setLoadState,
  setSpatialGridCells,
  setVisiumHdControlState,
  visiumHdBinRequestIdRef = { current: 0 },
  visiumHdControlState = selectedTwoMicrometerState(),
}: {
  readonly currentViewportDetail: ViewerViewportDetail | null
  readonly getSpatialDataset: WorkflowOptions['loaders']['getSpatialDataset']
  readonly spatialGridCells: readonly GridCellDatum[]
  readonly setLoadState: WorkflowOptions['setters']['setLoadState']
  readonly setSpatialGridCells: WorkflowOptions['setters']['setSpatialGridCells']
  readonly setVisiumHdControlState: WorkflowOptions['setters']['setVisiumHdControlState']
  readonly visiumHdBinRequestIdRef?: WorkflowOptions['refs']['visiumHdBinRequestIdRef']
  readonly visiumHdControlState?: VisiumHdControlState
}) {
  useVisiumHdGridLodWorkflow({
    callbacks: { appendDebugEvent: vi.fn() },
    controls: { visiumHdControlState },
    data: {
      currentViewportDetail,
      loadedDatasetUrl: 'https://example.test/visium',
      spatialGridCells,
    },
    loaders: { getSpatialDataset },
    refs: { visiumHdBinRequestIdRef },
    setters: {
      setLoadState,
      setSpatialGridCells,
      setVisiumHdControlState,
    },
  })

  return null
}

describe('useVisiumHdGridLodWorkflow', () => {
  it('loads selected 2um grid cells once the viewport is close enough', async () => {
    const overview = visiumOverview(2, ['s_002um_000001_000002-1'])
    const dataset = visiumDataset(overview)
    const setLoadState = vi.fn()
    const setSpatialGridCells = vi.fn()
    const setVisiumHdControlState = vi.fn()

    render(
      <Probe
        currentViewportDetail={viewportDetail(3)}
        getSpatialDataset={vi.fn(async () => dataset)}
        spatialGridCells={[gridCellDatum(16)]}
        setLoadState={setLoadState}
        setSpatialGridCells={setSpatialGridCells}
        setVisiumHdControlState={setVisiumHdControlState}
      />,
    )

    await waitFor(() => {
      expect(dataset.readBinnedOverview).toHaveBeenCalledWith(2)
    })

    expect(setSpatialGridCells).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 's_002um_000001_000002-1',
        binSizeMicrometers: 2,
      }),
    ])
    expect(
      (setSpatialGridCells.mock.calls[0]?.[0] as readonly GridCellDatum[])[0]
        ?.renderLodSourceBinSizeMicrometers,
    ).toBeUndefined()
    expect(setLoadState).toHaveBeenCalledWith({
      status: 'ready',
      url: 'https://example.test/visium',
      cellCount: 1,
    })
    expect(setVisiumHdControlState).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ready',
        selectedBinSize: 2,
      }),
    )
    expect(setVisiumHdControlState.mock.calls[1]?.[0]).not.toHaveProperty('loadedBinSize')
  })

  it('restores a render-only 16um view when selected 2um is zoomed out', async () => {
    const overview = visiumOverview(16, ['s_016um_000001_000002-1'])
    const dataset = visiumDataset(overview)
    const setLoadState = vi.fn()
    const setSpatialGridCells = vi.fn()
    const setVisiumHdControlState = vi.fn()

    render(
      <Probe
        currentViewportDetail={viewportDetail(2.9)}
        getSpatialDataset={vi.fn(async () => dataset)}
        spatialGridCells={[gridCellDatum(2)]}
        setLoadState={setLoadState}
        setSpatialGridCells={setSpatialGridCells}
        setVisiumHdControlState={setVisiumHdControlState}
      />,
    )

    await waitFor(() => {
      expect(dataset.readBinnedOverview).toHaveBeenCalledWith(16)
    })

    expect(setSpatialGridCells).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 's_016um_000001_000002-1',
        binSizeMicrometers: 16,
        renderLodSourceBinSizeMicrometers: 2,
      }),
    ])
    expect(setVisiumHdControlState).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ready',
        selectedBinSize: 2,
        loadedBinSize: 16,
      }),
    )
  })
})

function selectedTwoMicrometerState(): VisiumHdControlState {
  return {
    status: 'ready',
    url: 'https://example.test/visium',
    selectedBinSize: 2,
    options: [
      { size: 16, available: true, disabled: false, binCount: 1 },
      { size: 8, available: true, disabled: false },
      { size: 2, available: true, disabled: false },
    ],
    binCount: 1,
  }
}

function visiumDataset(overview: VisiumHdBinnedOverview) {
  return {
    annotations: vi.fn(async () => []),
    elements: vi.fn(async () => ({ elements: [] })),
    image: vi.fn(async () => null),
    matrix: vi.fn(async () => {
      throw new Error('unused')
    }),
    meta: vi.fn(async () => visiumMeta(overview.grid)),
    readBinnedOverview: vi.fn(async () => overview),
  }
}

function visiumOverview(
  binSizeMicrometers: VisiumHdBinSizeMicrometers,
  ids: readonly string[],
): VisiumHdBinnedOverview {
  const grid = visiumGrid(binSizeMicrometers)

  return {
    binSizeMicrometers,
    scalefactors: {
      micronsPerPixel: 0.5,
      tissueHiresScale: 0.2,
      tissueLowresScale: 0.02,
    },
    grid,
    gridCells: gridCells(grid, ids),
    fullresRows: new Float64Array(ids.map(() => 16)),
    fullresCols: new Float64Array(ids.map(() => 16)),
    inTissue: new Uint8Array(ids.map(() => 1)),
    sourcePaths: {
      tissuePositions: `binned_outputs/square_${binSizeMicrometers.toString().padStart(3, '0')}um/spatial/tissue_positions.parquet`,
      scalefactors: `binned_outputs/square_${binSizeMicrometers.toString().padStart(3, '0')}um/spatial/scalefactors_json.json`,
      tissueHiresImage: `binned_outputs/square_${binSizeMicrometers.toString().padStart(3, '0')}um/spatial/tissue_hires_image.png`,
      tissueLowresImage: `binned_outputs/square_${binSizeMicrometers.toString().padStart(3, '0')}um/spatial/tissue_lowres_image.png`,
      filteredMatrixH5: `binned_outputs/square_${binSizeMicrometers.toString().padStart(3, '0')}um/filtered_feature_bc_matrix.h5`,
    },
  }
}

function visiumGrid(binSizeMicrometers: VisiumHdBinSizeMicrometers): SpatialGrid {
  return {
    id: `grid-${binSizeMicrometers}um`,
    binSizeMicrometers: micrometers(binSizeMicrometers),
    basis: {
      origin: { x: micrometers(8), y: micrometers(8) },
      rowStep: { x: micrometers(0), y: micrometers(binSizeMicrometers) },
      colStep: { x: micrometers(binSizeMicrometers), y: micrometers(0) },
    },
  }
}

function gridCells(grid: SpatialGrid, ids: readonly string[]): GridCellBatch<string> {
  return {
    kind: 'grid-cells',
    gridId: grid.id,
    ids,
    rows: new Int32Array(ids.map((_, index) => index)),
    cols: new Int32Array(ids.map((_, index) => index + 1)),
  }
}

function gridCellDatum(binSizeMicrometers: VisiumHdBinSizeMicrometers): GridCellDatum {
  return {
    id: `grid-cell-${binSizeMicrometers}`,
    gridId: `grid-${binSizeMicrometers}um`,
    row: 0,
    col: 0,
    binSizeMicrometers,
    polygon: [
      [0, 0, 0],
      [binSizeMicrometers, 0, 0],
      [binSizeMicrometers, -binSizeMicrometers, 0],
      [0, -binSizeMicrometers, 0],
    ],
    fillColor: [34, 120, 108, 28],
    lineColor: [22, 90, 82, 150],
  }
}

function visiumMeta(grid: SpatialGrid): DatasetMeta {
  return {
    platform: 'visium-hd',
    units: {
      dataUnit: 'micrometer',
      imageUnit: 'pixel',
      micrometersPerPixel: micrometers(0.5),
      origin: 'top-left',
      imageYAxis: 'down',
    },
    extent: {
      minX: micrometers(0),
      maxX: micrometers(100),
      minY: micrometers(0),
      maxY: micrometers(100),
    },
    capabilities: {
      transcripts: false,
      cellBoundaries: false,
      pyramidImage: false,
      multiChannel: false,
    },
    grids: [grid],
  }
}

function viewportDetail(zoom: number): ViewerViewportDetail {
  return {
    bbox: {
      minX: micrometers(0),
      maxX: micrometers(100),
      minY: micrometers(0),
      maxY: micrometers(100),
    },
    visibleCellCount: 1,
    viewState: {
      target: [0, 0, 0],
      zoom,
      minZoom: -8,
      maxZoom: 8,
    },
  }
}
