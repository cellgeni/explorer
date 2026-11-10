import { describe, expect, it, vi } from 'vitest'
import { runDatasetDiagnostics, summarizeDatasetDiagnostics } from './datasetDiagnostics'
import type { SpatialDatasetDetection } from '../datasets/datasetFactory'
import { setDatasetManifest } from './datasetFiles'
import { ICECHUNK_FIXTURE_ORIGIN, icechunkFixtureFetcher } from '../test/icechunkFixtures'

describe('runDatasetDiagnostics', () => {
  it('reads the first expression chunk of AnnData in an Icechunk repository', async () => {
    const report = await runDatasetDiagnostics(
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

    expect(report.platform).toBe('h5ad')
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: 'icechunk-repository',
        status: 'pass',
        message: expect.stringMatching(
          /^\d+ groups and arrays; read the first chunk of \/X\/data$/,
        ),
      }),
    )
    expect(summarizeDatasetDiagnostics(report)).toBe('All checks passed')
  })

  it('fails the Icechunk check when the referenced file is unreadable', async () => {
    const report = await runDatasetDiagnostics(
      `${ICECHUNK_FIXTURE_ORIGIN}/moved.h5ad.icechunk`,
      {
        fetcher: icechunkFixtureFetcher({
          aliases: { '/moved.h5ad.icechunk': '/tiny.h5ad.icechunk' },
        }),
      },
    )

    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: 'icechunk-repository',
        status: 'fail',
        message: expect.stringContaining('/moved.h5ad'),
      }),
    )
  })

  it('reports an Icechunk URL with no repository as a failed check', async () => {
    const report = await runDatasetDiagnostics(
      `${ICECHUNK_FIXTURE_ORIGIN}/missing.icechunk`,
      { fetcher: icechunkFixtureFetcher() },
    )

    expect(report.platform).toBe('unknown')
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: 'icechunk-repository',
        status: 'fail',
        url: `${ICECHUNK_FIXTURE_ORIGIN}/missing.icechunk`,
      }),
    ])
  })

  it('checks required manifest and byte-range files', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }))
    const rangeValidator = vi.fn(async () => undefined)

    const report = await runDatasetDiagnostics('https://example.test/output', {
      fetcher,
      rangeValidator,
    })

    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/output/experiment.xenium',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(rangeValidator).toHaveBeenCalledWith(
      'https://example.test/output/cells.parquet',
      expect.objectContaining({ label: 'Overview cells' }),
    )
    expect(summarizeDatasetDiagnostics(report)).toBe('All checks passed')
  })

  it('checks the files a dataset manifest names', async () => {
    const baseUrl = 'https://example.test/renamed'
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.endsWith('/explorer.json')) {
        return Response.json({
          version: 1,
          platform: 'xenium',
          name: 'Renamed run',
          files: { cells: 'tables/cells.parquet', morphology: 'images/he.ome.tif' },
        })
      }

      return new Response(null, { status: url.endsWith('experiment.xenium') ? 404 : 200 })
    })
    const rangeValidator = vi.fn(async () => undefined)

    try {
      const report = await runDatasetDiagnostics(baseUrl, { fetcher, rangeValidator })
      const check = (id: string) => report.checks.find((entry) => entry.id === id)

      expect(check('dataset-manifest')).toMatchObject({
        status: 'pass',
        url: `${baseUrl}/explorer.json`,
        message: 'Valid xenium manifest: Renamed run',
      })
      expect(check('cells-parquet')?.url).toBe(`${baseUrl}/tables/cells.parquet`)
      expect(check('morphology')?.url).toBe(`${baseUrl}/images/he.ome.tif`)
      // experiment.xenium is optional once a manifest describes the dataset.
      expect(check('experiment-manifest')).toMatchObject({
        required: false,
        status: 'warning',
      })
    } finally {
      setDatasetManifest(baseUrl, undefined)
    }
  })

  it('reports an invalid dataset manifest as a failed check', async () => {
    const report = await runDatasetDiagnostics('https://example.test/bad.json', {
      fetcher: vi.fn(async () =>
        Response.json({ version: 1, platform: 'xenium', files: { cell: 'x.parquet' } }),
      ),
      rangeValidator: vi.fn(async () => undefined),
    })

    expect(report.platform).toBe('unknown')
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: 'dataset-manifest',
        status: 'fail',
        message: expect.stringContaining('unknown field "files.cell"'),
      }),
    ])
  })

  it('treats optional file misses as warnings', async () => {
    const report = await runDatasetDiagnostics('https://example.test/output', {
      fetcher: vi.fn(async () => new Response('{}', { status: 200 })),
      rangeValidator: vi.fn(async (url: string) => {
        if (url.endsWith('cell_boundaries.parquet')) {
          throw new Error('HTTP 404')
        }
      }),
    })

    expect(report.checks.find((check) => check.id === 'cell-boundaries')?.status).toBe(
      'warning',
    )
    expect(summarizeDatasetDiagnostics(report)).toContain('warnings')
  })

  it('checks SpatialData metadata and region shapes instead of Xenium files', async () => {
    const storeUrl = 'https://example.test/sample.sdata.zarr'
    const detection: SpatialDatasetDetection = {
      platform: 'spatialdata',
      baseUrl: storeUrl,
      spatialDataUrl: storeUrl,
      checked: [],
    }
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input)

      return url.endsWith('/zmetadata')
        ? Response.json({
            zarr_consolidated_format: 1,
            metadata: {
              '.zgroup': { zarr_format: 2 },
              'shapes/spots/.zgroup': { zarr_format: 2 },
              'shapes/spots/.zattrs': {
                coordinateTransformations: [
                  {
                    type: 'identity',
                    input: { axes: ['x', 'y'] },
                    output: { name: 'global' },
                  },
                ],
              },
              'tables/table/.zgroup': { zarr_format: 2 },
              'tables/table/.zattrs': { region: 'spots', instance_key: 'spot_id' },
            },
          })
        : new Response(null, { status: 404 })
    }) as unknown as typeof fetch
    const rangeValidator = vi.fn(async () => undefined)

    const report = await runDatasetDiagnostics(storeUrl, {
      detectDataset: vi.fn(async () => detection),
      fetcher,
      rangeValidator,
    })

    expect(report.platform).toBe('spatialdata')
    expect(report.checks.map((check) => [check.id, check.status, check.message])).toEqual(
      [
        ['dataset-layout', 'pass', 'Detected SpatialData'],
        [
          'spatialdata-metadata',
          'pass',
          'Coordinate system global; image none; table table',
        ],
        ['spatialdata-table-chunks', 'pass', 'All 0 table chunks readable'],
        ['spatialdata-shapes-spots', 'pass', 'Byte-range readable'],
      ],
    )
    expect(rangeValidator).toHaveBeenCalledWith(
      `${storeUrl}/shapes/spots/shapes.parquet`,
      expect.objectContaining({ label: 'SpatialData shapes spots' }),
    )
  })

  it('checks Atera files at the paths experiment.spatial lists', async () => {
    const baseUrl = 'https://example.test/atera'
    const detection: SpatialDatasetDetection = {
      platform: 'atera',
      baseUrl,
      checked: [],
    }
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === `${baseUrl}/experiment.spatial`
        ? Response.json({
            pixel_size: 0.2125,
            num_cells: 93864,
            panel_wta: { panel_name: 'Atera Human WTA' },
            images: { morphology_2d_filepath: 'morphology_2d/ch0000_dapi.ome.tif' },
            explorer_files: {
              cells_zarr_filepath: 'segmentation/cells.zarr.zip',
              transcripts_viz_zarr_filepath: 'viz/binned_transcripts.zarr.zip',
            },
          })
        : new Response(null, { status: 404 }),
    ) as unknown as typeof fetch
    const rangeValidator = vi.fn(async (url: string) => {
      if (
        url.endsWith('csc_cell_feature_matrix.zarr.zip') ||
        url.endsWith('/transcripts.zarr.zip')
      ) {
        throw new Error('HTTP 404')
      }
    })

    const report = await runDatasetDiagnostics(baseUrl, {
      detectDataset: vi.fn(async () => detection),
      fetcher,
      rangeValidator,
    })

    expect(report.platform).toBe('atera')
    expect(
      report.checks.map((check) => [
        check.id,
        check.status,
        check.url.replace(baseUrl, ''),
      ]),
    ).toEqual([
      ['dataset-layout', 'pass', ''],
      ['experiment-manifest', 'pass', '/experiment.spatial'],
      ['cellFeatureMatrix', 'pass', '/cell_feature_matrix.zarr.zip'],
      ['cscCellFeatureMatrix', 'fail', '/csc_cell_feature_matrix.zarr.zip'],
      ['cells', 'pass', '/segmentation/cells.zarr.zip'],
      ['binnedTranscripts', 'pass', '/viz/binned_transcripts.zarr.zip'],
      ['transcripts', 'warning', '/transcripts.zarr.zip'],
      ['morphology', 'pass', '/morphology_2d/ch0000_dapi.ome.tif'],
    ])
    expect(report.checks[1]?.message).toBe('Atera Human WTA; 93,864 cells; 0.2125 µm/px')
  })

  it('reports SpatialData table chunks that are missing or unreadable', async () => {
    const storeUrl = 'https://example.test/upload.sdata.zarr'
    const array = (dtype: string, extra: Record<string, unknown> = {}) => ({
      zarr_format: 2,
      shape: [4],
      chunks: [2],
      dtype,
      compressor: null,
      fill_value: 0,
      order: 'C',
      filters: null,
      dimension_separator: '/',
      ...extra,
    })
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input)

      if (url.endsWith('/zmetadata')) {
        return Response.json({
          zarr_consolidated_format: 1,
          metadata: {
            '.zgroup': { zarr_format: 2 },
            'tables/table/.zgroup': { zarr_format: 2 },
            'shapes/cells/.zgroup': { zarr_format: 2 },
            'shapes/cells/.zattrs': {
              coordinateTransformations: [
                {
                  type: 'identity',
                  input: { axes: ['x', 'y'] },
                  output: { name: 'global' },
                },
              ],
            },
            'tables/table/.zattrs': { region: 'cells', instance_key: 'cell_id' },
            'tables/table/obs/.zgroup': { zarr_format: 2 },
            'tables/table/obs/_index/.zarray': array('|O', {
              filters: [{ id: 'vlen-utf8' }],
            }),
            'tables/table/obs/area/.zarray': array('<f8'),
          },
        })
      }

      expect(init?.method).toBe('HEAD')
      const status = url.endsWith('obs/_index/1')
        ? 403
        : url.endsWith('obs/area/1')
          ? 404
          : 200
      return new Response(null, { status })
    }) as unknown as typeof fetch

    const report = await runDatasetDiagnostics(storeUrl, {
      detectDataset: vi.fn(async () => ({
        platform: 'spatialdata' as const,
        baseUrl: storeUrl,
        spatialDataUrl: storeUrl,
        checked: [],
      })),
      fetcher,
      rangeValidator: vi.fn(async () => undefined),
    })
    const chunks = report.checks.find((check) => check.id === 'spatialdata-table-chunks')

    expect(chunks).toMatchObject({
      status: 'fail',
      message:
        '2 of 4 table chunks missing or unreadable: tables/table/obs/_index/1 (HTTP 403), tables/table/obs/area/1 (HTTP 404)',
    })
  })

  it('checks Visium HD binned outputs instead of Xenium files', async () => {
    const detection: SpatialDatasetDetection = {
      platform: 'visium-hd',
      baseUrl: 'https://example.test/visium',
      segmentedScalefactorsPath: 'segmented_outputs/spatial/scalefactors_json.json',
      segmentedOutputs: {
        scalefactorsPath: 'segmented_outputs/spatial/scalefactors_json.json',
        filteredFeatureCellMatrixH5Path:
          'segmented_outputs/filtered_feature_cell_matrix.h5',
        cellSegmentationsGeojsonPath: 'segmented_outputs/cell_segmentations.geojson',
      },
      bins: [
        {
          binSizeMicrometers: 16,
          outputPath: 'binned_outputs/square_016um',
          tissuePositionsPath:
            'binned_outputs/square_016um/spatial/tissue_positions.parquet',
          scalefactorsPath: 'binned_outputs/square_016um/spatial/scalefactors_json.json',
          filteredMatrixH5Path:
            'binned_outputs/square_016um/filtered_feature_bc_matrix.h5',
        },
      ],
      checked: [],
    }
    const detectDataset = vi.fn(async () => detection)
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }))
    const rangeValidator = vi.fn(async () => undefined)

    const report = await runDatasetDiagnostics('https://example.test/visium', {
      detectDataset,
      fetcher,
      rangeValidator,
    })

    expect(report.platform).toBe('visium-hd')
    expect(report.checks.find((check) => check.id === 'dataset-layout')).toMatchObject({
      status: 'pass',
      message: 'Detected Visium HD (16 µm)',
    })
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/visium/binned_outputs/square_016um/spatial/scalefactors_json.json',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/visium/segmented_outputs/spatial/scalefactors_json.json',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/visium/segmented_outputs/cell_segmentations.geojson',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/visium/segmented_outputs/nucleus_segmentations.geojson',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(rangeValidator).toHaveBeenCalledWith(
      'https://example.test/visium/binned_outputs/square_016um/spatial/tissue_positions.parquet',
      expect.objectContaining({ label: 'Visium HD 16um positions' }),
    )
    expect(rangeValidator).toHaveBeenCalledWith(
      'https://example.test/visium/binned_outputs/square_016um/filtered_feature_bc_matrix.h5',
      expect.objectContaining({ label: 'Visium HD 16um filtered matrix' }),
    )
    expect(rangeValidator).toHaveBeenCalledWith(
      'https://example.test/visium/feature_slice.h5',
      expect.objectContaining({ label: 'Feature Slice H5' }),
    )
    expect(rangeValidator).toHaveBeenCalledWith(
      'https://example.test/visium/binned_outputs/square_016um/analysis/umap/gene_expression_2_components/projection.csv',
      expect.objectContaining({ label: 'Visium HD 16um UMAP projection' }),
    )
    expect(rangeValidator).toHaveBeenCalledWith(
      'https://example.test/visium/segmented_outputs/filtered_feature_cell_matrix.h5',
      expect.objectContaining({ label: 'Visium HD filtered feature-cell matrix' }),
    )
    expect(rangeValidator).toHaveBeenCalledWith(
      'https://example.test/visium/segmented_outputs/nucleus_instance_mask.tiff',
      expect.objectContaining({ label: 'Visium HD nucleus instance mask' }),
    )
    expect(fetcher).not.toHaveBeenCalledWith(
      'https://example.test/visium/experiment.xenium',
      expect.anything(),
    )
  })

  it('checks only the selected Visium HD binned mode when provided', async () => {
    const detection: SpatialDatasetDetection = {
      platform: 'visium-hd',
      baseUrl: 'https://example.test/visium',
      bins: [visiumBin(16, 'square_016um'), visiumBin(8, 'square_008um')],
      checked: [],
    }
    const rangeValidator = vi.fn(async () => undefined)

    const report = await runDatasetDiagnostics('https://example.test/visium', {
      detectDataset: vi.fn(async () => detection),
      fetcher: vi.fn(async () => new Response('{}', { status: 200 })),
      rangeValidator,
      visiumHdBinSizeMicrometers: 8,
    })

    expect(report.checks.find((check) => check.id === 'visium-hd-8um-positions')).toEqual(
      expect.objectContaining({ required: true, status: 'pass' }),
    )
    expect(
      report.checks.find((check) => check.id === 'visium-hd-16um-positions'),
    ).toBeUndefined()
    expect(rangeValidator).toHaveBeenCalledWith(
      'https://example.test/visium/binned_outputs/square_008um/spatial/tissue_positions.parquet',
      expect.objectContaining({ label: 'Visium HD 8um positions' }),
    )
    expect(rangeValidator).not.toHaveBeenCalledWith(
      'https://example.test/visium/binned_outputs/square_016um/spatial/tissue_positions.parquet',
      expect.anything(),
    )
  })

  it('fails Visium HD diagnostics when the selected binned mode is absent', async () => {
    const detection: SpatialDatasetDetection = {
      platform: 'visium-hd',
      baseUrl: 'https://example.test/visium',
      bins: [visiumBin(16, 'square_016um')],
      checked: [],
    }

    const report = await runDatasetDiagnostics('https://example.test/visium', {
      detectDataset: vi.fn(async () => detection),
      fetcher: vi.fn(async () => new Response('{}', { status: 200 })),
      rangeValidator: vi.fn(async () => undefined),
      visiumHdBinSizeMicrometers: 8,
    })

    expect(
      report.checks.find((check) => check.id === 'visium-hd-8um-selected-bin'),
    ).toEqual(
      expect.objectContaining({
        required: true,
        status: 'fail',
        message: 'Selected binned output was not detected.',
      }),
    )
  })
})

function visiumBin(
  binSizeMicrometers: 8 | 16,
  directory: string,
): Extract<SpatialDatasetDetection, { readonly platform: 'visium-hd' }>['bins'][number] {
  const outputPath = `binned_outputs/${directory}`

  return {
    binSizeMicrometers,
    outputPath,
    tissuePositionsPath: `${outputPath}/spatial/tissue_positions.parquet`,
    scalefactorsPath: `${outputPath}/spatial/scalefactors_json.json`,
    filteredMatrixH5Path: `${outputPath}/filtered_feature_bc_matrix.h5`,
  }
}
