import { afterEach, describe, expect, it, vi } from 'vitest'
import { intToCellId } from './cellid'
import { clearHostResponses } from './hostResponses'
import { zipArchive } from '../test/zipFixtures'
import {
  analysisAnnotationGroupOptionsFromMetadata,
  annotationsFromAnalysisGroups,
  readAnalysisZarrAnnotations,
} from './analysisAnnotations'

describe('analysis annotations', () => {
  it('maps analysis.zarr cell group arrays to cell-id annotations', () => {
    const cellA = intToCellId(1, 1)
    const cellB = intToCellId(2, 1)
    const cellC = intToCellId(3, 1)

    const annotations = annotationsFromAnalysisGroups(
      [
        {
          groupingIndex: 2,
          groupingName: 'gene_expression_graphclust',
          groupNames: ['Cluster 1', 'Cluster 2'],
          indptr: new Uint32Array([0, 2, 3]),
          indices: new Uint32Array([0, 2, 1]),
        },
      ],
      [cellA, cellB, cellC],
    )

    expect(annotations).toEqual([
      {
        id: 'analysis:2:0',
        label: 'graphclust: Cluster 1',
        cellIds: [cellA, cellC],
      },
      {
        id: 'analysis:2:1',
        label: 'graphclust: Cluster 2',
        cellIds: [cellB],
      },
    ])
  })

  it('skips out-of-range cell rows while preserving empty labels', () => {
    const cellA = intToCellId(1, 1)

    expect(
      annotationsFromAnalysisGroups(
        [
          {
            groupingName: 'gene_expression_kmeans_2_clusters',
            groupNames: [],
            indptr: new Uint32Array([0, 2]),
            indices: new Uint32Array([0, 10]),
          },
        ],
        [cellA],
      ),
    ).toEqual([
      {
        id: 'analysis:0:0',
        label: 'kmeans 2: Group 1',
        cellIds: [cellA],
      },
    ])
  })

  it('creates compact analysis grouping options from metadata', () => {
    expect(
      analysisAnnotationGroupOptionsFromMetadata(
        [
          'gene_expression_graphclust',
          'gene_expression_kmeans_3_clusters',
          'gene_expression_kmeans_9_clusters',
        ],
        [['Cluster 1', 'Cluster 2'], ['1', '2', '3'], []],
      ),
    ).toEqual([
      {
        id: 'analysis:0',
        label: 'graphclust',
        groupingName: 'gene_expression_graphclust',
        groupCount: 2,
      },
      {
        id: 'analysis:1',
        label: 'kmeans 3',
        groupingName: 'gene_expression_kmeans_3_clusters',
        groupCount: 3,
      },
      {
        id: 'analysis:2',
        label: 'kmeans 9',
        groupingName: 'gene_expression_kmeans_9_clusters',
        groupCount: 0,
      },
    ])
  })

  // A bare ZipFileStore sent a HEAD with no GET fallback, skipped the byte
  // range cache, and the groupings were read one at a time (EXP-236).
  it('reads every grouping together from a host that allows GET only', async () => {
    const analysisUrl = 'https://get-only.test/xenium/analysis.zarr.zip'
    const matrixUrl = 'https://get-only.test/xenium/cell_feature_matrix.zarr.zip'
    const files = new Map([
      [analysisUrl, analysisZip(3)],
      [matrixUrl, matrixZip()],
    ])
    let inFlight = 0
    let mostInFlight = 0
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      const bytes = files.get(request.url)
      const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.get('Range') ?? '')

      if (request.method === 'HEAD') {
        throw new TypeError('Failed to fetch')
      }
      if (bytes === undefined || range === null) {
        return new Response(null, { status: 404 })
      }

      inFlight += 1
      mostInFlight = Math.max(mostInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight -= 1
      const start = Number(range[1])
      const end = Math.min(Number(range[2]), bytes.length - 1)
      return new Response(bytes.slice(start, end + 1), {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
          'Content-Length': String(end - start + 1),
        },
      })
    })

    const annotations = await readAnalysisZarrAnnotations(analysisUrl, matrixUrl)

    expect(annotations.map((annotation) => [annotation.id, annotation.cellIds])).toEqual(
      [0, 1, 2].flatMap((grouping) => [
        [`analysis:${grouping}:0`, [intToCellId(1, 1), intToCellId(3, 1)]],
        [`analysis:${grouping}:1`, [intToCellId(2, 1)]],
      ]),
    )
    expect(mostInFlight).toBeGreaterThan(1)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearHostResponses()
})

const encoder = new TextEncoder()
const json = (value: unknown) => encoder.encode(JSON.stringify(value))

function u4Array(shape: readonly number[], values: readonly number[]) {
  return {
    zarray: json({
      zarr_format: 2,
      shape,
      chunks: shape,
      dtype: '<u4',
      compressor: null,
      fill_value: 0,
      filters: null,
      order: 'C',
    }),
    chunk: new Uint8Array(Uint32Array.from(values).buffer),
  }
}

// Groupings of three cells: matrix rows 0 and 2 in the first group, 1 in the
// second.
function analysisZip(groupings: number): Uint8Array {
  const indptr = u4Array([3], [0, 2, 3])
  const indices = u4Array([3], [0, 2, 1])
  return zipArchive([
    { name: '.zgroup', data: json({ zarr_format: 2 }) },
    { name: 'cell_groups/.zgroup', data: json({ zarr_format: 2 }) },
    {
      name: 'cell_groups/.zattrs',
      data: json({
        grouping_names: Array.from({ length: groupings }, (_, i) => `kmeans_${i + 2}`),
        group_names: Array.from({ length: groupings }, () => ['Cluster 1', 'Cluster 2']),
        number_groupings: groupings,
      }),
    },
    ...Array.from({ length: groupings }, (_, grouping) => [
      { name: `cell_groups/${grouping}/.zgroup`, data: json({ zarr_format: 2 }) },
      { name: `cell_groups/${grouping}/indptr/.zarray`, data: indptr.zarray },
      { name: `cell_groups/${grouping}/indptr/0`, data: indptr.chunk },
      { name: `cell_groups/${grouping}/indices/.zarray`, data: indices.zarray },
      { name: `cell_groups/${grouping}/indices/0`, data: indices.chunk },
    ]).flat(),
  ])
}

function matrixZip(): Uint8Array {
  const cellId = u4Array([3, 2], [1, 1, 2, 1, 3, 1])
  return zipArchive([
    { name: '.zgroup', data: json({ zarr_format: 2 }) },
    { name: 'cell_features/.zgroup', data: json({ zarr_format: 2 }) },
    { name: 'cell_features/cell_id/.zarray', data: cellId.zarray },
    { name: 'cell_features/cell_id/0.0', data: cellId.chunk },
  ])
}
