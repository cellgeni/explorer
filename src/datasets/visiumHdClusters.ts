import { formatGroupingName } from '../data/analysisAnnotations'
import { datasetFileUrl } from '../data/datasetFiles'
import { fetchHead, noteReadableResponse } from '../data/hostResponses'
import { parseVisiumClustersCsv } from './visiumFormat'
import type { SpatialElementId } from './spatialDataset'
import type { VisiumHdBinDescriptor, VisiumHdBinSizeMicrometers } from './visiumHdDataset'
import type { Annotation, AnnotationGroupOption } from '../data/annotation'

// Space Ranger clusters each 8 and 16 µm tier's bins (not 2 µm), and writes
// each clustering to analysis/clustering/<name>/clusters.csv as
// `Barcode,Cluster`. A clustering belongs to its tier: its barcodes are that
// size's bins.
export const VISIUM_HD_CLUSTERINGS: readonly string[] = [
  'gene_expression_graphclust',
  ...Array.from(
    { length: 9 },
    (_, index) => `gene_expression_kmeans_${index + 2}_clusters`,
  ),
]

const GROUP_ID_PREFIX = 'visium-hd-clusters'

export interface VisiumHdClusterReadOptions {
  readonly fetcher?: typeof fetch
  readonly signal?: AbortSignal
}

export interface VisiumHdClusteringGroup {
  readonly binSizeMicrometers: VisiumHdBinSizeMicrometers
  readonly clustering: string
}

export function visiumHdClusteringPath(
  bin: Pick<VisiumHdBinDescriptor, 'outputPath'>,
  clustering: string,
): string {
  return `${bin.outputPath}/analysis/clustering/${clustering}/clusters.csv`
}

// The set's id names its tier, so a set loaded for one bin size is not
// taken for another's.
export function visiumHdClusteringGroupId(group: VisiumHdClusteringGroup): string {
  return `${GROUP_ID_PREFIX}:${group.binSizeMicrometers}:${group.clustering}`
}

export function parseVisiumHdClusteringGroupId(
  groupId: string,
): VisiumHdClusteringGroup | null {
  const [prefix, size, clustering] = groupId.split(':')
  const binSizeMicrometers = Number(size)

  if (
    prefix !== GROUP_ID_PREFIX ||
    clustering === undefined ||
    clustering.length === 0 ||
    (binSizeMicrometers !== 2 && binSizeMicrometers !== 8 && binSizeMicrometers !== 16)
  ) {
    return null
  }

  return { binSizeMicrometers, clustering }
}

// The tier's clusterings that exist, found with a HEAD request each. A 403 or
// 404 (missing keys answer 403 on S3), or a request that fails outright (hosts
// that send no CORS headers with errors), means the clustering is absent. Any
// other status fails the call, so the list is not kept and is read again.
export async function readVisiumHdClusteringGroups(
  baseUrl: string,
  bin: VisiumHdBinDescriptor,
  options: VisiumHdClusterReadOptions = {},
): Promise<readonly AnnotationGroupOption[]> {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  const present = await Promise.all(
    VISIUM_HD_CLUSTERINGS.map(async (clustering) => {
      const url = datasetFileUrl(baseUrl, visiumHdClusteringPath(bin, clustering))

      let response: Response

      try {
        response = await fetchHead(
          fetcher,
          url,
          options.signal === undefined ? {} : { signal: options.signal },
        )
      } catch (error) {
        if (options.signal?.aborted === true) {
          throw error
        }

        return false
      }

      noteReadableResponse(url, response.status)

      if (response.ok || response.status === 403 || response.status === 404) {
        return response.ok
      }

      throw new Error(
        `${visiumHdClusteringPath(bin, clustering)} returned HTTP ${response.status.toString()}.`,
      )
    }),
  )

  return VISIUM_HD_CLUSTERINGS.flatMap((clustering, index) =>
    present[index] === true
      ? [
          {
            id: visiumHdClusteringGroupId({
              binSizeMicrometers: bin.binSizeMicrometers,
              clustering,
            }),
            label: formatGroupingName(clustering),
            groupingName: clustering,
            // k for k-means; graph-based clusters are counted when read.
            groupCount: kMeansClusterCount(clustering) ?? 0,
          },
        ]
      : [],
  )
}

// One annotation per cluster, in cluster order, labelled as Xenium's
// analysis sets are: `graphclust: Cluster 3`.
export async function readVisiumHdClusterAnnotations(
  baseUrl: string,
  bin: VisiumHdBinDescriptor,
  clustering: string,
  options: VisiumHdClusterReadOptions = {},
): Promise<readonly Annotation<SpatialElementId>[]> {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  const path = visiumHdClusteringPath(bin, clustering)
  const response = await fetcher(
    datasetFileUrl(baseUrl, path),
    options.signal === undefined ? {} : { signal: options.signal },
  )

  if (!response.ok) {
    throw new Error(`Unable to read ${path}: HTTP ${response.status}.`)
  }

  return visiumHdClusterAnnotations(
    parseVisiumClustersCsv(await response.text()),
    clustering,
  )
}

// Ids follow the other datasets' analysis sets (`analysis:<set>:<class>`) and
// leave out the tier, so a class keeps its colour, or stays hidden, when the
// same clustering is read for another tier.
export function visiumHdClusterAnnotations(
  clusterByBarcode: ReadonlyMap<string, string>,
  clustering: string,
): readonly Annotation<SpatialElementId>[] {
  const groupLabel = formatGroupingName(clustering)
  const barcodesByCluster = new Map<string, SpatialElementId[]>()

  for (const [barcode, cluster] of clusterByBarcode) {
    const barcodes = barcodesByCluster.get(cluster)

    if (barcodes === undefined) {
      barcodesByCluster.set(cluster, [barcode])
    } else {
      barcodes.push(barcode)
    }
  }

  return [...barcodesByCluster]
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .map(([cluster, cellIds]) => ({
      id: `analysis:${clustering}:${cluster}`,
      label: `${groupLabel}: Cluster ${cluster}`,
      cellIds,
    }))
}

function kMeansClusterCount(clustering: string): number | undefined {
  const match = /^gene_expression_kmeans_(\d+)_clusters$/u.exec(clustering)
  return match?.[1] === undefined ? undefined : Number(match[1])
}
