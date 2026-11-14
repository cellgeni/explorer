import { describe, expect, it, vi } from 'vitest'
import {
  datasetFileLabelFor,
  datasetFileUrl,
  datasetFileUrlFor,
  datasetManifestFor,
  setDatasetManifest,
} from '../data/datasetFiles'
import { clearFolderListings, isListedAsMissing } from '../data/folderListing'
import {
  cachedSpatialDataset,
  createSpatialDataset,
  detectSpatialDataset,
  isImageOnlyUrl,
  setSpatialDataSelection,
  spatialDataSelectionFor,
} from './datasetFactory'
import { AteraDataset } from './ateraDataset'
import { DatasetManifestError } from './datasetManifest'
import { AnnDataH5adDataset } from './h5adDataset'
import { ImageOnlyDataset } from './imageOnlyDataset'
import { MerscopeDataset } from './merscopeDataset'
import { SpatialDataDataset } from './spatialDataDataset'
import { VisiumHdDataset } from './visiumHdDataset'
import {
  ANNDATA_ZARR_FIXTURE_ORIGIN,
  annDataZarrFixtureFetcher,
} from '../test/annDataZarrFixtures'
import { ICECHUNK_FIXTURE_ORIGIN, icechunkFixtureFetcher } from '../test/icechunkFixtures'
import { byteRangeFetcher, zipArchive } from '../test/zipFixtures'

