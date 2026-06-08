import { describe, expect, it } from 'vitest'
import { asCellId } from '../../data/cellid'
import { micrometers } from '../../data/coords'
import type { DatasetCell, DatasetTranscript } from '../../datasets/xeniumDataset'
import {
  defaultRoiName,
  emptyRoiGeneStats,
  roiCellsToCsv,
  roiGeneStatsStatusCopy,
  roiGeneViewportWarmupKey,
  roiSelectionLabel,
  roiStatusCopy,
  roiTranscriptsToCsv,
  summarizeRoiCells,
} from './roiModel'

const cells: readonly DatasetCell[] = [
  {
    id: asCellId('aaaaaaaa-1'),
    position: { x: micrometers(1), y: micrometers(2) },
    transcriptCount: 10,
    cellArea: 20,
  },
  {
    id: asCellId('bbbbbbbb-2'),
    position: { x: micrometers(3), y: micrometers(4) },
    transcriptCount: 14,
    cellArea: 40,
  },
]

describe('roiModel', () => {
  it('formats ROI and gene-stat statuses', () => {
    expect(roiStatusCopy({ status: 'idle' }, 'box')).toBe('Drawing box')
    expect(
      roiStatusCopy(
        {
          status: 'ready',
          url: 'https://example.test/output',
          bbox: {
            minX: micrometers(0),
            minY: micrometers(0),
            maxX: micrometers(1),
            maxY: micrometers(1),
          },
          selection: {
            kind: 'box',
            bbox: {
              minX: micrometers(0),
              minY: micrometers(0),
              maxX: micrometers(1),
              maxY: micrometers(1),
            },
          },
          cells,
          hitCellLimit: true,
        },
        'idle',
      ),
    ).toBe('2+ cells')
    expect(
      roiGeneStatsStatusCopy({
        status: 'ready',
        url: 'https://example.test/output',
        stats: {
          genes: [
            {
              gene: 'Actb',
              count: 2,
              detectedCells: 1,
              percentCells: 100,
              meanPerCell: 2,
              percentTotal: 100,
            },
          ],
          cellCount: 1,
          sampledCellCount: 1,
          totalCount: 2,
          hitCellLimit: false,
        },
      }),
    ).toBe('Genes: top 1')
  })

  it('summarizes cells, selections, names, and warmup keys', () => {
    expect(summarizeRoiCells(cells)).toEqual({
      cellCount: 2,
      meanTranscriptCount: 12,
      meanCellArea: 30,
    })
    expect(summarizeRoiCells([])).toEqual({
      cellCount: 0,
      meanTranscriptCount: 0,
      meanCellArea: undefined,
    })
    expect(
      roiSelectionLabel({
        kind: 'lasso',
        bbox: {
          minX: micrometers(0),
          minY: micrometers(0),
          maxX: micrometers(1),
          maxY: micrometers(1),
        },
        points: [],
      }),
    ).toBe('ROI lasso')
    expect(defaultRoiName(3)).toBe('ROI 3')
    expect(emptyRoiGeneStats()).toEqual({
      genes: [],
      cellCount: 0,
      sampledCellCount: 0,
      totalCount: 0,
      hitCellLimit: false,
    })
    expect(
      roiGeneViewportWarmupKey('https://example.test/output', {
        bbox: {
          minX: micrometers(49),
          maxX: micrometers(151),
          minY: micrometers(249),
          maxY: micrometers(351),
        },
        viewState: { zoom: 1.24 },
        visibleCellCount: 65,
      }),
    ).toBe('https://example.test/output:0:2:2:4:12:2')
  })

  it('serializes ROI cells and transcripts as escaped CSV', () => {
    expect(roiCellsToCsv(cells)).toBe(
      [
        'cell_id,x_centroid,y_centroid,transcript_counts,cell_area',
        'aaaaaaaa-1,1,2,10,20',
        'bbbbbbbb-2,3,4,14,40',
      ].join('\n'),
    )

    const transcripts: readonly DatasetTranscript[] = [
      {
        cellId: asCellId('aaaaaaaa-1'),
        featureName: 'Gene, "A"',
        position: { x: micrometers(1), y: micrometers(2) },
        zLocation: 3,
        qv: 40,
        overlapsNucleus: true,
        isGene: false,
      },
    ]

    expect(roiTranscriptsToCsv(transcripts)).toBe(
      [
        'cell_id,feature_name,x_location,y_location,z_location,qv,overlaps_nucleus,is_gene',
        'aaaaaaaa-1,"Gene, ""A""",1,2,3,40,true,false',
      ].join('\n'),
    )
  })
})
