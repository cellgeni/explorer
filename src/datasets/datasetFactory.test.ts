import { describe, expect, it, vi } from 'vitest'
import {
  createSpatialDataset,
  detectSpatialDataset,
  isImageOnlyUrl,
} from './datasetFactory'
import { AnnDataH5adDataset } from './h5adDataset'
import { ImageOnlyDataset } from './imageOnlyDataset'
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

  it('detects a direct H5AD file URL without directory-style probes', async () => {
    const fetcher = fetcherForOkPaths(['/spatial/sample.h5ad'])

    await expect(
      detectSpatialDataset('https://example.test/spatial/sample.h5ad', { fetcher }),
    ).resolves.toMatchObject({
      platform: 'h5ad',
      baseUrl: 'https://example.test/spatial/sample.h5ad',
      h5adUrl: 'https://example.test/spatial/sample.h5ad',
    })

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/spatial/sample.h5ad',
      expect.objectContaining({ method: 'HEAD' }),
    )
  })

  it.each([
    ['OME-TIFF', 'https://example.test/images/sample.ome.tif'],
    ['OME-TIFF long extension', 'https://example.test/images/sample.ome.tiff?token=1'],
    ['TIFF', 'https://example.test/images/sample.tif'],
    ['TIFF long extension', 'https://example.test/images/sample.tiff#view'],
    ['NDPI', 'https://example.test/images/sample.ndpi'],
  ])(
    'detects a direct %s image URL without directory-style probes',
    async (_name, url) => {
      const fetcher = fetcherForOkPaths([new URL(url).pathname])

      await expect(detectSpatialDataset(url, { fetcher })).resolves.toMatchObject({
        platform: 'image',
        baseUrl: url,
        imageUrl: url,
      })

      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(fetcher).toHaveBeenCalledWith(
        url,
        expect.objectContaining({ method: 'HEAD' }),
      )
    },
  )

  it('classifies only direct image extensions as image-only URLs', () => {
    expect(isImageOnlyUrl('https://example.test/sample.ome.tif')).toBe(true)
    expect(isImageOnlyUrl('https://example.test/sample.ome.tiff?token=1')).toBe(true)
    expect(isImageOnlyUrl('https://example.test/sample.tif')).toBe(true)
    expect(isImageOnlyUrl('https://example.test/sample.tiff#view')).toBe(true)
    expect(isImageOnlyUrl('https://example.test/sample.ndpi')).toBe(true)
    expect(isImageOnlyUrl('https://example.test/sample.tif/metadata.json')).toBe(false)
    expect(isImageOnlyUrl('https://example.test/sample.h5ad')).toBe(false)
  })

  it('times out direct H5AD probes that never answer', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          })
        }),
    ) as unknown as typeof fetch

    try {
      const detection = detectSpatialDataset('https://example.test/spatial/sample.h5ad', {
        fetcher,
      })

      await vi.advanceTimersByTimeAsync(15_000)

      await expect(detection).resolves.toMatchObject({
        platform: 'unknown',
        checked: [
          {
            ok: false,
            error: 'Request timed out after 15,000 ms.',
          },
        ],
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('creates an AnnData H5AD dataset for direct file URLs', async () => {
    const dataset = await createSpatialDataset(
      'https://example.test/spatial/sample.h5ad',
      {
        fetcher: fetcherForOkPaths(['/spatial/sample.h5ad']),
      },
    )

    expect(dataset).toBeInstanceOf(AnnDataH5adDataset)
  })

  it('creates an image-only dataset for direct image URLs', async () => {
    const dataset = await createSpatialDataset(
      'https://example.test/images/sample.ome.tif',
      {
        fetcher: fetcherForOkPaths(['/images/sample.ome.tif']),
      },
    )

    expect(dataset).toBeInstanceOf(ImageOnlyDataset)
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
