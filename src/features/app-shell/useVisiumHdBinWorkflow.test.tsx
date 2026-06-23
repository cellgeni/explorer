import { act, render, waitFor } from '@testing-library/react'
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
  flatMorphologyImage,
  setFlatMorphologyImage,
  setGeneExpressionBatch,
  setGeneExpressionScaleDomain,
  setGeneExpressionState,
  setGenePanelState,
  setLoadState,
  setMorphologyState,
  setSelectedGridCell,
  setSpatialGridCells,
  setVisiumHdControlState,
}: {
  readonly state: VisiumHdControlState
  readonly getSpatialDataset: Parameters<
    typeof useVisiumHdBinWorkflow
  >[0]['getSpatialDataset']
  readonly onReady: (nextApi: UseVisiumHdBinWorkflowResult) => void
  readonly flatMorphologyImage?: Parameters<
    typeof useVisiumHdBinWorkflow
  >[0]['flatMorphologyImage']
  readonly setFlatMorphologyImage: Parameters<
    typeof useVisiumHdBinWorkflow
  >[0]['setFlatMorphologyImage']
  readonly setGeneExpressionBatch?: Parameters<
    typeof useVisiumHdBinWorkflow
  >[0]['setGeneExpressionBatch']
  readonly setGeneExpressionScaleDomain?: Parameters<
    typeof useVisiumHdBinWorkflow
  >[0]['setGeneExpressionScaleDomain']
  readonly setGeneExpressionState?: Parameters<
    typeof useVisiumHdBinWorkflow
  >[0]['setGeneExpressionState']
  readonly setGenePanelState: Parameters<
    typeof useVisiumHdBinWorkflow
  >[0]['setGenePanelState']
  readonly setLoadState: Parameters<typeof useVisiumHdBinWorkflow>[0]['setLoadState']
  readonly setMorphologyState: Parameters<
    typeof useVisiumHdBinWorkflow
  >[0]['setMorphologyState']
  readonly setSelectedGridCell: Parameters<
    typeof useVisiumHdBinWorkflow
  >[0]['setSelectedGridCell']
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
    flatMorphologyImage,
    setFlatMorphologyImage,
    setGeneExpressionBatch,
    setGeneExpressionScaleDomain,
    setGeneExpressionState,
    setGenePanelState,
    setLoadState,
    setMorphologyState,
    setSelectedGridCell,
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
      genePanel: vi.fn(async () => ['Actb']),
      meta: vi.fn(async () => meta),
      readBinnedOverview: vi.fn(async () => overview),
    }
    const getSpatialDataset = vi.fn(async () => dataset)
    const setFlatMorphologyImage = vi.fn()
    const setGenePanelState = vi.fn()
    const setLoadState = vi.fn()
    const setMorphologyState = vi.fn()
    const setSelectedGridCell = vi.fn()
    const setSpatialGridCells = vi.fn()
    const setVisiumHdControlState = vi.fn()
    let api: UseVisiumHdBinWorkflowResult | null = null

    render(
      <Probe
        state={visiumControlStateWithMissingTwoMicrometer()}
        getSpatialDataset={getSpatialDataset}
        onReady={(nextApi) => {
          api = nextApi
        }}
        setFlatMorphologyImage={setFlatMorphologyImage}
        setGenePanelState={setGenePanelState}
        setLoadState={setLoadState}
        setMorphologyState={setMorphologyState}
        setSelectedGridCell={setSelectedGridCell}
        setSpatialGridCells={setSpatialGridCells}
        setVisiumHdControlState={setVisiumHdControlState}
      />,
    )

    await act(async () => {
      await api?.handleVisiumHdBinSizeChange(8)
    })

    expect(getSpatialDataset).toHaveBeenCalledWith(datasetUrl)
    expect(dataset.genePanel).toHaveBeenCalledWith(8)
    expect(dataset.readBinnedOverview).toHaveBeenCalledWith(8)
    expect(dataset.meta).toHaveBeenCalledWith(8)
    expect(dataset.image).toHaveBeenCalledWith(8)
    expect(setSelectedGridCell).toHaveBeenCalledWith(null)
    expect(setLoadState).toHaveBeenCalledWith({
      status: 'ready',
      url: datasetUrl,
      cellCount: 1,
    })
    expect(setGenePanelState).toHaveBeenCalledWith({
      status: 'loading',
      url: datasetUrl,
    })
    await waitFor(() => {
      expect(setGenePanelState).toHaveBeenCalledWith({
        status: 'ready',
        url: datasetUrl,
        genes: ['Actb'],
      })
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

  it('clears selected-gene expression state when switching bin tiers', async () => {
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
    const dataset = {
      annotations: vi.fn(async () => []),
      elements: vi.fn(async () => ({ elements: [] })),
      image: vi.fn(async () => null),
      matrix: vi.fn(async () => {
        throw new Error('unused')
      }),
      genePanel: vi.fn(async () => ['Actb']),
      meta: vi.fn(async () => visiumMeta(grid)),
      readBinnedOverview: vi.fn(async () => overview),
    }
    const setGeneExpressionBatch = vi.fn()
    const setGeneExpressionScaleDomain = vi.fn()
    const setGeneExpressionState = vi.fn()
    let api: UseVisiumHdBinWorkflowResult | null = null

    render(
      <Probe
        state={visiumControlState()}
        getSpatialDataset={vi.fn(async () => dataset)}
        onReady={(nextApi) => {
          api = nextApi
        }}
        setFlatMorphologyImage={vi.fn()}
        setGeneExpressionBatch={setGeneExpressionBatch}
        setGeneExpressionScaleDomain={setGeneExpressionScaleDomain}
        setGeneExpressionState={setGeneExpressionState}
        setGenePanelState={vi.fn()}
        setLoadState={vi.fn()}
        setMorphologyState={vi.fn()}
        setSelectedGridCell={vi.fn()}
        setSpatialGridCells={vi.fn()}
        setVisiumHdControlState={vi.fn()}
      />,
    )

    await act(async () => {
      await api?.handleVisiumHdBinSizeChange(8)
    })

    expect(setGeneExpressionBatch).toHaveBeenCalledWith(null)
    expect(setGeneExpressionScaleDomain).toHaveBeenCalledWith({ key: '', max: 0 })
    expect(setGeneExpressionState).toHaveBeenCalledWith({ status: 'idle' })
  })

  it('keeps the loaded Visium HD tissue image when switching bin tiers', async () => {
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
    const existingFlatImage: FlatMorphologyCanvasImage = {
      url: `${datasetUrl}/binned_outputs/square_016um/spatial/tissue_hires_image.png`,
      scaleFactor: 0.2,
      micrometersPerPixel: micrometers(0.5),
      size: [200, 120],
    }
    const dataset = {
      annotations: vi.fn(async () => []),
      elements: vi.fn(async () => ({ elements: [] })),
      image: vi.fn(async () => {
        throw new Error('unused')
      }),
      matrix: vi.fn(async () => {
        throw new Error('unused')
      }),
      genePanel: vi.fn(async () => ['Actb']),
      meta: vi.fn(async () => visiumMeta(grid)),
      readBinnedOverview: vi.fn(async () => overview),
    }
    const setFlatMorphologyImage = vi.fn()
    const setMorphologyState = vi.fn()
    let api: UseVisiumHdBinWorkflowResult | null = null

    render(
      <Probe
        state={visiumControlState()}
        getSpatialDataset={vi.fn(async () => dataset)}
        onReady={(nextApi) => {
          api = nextApi
        }}
        flatMorphologyImage={existingFlatImage}
        setFlatMorphologyImage={setFlatMorphologyImage}
        setGenePanelState={vi.fn()}
        setLoadState={vi.fn()}
        setMorphologyState={setMorphologyState}
        setSelectedGridCell={vi.fn()}
        setSpatialGridCells={vi.fn()}
        setVisiumHdControlState={vi.fn()}
      />,
    )

    await act(async () => {
      await api?.handleVisiumHdBinSizeChange(8)
    })

    expect(dataset.image).not.toHaveBeenCalled()
    expect(setFlatMorphologyImage).not.toHaveBeenCalled()
    expect(setMorphologyState).toHaveBeenCalledWith({
      status: 'ready',
      url: existingFlatImage.url,
    })
  })

  it('ignores disabled Visium HD tiers', async () => {
    let api: UseVisiumHdBinWorkflowResult | null = null
    const getSpatialDataset = vi.fn(async () => {
      throw new Error('unused')
    })

    render(
      <Probe
        state={visiumControlStateWithMissingTwoMicrometer()}
        getSpatialDataset={getSpatialDataset}
        onReady={(nextApi) => {
          api = nextApi
        }}
        setFlatMorphologyImage={vi.fn()}
        setGenePanelState={vi.fn()}
        setLoadState={vi.fn()}
        setMorphologyState={vi.fn()}
        setSelectedGridCell={vi.fn()}
        setSpatialGridCells={vi.fn()}
        setVisiumHdControlState={vi.fn()}
      />,
    )

    await act(async () => {
      await api?.handleVisiumHdBinSizeChange(2)
    })

    expect(getSpatialDataset).not.toHaveBeenCalled()
  })

  it('loads a 2 µm tier without a configured budget', async () => {
    const datasetUrl = 'https://example.test/visium'
    const grid = visiumGrid(2)
    const overview: VisiumHdBinnedOverview = {
      binSizeMicrometers: 2,
      scalefactors: {
        micronsPerPixel: 0.5,
        tissueHiresScale: 0.2,
        tissueLowresScale: 0.02,
      },
      grid,
      gridCells: gridCells(grid, 's_002um_000001_000002-1'),
      fullresRows: new Float64Array([16]),
      fullresCols: new Float64Array([16]),
      inTissue: new Uint8Array([1]),
      sourcePaths: {
        tissuePositions: 'binned_outputs/square_002um/spatial/tissue_positions.parquet',
        scalefactors: 'binned_outputs/square_002um/spatial/scalefactors_json.json',
        tissueHiresImage: 'binned_outputs/square_002um/spatial/tissue_hires_image.png',
        tissueLowresImage: 'binned_outputs/square_002um/spatial/tissue_lowres_image.png',
        filteredMatrixH5: 'binned_outputs/square_002um/filtered_feature_bc_matrix.h5',
        filteredMatrixBarcodes:
          'binned_outputs/square_002um/filtered_feature_bc_matrix/barcodes.tsv.gz',
      },
    }
    const dataset = {
      annotations: vi.fn(async () => []),
      elements: vi.fn(async () => ({ elements: [] })),
      image: vi.fn(async () => null),
      matrix: vi.fn(async () => {
        throw new Error('unused')
      }),
      genePanel: vi.fn(async () => ['Actb']),
      meta: vi.fn(async () => visiumMeta(grid)),
      readBinnedOverview: vi.fn(async () => overview),
    }
    const getSpatialDataset = vi.fn(async () => dataset)
    let api: UseVisiumHdBinWorkflowResult | null = null

    render(
      <Probe
        state={visiumControlState()}
        getSpatialDataset={getSpatialDataset}
        onReady={(nextApi) => {
          api = nextApi
        }}
        setFlatMorphologyImage={vi.fn()}
        setGenePanelState={vi.fn()}
        setLoadState={vi.fn()}
        setMorphologyState={vi.fn()}
        setSelectedGridCell={vi.fn()}
        setSpatialGridCells={vi.fn()}
        setVisiumHdControlState={vi.fn()}
      />,
    )

    await act(async () => {
      await api?.handleVisiumHdBinSizeChange(2)
    })

    expect(getSpatialDataset).toHaveBeenCalledWith(datasetUrl)
    expect(dataset.genePanel).toHaveBeenCalledWith(2)
    expect(dataset.readBinnedOverview).toHaveBeenCalledWith(2)
    expect(dataset.meta).toHaveBeenCalledWith(2)
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
      { size: 2, available: true, disabled: false },
    ],
    binCount: 54_504,
  }
}

function visiumControlStateWithMissingTwoMicrometer(): VisiumHdControlState {
  return {
    status: 'ready',
    url: 'https://example.test/visium',
    selectedBinSize: 16,
    options: [
      { size: 16, available: true, disabled: false, binCount: 54_504 },
      { size: 8, available: true, disabled: false },
      {
        size: 2,
        available: false,
        disabled: true,
        reason: '2 µm binned output was not detected.',
      },
    ],
    binCount: 54_504,
  }
}

function visiumGrid(binSizeMicrometers: 2 | 8 | 16): SpatialGrid {
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
