import { describe, expect, it, vi } from 'vitest'
import {
  VISIUM_HD_CLUSTERINGS,
  parseVisiumHdClusteringGroupId,
  readVisiumHdClusterAnnotations,
  readVisiumHdClusteringGroups,
  visiumHdClusteringGroupId,
} from './visiumHdClusters'
import type { VisiumHdBinDescriptor } from './visiumHdDataset'

const bin16: VisiumHdBinDescriptor = {
  binSizeMicrometers: 16,
  outputPath: 'binned_outputs/square_016um',
  tissuePositionsPath: 'binned_outputs/square_016um/spatial/tissue_positions.parquet',
  scalefactorsPath: 'binned_outputs/square_016um/spatial/scalefactors_json.json',
  filteredMatrixH5Path: 'binned_outputs/square_016um/filtered_feature_bc_matrix.h5',
}

const CLUSTERING_ROOT =
  'https://example.test/visium/binned_outputs/square_016um/analysis/clustering'

describe('Visium HD clusterings', () => {
  it('names a set by its tier and clustering, and reads the name back', () => {
    const groupId = visiumHdClusteringGroupId({
      binSizeMicrometers: 8,
      clustering: 'gene_expression_graphclust',
    })

    expect(groupId).toBe('visium-hd-clusters:8:gene_expression_graphclust')
    expect(parseVisiumHdClusteringGroupId(groupId)).toEqual({
      binSizeMicrometers: 8,
      clustering: 'gene_expression_graphclust',
    })

    for (const other of [
      'analysis:0',
      'visium-hd-clusters:4:gene_expression_graphclust',
      'visium-hd-clusters:16:',
      'visium-hd-clusters:16',
    ]) {
      expect(parseVisiumHdClusteringGroupId(other)).toBeNull()
    }
  })

  it('lists the clusterings a tier has, by HEAD request', async () => {
    const present = new Set([
      `${CLUSTERING_ROOT}/gene_expression_graphclust/clusters.csv`,
      `${CLUSTERING_ROOT}/gene_expression_kmeans_10_clusters/clusters.csv`,
    ])
    const fetcher = vi.fn(async (url: RequestInfo | URL) =>
      // S3 answers 403 for missing keys.
      present.has(String(url))
        ? new Response(null, { status: 200 })
        : new Response(null, { status: 403 }),
    )

    await expect(
      readVisiumHdClusteringGroups('https://example.test/visium', bin16, { fetcher }),
    ).resolves.toEqual([
      {
        id: 'visium-hd-clusters:16:gene_expression_graphclust',
        label: 'graphclust',
        groupingName: 'gene_expression_graphclust',
        groupCount: 0,
      },
      {
        id: 'visium-hd-clusters:16:gene_expression_kmeans_10_clusters',
        label: 'kmeans 10',
        groupingName: 'gene_expression_kmeans_10_clusters',
        groupCount: 10,
      },
    ])
    expect(fetcher).toHaveBeenCalledTimes(VISIUM_HD_CLUSTERINGS.length)
    expect(fetcher).toHaveBeenCalledWith(
      `${CLUSTERING_ROOT}/gene_expression_kmeans_2_clusters/clusters.csv`,
      { method: 'HEAD' },
    )
  })

  it('treats a clustering whose HEAD request fails as absent, unless cancelled', async () => {
    const failing = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })

    await expect(
      readVisiumHdClusteringGroups('https://example.test/visium', bin16, {
        fetcher: failing,
      }),
    ).resolves.toEqual([])

    const controller = new AbortController()
    controller.abort()

    await expect(
      readVisiumHdClusteringGroups('https://example.test/visium', bin16, {
        fetcher: failing,
        signal: controller.signal,
      }),
    ).rejects.toThrow('Failed to fetch')
  })

  it('fails on a server error instead of listing the clustering as absent', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 503 }))

    await expect(
      readVisiumHdClusteringGroups('https://example.test/visium', bin16, { fetcher }),
    ).rejects.toThrow('returned HTTP 503')
  })

  it('reads one annotation per cluster, in cluster order', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          [
            'Barcode,Cluster',
            's_016um_00001_00002-1,10',
            's_016um_00001_00003-1,2',
            's_016um_00004_00005-1,2',
            's_016um_00006_00007-1,1',
            '',
          ].join('\n'),
        ),
    )

    await expect(
      readVisiumHdClusterAnnotations(
        'https://example.test/visium',
        bin16,
        'gene_expression_graphclust',
        { fetcher },
      ),
    ).resolves.toEqual([
      {
        id: 'analysis:gene_expression_graphclust:1',
        label: 'graphclust: Cluster 1',
        cellIds: ['s_016um_00006_00007-1'],
      },
      {
        id: 'analysis:gene_expression_graphclust:2',
        label: 'graphclust: Cluster 2',
        cellIds: ['s_016um_00001_00003-1', 's_016um_00004_00005-1'],
      },
      {
        id: 'analysis:gene_expression_graphclust:10',
        label: 'graphclust: Cluster 10',
        cellIds: ['s_016um_00001_00002-1'],
      },
    ])
    expect(fetcher).toHaveBeenCalledWith(
      `${CLUSTERING_ROOT}/gene_expression_graphclust/clusters.csv`,
      {},
    )
  })

  it('names the clusters file a failed read was for', async () => {
    await expect(
      readVisiumHdClusterAnnotations(
        'https://example.test/visium',
        bin16,
        'gene_expression_kmeans_3_clusters',
        { fetcher: async () => new Response('missing', { status: 404 }) },
      ),
    ).rejects.toThrow(
      'Unable to read binned_outputs/square_016um/analysis/clustering/gene_expression_kmeans_3_clusters/clusters.csv: HTTP 404.',
    )
  })
})
