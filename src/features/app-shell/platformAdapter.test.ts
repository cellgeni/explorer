import { describe, expect, it, vi } from 'vitest'
import { asCellId } from '../../data/cellid'
import { micrometers } from '../../data/coords'
import type { RoiSelection } from '../../data/roiSelection'
import type { CellBoundaryDatum } from '../../rendering/deckLayers'
import type {
  BoundaryElementsLoader,
  GeneExpressionLoader,
  SpatialDatasetLoader,
} from './appDependencies'
import type { DatasetLoadState } from '../dataset/datasetLoadModel'
import type { VisiumHdControlState } from '../dataset/visiumHdModel'
import type { RoiState } from '../roi/roiModel'
import { IDLE_VISIUM_HD_ROI_STATE, type VisiumHdRoiState } from '../roi/visiumHdRoiModel'
import {
  activeVisiumHdRoiStateForPlatform,
  appPlatformAdapterFor,
  isVisiumHdPlatform,
  loadPlatformBoundaryElements,
  loadPlatformGeneExpression,
  loadPlatformNucleusBoundaryElements,
  platformActiveBoundaryCell,
  platformAnalysisEmbeddingOptions,
  platformBoundarySurfaceReserved,
  platformExpressionProfileSelection,
  platformRoiElementIds,
  platformRoiCompleteHandler,
  platformRoiSelection,
  platformSelectedEmbeddingElementId,
} from './platformAdapter'

const readyLoadState: DatasetLoadState = {
  status: 'ready',
  url: 'https://example.test/output',
  cellCount: 2,
}

const selection: RoiSelection = {
  kind: 'box',
  bbox: {
    minX: micrometers(0),
    maxX: micrometers(10),
    minY: micrometers(0),
    maxY: micrometers(10),
  },
}

const roiState: RoiState = {
  status: 'ready',
  url: readyLoadState.url,
  bbox: selection.bbox,
  selection,
  cells: [
    {
      id: asCellId('aaaaaaaa-1'),
      position: { x: micrometers(1), y: micrometers(1) },
      transcriptCount: 4,
    },
  ],
  hitCellLimit: false,
}

const visiumHdRoiState: VisiumHdRoiState = {
  status: 'ready',
  url: readyLoadState.url,
  binSizeMicrometers: 16,
  bbox: selection.bbox,
  selection,
  bins: [
    {
      barcode: 'bin-1',
      gridId: 'grid-16um',
      row: 1,
      col: 2,
      center: { x: micrometers(1), y: micrometers(1) },
      binSizeMicrometers: 16,
    },
  ],
  hitBinLimit: false,
}

const boundaryCell: CellBoundaryDatum = {
  id: 'cell-boundary-1',
  polygon: [],
  fillColor: [0, 0, 0, 255],
  lineColor: [255, 255, 255, 255],
}

