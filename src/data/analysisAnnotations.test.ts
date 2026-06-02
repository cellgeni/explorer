import { describe, expect, it } from 'vitest'
import { intToCellId } from './cellid'
import { annotationsFromAnalysisGroups } from './analysisAnnotations'

describe('analysis annotations', () => {
  it('maps analysis.zarr cell group arrays to cell-id annotations', () => {
    const cellA = intToCellId(1, 1)
    const cellB = intToCellId(2, 1)
    const cellC = intToCellId(3, 1)

    const annotations = annotationsFromAnalysisGroups(
      [
        {
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
        id: 'analysis:0:0',
        label: 'graphclust: Cluster 1',
        cellIds: [cellA, cellC],
      },
      {
        id: 'analysis:0:1',
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
            groupingName: 'kmeans_2_clusters',
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
        label: 'kmeans 2 clusters: Group 1',
        cellIds: [cellA],
      },
    ])
  })
})
