import { describe, expect, it, vi } from 'vitest'
import type { CellTranscriptZDistribution } from '../../data/cellTranscripts'
import { micrometers } from '../../data/coords'
import type { RoiGeneStats } from '../../data/roiGeneStats'
import type { SpatialElement } from '../../datasets/spatialDataset'
import type { OverviewCellDatum } from '../../rendering/deckLayers'
import {
  IDLE_CELL_DETAIL_STATE,
  IDLE_CELL_TRANSCRIPT_DISTRIBUTION_STATE,
  cellDetailFailed,
  cellDetailLoading,
  cellDetailReady,
  cellDetailStatusCopy,
  cellExpressionSummaryFromStats,
  cellTranscriptDistributionFailed,
  cellTranscriptDistributionLoading,
  cellTranscriptDistributionReady,
  loadSelectedCellBoundary,
  overviewCellToDatasetCell,
  overviewCellsToBbox,
  selectedCellBoundaryBbox,
  summarizeCellShape,
} from './cellDetailModel'

const cell: OverviewCellDatum = {
  id: 'aaaaaaaa-1',
  position: [10, -20, 0],
  radiusPixels: 2,
  radiusMicrometers: 6,
  fillColor: [0, 0, 0],
  transcriptCount: 12,
  cellArea: 78.5,
}

const boundary: SpatialElement = {
  id: 'aaaaaaaa-1',
  geometry: {
    kind: 'polygon',
    rings: [
      [
        { x: micrometers(0), y: micrometers(0) },
        { x: micrometers(10), y: micrometers(0) },
        { x: micrometers(10), y: micrometers(10) },
        { x: micrometers(0), y: micrometers(10) },
      ],
    ],
  },
}

describe('cellDetailModel', () => {
  it('constructs selected-cell async transitions', () => {
    const expression = { genes: [], totalCount: 0, hitGeneLimit: false }
    const shape = summarizeCellShape(cell, boundary)
    const distribution: CellTranscriptZDistribution = {
      bins: [],
      transcriptCount: 0,
      zCount: 0,
      missingZCount: 0,
      maxBinCount: 0,
      hitTranscriptLimit: false,
      minQv: 20,
    }
    const error = { title: 'Failed', message: 'No data' }

    expect(IDLE_CELL_DETAIL_STATE).toEqual({ status: 'idle' })
    expect(cellDetailLoading('https://example.test/output', cell.id)).toEqual({
      status: 'loading',
      url: 'https://example.test/output',
      cellId: cell.id,
    })
    expect(
      cellDetailReady({
        url: 'https://example.test/output',
        cellId: cell.id,
        expression,
        shape,
        boundary,
      }),
    ).toEqual({
      status: 'ready',
      url: 'https://example.test/output',
      cellId: cell.id,
      expression,
      shape,
      boundary,
    })
    expect(cellDetailFailed('https://example.test/output', cell.id, error)).toEqual({
      status: 'error',
      url: 'https://example.test/output',
      cellId: cell.id,
      error,
    })

    expect(IDLE_CELL_TRANSCRIPT_DISTRIBUTION_STATE).toEqual({ status: 'idle' })
    expect(
      cellTranscriptDistributionLoading('https://example.test/output', cell.id),
    ).toEqual({
      status: 'loading',
      url: 'https://example.test/output',
      cellId: cell.id,
    })
    expect(
      cellTranscriptDistributionReady(
        'https://example.test/output',
        cell.id,
        distribution,
      ),
    ).toEqual({
      status: 'ready',
      url: 'https://example.test/output',
      cellId: cell.id,
      distribution,
    })
    expect(
      cellTranscriptDistributionFailed('https://example.test/output', cell.id, error),
    ).toEqual({
      status: 'error',
      url: 'https://example.test/output',
      cellId: cell.id,
      error,
    })
  })

  it('converts overview cells into dataset cells and bounding boxes', () => {
    expect(overviewCellToDatasetCell(cell)).toEqual({
      id: 'aaaaaaaa-1',
      position: { x: micrometers(10), y: micrometers(20) },
      transcriptCount: 12,
      cellArea: 78.5,
    })
    expect(selectedCellBoundaryBbox(cell)).toEqual({
      minX: micrometers(-15),
      maxX: micrometers(35),
      minY: micrometers(-5),
      maxY: micrometers(45),
    })
    expect(
      overviewCellsToBbox([cell, { ...cell, id: 'bbbbbbbb-2', position: [-5, 8, 0] }]),
    ).toEqual({
      minX: micrometers(-5),
      maxX: micrometers(10),
      minY: micrometers(-8),
      maxY: micrometers(20),
    })
  })

  it('loads the selected boundary and treats non-abort failures as missing boundaries', async () => {
    const loadBoundaryElements = vi.fn(async () => ({ elements: [boundary] }))
    await expect(
      loadSelectedCellBoundary(
        'https://example.test/output',
        cell,
        loadBoundaryElements,
        new AbortController().signal,
      ),
    ).resolves.toBe(boundary)

    await expect(
      loadSelectedCellBoundary(
        'https://example.test/output',
        cell,
        vi.fn(async () => {
          throw new Error('missing file')
        }),
        new AbortController().signal,
      ),
    ).resolves.toBeNull()
  })

  it('rethrows abort errors while loading the selected boundary', async () => {
    const abortController = new AbortController()
    abortController.abort()

    await expect(
      loadSelectedCellBoundary(
        'https://example.test/output',
        cell,
        vi.fn(async () => ({ elements: [boundary] })),
        abortController.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('summarizes cell expression and status copy', () => {
    const stats: RoiGeneStats = {
      genes: [
        {
          gene: 'Actb',
          count: 8,
          detectedCells: 1,
          percentCells: 100,
          meanPerCell: 8,
          percentTotal: 80,
        },
      ],
      cellCount: 1,
      sampledCellCount: 1,
      totalCount: 10,
      hitCellLimit: false,
    }

    expect(cellExpressionSummaryFromStats(stats)).toEqual({
      genes: [{ gene: 'Actb', count: 8, percentTotal: 80 }],
      totalCount: 10,
      hitGeneLimit: false,
    })
    expect(cellDetailStatusCopy({ status: 'idle' }, null)).toBe('No selection')
    expect(
      cellDetailStatusCopy(
        {
          status: 'ready',
          url: 'https://example.test/output',
          cellId: cell.id,
          expression: cellExpressionSummaryFromStats(stats),
          shape: {},
          boundary: null,
        },
        cell,
      ),
    ).toBe('1 gene')
  })

  it('summarizes cell shape from cell metrics and polygon boundaries', () => {
    const cellWithoutArea: OverviewCellDatum = {
      id: cell.id,
      position: cell.position,
      radiusPixels: cell.radiusPixels,
      radiusMicrometers: 6,
      fillColor: cell.fillColor,
      transcriptCount: 12,
    }

    expect(summarizeCellShape(cell, boundary)).toMatchObject({
      areaMicrometersSquared: 78.5,
      boundaryAreaMicrometersSquared: 100,
      perimeterMicrometers: 40,
      boundaryPointCount: 4,
    })
    expect(summarizeCellShape(cellWithoutArea, boundary)).toMatchObject({
      areaMicrometersSquared: 100,
      boundaryEquivalentDiameterMicrometers: expect.any(Number),
      circularity: expect.closeTo(Math.PI / 4),
    })
  })
})