describe('spatial dataset detection', () => {
  it('detects Xenium from experiment.xenium', async () => {
    const fetcher = fetcherForOkPaths(['/xenium/experiment.xenium'])

    await expect(
      detectSpatialDataset('https://example.test/xenium/', { fetcher }),
    ).resolves.toMatchObject({
      platform: 'xenium',
      baseUrl: 'https://example.test/xenium',
    })

    // The folder index page is read first; the dataset manifest and
    // experiment.spatial probes then run alongside the experiment.xenium probe.
    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/xenium/',
      expect.objectContaining({ cache: 'no-cache' }),
    )
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/xenium/explorer.json',
      expect.objectContaining({ cache: 'no-cache' }),
    )
  })

  it('prefers Xenium manifests over generic Zarr metadata probes', async () => {
    const fetcher = fetcherForOkPaths(['/xenium/experiment.xenium', '/xenium/zarr.json'])

    await expect(
      detectSpatialDataset('https://example.test/xenium/', { fetcher }),
    ).resolves.toMatchObject({
      platform: 'xenium',
      baseUrl: 'https://example.test/xenium',
    })

    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('detects Atera from experiment.spatial without further probes', async () => {
    const fetcher = fetcherForOkPaths(['/atera/experiment.spatial'])

    await expect(
      detectSpatialDataset('https://example.test/atera/', { fetcher }),
    ).resolves.toMatchObject({
      platform: 'atera',
      baseUrl: 'https://example.test/atera',
      checked: [
        expect.objectContaining({ path: 'explorer.json', ok: false }),
        expect.objectContaining({ path: 'experiment.xenium', ok: false }),
        expect.objectContaining({ path: 'experiment.spatial', ok: true }),
      ],
    })
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('prefers experiment.xenium when a folder has both experiment files', async () => {
    const fetcher = fetcherForOkPaths([
      '/both/experiment.xenium',
      '/both/experiment.spatial',
    ])

    await expect(
      detectSpatialDataset('https://example.test/both/', { fetcher }),
    ).resolves.toMatchObject({ platform: 'xenium' })
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

  it('detects standard Visium Space Ranger output before Visium HD tiers', async () => {
    const fetcher = fetcherForOkPaths([
      '/visium/spatial/tissue_positions.csv',
      '/visium/spatial/scalefactors_json.json',
      '/visium/filtered_feature_bc_matrix.h5',
      '/visium/spatial/tissue_hires_image.png',
    ])

    await expect(
      detectSpatialDataset('https://example.test/visium/', { fetcher }),
    ).resolves.toMatchObject({
      platform: 'visium',
      baseUrl: 'https://example.test/visium',
      files: {
        tissuePositions: 'spatial/tissue_positions.csv',
        scalefactors: 'spatial/scalefactors_json.json',
        filteredMatrix: 'filtered_feature_bc_matrix.h5',
        hiresImage: 'spatial/tissue_hires_image.png',
      },
    })
    expect(
      vi
        .mocked(fetcher)
        .mock.calls.some(([url]) => String(url).includes('binned_outputs')),
    ).toBe(false)
  })

  it('detects Space Ranger 1.x output from tissue_positions_list.csv', async () => {
    const detection = await detectSpatialDataset('https://example.test/sr1', {
      fetcher: fetcherForOkPaths([
        '/sr1/spatial/tissue_positions_list.csv',
        '/sr1/spatial/scalefactors_json.json',
        '/sr1/filtered_feature_bc_matrix.h5',
        '/sr1/spatial/tissue_lowres_image.png',
      ]),
    })

    expect(detection).toMatchObject({
      platform: 'visium',
      files: {
        tissuePositions: 'spatial/tissue_positions_list.csv',
        lowresImage: 'spatial/tissue_lowres_image.png',
      },
    })
    expect(detection.platform === 'visium' ? detection.files.hiresImage : null).toBe(
      undefined,
    )
  })

  it('does not detect standard Visium without the filtered matrix', async () => {
    await expect(
      detectSpatialDataset('https://example.test/partial', {
        fetcher: fetcherForOkPaths([
          '/partial/spatial/tissue_positions.csv',
          '/partial/spatial/scalefactors_json.json',
        ]),
      }),
    ).resolves.toMatchObject({ platform: 'unknown' })
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
    ['QPTIFF', 'https://example.test/images/Scan1.er.qptiff'],
    ['SVS', 'https://example.test/images/CMU-1.svs'],
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

  it.each([
    ['qptiff', 'https://example.test/images/Scan1.er.qptiff'],
    ['svs', 'https://example.test/images/CMU-1.svs'],
  ])('labels a %s URL with its image kind', async (imageKind, url) => {
    const fetcher = fetcherForOkPaths([new URL(url).pathname])

    await expect(detectSpatialDataset(url, { fetcher })).resolves.toMatchObject({
      platform: 'image',
      imageKind,
    })
  })

  it('classifies only direct image extensions as image-only URLs', () => {
    expect(isImageOnlyUrl('https://example.test/sample.ome.tif')).toBe(true)
    expect(isImageOnlyUrl('https://example.test/sample.ome.tiff?token=1')).toBe(true)
    expect(isImageOnlyUrl('https://example.test/sample.tif')).toBe(true)
    expect(isImageOnlyUrl('https://example.test/sample.tiff#view')).toBe(true)
    expect(isImageOnlyUrl('https://example.test/sample.ndpi')).toBe(true)
    expect(isImageOnlyUrl('https://example.test/sample.qptiff')).toBe(true)
    expect(isImageOnlyUrl('https://example.test/sample.svs')).toBe(true)
    expect(isImageOnlyUrl('https://example.test/sample.ome.zarr')).toBe(true)
    expect(isImageOnlyUrl('https://example.test/sample.zarr?token=1')).toBe(true)
    expect(isImageOnlyUrl('https://example.test/sample/zarr.json')).toBe(true)
    expect(isImageOnlyUrl('https://example.test/sample/.zattrs')).toBe(true)
    expect(isImageOnlyUrl('https://example.test/sample.tif/metadata.json')).toBe(false)
    expect(isImageOnlyUrl('https://example.test/sample.h5ad')).toBe(false)
  })

  it.each([
    [
      'OME-Zarr directory',
      'https://example.test/images/sample.ome.zarr/',
      '/images/sample.ome.zarr/zarr.json',
    ],
    [
      'Zarr directory',
      'https://example.test/images/sample.zarr',
      '/images/sample.zarr/.zattrs',
    ],
    [
      'OME-Zarr v3 metadata URL',
      'https://example.test/images/sample/zarr.json',
      '/images/sample/zarr.json',
    ],
    [
      'OME-Zarr v2 metadata URL',
      'https://example.test/images/sample/.zattrs',
      '/images/sample/.zattrs',
    ],
  ])('detects a direct %s image source', async (_name, url, okPath) => {
    const fetcher = fetcherForOkPaths([okPath])

    await expect(detectSpatialDataset(url, { fetcher })).resolves.toMatchObject({
      platform: 'image',
      baseUrl: url.replace(/\/+$/, ''),
      imageUrl: url.replace(/\/+$/, ''),
      imageKind: 'ome-zarr',
    })

    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining(okPath),
      expect.objectContaining({ method: 'HEAD' }),
    )
  })

  it('detects OME-Zarr metadata from a plain directory URL after Xenium probing', async () => {
    const fetcher = fetcherForOkPaths(['/images/plain/zarr.json'])

    await expect(
      detectSpatialDataset('https://example.test/images/plain/', { fetcher }),
    ).resolves.toMatchObject({
      platform: 'image',
      baseUrl: 'https://example.test/images/plain',
      imageUrl: 'https://example.test/images/plain/zarr.json',
      imageKind: 'ome-zarr',
    })

    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/images/plain/experiment.xenium',
      expect.objectContaining({ method: 'HEAD' }),
    )
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/images/plain/zarr.json',
      expect.objectContaining({ method: 'HEAD' }),
    )
  })

  it('detects a SpatialData store from root attributes on a .zarr URL', async () => {
    const fetcher = fetcherForJsonPaths({
      '/stores/sample.sdata.zarr/.zattrs': { spatialdata_attrs: { version: '0.1' } },
    })

    await expect(
      detectSpatialDataset('https://example.test/stores/sample.sdata.zarr/', { fetcher }),
    ).resolves.toMatchObject({
      platform: 'spatialdata',
      baseUrl: 'https://example.test/stores/sample.sdata.zarr',
      spatialDataUrl: 'https://example.test/stores/sample.sdata.zarr',
    })
  })

  it('detects a Zarr v3 SpatialData store from a plain directory URL', async () => {
    const fetcher = fetcherForJsonPaths({
      '/stores/sample.sdata/zarr.json': {
        zarr_format: 3,
        node_type: 'group',
        attributes: { spatialdata_attrs: { version: '0.2' } },
      },
    })

    await expect(
      detectSpatialDataset('https://example.test/stores/sample.sdata', { fetcher }),
    ).resolves.toMatchObject({
      platform: 'spatialdata',
      spatialDataUrl: 'https://example.test/stores/sample.sdata',
    })
  })

  it('keeps SpatialData image elements on the OME-Zarr image path', async () => {
    const fetcher = fetcherForJsonPaths({
      '/stores/sample.zarr/images/he/.zattrs': {
        spatialdata_attrs: { version: '0.1' },
        multiscales: [{ datasets: [{ path: '0' }] }],
      },
    })

    await expect(
      detectSpatialDataset('https://example.test/stores/sample.zarr/images/he', {
        fetcher,
      }),
    ).resolves.toMatchObject({ platform: 'image', imageKind: 'ome-zarr' })
  })

  it('creates a SpatialData dataset for SpatialData stores', async () => {
    const dataset = await createSpatialDataset(
      'https://example.test/stores/sample.sdata.zarr',
      {
        fetcher: fetcherForJsonPaths({
          '/stores/sample.sdata.zarr/.zattrs': { spatialdata_attrs: { version: '0.1' } },
        }),
      },
    )

    expect(dataset).toBeInstanceOf(SpatialDataDataset)
  })

  it('builds a fresh cached SpatialData instance when the selection changes', async () => {
    const url = 'https://example.test/stores/selected.zarr'
    vi.stubGlobal(
      'fetch',
      fetcherForJsonPaths({
        '/stores/selected.zarr/.zattrs': { spatialdata_attrs: { version: '0.1' } },
      }),
    )

    try {
      const first = await cachedSpatialDataset(url)
      await expect(cachedSpatialDataset(`${url}/`)).resolves.toBe(first)

      setSpatialDataSelection(url, { image: 'he', micrometersPerUnit: 0.2125 })
      expect(spatialDataSelectionFor(`${url}/`)).toEqual({
        image: 'he',
        micrometersPerUnit: 0.2125,
      })

      const second = await cachedSpatialDataset(url)
      expect(second).toBeInstanceOf(SpatialDataDataset)
      expect(second).not.toBe(first)
    } finally {
      setSpatialDataSelection(url, undefined)
      vi.unstubAllGlobals()
    }
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

  it('creates an Atera dataset with manifest file locations', async () => {
    const fetcher = fetcherForJsonPaths({
      '/atera-manifest/explorer.json': {
        version: 1,
        platform: 'atera',
        files: { cells: 'segmentation/cells.zarr.zip' },
      },
    })
    const dataset = await createSpatialDataset('https://example.test/atera-manifest/', {
      fetcher,
    })

    expect(dataset).toBeInstanceOf(AteraDataset)
    await expect((dataset as AteraDataset).fileUrl('cells')).resolves.toBe(
      'https://example.test/atera-manifest/segmentation/cells.zarr.zip',
    )
  })

  it('resolves Atera files against the root of a manifest entered by URL', async () => {
    const fetcher = fetcherForJsonPaths({
      '/manifests/atera.json': {
        version: 1,
        platform: 'atera',
        root: '../runs/atera-1',
      },
    })
    const dataset = await createSpatialDataset(
      'https://example.test/manifests/atera.json',
      {
        fetcher,
      },
    )

    expect(dataset).toBeInstanceOf(AteraDataset)
    await expect((dataset as AteraDataset).fileUrl('experiment')).resolves.toBe(
      'https://example.test/runs/atera-1/experiment.spatial',
    )
    await expect((dataset as AteraDataset).fileUrl('cells')).resolves.toBe(
      'https://example.test/runs/atera-1/cells.zarr.zip',
    )
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

  it('creates an image-only dataset for direct OME-Zarr URLs', async () => {
    const dataset = await createSpatialDataset(
      'https://example.test/images/sample.ome.zarr',
      {
        fetcher: fetcherForOkPaths(['/images/sample.ome.zarr/zarr.json']),
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

describe('dataset manifests', () => {
  it('detects a folder manifest and resolves relocated files through it', async () => {
    const baseUrl = 'https://example.test/manifest-xenium'
    const fetcher = fetcherForResponses({
      '/manifest-xenium/explorer.json': () =>
        Response.json({
          version: 1,
          platform: 'xenium',
          name: 'Renamed run',
          files: {
            cells: 'tables/cells_v2.parquet',
            cellFeatureMatrix: 'https://cdn.example.test/matrix.zarr.zip',
          },
        }),
    })

    try {
      const detection = await detectSpatialDataset(`${baseUrl}/`, { fetcher })

      expect(detection).toMatchObject({
        platform: 'xenium',
        baseUrl,
        manifest: { name: 'Renamed run', rootUrl: baseUrl },
      })
      expect(datasetFileUrlFor(baseUrl, 'cells')).toBe(
        `${baseUrl}/tables/cells_v2.parquet`,
      )
      expect(datasetFileLabelFor(baseUrl, 'cells')).toBe('tables/cells_v2.parquet')
      expect(datasetFileUrlFor(baseUrl, 'cellFeatureMatrix')).toBe(
        'https://cdn.example.test/matrix.zarr.zip',
      )
      // Files the manifest leaves out keep their standard names.
      expect(datasetFileUrlFor(baseUrl, 'transcripts')).toBe(
        `${baseUrl}/transcripts.parquet`,
      )
      expect(datasetFileLabelFor(baseUrl, 'transcripts')).toBe('transcripts.parquet')
    } finally {
      setDatasetManifest(baseUrl, undefined)
    }
  })

  it('loads a manifest URL and resolves paths against its folder or root', async () => {
    const manifestUrl = 'https://example.test/manifests/run-7.json'
    const fetcher = fetcherForResponses({
      '/manifests/run-7.json': () =>
        Response.json({
          version: 1,
          platform: 'xenium',
          root: '../outputs/run-7',
        }),
    })

    try {
      await expect(detectSpatialDataset(manifestUrl, { fetcher })).resolves.toMatchObject(
        {
          platform: 'xenium',
          baseUrl: manifestUrl,
        },
      )
      expect(datasetFileUrlFor(manifestUrl, 'cells')).toBe(
        'https://example.test/outputs/run-7/cells.parquet',
      )
      expect(datasetFileUrl(manifestUrl, 'morphology_focus/ch0000.ome.tif')).toBe(
        'https://example.test/outputs/run-7/morphology_focus/ch0000.ome.tif',
      )
      // The manifest, then the root folder's index page.
      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(fetcher).toHaveBeenLastCalledWith(
        'https://example.test/outputs/run-7/',
        expect.objectContaining({ cache: 'no-cache' }),
      )
    } finally {
      setDatasetManifest(manifestUrl, undefined)
    }
  })

  it('points H5AD, image, and SpatialData sources at the manifest file', async () => {
    const fetcher = fetcherForResponses({
      '/m/h5ad.json': () =>
        Response.json({ version: 1, platform: 'h5ad', files: { h5ad: 'data/x.h5ad' } }),
      '/m/data/x.h5ad': () => new Response(null, { status: 200 }),
      '/m/image.json': () =>
        Response.json({ version: 1, platform: 'image', files: { image: 'he.ome.zarr' } }),
      '/m/sdata.json': () =>
        Response.json({
          version: 1,
          platform: 'spatialdata',
          files: { store: 'stores/sample.zarr/' },
          options: { coordinateSystem: 'aligned', micrometersPerUnit: 0.5 },
        }),
    })
    const urls = [
      'https://example.test/m/h5ad.json',
      'https://example.test/m/image.json',
      'https://example.test/m/sdata.json',
    ]

    try {
      await expect(
        detectSpatialDataset(urls[0] ?? '', { fetcher }),
      ).resolves.toMatchObject({
        platform: 'h5ad',
        h5adUrl: 'https://example.test/m/data/x.h5ad',
      })
      await expect(
        detectSpatialDataset(urls[1] ?? '', { fetcher }),
      ).resolves.toMatchObject({
        platform: 'image',
        imageUrl: 'https://example.test/m/he.ome.zarr',
        imageKind: 'ome-zarr',
      })
      await expect(
        detectSpatialDataset(urls[2] ?? '', { fetcher }),
      ).resolves.toMatchObject({
        platform: 'spatialdata',
        spatialDataUrl: 'https://example.test/m/stores/sample.zarr',
      })
      // The manifest's options are the starting selection until the viewer
      // sets one, which replaces them.
      expect(spatialDataSelectionFor(urls[2] ?? '')).toEqual({
        coordinateSystem: 'aligned',
        micrometersPerUnit: 0.5,
      })
      setSpatialDataSelection(urls[2] ?? '', { coordinateSystem: 'global' })
      expect(spatialDataSelectionFor(urls[2] ?? '')).toEqual({
        coordinateSystem: 'global',
      })
    } finally {
      setSpatialDataSelection(urls[2] ?? '', undefined)

      for (const url of urls) {
        setDatasetManifest(url, undefined)
      }
    }
  })

  it('reports an unreadable H5AD file named by the manifest', async () => {
    const url = 'https://example.test/m/missing-h5ad.json'
    const fetcher = fetcherForResponses({
      '/m/missing-h5ad.json': () =>
        Response.json({ version: 1, platform: 'h5ad', files: { h5ad: 'gone.h5ad' } }),
    })

    await expect(detectSpatialDataset(url, { fetcher })).rejects.toThrow(
      'missing-h5ad.json: "files.h5ad" (https://example.test/m/gone.h5ad) is not readable (HTTP 404).',
    )
  })

  it('rejects an entered manifest URL that is missing or invalid', async () => {
    const fetcher = fetcherForResponses({
      '/m/broken.json': () => new Response('{ "version": 1, ', { status: 200 }),
      '/m/typo.json': () =>
        Response.json({ version: 1, platform: 'xenium', files: { cell: 'c.parquet' } }),
    })

    await expect(
      detectSpatialDataset('https://example.test/m/absent.json', { fetcher }),
    ).rejects.toThrow('absent.json: could not be read (HTTP 404).')
    await expect(
      detectSpatialDataset('https://example.test/m/broken.json', { fetcher }),
    ).rejects.toThrow('broken.json: is not valid JSON.')
    await expect(
      detectSpatialDataset('https://example.test/m/typo.json', { fetcher }),
    ).rejects.toBeInstanceOf(DatasetManifestError)
  })

  it('ignores probed documents that are not manifests', async () => {
    const fetcher = fetcherForResponses({
      '/spa/explorer.json': () =>
        new Response('<!doctype html><title>App</title>', { status: 200 }),
      '/spa/experiment.xenium': () => new Response(null, { status: 200 }),
      '/empty/explorer.json': () => Response.json({}),
      '/empty/experiment.xenium': () => new Response(null, { status: 200 }),
    })

    await expect(
      detectSpatialDataset('https://example.test/spa', { fetcher }),
    ).resolves.toMatchObject({ platform: 'xenium' })
    await expect(
      detectSpatialDataset('https://example.test/empty', { fetcher }),
    ).resolves.toMatchObject({ platform: 'xenium' })
  })

  it('reports an invalid probed manifest instead of ignoring it', async () => {
    const baseUrl = 'https://example.test/invalid-folder'
    setDatasetManifest(baseUrl, {
      platform: 'xenium',
      url: `${baseUrl}/explorer.json`,
      rootUrl: 'https://example.test/stale',
      files: {},
    })
    const fetcher = fetcherForResponses({
      '/invalid-folder/explorer.json': () =>
        Response.json({ version: 1, platform: 'xenium', defaults: { opacity: 1 } }),
      '/invalid-folder/experiment.xenium': () => new Response(null, { status: 200 }),
    })

    await expect(detectSpatialDataset(baseUrl, { fetcher })).rejects.toThrow(
      'unknown field "defaults.opacity"',
    )
    expect(datasetManifestFor(baseUrl)).toBeUndefined()
  })

  it('drops a manifest registered by an earlier detection once it is gone', async () => {
    const baseUrl = 'https://example.test/removed-manifest'
    setDatasetManifest(baseUrl, {
      platform: 'xenium',
      url: `${baseUrl}/explorer.json`,
      rootUrl: 'https://example.test/elsewhere',
      files: {},
    })

    await expect(
      detectSpatialDataset(baseUrl, {
        fetcher: fetcherForOkPaths(['/removed-manifest/experiment.xenium']),
      }),
    ).resolves.toMatchObject({ platform: 'xenium' })
    expect(datasetManifestFor(baseUrl)).toBeUndefined()
    expect(datasetFileUrlFor(baseUrl, 'cells')).toBe(`${baseUrl}/cells.parquet`)
  })

  it('builds Visium HD bins from the manifest and checks their files', async () => {
    const baseUrl = 'https://example.test/vhd'
    const okPaths = [
      '/vhd/bins/008/spatial/tissue_positions.parquet',
      '/vhd/bins/008/spatial/scalefactors_json.json',
      '/vhd/matrices/008.h5',
    ]
    const manifest = {
      version: 1,
      platform: 'visium-hd',
      files: {
        bins: [{ size: 8, path: 'bins/008', filteredMatrix: 'matrices/008.h5' }],
        featureSlice: 'slices/feature_slice.h5',
        segmentedOutputs: { cellSegmentations: 'seg/cells.geojson' },
      },
      options: { binSize: 8 },
    }
    const fetcher = fetcherForResponses({
      '/vhd/explorer.json': () => Response.json(manifest),
      ...Object.fromEntries(
        okPaths.map((path) => [path, () => new Response(null, { status: 200 })]),
      ),
    })

    try {
      const detection = await detectSpatialDataset(baseUrl, { fetcher })

      expect(detection).toMatchObject({
        platform: 'visium-hd',
        bins: [
          {
            binSizeMicrometers: 8,
            outputPath: 'bins/008',
            tissuePositionsPath: 'bins/008/spatial/tissue_positions.parquet',
            filteredMatrixH5Path: 'matrices/008.h5',
          },
        ],
        segmentedOutputs: { cellSegmentationsGeojsonPath: 'seg/cells.geojson' },
      })

      const dataset = await createSpatialDataset(baseUrl, { fetcher })
      expect(dataset).toBeInstanceOf(VisiumHdDataset)
      expect(dataset).toMatchObject({
        readers: {
          defaultBinSizeMicrometers: 8,
          featureSliceH5Path: 'slices/feature_slice.h5',
        },
      })

      const incomplete = fetcherForResponses({
        '/vhd/explorer.json': () => Response.json(manifest),
      })
      await expect(
        detectSpatialDataset(baseUrl, { fetcher: incomplete }),
      ).rejects.toThrow(
        'the 8 µm bin is missing bins/008/spatial/tissue_positions.parquet (HTTP 404).',
      )
    } finally {
      setDatasetManifest(baseUrl, undefined)
    }
  })
})

describe('standard Visium manifests', () => {
  it('uses manifest file names, falls back to Space Ranger names, and checks both', async () => {
    const baseUrl = 'https://example.test/geo/explorer.json'
    const manifest = {
      version: 1,
      platform: 'visium',
      root: 'suppl/',
      files: {
        tissuePositions: 'GSM1_tissue_positions_list.csv.gz',
        filteredMatrix: 'GSM1_filtered_feature_bc_matrix.h5',
        hiresImage: 'GSM1_tissue_hires_image.png',
        clusters: 'GSM1_clusters.csv',
      },
    }
    const fetcher = fetcherForResponses({
      '/geo/explorer.json': () => Response.json(manifest),
      '/geo/suppl/GSM1_tissue_positions_list.csv.gz': () => new Response(null),
      '/geo/suppl/GSM1_filtered_feature_bc_matrix.h5': () => new Response(null),
      '/geo/suppl/GSM1_tissue_hires_image.png': () => new Response(null),
      '/geo/suppl/spatial/scalefactors_json.json': () => new Response(null),
    })

    try {
      await expect(detectSpatialDataset(baseUrl, { fetcher })).resolves.toMatchObject({
        platform: 'visium',
        files: {
          tissuePositions: 'GSM1_tissue_positions_list.csv.gz',
          scalefactors: 'spatial/scalefactors_json.json',
          filteredMatrix: 'GSM1_filtered_feature_bc_matrix.h5',
          hiresImage: 'GSM1_tissue_hires_image.png',
          analysis: { clusters: 'GSM1_clusters.csv' },
        },
      })
      expect(datasetFileUrl(baseUrl, 'GSM1_clusters.csv')).toBe(
        'https://example.test/geo/suppl/GSM1_clusters.csv',
      )

      const dataset = await createSpatialDataset(baseUrl, { fetcher })
      expect(dataset).toBeInstanceOf(AnnDataH5adDataset)
      expect(dataset).toMatchObject({
        visiumImageUrls: {
          hires: 'https://example.test/geo/suppl/GSM1_tissue_hires_image.png',
        },
      })

      const missingImage = fetcherForResponses({
        '/geo/explorer.json': () => Response.json(manifest),
        '/geo/suppl/GSM1_tissue_positions_list.csv.gz': () => new Response(null),
        '/geo/suppl/GSM1_filtered_feature_bc_matrix.h5': () => new Response(null),
        '/geo/suppl/spatial/scalefactors_json.json': () => new Response(null),
      })
      await expect(
        detectSpatialDataset(baseUrl, { fetcher: missingImage }),
      ).rejects.toThrow(
        /"files.hiresImage" \(.*GSM1_tissue_hires_image.png\) is not readable \(HTTP 404\)/,
      )
    } finally {
      setDatasetManifest(baseUrl, undefined)
    }
  })
})

describe('MERSCOPE output', () => {
  it('detects a region folder from its two cell tables', async () => {
    const fetcher = fetcherForResponses({
      '/region_0/cell_by_gene.csv': () => new Response(null),
      '/region_0/cell_metadata.csv': () => new Response(null),
      '/region_0/cell_boundaries.parquet': () =>
        new Response(null, { headers: { 'Content-Length': '535000000' } }),
    })

    await expect(
      detectSpatialDataset('https://example.test/region_0/', { fetcher }),
    ).resolves.toMatchObject({
      platform: 'merscope',
      baseUrl: 'https://example.test/region_0',
      files: {
        cellByGene: 'cell_by_gene.csv',
        cellMetadata: 'cell_metadata.csv',
        cellBoundaries: 'cell_boundaries.parquet',
        cellBoundariesByteLength: 535000000,
      },
    })

    const dataset = await createSpatialDataset('https://example.test/region_0', {
      fetcher,
    })
    expect(dataset).toBeInstanceOf(MerscopeDataset)
    expect(dataset).toMatchObject({
      files: {
        cellByGene: 'https://example.test/region_0/cell_by_gene.csv',
        cellBoundaries: 'https://example.test/region_0/cell_boundaries.parquet',
      },
      cellBoundariesByteLength: 535000000,
    })
  })

  it('needs both cell tables, and treats boundaries as optional', async () => {
    await expect(
      detectSpatialDataset('https://example.test/region_0', {
        fetcher: fetcherForOkPaths(['/region_0/cell_by_gene.csv']),
      }),
    ).resolves.toMatchObject({ platform: 'unknown' })

    const detection = await detectSpatialDataset('https://example.test/region_0', {
      fetcher: fetcherForOkPaths([
        '/region_0/cell_by_gene.csv',
        '/region_0/cell_metadata.csv',
      ]),
    })
    expect(detection).toMatchObject({ platform: 'merscope' })
    expect(
      detection.platform === 'merscope' ? detection.files.cellBoundaries : null,
    ).toBe(undefined)
  })

  it('reads vpt and GEO file names from a manifest', async () => {
    const baseUrl = 'https://example.test/D082/explorer.json'
    const manifest = {
      version: 1,
      platform: 'merscope',
      root: 'region_0/',
      files: {
        cellByGene: 'baysor_cell_by_gene.csv',
        cellMetadata: 'baysor_cell_metadata.csv',
        cellBoundaries: 'baysor_micron_space.parquet',
      },
    }
    const responses = {
      '/D082/explorer.json': () => Response.json(manifest),
      '/D082/region_0/baysor_cell_by_gene.csv': () => new Response(null),
      '/D082/region_0/baysor_cell_metadata.csv': () => new Response(null),
      '/D082/region_0/baysor_micron_space.parquet': () =>
        new Response(null, { headers: { 'Content-Length': '797415' } }),
    }

    try {
      await expect(
        detectSpatialDataset(baseUrl, { fetcher: fetcherForResponses(responses) }),
      ).resolves.toMatchObject({
        platform: 'merscope',
        files: {
          cellByGene: 'baysor_cell_by_gene.csv',
          cellMetadata: 'baysor_cell_metadata.csv',
          cellBoundaries: 'baysor_micron_space.parquet',
          cellBoundariesByteLength: 797415,
        },
      })
      expect(datasetFileUrl(baseUrl, 'baysor_cell_by_gene.csv')).toBe(
        'https://example.test/D082/region_0/baysor_cell_by_gene.csv',
      )

      const noBoundaries = Object.fromEntries(
        Object.entries(responses).filter(([path]) => !path.endsWith('.parquet')),
      )
      await expect(
        detectSpatialDataset(baseUrl, { fetcher: fetcherForResponses(noBoundaries) }),
      ).rejects.toThrow(
        /"files.cellBoundaries" \(.*baysor_micron_space.parquet\) is not readable \(HTTP 404\)/,
      )

      const unnamed = fetcherForResponses({
        '/D082/explorer.json': () =>
          Response.json({ version: 1, platform: 'merscope', root: 'region_0/' }),
      })
      await expect(detectSpatialDataset(baseUrl, { fetcher: unnamed })).rejects.toThrow(
        'no cell_by_gene.csv under https://example.test/D082/region_0. Name the file in "files.cellByGene".',
      )
    } finally {
      setDatasetManifest(baseUrl, undefined)
    }
  })
})

describe('folder index pages', () => {
  const index =
    (...names: readonly string[]) =>
    () =>
      new Response(
        `<html><head><title>Index of /bia</title></head><body>${names
          .map((name) => `<a href="${name}">${name}</a>`)
          .join('')}</body></html>`,
        { status: 200 },
      )

  it('skips probes for files the folder index page does not list', async () => {
    const fetcher = fetcherForResponses({
      '/bia/': index('experiment.xenium', 'cells.parquet'),
      '/bia/experiment.xenium': () => new Response(null, { status: 200 }),
    })

    try {
      await expect(
        detectSpatialDataset('https://example.test/bia/', { fetcher }),
      ).resolves.toMatchObject({
        platform: 'xenium',
        checked: [
          { path: 'explorer.json', ok: false, error: 'not in the folder listing' },
          expect.objectContaining({ path: 'experiment.xenium', ok: true }),
        ],
      })
      expect(vi.mocked(fetcher).mock.calls.map(([url]) => String(url))).toEqual([
        'https://example.test/bia/',
        'https://example.test/bia/experiment.xenium',
      ])
      // Readers see the listing too.
      expect(isListedAsMissing('https://example.test/bia/transcripts.parquet')).toBe(true)
    } finally {
      clearFolderListings()
    }
  })

  it('still probes dotfiles, which index pages usually hide', async () => {
    const fetcher = fetcherForResponses({ '/bia/': index('notes.txt') })

    try {
      await expect(
        detectSpatialDataset('https://example.test/bia/', { fetcher }),
      ).resolves.toMatchObject({ platform: 'unknown' })
      expect(vi.mocked(fetcher).mock.calls.map(([url]) => String(url))).toEqual([
        'https://example.test/bia/',
        'https://example.test/bia/.zattrs',
      ])
    } finally {
      clearFolderListings()
    }
  })
})

function fetcherForResponses(
  responses: Readonly<Record<string, () => Response>>,
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const respond = responses[new URL(String(input)).pathname]
    return respond === undefined ? new Response(null, { status: 404 }) : respond()
  }) as unknown as typeof fetch
}

function fetcherForOkPaths(paths: readonly string[]): typeof fetch {
  const okPaths = new Set(paths)

  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    const status = okPaths.has(url.pathname) ? 200 : 404
    return new Response(null, { status })
  }) as unknown as typeof fetch
}

function fetcherForJsonPaths(bodies: Readonly<Record<string, unknown>>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const body = bodies[new URL(String(input)).pathname]

    return body === undefined
      ? new Response(null, { status: 404 })
      : Response.json(body, { status: 200 })
  }) as unknown as typeof fetch
}

describe('Icechunk repositories', () => {
  it('detects AnnData in an Icechunk repository and creates an AnnData dataset', async () => {
    const fetcher = icechunkFixtureFetcher()
    const url = `${ICECHUNK_FIXTURE_ORIGIN}/anndata.icechunk/`

    await expect(detectSpatialDataset(url, { fetcher })).resolves.toEqual({
      platform: 'h5ad',
      baseUrl: `${ICECHUNK_FIXTURE_ORIGIN}/anndata.icechunk`,
      h5adUrl: `${ICECHUNK_FIXTURE_ORIGIN}/anndata.icechunk`,
      source: 'icechunk',
      checked: [
        {
          path: 'Icechunk repository (AnnData)',
          url: `${ICECHUNK_FIXTURE_ORIGIN}/anndata.icechunk`,
          ok: true,
        },
      ],
    })

    const dataset = await createSpatialDataset(url, { fetcher })

    expect(dataset).toBeInstanceOf(AnnDataH5adDataset)
    await expect((dataset as AnnDataH5adDataset).genePanel()).resolves.toEqual([
      'Actb',
      'Gad1',
      'Gapdh',
      'Sst',
    ])
  })

  it('opens an H5AD companion repository entered directly against the H5AD next to it', async () => {
    const dataset = await createSpatialDataset(
      `${ICECHUNK_FIXTURE_ORIGIN}/moved.h5ad.icechunk`,
      {
        fetcher: icechunkFixtureFetcher({
          aliases: {
            '/moved.h5ad.icechunk': '/tiny.h5ad.icechunk',
            '/moved.h5ad': '/tiny.h5ad',
          },
        }),
      },
    )

    expect(dataset).toBeInstanceOf(AnnDataH5adDataset)
    await expect((dataset as AnnDataH5adDataset).overview()).resolves.toHaveLength(6)
  })

  it('detects SpatialData in a zip, at its root or in a store folder', async () => {
    const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
    const fetcher = byteRangeFetcher(
      new Map([
        [
          'https://example.test/zips/v3.zarr.zip',
          zipArchive([
            {
              name: 'v3.zarr/zarr.json',
              data: json({
                zarr_format: 3,
                node_type: 'group',
                attributes: { spatialdata_attrs: { version: '0.2' } },
              }),
            },
          ]),
        ],
        [
          'https://example.test/zips/v2.zip',
          zipArchive([
            { name: '.zgroup', data: json({ zarr_format: 2 }) },
            { name: '.zattrs', data: json({ spatialdata_attrs: { version: '0.1' } }) },
          ]),
        ],
        [
          // No root attributes, as some writers leave them out.
          'https://example.test/zips/bare.zarr.zip',
          zipArchive([
            { name: 'bare.zarr/.zgroup', data: json({ zarr_format: 2 }) },
            { name: 'bare.zarr/tables/.zgroup', data: json({ zarr_format: 2 }) },
            { name: 'bare.zarr/shapes/.zgroup', data: json({ zarr_format: 2 }) },
          ]),
        ],
        [
          'https://example.test/zips/image.zarr.zip',
          zipArchive([
            {
              name: 'image.zarr/.zattrs',
              data: json({ multiscales: [{ datasets: [{ path: '0' }] }] }),
            },
            { name: 'image.zarr/labels/.zgroup', data: json({ zarr_format: 2 }) },
          ]),
        ],
      ]),
    )

    await expect(
      detectSpatialDataset('https://example.test/zips/v3.zarr.zip', { fetcher }),
    ).resolves.toMatchObject({
      platform: 'spatialdata',
      spatialDataUrl: 'https://example.test/zips/v3.zarr.zip',
      checked: [
        expect.objectContaining({ path: 'store.zip', ok: true }),
        expect.objectContaining({ path: 'v3.zarr/zarr.json in the zip (SpatialData)' }),
      ],
    })
    await expect(
      detectSpatialDataset('https://example.test/zips/v2.zip', { fetcher }),
    ).resolves.toMatchObject({
      platform: 'spatialdata',
      spatialDataUrl: 'https://example.test/zips/v2.zip',
    })
    await expect(
      detectSpatialDataset('https://example.test/zips/bare.zarr.zip', { fetcher }),
    ).resolves.toMatchObject({
      platform: 'spatialdata',
      checked: [
        expect.objectContaining({ path: 'store.zip' }),
        expect.objectContaining({
          path: 'bare.zarr/ in the zip (SpatialData shapes, tables)',
        }),
      ],
    })
    await expect(
      detectSpatialDataset('https://example.test/zips/image.zarr.zip', { fetcher }),
    ).rejects.toThrow('holds a Zarr store (image.zarr/.zattrs) that is not SpatialData')
    await expect(
      detectSpatialDataset('https://example.test/zips/missing.zarr.zip', { fetcher }),
    ).resolves.toMatchObject({
      platform: 'unknown',
      checked: [expect.objectContaining({ path: 'store.zip', ok: false, status: 404 })],
    })
  })

  it('detects SpatialData and OME-Zarr images in Icechunk repositories', async () => {
    const fetcher = icechunkFixtureFetcher()

    await expect(
      detectSpatialDataset(`${ICECHUNK_FIXTURE_ORIGIN}/spatialdata.icechunk`, {
        fetcher,
      }),
    ).resolves.toMatchObject({
      platform: 'spatialdata',
      spatialDataUrl: `${ICECHUNK_FIXTURE_ORIGIN}/spatialdata.icechunk`,
    })
    await expect(
      detectSpatialDataset(`${ICECHUNK_FIXTURE_ORIGIN}/image.icechunk`, { fetcher }),
    ).resolves.toMatchObject({
      platform: 'image',
      imageUrl: `${ICECHUNK_FIXTURE_ORIGIN}/image.icechunk`,
      imageKind: 'ome-zarr',
    })
  })

  it('reads Icechunk images and SpatialData stores named by a manifest', async () => {
    const fixtures = icechunkFixtureFetcher()
    const manifests: Record<string, unknown> = {
      '/image-manifest.json': {
        version: 1,
        platform: 'image',
        files: { image: 'image.icechunk' },
      },
      '/sdata-manifest.json': {
        version: 1,
        platform: 'spatialdata',
        files: { store: 'spatialdata.icechunk/' },
      },
    }
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const manifest = manifests[new URL(String(input)).pathname]
      return manifest === undefined ? fixtures(input, init) : Response.json(manifest)
    }) as typeof fetch
    const urls = Object.keys(manifests).map((path) => `${ICECHUNK_FIXTURE_ORIGIN}${path}`)

    try {
      await expect(
        detectSpatialDataset(urls[0] ?? '', { fetcher }),
      ).resolves.toMatchObject({
        platform: 'image',
        imageUrl: `${ICECHUNK_FIXTURE_ORIGIN}/image.icechunk`,
        imageKind: 'ome-zarr',
      })
      await expect(
        detectSpatialDataset(urls[1] ?? '', { fetcher }),
      ).resolves.toMatchObject({
        platform: 'spatialdata',
        spatialDataUrl: `${ICECHUNK_FIXTURE_ORIGIN}/spatialdata.icechunk`,
      })
    } finally {
      for (const url of urls) {
        setDatasetManifest(url, undefined)
      }
    }
  })

  it('reports an Icechunk URL with no repository', async () => {
    await expect(
      detectSpatialDataset(`${ICECHUNK_FIXTURE_ORIGIN}/missing.icechunk`, {
        fetcher: icechunkFixtureFetcher(),
      }),
    ).rejects.toMatchObject({
      name: 'IcechunkRepositoryUnavailableError',
      message: expect.stringContaining('Not a valid icechunk repository'),
    })
  })
})

describe('AnnData Zarr stores', () => {
  it('detects AnnData from the root attributes of a .zarr URL and creates an AnnData dataset', async () => {
    const fetcher = annDataZarrFixtureFetcher({ hidden: ['/tiny.zarr/.zmetadata'] })
    const url = `${ANNDATA_ZARR_FIXTURE_ORIGIN}/tiny.zarr`

    await expect(detectSpatialDataset(`${url}/`, { fetcher })).resolves.toEqual({
      platform: 'h5ad',
      baseUrl: url,
      h5adUrl: url,
      source: 'zarr',
      checked: [
        { path: 'zarr.json', url: `${url}/zarr.json`, ok: false, status: 404 },
        { path: '.zattrs', url: `${url}/.zattrs`, ok: true, status: 200 },
        { path: '.zattrs (AnnData)', url: `${url}/.zattrs`, ok: true, status: 200 },
      ],
    })

    const dataset = await createSpatialDataset(url, { fetcher })

    expect(dataset).toBeInstanceOf(AnnDataH5adDataset)
    await expect((dataset as AnnDataH5adDataset).genePanel()).resolves.toEqual([
      'Actb',
      'Gad1',
      'Gapdh',
      'Sst',
    ])
  })

  it('detects AnnData in a Zarr v3 store from a plain directory URL', async () => {
    const fetcher = annDataZarrFixtureFetcher({
      aliases: { '/datasets/heart': '/tiny.v3.zarr' },
    })
    const url = `${ANNDATA_ZARR_FIXTURE_ORIGIN}/datasets/heart`
    const detection = await detectSpatialDataset(`${url}/`, { fetcher })

    expect(detection).toMatchObject({
      platform: 'h5ad',
      baseUrl: url,
      h5adUrl: url,
      source: 'zarr',
    })
    expect(detection.checked.at(-1)).toEqual({
      path: 'zarr.json (AnnData)',
      url: `${url}/zarr.json`,
      ok: true,
      status: 200,
    })
  })
})
