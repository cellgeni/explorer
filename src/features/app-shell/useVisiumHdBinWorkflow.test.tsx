import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { FlatMorphologyCanvasImage } from '../../components/MorphologyCanvas'
import { micrometers } from '../../data/coords'
import type {
  DatasetMeta,
  GridCellBatch,
  SpatialGrid,
} from '../../datasets/spatialDataset'
import type { VisiumHdBinnedOverview } from '../../datasets/visiumHdDataset'
import type { VisiumHdControlState } from '../dataset/visiumHdModel'
import {
  useVisiumHdBinWorkflow,
  type UseVisiumHdBinWorkflowResult,
} from './useVisiumHdBinWorkflow'

function Probe({
  state,
  getSpatialDataset,
  onReady,
  setFlatMorphologyImage,
  setLoadState,
  setMorphologyState,
  setSpatialGridCells,
  setVisiumHdControlState,
}: {
  readonly state: VisiumHdControlState
  readonly getSpatialDataset: Parameters<
    typeof useVisiumHdBinWorkflow
  >[0]['getSpatialDataset']
  readonly onReady: (nextApi: UseVisiumHdBinWorkflowResult) => void
  readonly setFlatMorphologyImage: Parameters<
    typeof useVisiumHdBinWorkflow
  >[0]['setFlatMorphologyImage']
  readonly setLoadState: Parameters<typeof useVisiumHdBinWorkflow>[0]['setLoadState']
  readonly setMorphologyState: Parameters<
    typeof useVisiumHdBinWorkflow
  >[0]['setMorphologyState']
  readonly setSpatialGridCells: Parameters<
    typeof useVisiumHdBinWorkflow
  >[0]['setSpatialGridCells']
  readonly setVisiumHdControlState: Parameters<
    typeof useVisiumHdBinWorkflow
  >[0]['setVisiumHdControlState']
}) {
  const api = useVisiumHdBinWorkflow({
    appendDebugEvent: vi.fn(),
    getSpatialDataset,
    loadedDatasetUrl: 'https://example.test/visium',
    shouldLoadMorphology: true,
    visiumHdControlState: state,
    setFlatMorphologyImage,
    setLoadState,
    setMorphologyState,
    setSpatialGridCells,
    setVisiumHdControlState,
  })

  useEffect(() => {
    onReady(api)
  }, [api, onReady])

  return null
}

