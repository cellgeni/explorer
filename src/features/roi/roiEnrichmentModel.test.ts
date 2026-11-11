import { describe, expect, it } from 'vitest'
import { micrometers } from '../../data/coords'
import type { RoiGeneStat, RoiGeneStats } from '../../data/roiGeneStats'
import { roiSelectionContains, type RoiSelection } from '../../data/roiSelection'
import {
  ENRICHMENT_PSEUDOCOUNT,
  formatLog2FoldChange,
  log2FoldChange,
  rankRoiGenes,
  referenceOutsideSelection,
  referenceSampleIndices,
} from './roiEnrichmentModel'

function stat(
  gene: string,
  count: number,
  detectedCells: number,
  cells: number,
): RoiGeneStat {
  return {
    gene,
    count,
    detectedCells,
    percentCells: (detectedCells / cells) * 100,
    meanPerCell: count / cells,
    percentTotal: 0,
  }
}

function stats(cells: number, genes: readonly RoiGeneStat[]): RoiGeneStats {
  return {
    genes,
    cellCount: cells,
    sampledCellCount: cells,
    totalCount: genes.reduce((total, gene) => total + gene.count, 0),
    hitCellLimit: false,
  }
}

const BOX: RoiSelection = {
  kind: 'box',
  bbox: {
    minX: micrometers(0),
    minY: micrometers(0),
    maxX: micrometers(10),
    maxY: micrometers(10),
  },
}

const TRIANGLE: RoiSelection = {
  kind: 'lasso',
  bbox: BOX.bbox,
  points: [
    { x: micrometers(0), y: micrometers(0) },
    { x: micrometers(10), y: micrometers(0) },
    { x: micrometers(0), y: micrometers(10) },
  ],
}

describe('roiEnrichmentModel', () => {
  it('takes evenly spaced runs of consecutive elements', () => {
    expect(referenceSampleIndices(0)).toEqual([])
    expect(referenceSampleIndices(5, 2, 4)).toEqual([0, 1, 2, 3, 4])
    expect(referenceSampleIndices(100, 4, 3)).toEqual([
      0, 1, 2, 25, 26, 27, 50, 51, 52, 75, 76, 77,
    ])
    // The last run stays inside the list.
    expect(referenceSampleIndices(10, 3, 3)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(referenceSampleIndices(1_414_155)).toHaveLength(512)
  })

  it('keeps the reference outside a box or lasso', () => {
    const points = [
      { x: micrometers(1), y: micrometers(1) },
      { x: micrometers(8), y: micrometers(8) },
      { x: micrometers(20), y: micrometers(5) },
    ]

    expect(referenceOutsideSelection(points, BOX, (point) => point)).toEqual([points[2]])
    expect(referenceOutsideSelection(points, TRIANGLE, (point) => point)).toEqual([
      points[1],
      points[2],
    ])
    expect(roiSelectionContains(TRIANGLE, { x: micrometers(2), y: micrometers(2) })).toBe(
      true,
    )
  })

  it('takes log2 of the ratio of means with the pseudocount', () => {
    expect(log2FoldChange(1.5, 0.3)).toBeCloseTo(
      Math.log2((1.5 + ENRICHMENT_PSEUDOCOUNT) / (0.3 + ENRICHMENT_PSEUDOCOUNT)),
    )
    expect(log2FoldChange(0, 0)).toBe(0)
    expect(log2FoldChange(0.7, 0)).toBeCloseTo(3)
  })

  it('ranks by fold change, filtered by the share of cells expressing inside', () => {
    const inside = stats(10, [
      stat('ACTB', 100, 10, 10),
      stat('GFAP', 30, 6, 10),
      stat('RARE', 5, 1, 10),
      stat('AQP4', 20, 5, 10),
    ])
    const outside = stats(100, [
      stat('ACTB', 1_000, 100, 100),
      stat('GFAP', 30, 10, 100),
      stat('RARE', 0, 0, 100),
    ])

    const ranked = rankRoiGenes(inside, outside, {
      sort: 'enriched',
      minPercentInside: 20,
    })

    expect(ranked.map((gene) => gene.gene)).toEqual(['AQP4', 'GFAP', 'ACTB'])
    expect(ranked[0]).toMatchObject({
      meanInside: 2,
      meanOutside: 0,
      percentInside: 50,
      percentOutside: 0,
    })
    expect(ranked[1]).toMatchObject({ percentOutside: 10, meanOutside: 0.3 })
    expect(ranked[2]?.log2FoldChange).toBeCloseTo(0)

    // With no filter the rare gene comes in.
    expect(
      rankRoiGenes(inside, outside, { sort: 'enriched', minPercentInside: 0 }).map(
        (gene) => gene.gene,
      ),
    ).toContain('RARE')
  })

  it('sorts by count for most abundant, and while the reference is missing', () => {
    const inside = stats(10, [
      stat('GFAP', 30, 6, 10),
      stat('ACTB', 100, 10, 10),
      stat('AQP4', 30, 5, 10),
    ])
    const outside = stats(10, [stat('ACTB', 1_000, 10, 10)])

    expect(
      rankRoiGenes(inside, outside, { sort: 'abundant', minPercentInside: 0 }).map(
        (gene) => gene.gene,
      ),
    ).toEqual(['ACTB', 'AQP4', 'GFAP'])

    const withoutReference = rankRoiGenes(inside, null, {
      sort: 'enriched',
      minPercentInside: 0,
      limit: 2,
    })
    expect(withoutReference.map((gene) => gene.gene)).toEqual(['ACTB', 'AQP4'])
    expect(withoutReference[0]).toMatchObject({
      meanOutside: null,
      percentOutside: null,
      log2FoldChange: null,
    })
  })

  it('formats fold changes with a sign and one decimal', () => {
    expect(formatLog2FoldChange(2.44)).toBe('+2.4')
    expect(formatLog2FoldChange(-0.76)).toBe('−0.8')
    expect(formatLog2FoldChange(0.02)).toBe('0.0')
  })
})