describe('platformAdapter', () => {
  it('selects the active app platform from ready dataset state', () => {
    const idleVisium = appPlatformAdapterFor({ status: 'idle' }, 'visium-hd')
    const xenium = appPlatformAdapterFor(readyLoadState, 'xenium')
    const visiumHd = appPlatformAdapterFor(readyLoadState, 'visium-hd')

    expect(idleVisium.kind).toBe('xenium')
    expect(xenium.kind).toBe('xenium')
    expect(visiumHd.kind).toBe('visium-hd')
    expect(isVisiumHdPlatform(visiumHd)).toBe(true)
  })

  it('centralizes Xenium feature gates and labels', () => {
    const adapter = appPlatformAdapterFor(readyLoadState, 'xenium')
    const loadingControl: VisiumHdControlState = {
      status: 'loading',
      url: readyLoadState.url,
      selectedBinSize: 16,
      options: [],
    }

    expect(adapter.labels.embeddingElementPlural).toBe('cells')
    expect(adapter.capabilities).toMatchObject({
      annotations: true,
      magicLensMinQv: true,
      nucleusBoundaries: false,
      transcripts: true,
    })
    expect(adapter.featureLoadEnabled(readyLoadState)).toBe(true)
    expect(adapter.effectiveTranscriptOverlay(true)).toBe(true)
    expect(adapter.boundaryLoadingEnabled(false, true)).toBe(false)
    expect(adapter.boundaryOverlayRequestKey(true, true)).toBe('enabled:no-nucleus')
    expect(adapter.geneExpressionOverlayEnabled(25)).toBe(true)
    expect(adapter.cellBoundaryHoverEnabled(false)).toBe(false)
    expect(adapter.cellBoundaryHoverEnabled(true)).toBe(true)
    expect(adapter.magicLensAvailability(readyLoadState, 0)).toEqual({
      loadEnabled: true,
    })
    expect(
      adapter.canDrawRoi({
        isDatasetPreparationPending: true,
        loadState: readyLoadState,
        spatialGridCellCount: 0,
        visiumHdControlState: loadingControl,
      }),
    ).toBe(false)
  })

  it('centralizes Visium HD feature gates and labels', () => {
    const adapter = appPlatformAdapterFor(readyLoadState, 'visium-hd')
    const readyControl: VisiumHdControlState = {
      status: 'ready',
      url: readyLoadState.url,
      selectedBinSize: 16,
      options: [],
    }
    const loadingControl: VisiumHdControlState = {
      ...readyControl,
      status: 'loading',
    }

    expect(adapter.labels.embeddingElementPlural).toBe('bins')
    expect(adapter.capabilities).toMatchObject({
      annotations: false,
      magicLensMinQv: false,
      nucleusBoundaries: true,
      transcripts: false,
    })
    expect(adapter.featureLoadEnabled(readyLoadState)).toBe(false)
    expect(adapter.effectiveTranscriptOverlay(true)).toBe(false)
    expect(adapter.boundaryLoadingEnabled(false, true)).toBe(true)
    expect(adapter.boundaryOverlayRequestKey(false, true)).toBe('enabled:nucleus')
    expect(adapter.geneExpressionOverlayEnabled(25)).toBe(false)
    expect(adapter.cellBoundaryHoverEnabled(true)).toBe(true)
    expect(adapter.magicLensAvailability(readyLoadState, 0)).toEqual({
      loadEnabled: false,
      unavailableReason: 'Bins pending',
    })
    expect(adapter.magicLensAvailability(readyLoadState, 3)).toEqual({
      loadEnabled: true,
    })
    expect(
      adapter.canDrawRoi({
        isDatasetPreparationPending: false,
        loadState: readyLoadState,
        spatialGridCellCount: 3,
        visiumHdControlState: readyControl,
      }),
    ).toBe(true)
    expect(
      adapter.canDrawRoi({
        isDatasetPreparationPending: false,
        loadState: readyLoadState,
        spatialGridCellCount: 3,
        visiumHdControlState: loadingControl,
      }),
    ).toBe(false)
  })

  it('adapts ROI, embedding, and analysis-loading state by platform', () => {
    const xenium = appPlatformAdapterFor(readyLoadState, 'xenium')
    const visiumHd = appPlatformAdapterFor(readyLoadState, 'visium-hd')

    expect(
      activeVisiumHdRoiStateForPlatform({
        activeBinSize: 16,
        adapter: xenium,
        loadState: readyLoadState,
        state: visiumHdRoiState,
      }),
    ).toBe(IDLE_VISIUM_HD_ROI_STATE)
    expect(
      activeVisiumHdRoiStateForPlatform({
        activeBinSize: 16,
        adapter: visiumHd,
        loadState: readyLoadState,
        state: visiumHdRoiState,
      }),
    ).toBe(visiumHdRoiState)
    expect(
      activeVisiumHdRoiStateForPlatform({
        activeBinSize: 8,
        adapter: visiumHd,
        loadState: readyLoadState,
        state: visiumHdRoiState,
      }),
    ).toBe(IDLE_VISIUM_HD_ROI_STATE)
    expect(platformRoiElementIds(xenium, roiState, visiumHdRoiState)).toEqual([
      'aaaaaaaa-1',
    ])
    expect(platformRoiElementIds(visiumHd, roiState, visiumHdRoiState)).toEqual(['bin-1'])
    expect(platformRoiSelection(xenium, roiState, visiumHdRoiState)).toBe(selection)
    expect(platformRoiSelection(visiumHd, roiState, visiumHdRoiState)).toBe(selection)
    expect(
      platformSelectedEmbeddingElementId(xenium, { id: 'aaaaaaaa-1' }, { id: 'bin-1' }),
    ).toBe('aaaaaaaa-1')
    expect(
      platformSelectedEmbeddingElementId(visiumHd, { id: 'cell-1' }, { id: 'bin-1' }),
    ).toBe('bin-1')
    expect(platformAnalysisEmbeddingOptions(xenium, 16)).toEqual({})
    expect(platformAnalysisEmbeddingOptions(visiumHd, 16)).toEqual({
      visiumHdBinSizeMicrometers: 16,
    })
  })

  it('adapts derived viewer selections and surface policy by platform', () => {
    const xenium = appPlatformAdapterFor(readyLoadState, 'xenium')
    const visiumHd = appPlatformAdapterFor(readyLoadState, 'visium-hd')
    const handlers = {
      xenium: () => 'xenium',
      visiumHd: () => 'visium-hd',
    }

    expect(
      platformBoundarySurfaceReserved(visiumHd, {
        boundaryState: { status: 'loading', url: readyLoadState.url },
        expressionBoundaryCount: 0,
        showCellBoundaries: true,
      }),
    ).toBe(true)
    expect(
      platformBoundarySurfaceReserved(visiumHd, {
        boundaryState: { status: 'ready', url: readyLoadState.url, cellCount: 1 },
        expressionBoundaryCount: 1,
        showCellBoundaries: true,
      }),
    ).toBe(false)
    expect(
      platformBoundarySurfaceReserved(xenium, {
        boundaryState: { status: 'loading', url: readyLoadState.url },
        expressionBoundaryCount: 1,
        showCellBoundaries: true,
      }),
    ).toBe(false)
    expect(platformActiveBoundaryCell(xenium, boundaryCell, [boundaryCell])).toBeNull()
    expect(platformActiveBoundaryCell(visiumHd, boundaryCell, [boundaryCell])).toBe(
      boundaryCell,
    )
    expect(
      platformExpressionProfileSelection(visiumHd, boundaryCell, { id: 'bin-1' }),
    ).toEqual({ id: 'cell-boundary-1', kind: 'cell' })
    expect(platformExpressionProfileSelection(visiumHd, null, { id: 'bin-1' })).toEqual({
      id: 'bin-1',
      kind: 'bin',
    })
    expect(
      platformExpressionProfileSelection(xenium, boundaryCell, { id: 'bin-1' }),
    ).toBeNull()
    expect(platformRoiCompleteHandler(xenium, handlers)()).toBe('xenium')
    expect(platformRoiCompleteHandler(visiumHd, handlers)()).toBe('visium-hd')
  })

  it('delegates Xenium loaders to the standard app dependencies', async () => {
    const adapter = appPlatformAdapterFor(readyLoadState, 'xenium')
    const boundaryBatch = { elements: [] }
    const expressionBatch = {
      elements: [],
      genes: ['Actb'],
      maxCount: 0,
    }
    const loadBoundaryElements = vi.fn(async () => boundaryBatch)
    const loadGeneExpression = vi.fn(async () => expressionBatch)
    const getSpatialDataset = vi.fn()

    await expect(
      loadPlatformBoundaryElements(
        adapter,
        {
          getSpatialDataset: getSpatialDataset as unknown as SpatialDatasetLoader,
          loadBoundaryElements: loadBoundaryElements as BoundaryElementsLoader,
        },
        readyLoadState.url,
        selection.bbox,
      ),
    ).resolves.toBe(boundaryBatch)
    expect(loadBoundaryElements).toHaveBeenCalledWith(
      readyLoadState.url,
      selection.bbox,
      {},
    )
    expect(getSpatialDataset).not.toHaveBeenCalled()

    await expect(
      loadPlatformGeneExpression(
        adapter,
        {
          activeBinSize: undefined,
          getSpatialDataset: getSpatialDataset as unknown as SpatialDatasetLoader,
          loadGeneExpression: loadGeneExpression as GeneExpressionLoader,
        },
        readyLoadState.url,
        selection.bbox,
        ['Actb'],
      ),
    ).resolves.toBe(expressionBatch)
    expect(loadGeneExpression).toHaveBeenCalledWith(
      readyLoadState.url,
      selection.bbox,
      ['Actb'],
      {},
    )
  })

  it('loads Visium HD boundary, nucleus, and expression data through dataset capabilities', async () => {
    const adapter = appPlatformAdapterFor(readyLoadState, 'visium-hd')
    const elements = [{ id: 'cell-1', geometry: { kind: 'polygon' as const, rings: [] } }]
    const nuclei = [
      { id: 'nucleus-1', geometry: { kind: 'polygon' as const, rings: [] } },
    ]
    const expressionBatch = {
      elements: [],
      genes: ['Actb'],
      maxCount: 0,
    }
    const dataset = {
      meta: vi.fn(async () => ({
        capabilities: { cellBoundaries: true },
        segmentations: [{ kind: 'nucleus' }],
      })),
      elements: vi.fn(async () => ({ elements })),
      segmentationElements: vi.fn(async () => nuclei),
      geneExpression: vi.fn(async () => expressionBatch),
    }
    const getSpatialDataset = vi.fn(async () => dataset)
    const loadBoundaryElements = vi.fn()
    const loadGeneExpression = vi.fn()

    await expect(
      loadPlatformBoundaryElements(
        adapter,
        {
          getSpatialDataset: getSpatialDataset as unknown as SpatialDatasetLoader,
          loadBoundaryElements: loadBoundaryElements as BoundaryElementsLoader,
        },
        readyLoadState.url,
        selection.bbox,
      ),
    ).resolves.toEqual({ elements })
    expect(loadBoundaryElements).not.toHaveBeenCalled()
    expect(dataset.elements).toHaveBeenCalledWith(selection.bbox)

    await expect(
      loadPlatformNucleusBoundaryElements(
        adapter,
        { getSpatialDataset: getSpatialDataset as unknown as SpatialDatasetLoader },
        readyLoadState.url,
        selection.bbox,
      ),
    ).resolves.toEqual({ elements: nuclei })
    expect(dataset.segmentationElements).toHaveBeenCalledWith('nucleus', selection.bbox)

    await expect(
      loadPlatformGeneExpression(
        adapter,
        {
          activeBinSize: 16,
          getSpatialDataset: getSpatialDataset as unknown as SpatialDatasetLoader,
          loadGeneExpression: loadGeneExpression as GeneExpressionLoader,
        },
        readyLoadState.url,
        selection.bbox,
        ['Actb'],
      ),
    ).resolves.toBe(expressionBatch)
    expect(loadGeneExpression).not.toHaveBeenCalled()
    expect(dataset.geneExpression).toHaveBeenCalledWith(selection.bbox, ['Actb'], {
      binSizeMicrometers: 16,
    })
  })

  it('returns empty Visium HD overlays when boundary capabilities are absent', async () => {
    const adapter = appPlatformAdapterFor(readyLoadState, 'visium-hd')
    const dataset = {
      meta: vi.fn(async () => ({
        capabilities: { cellBoundaries: false },
        segmentations: [],
      })),
      elements: vi.fn(),
    }
    const getSpatialDataset = vi.fn(async () => dataset)

    await expect(
      loadPlatformBoundaryElements(
        adapter,
        {
          getSpatialDataset: getSpatialDataset as unknown as SpatialDatasetLoader,
          loadBoundaryElements: vi.fn() as BoundaryElementsLoader,
        },
        readyLoadState.url,
        selection.bbox,
      ),
    ).resolves.toEqual({ elements: [] })
    expect(dataset.elements).not.toHaveBeenCalled()

    await expect(
      loadPlatformNucleusBoundaryElements(
        adapter,
        { getSpatialDataset: getSpatialDataset as unknown as SpatialDatasetLoader },
        readyLoadState.url,
        selection.bbox,
      ),
    ).resolves.toEqual({ elements: [] })
  })
})
