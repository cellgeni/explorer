import { describe, expect, it, vi } from 'vitest'
import { micrometers } from '../../data/coords'
import type { GexResult } from '../../data/gexTypes'
import type { RoiSelection } from '../../data/roiSelection'
import type { GeneExpressionBatch } from '../../datasets/spatialDataset'
import {
  gridCellColumnsFixture,
  squareGridBasis,
} from '../../test/gridCellColumnsFixture'
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

// Two bins in the lens and one far outside it, as 10 µm squares.
const gridCells = gridCellColumnsFixture(
  [
    { id: 's_008um_1_1', row: 0, col: 0 },
    { id: 's_008um_1_2', row: 0, col: 2 },
    { id: 'outside', row: 8, col: 8 },
  ],
  { binSizeMicrometers: 8, basis: squareGridBasis(10) },
)

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
        visiumHdBinSizeMicrometers: 8,
      },
    )
    expect(summary).toMatchObject({
      kind: 'expression',
      transcriptCount: 7,
      cellCount: 1,
      selectedGeneTranscriptCount: 7,
    })
  })

  it('reads the drawn tier when it stands in for the selected size', async () => {
    // 2 µm selected, zoomed out: the lens is over the 8 µm bins drawn instead.
    const signal = new AbortController().signal
    const matrix = vi.fn(async () =>
      matrixResult(['s_008um_1_1', 's_008um_1_2'], ['VIM', 'DCN'], [6, 4]),
    )
    const loadGeneExpression = vi.fn(async () =>
      geneExpressionBatch(['s_008um_1_1', 's_008um_1_2'], ['VIM'], [6, 4]),
    )
    const options = (selectedGenes: readonly string[]) => ({
      baseUrl: 'https://example.test/ready',
      controls: { selectedBinSize: 2 as const },
      data: {
        currentViewportDetail: null,
        geneExpressionBatch: null,
        gridCells,
        readyDatasetUrl: 'https://example.test/ready',
        selectedGenes,
      },
      loaders: {
        getSpatialDataset: vi.fn(async () => ({
          matrix,
        })) as unknown as SpatialDatasetLoader,
        loadGeneExpression,
      },
      loaderOptions: { signal, scope: 'roi' as const, circleFilter: null },
      selection,
    })

    await expect(summarizeVisiumHdMagicLensSelection(options([]))).resolves.toMatchObject(
      {
        transcriptCount: 20,
      },
    )
    expect(matrix).toHaveBeenCalledWith(['s_008um_1_1', 's_008um_1_2'], 8, { signal })

    await expect(
      summarizeVisiumHdMagicLensSelection(options(['VIM'])),
    ).resolves.toMatchObject({ transcriptCount: 10 })
    expect(loadGeneExpression).toHaveBeenCalledWith(
      'https://example.test/ready',
      selection.bbox,
      ['VIM'],
      expect.objectContaining({ visiumHdBinSizeMicrometers: 8 }),
    )
  })
})

describe('summarizeVisiumHdMagicLensSelection over a lasso', () => {
  // A thin lasso along the diagonal holds two bins, but its box is large.
  function lasso(size: number): RoiSelection {
    return {
      kind: 'lasso',
      bbox: {
        minX: micrometers(0),
        minY: micrometers(0),
        maxX: micrometers(size),
        maxY: micrometers(size),
      },
      points: [
        { x: micrometers(0), y: micrometers(0) },
        { x: micrometers(size), y: micrometers(size) },
        { x: micrometers(size - 1), y: micrometers(size) },
        { x: micrometers(0), y: micrometers(1) },
      ],
    }
  }

  async function summarize(selection: RoiSelection) {
    const limits: (number | undefined)[] = []
    const loadGeneExpression = vi.fn(
      async (
        _url: string,
        _bbox: unknown,
        _genes: readonly string[],
        options?: { readonly limit?: number },
      ) => {
        limits.push(options?.limit)
        return geneExpressionBatch(['s_008um_1_1'], ['DCN'], [7])
      },
    )
    const summary = await summarizeVisiumHdMagicLensSelection({
      baseUrl: 'https://example.test/visium',
      controls: { selectedBinSize: 8 },
      data: {
        currentViewportDetail: null,
        geneExpressionBatch: null,
        gridCells,
        readyDatasetUrl: null,
        selectedGenes: ['DCN'],
      },
      loaders: { getSpatialDataset: vi.fn(), loadGeneExpression },
      loaderOptions: {
        signal: new AbortController().signal,
        scope: 'roi',
        circleFilter: null,
      },
      selection,
    })

    return { summary, limit: limits[0] }
  }

  it('reads every bin of the box, not the first 25,000', async () => {
    // 1,600 µm of 8 µm bins: up to (200 + 2)² bins meet the box.
    const { summary, limit } = await summarize(lasso(1_600))

    expect(limit).toBe(202 * 202)
    expect(summary).toMatchObject({ cellCount: 2, hitLimit: false })
  })

  it('says the summary may be incomplete past the box cap', async () => {
    const { summary, limit } = await summarize(lasso(8_000))

    expect(limit).toBe(200_000)
    expect(summary).toMatchObject({ hitLimit: true })
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
    population: 'all',
    geneCounts: genes.length === 1 ? [{ gene: genes[0] ?? '', count: sum(counts) }] : [],
    maxCount: Math.max(0, ...counts),
  }
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
