import { describe, expect, it, vi } from 'vitest'
import { createSpatialDataset, detectSpatialDataset } from './datasetFactory'
import { VisiumHdDataset } from './visiumHdDataset'

describe('spatial dataset detection', () => {
  it('detects Xenium from experiment.xenium', async () => {
    const fetcher = fetcherForOkPaths(['/xenium/experiment.xenium'])

    await expect(
      detectSpatialDataset('https://example.test/xenium/', { fetcher }),
    ).resolves.toMatchObject({
      platform: 'xenium',
      baseUrl: 'https://example.test/xenium',
    })

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('detects Visium HD binned outputs and segmented output sidecars', async () => {
    const fetcher = fetcherForOkPaths([
      '/visium/binned_outputs/square_002um/spatial/tissue_positions.parquet',
      '/visium/binned_outputs/square_002um/spatial/scalefactors_json.json',
      '/visium/binned_outputs/square_002um/filtered_feature_bc_matrix.h5',
      '/visium/binned_outputs/square_008um/spatial/tissue_positions.parquet',
      '/visium/binned_outputs/square_008um/spatial/scalefactors_json.json',
      '/visium/binned_outputs/square_008um/filtered_feature_bc_matrix.h5',
      '/visium/binned_outputs/square_016um/spatial/tissue_positions.parquet',
      '/visium/binned_outputs/square_016um/spatial/scalefactors_json.json',
      '/visium/binned_outputs/square_016um/filtered_feature_bc_matrix.h5',
      '/visium/segmented_outputs/spatial/scalefactors_json.json',
      '/visium/segmented_outputs/filtered_feature_cell_matrix.h5',
      '/visium/segmented_outputs/cell_segmentations.geojson',
    ])

    const detection = await detectSpatialDataset('https://example.test/visium/', {
      fetcher,
    })

    expect(detection).toMatchObject({
      platform: 'visium-hd',
      baseUrl: 'https://example.test/visium',
      segmentedScalefactorsPath: 'segmented_outputs/spatial/scalefactors_json.json',
      segmentedOutputs: {
        scalefactorsPath: 'segmented_outputs/spatial/scalefactors_json.json',
        filteredFeatureCellMatrixH5Path:
          'segmented_outputs/filtered_feature_cell_matrix.h5',
        cellSegmentationsGeojsonPath: 'segmented_outputs/cell_segmentations.geojson',
      },
    })

    if (detection.platform !== 'visium-hd') {
      throw new Error('Expected Visium HD detection.')
    }

    expect(detection.bins.map((bin) => bin.binSizeMicrometers)).toEqual([2, 8, 16])
    expect(detection.bins[2]).toMatchObject({
      outputPath: 'binned_outputs/square_016um',
      tissuePositionsPath: 'binned_outputs/square_016um/spatial/tissue_positions.parquet',
      scalefactorsPath: 'binned_outputs/square_016um/spatial/scalefactors_json.json',
      filteredMatrixH5Path: 'binned_outputs/square_016um/filtered_feature_bc_matrix.h5',
    })
  })

  it('returns unknown when neither Xenium nor Visium HD probes match', async () => {
    const detection = await detectSpatialDataset('https://example.test/other/', {
      fetcher: fetcherForOkPaths([]),
    })

    expect(detection.platform).toBe('unknown')
    expect(detection.checked.length).toBeGreaterThan(1)
  })

  it('passes an explicit Visium HD 2 µm barcode budget into created datasets', async () => {
    const dataset = await createSpatialDataset('https://example.test/visium/', {
      fetcher: fetcherForOkPaths([
        '/visium/binned_outputs/square_002um/spatial/tissue_positions.parquet',
        '/visium/binned_outputs/square_002um/spatial/scalefactors_json.json',
        '/visium/binned_outputs/square_002um/filtered_feature_bc_matrix.h5',
        '/visium/binned_outputs/square_016um/spatial/tissue_positions.parquet',
        '/visium/binned_outputs/square_016um/spatial/scalefactors_json.json',
        '/visium/binned_outputs/square_016um/filtered_feature_bc_matrix.h5',
      ]),
      visiumHdMaxTwoMicrometerFilteredBarcodes: 25_000,
    })

    expect(dataset).toBeInstanceOf(VisiumHdDataset)
    expect(dataset).toMatchObject({
      maxTwoMicrometerFilteredBarcodes: 25_000,
    })
  })
})

function fetcherForOkPaths(paths: readonly string[]): typeof fetch {
  const okPaths = new Set(paths)

  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    const status = okPaths.has(url.pathname) ? 200 : 404
    return new Response(null, { status })
  }) as unknown as typeof fetch
}
