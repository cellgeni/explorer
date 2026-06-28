import { describe, expect, it, vi } from 'vitest'
import { micrometers } from '../../data/coords'
import type { GexResult } from '../../data/gexTypes'
import type { RoiSelection } from '../../data/roiSelection'
import type { GeneExpressionBatch } from '../../datasets/xeniumDataset'
import type { GridCellDatum } from '../../rendering/deckLayers'
import type { SpatialDatasetLoader } from '../app-shell/appDependencies'
import { summarizeVisiumHdMagicLensSelection } from './useVisiumHdMagicLensSummary'

const selection: RoiSelection = {
  kind: 'box',
  bbox: {
    minX: micrometers(0),
    minY: micrometers(0),
    maxX: micrometers(30),
    maxY: micrometers(30),
  },
}

const gridCells: readonly GridCellDatum[] = [
  gridCellDatum('s_008um_1_1', [
    [0, 0, 0],
    [10, 0, 0],
    [10, -10, 0],
    [0, -10, 0],
  ]),
  gridCellDatum('s_008um_1_2', [
    [20, 0, 0],
    [30, 0, 0],
    [30, -10, 0],
    [20, -10, 0],
  ]),
  gridCellDatum('outside', [
    [80, -80, 0],
    [90, -80, 0],
    [90, -90, 0],
    [80, -90, 0],
  ]),
]

describe('summarizeVisiumHdMagicLensSelection', () => {
  it('loads Visium HD expression profiles when no genes are selected', async () => {
    const signal = new AbortController().signal
    const matrix = vi.fn(async () =>
      matrixResult(['s_008um_1_1', 's_008um_1_2'], ['VIM', 'DCN'], [6, 4]),
    )
    const getSpatialDataset = vi.fn(async () => ({ matrix }))
    const loadGeneExpression = vi.fn()

    const summary = await summarizeVisiumHdMagicLensSelection({
      baseUrl: 'https://example.test/fallback',
      controls: { selectedBinSize: 8 },
      data: {
        currentViewportDetail: null,
        geneExpressionBatch: null,
        gridCells,
        readyDatasetUrl: 'https://example.test/ready',
        selectedGenes: [],
      },
      loaders: {
        getSpatialDataset: getSpatialDataset as unknown as SpatialDatasetLoader,
        loadGeneExpression,
      },
      loaderOptions: {
        signal,
        scope: 'roi',
        circleFilter: null,
      },
      selection,
    })

    expect(getSpatialDataset).toHaveBeenCalledWith('https://example.test/ready')
    expect(matrix).toHaveBeenCalledWith(['s_008um_1_1', 's_008um_1_2'], 8, {
      signal,
    })
    expect(loadGeneExpression).not.toHaveBeenCalled()
    expect(summary).toMatchObject({
      kind: 'expression',
      transcriptCount: 20,
      cellCount: 2,
      geneCount: 2,
      selectedGeneTranscriptCount: 0,
      hitLimit: false,
    })
    expect(summary.topGenes.map((gene) => gene.gene)).toEqual(['VIM', 'DCN'])
  })

  it('reuses the viewport expression batch for matching selected-gene scans', async () => {
    const loadGeneExpression = vi.fn()
    const summary = await summarizeVisiumHdMagicLensSelection({
      baseUrl: 'https://example.test/visium',
      controls: { selectedBinSize: 8 },
      data: {
        currentViewportDetail: {
          bbox: selection.bbox,
          visibleCellCount: 2,
          viewState: {
            target: [0, 0, 0],
            zoom: 0,
            minZoom: -8,
            maxZoom: 8,
          },
        },
        geneExpressionBatch: geneExpressionBatch(
          ['s_008um_1_1', 'outside'],
          ['VIM'],
          [12, 5],
        ),
        gridCells,
        readyDatasetUrl: 'https://example.test/ready',
        selectedGenes: ['vim'],
      },
      loaders: {
        getSpatialDataset: vi.fn(),
        loadGeneExpression,
      },
      loaderOptions: {
        signal: new AbortController().signal,
        scope: 'viewport',
        circleFilter: null,
      },
      selection,
    })

    expect(loadGeneExpression).not.toHaveBeenCalled()
    expect(summary).toMatchObject({
      kind: 'expression',
      transcriptCount: 12,
      cellCount: 2,
      selectedGeneTranscriptCount: 12,
    })
    expect(summary.topGenes).toEqual([
      {
        gene: 'VIM',
        count: 12,
        percentTotal: 100,
        selected: true,
      },
    ])
  })

  it('loads selected-gene expression when viewport data cannot be reused', async () => {
    const signal = new AbortController().signal
    const loadGeneExpression = vi.fn(async () =>
      geneExpressionBatch(['s_008um_1_1', 's_008um_1_2'], ['DCN'], [7, 11]),
    )

    const summary = await summarizeVisiumHdMagicLensSelection({
      baseUrl: 'https://example.test/fallback',
      controls: { selectedBinSize: 8 },
      data: {
        currentViewportDetail: null,
        geneExpressionBatch: null,
        gridCells,
        readyDatasetUrl: null,
        selectedGenes: ['DCN'],
      },
      loaders: {
        getSpatialDataset: vi.fn(),
        loadGeneExpression,
      },
      loaderOptions: {
        signal,
        scope: 'roi',
        circleFilter: {
          center: { x: micrometers(5), y: micrometers(5) },
          radiusMicrometers: 6,
        },
      },
      selection,
    })

    expect(loadGeneExpression).toHaveBeenCalledWith(
      'https://example.test/fallback',
      selection.bbox,
      ['DCN'],
      {
        limit: 25_000,
        signal,
      },
    )
    expect(summary).toMatchObject({
      kind: 'expression',
      transcriptCount: 7,
      cellCount: 1,
      selectedGeneTranscriptCount: 7,
    })
  })
})

function matrixResult(
  ids: readonly string[],
  genes: readonly string[],
  counts: readonly number[],
): GexResult<string> {
  return {
    geneNames: genes,
    cells: new Map(
      ids.map((id) => [
        id,
        {
          geneNames: genes,
          counts,
        },
      ]),
    ),
  }
}

function geneExpressionBatch(
  ids: readonly string[],
  genes: readonly string[],
  counts: readonly number[],
): GeneExpressionBatch {
  const elements = ids.map((id, index) => ({
    id,
    position: { x: micrometers(index * 20 + 5), y: micrometers(5) },
    count: counts[index] ?? 0,
  }))

  return {
    elements,
    genes,
    geneCounts: genes.length === 1 ? [{ gene: genes[0] ?? '', count: sum(counts) }] : [],
    maxCount: Math.max(0, ...counts),
  }
}

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

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
