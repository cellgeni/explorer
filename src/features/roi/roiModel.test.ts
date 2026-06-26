import { describe, expect, it } from 'vitest'
import { asCellId } from '../../data/cellid'
import { micrometers } from '../../data/coords'
import type { DatasetCell, DatasetTranscript } from '../../datasets/xeniumDataset'
import {
  IDLE_ROI_GENE_STATS_STATE,
  IDLE_ROI_GENE_VIEWPORT_WARMUP_STATE,
  IDLE_ROI_STATE,
  IDLE_ROI_TRANSCRIPT_EXPORT_STATE,
  defaultRoiName,
  emptyRoiGeneStats,
  roiCellsToCsv,
  roiFailed,
  roiGeneDatasetWarmupKey,
  roiGeneStatsFailed,
  roiGeneStatsLoading,
  roiGeneStatsReady,
  roiGeneViewportWarmupFailed,
  roiGeneViewportWarmupLoading,
  roiGeneViewportWarmupReady,
  roiLoading,
  roiReady,
  roiGeneStatsStatusCopy,
  roiSelectionLabel,
  roiSelectionToGeoJson,
  roiStatusCopy,
  roiTranscriptExportFailed,
  roiTranscriptExportLoading,
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

const bbox = {
  minX: micrometers(0),
  minY: micrometers(0),
  maxX: micrometers(10),
  maxY: micrometers(20),
}

const selection = {
  kind: 'box' as const,
  bbox,
}

describe('roiModel', () => {
  it('constructs ROI async transitions', () => {
    const stats = emptyRoiGeneStats()
    const error = { title: 'Failed' }

    expect(IDLE_ROI_STATE).toEqual({ status: 'idle' })
    expect(roiLoading('https://example.test/output', bbox, selection)).toEqual({
      status: 'loading',
      url: 'https://example.test/output',
      bbox,
      selection,
    })
    expect(roiReady('https://example.test/output', bbox, selection, cells, true)).toEqual(
      {
        status: 'ready',
        url: 'https://example.test/output',
        bbox,
        selection,
        cells,
        hitCellLimit: true,
      },
    )
    expect(roiFailed('https://example.test/output', bbox, selection, error)).toEqual({
      status: 'error',
      url: 'https://example.test/output',
      bbox,
      selection,
      error,
    })

    expect(IDLE_ROI_GENE_STATS_STATE).toEqual({ status: 'idle' })
    expect(roiGeneStatsLoading('https://example.test/output', 2)).toEqual({
      status: 'loading',
      url: 'https://example.test/output',
      cellCount: 2,
    })
    expect(roiGeneStatsReady('https://example.test/output', stats)).toEqual({
      status: 'ready',
      url: 'https://example.test/output',
      stats,
    })
    expect(roiGeneStatsFailed('https://example.test/output', error)).toEqual({
      status: 'error',
      url: 'https://example.test/output',
      error,
    })

    expect(IDLE_ROI_GENE_VIEWPORT_WARMUP_STATE).toEqual({ status: 'idle' })
    expect(roiGeneViewportWarmupLoading('warmup-key')).toEqual({
      status: 'loading',
      key: 'warmup-key',
    })
    expect(roiGeneViewportWarmupReady('warmup-key')).toEqual({
      status: 'ready',
      key: 'warmup-key',
    })
    expect(roiGeneViewportWarmupFailed('warmup-key')).toEqual({
      status: 'error',
      key: 'warmup-key',
    })

    expect(IDLE_ROI_TRANSCRIPT_EXPORT_STATE).toEqual({ status: 'idle' })
    expect(roiTranscriptExportLoading('https://example.test/output')).toEqual({
      status: 'loading',
      url: 'https://example.test/output',
    })
    expect(roiTranscriptExportFailed('https://example.test/output', error)).toEqual({
      status: 'error',
      url: 'https://example.test/output',
      error,
    })
  })

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
    expect(roiGeneDatasetWarmupKey('https://example.test/output')).toBe(
      'https://example.test/output:roi-gene-warmup',
    )
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

  it('serializes ROI selections as GeoJSON polygons', () => {
    const box = JSON.parse(
      roiSelectionToGeoJson(
        {
          kind: 'box',
          bbox: {
            minX: micrometers(0),
            minY: micrometers(1),
            maxX: micrometers(10),
            maxY: micrometers(20),
          },
        },
        { roi_name: 'Tumor ROI', selected_cell_count: 2 },
      ),
    )

    expect(box).toMatchObject({
      type: 'FeatureCollection',
      bbox: [0, 1, 10, 20],
      features: [
        {
          type: 'Feature',
          properties: {
            roi_kind: 'box',
            coordinate_unit: 'micrometer',
            roi_name: 'Tumor ROI',
            selected_cell_count: 2,
          },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 1],
                [10, 1],
                [10, 20],
                [0, 20],
                [0, 1],
              ],
            ],
          },
        },
      ],
    })

    const lasso = JSON.parse(
      roiSelectionToGeoJson({
        kind: 'lasso',
        bbox: {
          minX: micrometers(2),
          minY: micrometers(3),
          maxX: micrometers(8),
          maxY: micrometers(9),
        },
        points: [
          { x: micrometers(2), y: micrometers(3) },
          { x: micrometers(8), y: micrometers(3) },
          { x: micrometers(5), y: micrometers(9) },
        ],
      }),
    )

    expect(lasso.features[0].geometry.coordinates[0]).toEqual([
      [2, 3],
      [8, 3],
      [5, 9],
      [2, 3],
    ])
  })
})
