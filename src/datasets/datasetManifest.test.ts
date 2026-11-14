import { describe, expect, it } from 'vitest'
import {
  DatasetManifestError,
  isDatasetManifestUrl,
  looksLikeDatasetManifest,
  manifestZchunkStoreUrl,
  parseDatasetManifest,
} from './datasetManifest'

const MANIFEST_URL = 'https://example.test/runs/sample-1/explorer.json'

function parse(json: unknown) {
  return parseDatasetManifest(json, MANIFEST_URL)
}

function parseError(json: unknown): string {
  try {
    parse(json)
  } catch (error) {
    expect(error).toBeInstanceOf(DatasetManifestError)
    return (error as Error).message
  }

  throw new Error('Expected the manifest to be rejected.')
}

describe('parseDatasetManifest', () => {
  it('resolves Xenium file paths against the manifest folder', () => {
    const manifest = parse({
      version: 1,
      platform: 'xenium',
      name: 'Sample 1',
      files: {
        cells: 'processed/cells_v2.parquet',
        transcripts: './transcripts.parquet',
        morphology: 'https://images.example.test/sample-1/he.ome.tif',
      },
    })

    expect(manifest).toMatchObject({
      platform: 'xenium',
      name: 'Sample 1',
      url: MANIFEST_URL,
      rootUrl: 'https://example.test/runs/sample-1',
      files: {
        cells: {
          path: 'processed/cells_v2.parquet',
          url: 'https://example.test/runs/sample-1/processed/cells_v2.parquet',
        },
        transcripts: {
          path: 'transcripts.parquet',
          url: 'https://example.test/runs/sample-1/transcripts.parquet',
        },
        morphology: {
          path: 'https://images.example.test/sample-1/he.ome.tif',
          url: 'https://images.example.test/sample-1/he.ome.tif',
        },
      },
    })
  })

  it('resolves paths against root when one is given', () => {
    const manifest = parse({
      version: 1,
      platform: 'xenium',
      root: '../shared/output-XETG',
      files: { cells: 'cells.parquet' },
    })

    expect(manifest.rootUrl).toBe('https://example.test/runs/shared/output-XETG')
    expect(manifest.platform === 'xenium' && manifest.files.cells?.url).toBe(
      'https://example.test/runs/shared/output-XETG/cells.parquet',
    )
  })

  it('resolves Atera files under their own roles', () => {
    const manifest = parse({
      version: 1,
      platform: 'atera',
      files: {
        cscCellFeatureMatrix: 'matrices/csc.zarr.zip',
        morphology: 'morphology_2d/ch0002_18s.ome.tif',
      },
    })

    expect(manifest).toMatchObject({
      platform: 'atera',
      files: {
        cscCellFeatureMatrix: {
          path: 'matrices/csc.zarr.zip',
          url: 'https://example.test/runs/sample-1/matrices/csc.zarr.zip',
        },
        morphology: {
          url: 'https://example.test/runs/sample-1/morphology_2d/ch0002_18s.ome.tif',
        },
      },
    })
    expect(
      parseError({ version: 1, platform: 'atera', files: { analysis: 'a' } }),
    ).toContain('files.analysis')
    expect(
      parseError({ version: 1, platform: 'atera', options: { binSize: 8 } }),
    ).toContain('options')
  })

  it('resolves renamed standard Visium files, such as GEO supplementary files', () => {
    const manifest = parse({
      version: 1,
      platform: 'visium',
      root: 'https://ftp.example.test/geo/GSM1/suppl/',
      files: {
        tissuePositions: 'GSM1_tissue_positions_list.csv.gz',
        scalefactors: 'GSM1_scalefactors_json.json.gz',
        filteredMatrix: 'GSM1_filtered_feature_bc_matrix.h5',
        hiresImage: 'https://images.example.test/GSM1_hires.png',
        clusters: 'GSM1_clusters.csv',
      },
    })

    expect(manifest).toMatchObject({
      platform: 'visium',
      rootUrl: 'https://ftp.example.test/geo/GSM1/suppl',
      files: {
        tissuePositions: {
          path: 'GSM1_tissue_positions_list.csv.gz',
          url: 'https://ftp.example.test/geo/GSM1/suppl/GSM1_tissue_positions_list.csv.gz',
        },
        hiresImage: { url: 'https://images.example.test/GSM1_hires.png' },
        clusters: { url: 'https://ftp.example.test/geo/GSM1/suppl/GSM1_clusters.csv' },
      },
    })
    expect(parseError({ version: 1, platform: 'visium', files: { bins: [] } })).toContain(
      'files.bins',
    )
    expect(
      parseError({ version: 1, platform: 'visium', options: { image: 'hires' } }),
    ).toContain('options')
  })

  it('resolves renamed MERSCOPE files, such as GEO prefixed or vpt outputs', () => {
    const manifest = parse({
      version: 1,
      platform: 'merscope',
      root: 'https://ftp.example.test/geo/GSM9/suppl/',
      files: {
        cellByGene: 'GSM9_EFE_r1_cell_by_gene.csv.gz',
        cellMetadata: 'GSM9_EFE_r1_cell_metadata.csv.gz',
        cellBoundaries: 'GSM9_EFE_r1_cell_boundaries.parquet.gz',
      },
    })

    expect(manifest).toMatchObject({
      platform: 'merscope',
      files: {
        cellByGene: {
          path: 'GSM9_EFE_r1_cell_by_gene.csv.gz',
          url: 'https://ftp.example.test/geo/GSM9/suppl/GSM9_EFE_r1_cell_by_gene.csv.gz',
        },
        cellBoundaries: {
          url: 'https://ftp.example.test/geo/GSM9/suppl/GSM9_EFE_r1_cell_boundaries.parquet.gz',
        },
      },
    })
    expect(
      parseError({
        version: 1,
        platform: 'merscope',
        files: { transcripts: 'detected_transcripts.csv' },
      }),
    ).toContain('files.transcripts')
    expect(
      parseError({ version: 1, platform: 'merscope', options: { zIndex: 3 } }),
    ).toContain('options')
  })

  it('resolves a .zchunkstore sidecar for the TIFF image', () => {
    const xenium = parse({
      version: 1,
      platform: 'xenium',
      files: { morphologyZchunkstore: 'sidecars/morphology_focus.zchunkstore' },
    })
    const atera = parse({
      version: 1,
      platform: 'atera',
      files: { morphologyZchunkstore: 'https://cdn.example.test/atera.zchunkstore' },
    })
    const image = parse({
      version: 1,
      platform: 'image',
      files: { image: 'he.ome.tif', zchunkstore: 'he.zchunkstore' },
    })

    expect(manifestZchunkStoreUrl(xenium)).toBe(
      'https://example.test/runs/sample-1/sidecars/morphology_focus.zchunkstore',
    )
    expect(manifestZchunkStoreUrl(atera)).toBe(
      'https://cdn.example.test/atera.zchunkstore',
    )
    expect(manifestZchunkStoreUrl(image)).toBe(
      'https://example.test/runs/sample-1/he.zchunkstore',
    )
    expect(
      manifestZchunkStoreUrl(
        parse({ version: 1, platform: 'image', files: { image: 'he.ome.tif' } }),
      ),
    ).toBeUndefined()
    expect(manifestZchunkStoreUrl(undefined)).toBeUndefined()
    expect(
      parseError({
        version: 1,
        platform: 'image',
        files: { image: 'he.ome.zarr', zchunkstore: 'he.zchunkstore' },
      }),
    ).toContain('"files.zchunkstore" is only for TIFF images')
    expect(
      parseError({
        version: 1,
        platform: 'h5ad',
        files: { h5ad: 'a.h5ad', zchunkstore: 'a.zchunkstore' },
      }),
    ).toContain('files.zchunkstore')
  })

  it('accepts a manifest without files for platforms with standard names', () => {
    expect(parse({ version: 1, platform: 'xenium' })).toMatchObject({
      platform: 'xenium',
      files: {},
    })
  })

  it('requires a supported version and platform', () => {
    expect(parseError({ platform: 'xenium' })).toBe(
      'explorer.json: "version" is required; use 1.',
    )
    expect(parseError({ version: 2, platform: 'xenium' })).toContain(
      '"version" 2 is not supported',
    )
    expect(parseError({ version: 1, platform: 'merfish' })).toContain(
      '"platform" must be one of "xenium", "atera", "visium", "visium-hd", "merscope", "h5ad", "spatialdata", "image"',
    )
    expect(parseError([])).toBe('explorer.json: expected a JSON object.')
  })

  it('names unknown fields and lists the expected ones', () => {
    const message = parseError({
      version: 1,
      platform: 'xenium',
      files: { cell: 'cells.parquet' },
    })

    expect(message).toContain('unknown field "files.cell"')
    expect(message).toContain('cells, cellBoundaries, nucleusBoundaries, transcripts')
    expect(parseError({ version: 1, platform: 'xenium', colour: 'red' })).toContain(
      'unknown field "colour"',
    )
  })

  it('rejects non-string and non-http paths', () => {
    expect(
      parseError({ version: 1, platform: 'xenium', files: { cells: 42 } }),
    ).toContain('"files.cells" must be a non-empty string')
    expect(
      parseError({
        version: 1,
        platform: 'xenium',
        files: { cells: 's3://bucket/cells.parquet' },
      }),
    ).toContain('"files.cells" must be a relative path or an http(s) URL')
  })

  it('requires the source file for single-file platforms', () => {
    expect(parseError({ version: 1, platform: 'h5ad' })).toContain(
      '"files.h5ad" is required for platform "h5ad"',
    )
    expect(parseError({ version: 1, platform: 'spatialdata', files: {} })).toContain(
      '"files.store" is required',
    )
    expect(
      parse({ version: 1, platform: 'image', files: { image: 'he.ome.tif' } }),
    ).toMatchObject({
      platform: 'image',
      files: { image: { url: 'https://example.test/runs/sample-1/he.ome.tif' } },
    })
  })

  it('reads SpatialData options and rejects options elsewhere', () => {
    expect(
      parse({
        version: 1,
        platform: 'spatialdata',
        files: { store: 'sample.zarr' },
        options: {
          table: 'table_nuclei',
          coordinateSystem: 'global',
          image: 'he',
          micrometersPerUnit: 0.2125,
        },
      }),
    ).toMatchObject({
      files: { store: { url: 'https://example.test/runs/sample-1/sample.zarr' } },
      options: {
        table: 'table_nuclei',
        coordinateSystem: 'global',
        image: 'he',
        micrometersPerUnit: 0.2125,
      },
    })
    expect(
      parseError({
        version: 1,
        platform: 'spatialdata',
        files: { store: 'sample.zarr' },
        options: { micrometersPerUnit: 0 },
      }),
    ).toContain('"options.micrometersPerUnit" must be a positive number')
    expect(
      parseError({ version: 1, platform: 'xenium', options: { binSize: 8 } }),
    ).toContain('"options" is not used for platform "xenium"')
  })

  it('reads Visium HD bins, segmented outputs, and the starting bin size', () => {
    const manifest = parse({
      version: 1,
      platform: 'visium-hd',
      files: {
        bins: [
          { size: 16, path: 'bins/016' },
          { size: 8, path: 'bins/008', filteredMatrix: 'matrices/008.h5' },
        ],
        featureSlice: 'slices/feature_slice.h5',
        segmentedOutputs: { cellSegmentations: 'cells.geojson' },
      },
      options: { binSize: 8 },
    })

    expect(manifest).toMatchObject({
      platform: 'visium-hd',
      bins: [
        { size: 16, path: 'bins/016' },
        { size: 8, path: 'bins/008', filteredMatrix: 'matrices/008.h5' },
      ],
      files: { featureSlice: { path: 'slices/feature_slice.h5' } },
      segmentedOutputs: { cellSegmentations: 'cells.geojson' },
      options: { binSize: 8 },
    })
  })

  it('validates Visium HD bins', () => {
    const visium = (files: unknown, options?: unknown) =>
      parseError({ version: 1, platform: 'visium-hd', files, options })

    expect(visium({ bins: [] })).toContain('"files.bins" must be a non-empty array')
    expect(visium({ bins: [{ size: 4, path: 'x' }] })).toContain(
      '"files.bins[0].size" must be one of 2, 8, 16',
    )
    expect(visium({ bins: [{ size: 8 }] })).toContain('"files.bins[0].path" is required')
    expect(
      visium({
        bins: [
          { size: 8, path: 'a' },
          { size: 8, path: 'b' },
        ],
      }),
    ).toContain('lists the 8 µm bin more than once')
    expect(visium({ bins: [{ size: 8, path: 'a' }] }, { binSize: 16 })).toContain(
      '"options.binSize" 16 is not one of the listed bins',
    )
    expect(visium({ segmentedOutputs: { cells: 'x.geojson' } })).toContain(
      'unknown field "files.segmentedOutputs.cells"',
    )
  })

  it('reads display defaults and checks their types', () => {
    expect(
      parse({
        version: 1,
        platform: 'xenium',
        defaults: {
          genes: [' EPCAM ', 'PTPRC'],
          colorCellsBy: 'cell-area',
          cellBoundaries: false,
          imageOpacity: 0.6,
          channels: ['DAPI'],
          transcripts: true,
        },
      }).defaults,
    ).toEqual({
      genes: ['EPCAM', 'PTPRC'],
      colorCellsBy: 'cell-area',
      cellBoundaries: false,
      imageOpacity: 0.6,
      channels: ['DAPI'],
      transcripts: true,
    })

    const defaults = (value: unknown) =>
      parseError({ version: 1, platform: 'xenium', defaults: value })

    expect(defaults({ genes: 'EPCAM' })).toContain(
      '"defaults.genes" must be an array of non-empty strings',
    )
    expect(defaults({ imageOpacity: 1.5 })).toContain(
      '"defaults.imageOpacity" must be a number from 0 to 1',
    )
    expect(defaults({ cellBoundaries: 'yes' })).toContain(
      '"defaults.cellBoundaries" must be true or false',
    )
    expect(defaults({ zoom: 2 })).toContain('unknown field "defaults.zoom"')
  })

  it('reads where the data comes from and checks the source fields', () => {
    expect(
      parse({
        version: 1,
        platform: 'h5ad',
        description: ' Mouse embryo at E9.0 ',
        source: {
          repository: 'CELLxGENE',
          accession: ' fe70db78 ',
          url: 'https://cellxgene.cziscience.com/collections/d74b6979',
          license: 'CC BY 4.0',
        },
        files: { h5ad: 'embryo.h5ad' },
      }),
    ).toMatchObject({
      description: 'Mouse embryo at E9.0',
      source: {
        repository: 'CELLxGENE',
        accession: 'fe70db78',
        url: 'https://cellxgene.cziscience.com/collections/d74b6979',
        license: 'CC BY 4.0',
      },
    })

    const source = (value: unknown) =>
      parseError({ version: 1, platform: 'xenium', source: value })

    expect(source('BioImage Archive')).toContain('"source" must be an object')
    expect(source({ repo: 'BIA' })).toContain('unknown field "source.repo"')
    expect(source({ citation: '' })).toContain(
      '"source.citation" must be a non-empty string',
    )
    expect(source({ url: 'ftp://ftp.ebi.ac.uk/biostudies' })).toContain(
      '"source.url" must be an http(s) URL',
    )
  })
})

describe('dataset manifest URLs', () => {
  it('treats .json URLs other than Zarr metadata as manifests', () => {
    expect(isDatasetManifestUrl('https://example.test/sample/explorer.json')).toBe(true)
    expect(isDatasetManifestUrl('https://example.test/manifests/run-7.json?v=2')).toBe(
      true,
    )
    expect(isDatasetManifestUrl('https://example.test/sample.zarr/zarr.json')).toBe(false)
    expect(isDatasetManifestUrl('https://example.test/sample.zarr/.zattrs')).toBe(false)
    expect(isDatasetManifestUrl('https://example.test/sample')).toBe(false)
  })

  it('only treats probed JSON objects with a platform or version as manifests', () => {
    expect(looksLikeDatasetManifest({})).toBe(false)
    expect(looksLikeDatasetManifest([])).toBe(false)
    expect(looksLikeDatasetManifest('<html>')).toBe(false)
    expect(looksLikeDatasetManifest({ platform: 'xenium' })).toBe(true)
    expect(looksLikeDatasetManifest({ version: 1 })).toBe(true)
  })
})
