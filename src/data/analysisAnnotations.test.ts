import { describe, expect, it } from 'vitest'
import { intToCellId } from './cellid'
import {
  analysisAnnotationGroupOptionsFromMetadata,
  annotationsFromAnalysisGroups,
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
})