describe('useVisiumHdBinWorkflow', () => {
  it('loads a selectable Visium HD bin tier and updates grid plus flat image state', async () => {
    const datasetUrl = 'https://example.test/visium'
    const grid = visiumGrid(8)
    const overview: VisiumHdBinnedOverview = {
      binSizeMicrometers: 8,
      scalefactors: {
        micronsPerPixel: 0.5,
        tissueHiresScale: 0.2,
        tissueLowresScale: 0.02,
      },
      grid,
      gridCells: gridCells(grid, 'BC-8'),
      fullresRows: new Float64Array([16]),
      fullresCols: new Float64Array([16]),
      inTissue: new Uint8Array([1]),
      sourcePaths: {
        tissuePositions: 'binned_outputs/square_008um/spatial/tissue_positions.parquet',
        scalefactors: 'binned_outputs/square_008um/spatial/scalefactors_json.json',
        tissueHiresImage: 'binned_outputs/square_008um/spatial/tissue_hires_image.png',
        tissueLowresImage: 'binned_outputs/square_008um/spatial/tissue_lowres_image.png',
        filteredMatrixH5: 'binned_outputs/square_008um/filtered_feature_bc_matrix.h5',
      },
    }
    const meta = visiumMeta(grid)
    const dataset = {
      annotations: vi.fn(async () => []),
      elements: vi.fn(async () => ({ elements: [] })),
      image: vi.fn(async () => ({
        kind: 'flat' as const,
        url: `${datasetUrl}/binned_outputs/square_008um/spatial/tissue_hires_image.png`,
        scaleFactor: 0.2,
        size: [200, 120] as const,
      })),
      matrix: vi.fn(async () => {
        throw new Error('unused')
      }),
      meta: vi.fn(async () => meta),
      readBinnedOverview: vi.fn(async () => overview),
    }
    const getSpatialDataset = vi.fn(async () => dataset)
    const setFlatMorphologyImage = vi.fn()
    const setLoadState = vi.fn()
    const setMorphologyState = vi.fn()
    const setSpatialGridCells = vi.fn()
    const setVisiumHdControlState = vi.fn()
    let api: UseVisiumHdBinWorkflowResult | null = null

    render(
      <Probe
        state={visiumControlState()}
        getSpatialDataset={getSpatialDataset}
        onReady={(nextApi) => {
          api = nextApi
        }}
        setFlatMorphologyImage={setFlatMorphologyImage}
        setLoadState={setLoadState}
        setMorphologyState={setMorphologyState}
        setSpatialGridCells={setSpatialGridCells}
        setVisiumHdControlState={setVisiumHdControlState}
      />,
    )

    await act(async () => {
      await api?.handleVisiumHdBinSizeChange(8)
    })

    expect(getSpatialDataset).toHaveBeenCalledWith(datasetUrl)
    expect(dataset.readBinnedOverview).toHaveBeenCalledWith(8)
    expect(dataset.meta).toHaveBeenCalledWith(8)
    expect(dataset.image).toHaveBeenCalledWith(8)
    expect(setLoadState).toHaveBeenCalledWith({
      status: 'ready',
      url: datasetUrl,
      cellCount: 1,
    })
    expect(setSpatialGridCells).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'BC-8', gridId: grid.id, row: 0, col: 0 }),
    ])
    expect(setFlatMorphologyImage).toHaveBeenCalledWith({
      url: `${datasetUrl}/binned_outputs/square_008um/spatial/tissue_hires_image.png`,
      size: [200, 120],
      scaleFactor: 0.2,
      micrometersPerPixel: micrometers(0.5),
    } satisfies FlatMorphologyCanvasImage)
    expect(setVisiumHdControlState).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ready',
        selectedBinSize: 8,
        binCount: 1,
      }),
    )
  })

  it('ignores disabled Visium HD tiers', async () => {
    let api: UseVisiumHdBinWorkflowResult | null = null
    const getSpatialDataset = vi.fn(async () => {
      throw new Error('unused')
    })

    render(
      <Probe
        state={visiumControlState()}
        getSpatialDataset={getSpatialDataset}
        onReady={(nextApi) => {
          api = nextApi
        }}
        setFlatMorphologyImage={vi.fn()}
        setLoadState={vi.fn()}
        setMorphologyState={vi.fn()}
        setSpatialGridCells={vi.fn()}
        setVisiumHdControlState={vi.fn()}
      />,
    )

    await act(async () => {
      await api?.handleVisiumHdBinSizeChange(2)
    })

    expect(getSpatialDataset).not.toHaveBeenCalled()
  })
})

function visiumControlState(): VisiumHdControlState {
  return {
    status: 'ready',
    url: 'https://example.test/visium',
    selectedBinSize: 16,
    options: [
      { size: 16, available: true, disabled: false, binCount: 54_504 },
      { size: 8, available: true, disabled: false },
      {
        size: 2,
        available: true,
        disabled: true,
        reason: '2 µm is disabled until budgeted loading is implemented.',
      },
    ],
    binCount: 54_504,
  }
}

function visiumGrid(binSizeMicrometers: 8 | 16): SpatialGrid {
  return {
    id: `visium-hd-square-${binSizeMicrometers.toString().padStart(3, '0')}um`,
    binSizeMicrometers: micrometers(binSizeMicrometers),
    basis: {
      origin: { x: micrometers(4), y: micrometers(4) },
      rowStep: { x: micrometers(0), y: micrometers(binSizeMicrometers) },
      colStep: { x: micrometers(binSizeMicrometers), y: micrometers(0) },
    },
    bounds: { minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 },
  }
}

function gridCells(grid: SpatialGrid, id: string): GridCellBatch {
  return {
    kind: 'grid-cells',
    gridId: grid.id,
    ids: [id],
    rows: new Int32Array([0]),
    cols: new Int32Array([0]),
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
      maxX: micrometers(8),
      minY: micrometers(0),
      maxY: micrometers(8),
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
