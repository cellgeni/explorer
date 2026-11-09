import { describe, expect, it, vi } from 'vitest'
import { micrometers, type BBox } from '../data/coords'
import {
  array,
  categorical,
  group,
  json,
  strings,
  typed,
  v2Array,
} from '../test/ateraFixtures'
import {
  AteraDataset,
  isAteraTableMetadataKey,
  zarrNodesFromMetadataKeys,
  type AteraZipStore,
} from './ateraDataset'

const BASE_URL = 'https://example.test/atera'
const WHOLE_SLIDE: BBox = {
  minX: micrometers(0),
  minY: micrometers(0),
  maxX: micrometers(1000),
  maxY: micrometers(1000),
}

// Three cells, four features (three genes and a negative control probe).
//   cell 0 at (10, 10): GENEA 1, GENEC 2
//   cell 1 at (30, 10): GENEB 5
//   cell 2 at (200, 200): GENEA 3, NegControlProbe 4
const BARCODES = ['aaaaaaaa-1', 'aaaaaaab-1', 'aaaaaaac-1']

function matrixStore(): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>()
  group(entries, '', { 'encoding-type': 'anndata', 'encoding-version': '0.1.0' })
  group(entries, 'X', { 'encoding-type': 'csr_matrix', shape: [3, 4] })
  array(entries, 'X/indptr', '<i8', [0, 2, 3, 5])
  array(entries, 'X/indices', '<i8', [0, 2, 1, 0, 3])
  array(entries, 'X/data', '<i4', [1, 2, 5, 3, 4])
  group(entries, 'obs', {
    _index: 'barcode',
    'column-order': [
      'cell_id',
      'filtered',
      'leiden_res_1.0',
      'centroid_column',
      'centroid_row',
      'cell_area',
      'transcript_counts',
    ],
    'encoding-type': 'dataframe',
  })
  strings(entries, 'obs/barcode', BARCODES)
  array(entries, 'obs/cell_id', '<i8', [4294967297, 4294967298, 4294967299])
  array(entries, 'obs/filtered', '|b1', [1, 1, 0])
  categorical(entries, 'obs/leiden_res_1.0', [0, 1, 0], ['0', '1'])
  array(entries, 'obs/centroid_column', '<f4', [10, 30, 200])
  array(entries, 'obs/centroid_row', '<f4', [10, 10, 200])
  array(entries, 'obs/cell_area', '<f4', [50, 60, 70])
  array(entries, 'obs/transcript_counts', '<i8', [3, 5, 7])
  group(entries, 'obsm', { 'encoding-type': 'dict' })
  array(entries, 'obsm/X_umap', '<f4', [1, 2, 3, 4, 5, 6], [3, 2])
  group(entries, 'var', {
    _index: 'feature_id',
    'column-order': ['feature_name', 'feature_id', 'feature_type', 'de_c0_logfc'],
    'encoding-type': 'dataframe',
  })
  strings(entries, 'var/feature_id', ['ENSG1', 'ENSG2', 'ENSG3', 'NC1'])
  strings(entries, 'var/feature_name', ['GENEA', 'GENEB', 'GENEC', 'NegControlProbe_1'])
  categorical(
    entries,
    'var/feature_type',
    [0, 0, 0, 1],
    ['Gene Expression', 'Negative Control Probe'],
  )
  array(entries, 'var/de_c0_logfc', '<f4', [0, 0, 0, 0])
  return entries
}

function cscStore(): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>()
  group(entries, '', { 'encoding-type': 'anndata' })
  group(entries, 'X', { 'encoding-type': 'csc_matrix', shape: [3, 4] })
  array(entries, 'X/indptr', '<i8', [0, 2, 3, 4, 5])
  array(entries, 'X/indices', '<i8', [0, 2, 1, 0, 2])
  array(entries, 'X/data', '<i4', [1, 3, 5, 2, 4])
  return entries
}

function cellsStore(): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>()
  group(entries, '', {
    name: 'CellSegmentationDataset',
    segmentation_methods: ['Boundary stain', 'Interior stain'],
  })
  array(entries, 'bboxes', '<f4', [5, 5, 15, 15, 25, 5, 35, 15, 195, 195, 205, 205])
  // Column-chunked like the real file: one chunk per summary column.
  const summary = [
    [10, 30, 200],
    [10, 10, 200],
    [50, 60, 70],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [1, 2, 1],
  ]
  entries.set('cell_summary/.zarray', json(v2Array('<f8', [3, 8], [3, 1])))
  entries.set(
    'cell_summary/.zattrs',
    json({
      column_names: [
        'cell_centroid_x',
        'cell_centroid_y',
        'cell_area',
        'nucleus_centroid_x',
        'nucleus_centroid_y',
        'nucleus_area',
        'z_level',
        'nucleus_count',
      ],
    }),
  )
  summary.forEach((column, index) => {
    entries.set(`cell_summary/0.${index}`, typed('<f8', column))
  })
  array(entries, 'polygon_sets/1/method', '<u4', [0, 1, 0])
  const triangle = [0, 0, 255, 0, 255, 255]

  group(entries, 'gridded_polygon_sets/1', {
    grid_size: [500],
    grid_keys: [[[0, 0]]],
    grid_number_objects: [[3]],
  })
  array(entries, 'gridded_polygon_sets/1/0/0,0/cell_index', '<u4', [0, 1, 2])
  array(entries, 'gridded_polygon_sets/1/0/0,0/num_vertices', '<i4', [3, 3, 3])
  array(entries, 'gridded_polygon_sets/1/0/0,0/relative_vertices', '|u1', [
    ...triangle,
    ...triangle,
    ...triangle,
  ])
  // Cell 1 has two nuclei.
  group(entries, 'gridded_polygon_sets/0', {
    grid_size: [500],
    grid_keys: [[[0, 0]]],
    grid_number_objects: [[3]],
  })
  array(entries, 'gridded_polygon_sets/0/0/0,0/cell_index', '<u4', [0, 1, 1])
  array(entries, 'gridded_polygon_sets/0/0/0,0/num_vertices', '<i4', [3, 3, 3])
  array(entries, 'gridded_polygon_sets/0/0/0,0/relative_vertices', '|u1', [
    ...triangle,
    ...triangle,
    ...triangle,
  ])
  return entries
}

function createDataset(
  options: {
    readonly experiment?: unknown
    readonly files?: ConstructorParameters<typeof AteraDataset>[0]['files']
  } = {},
) {
  const stores = new Map<string, Map<string, Uint8Array>>([
    [`${BASE_URL}/cell_feature_matrix.zarr.zip`, matrixStore()],
    [`${BASE_URL}/matrices/csc.zarr.zip`, cscStore()],
    [`${BASE_URL}/cells.zarr.zip`, cellsStore()],
  ])
  const requestedKeys: string[] = []
  const openZipStore = vi.fn(async (url: string): Promise<AteraZipStore> => {
    const entries = stores.get(url)

    if (entries === undefined) {
      throw new Error(`No fixture for ${url}`)
    }

    return {
      entryNames: [...entries.keys()],
      store: {
        get: async (key: string) => {
          requestedKeys.push(`${url.split('/').pop()}:${key}`)
          return entries.get(key.replace(/^\//, ''))
        },
      },
    }
  })
  const fetcher = vi.fn(async (input: RequestInfo | URL) =>
    String(input) === `${BASE_URL}/experiment.spatial`
      ? Response.json(
          options.experiment ?? {
            pixel_size: 0.2125,
            images: { morphology_2d_filepath: 'morphology_2d/ch0000_dapi.ome.tif' },
            explorer_files: {
              cell_feature_viz_zarr_filepath: 'matrices/csc.zarr.zip',
            },
          },
        )
      : new Response(null, { status: 404 }),
  ) as unknown as typeof fetch
  const dataset = new AteraDataset({
    baseUrl: `${BASE_URL}/`,
    fetcher,
    openZipStore,
    ...(options.files === undefined ? {} : { files: options.files }),
  })

  return { dataset, openZipStore, requestedKeys }
}

describe('AteraDataset', () => {
  it('builds the overview from matrix obs and cells.zarr.zip details', async () => {
    const { dataset } = createDataset()

    const overview = await dataset.overview()

    expect(overview).toHaveLength(3)
    expect(overview[1]).toMatchObject({
      cellId: 'aaaaaaab-1',
      position: { x: 30, y: 10 },
      transcriptCount: 5,
      cellArea: 60,
      nucleusCount: 2,
      segmentationMethod: 'Interior stain',
    })
  })

  it('opens only the matrix metadata the viewer reads', async () => {
    const { dataset, requestedKeys } = createDataset()

    await dataset.overview()

    expect(requestedKeys).toContain(
      'cell_feature_matrix.zarr.zip:/var/feature_name/.zarray',
    )
    expect(requestedKeys.some((key) => key.includes('de_c0_logfc'))).toBe(false)
  })

  it('offers gene features only and reads annotations, tracks, and embeddings', async () => {
    const { dataset } = createDataset()

    await expect(dataset.genePanel()).resolves.toEqual(['GENEA', 'GENEB', 'GENEC'])
    await expect(dataset.annotationGroups()).resolves.toEqual([
      expect.objectContaining({ label: 'leiden_res_1.0', groupCount: 2 }),
    ])
    // Boolean columns are 0/1 tracks, as on the h5wasm backend.
    const tracks = await dataset.metadataTracks()
    expect(tracks.map((track) => [track.label, track.min, track.max])).toEqual([
      ['filtered', 0, 1],
      ['cell_area', 50, 70],
      ['transcript_counts', 3, 7],
    ])
    const embeddings = await dataset.embeddingOptions()
    expect(embeddings.map((embedding) => embedding.kind)).toEqual(['X_umap'])
  })

  it('sums selected genes from the CSC matrix located by experiment.spatial', async () => {
    const { dataset, openZipStore } = createDataset()

    const batch = await dataset.geneExpression(WHOLE_SLIDE, ['GENEA', 'GENEB'])

    expect(openZipStore).toHaveBeenCalledWith(`${BASE_URL}/matrices/csc.zarr.zip`)
    expect(batch.maxCount).toBe(5)
    expect(batch.elements.map((element) => [element.id, element.count])).toEqual([
      ['aaaaaaaa-1', 1],
      ['aaaaaaab-1', 5],
      ['aaaaaaac-1', 3],
    ])
    expect(batch.elements[2]).toMatchObject({ transcriptCount: 7, nucleusCount: 1 })
  })

  it('limits expression to the box and samples cells without expression', async () => {
    const { dataset } = createDataset()
    const box: BBox = {
      minX: micrometers(0),
      minY: micrometers(0),
      maxX: micrometers(100),
      maxY: micrometers(100),
    }

    const batch = await dataset.geneExpression(box, ['GENEC'], { sampleStride: 2 })

    // Cell 0 expresses GENEC; cell 1 is the first zero cell, so it is kept.
    expect(batch.elements.map((element) => [element.id, element.count])).toEqual([
      ['aaaaaaaa-1', 2],
      ['aaaaaaab-1', 0],
    ])
    await expect(dataset.geneExpression(box, ['UNKNOWN'])).resolves.toMatchObject({
      maxCount: 0,
    })
  })

  it('reads cell rows from the CSR matrix for cell details and ROI stats', async () => {
    const { dataset } = createDataset()

    const matrix = await dataset.matrix(['aaaaaaac-1'])

    expect(matrix.cells.get('aaaaaaac-1')).toEqual({
      geneNames: ['GENEA', 'NegControlProbe_1'],
      counts: [3, 4],
    })
  })

  it('decodes cell and nucleus polygons with matrix barcodes as ids', async () => {
    const { dataset } = createDataset()
    const box: BBox = {
      minX: micrometers(0),
      minY: micrometers(0),
      maxX: micrometers(40),
      maxY: micrometers(40),
    }

    const cells = await dataset.elements(box)
    const nuclei = await dataset.segmentationElements('nucleus', box)

    expect(cells.elements.map((element) => element.id)).toEqual([
      'aaaaaaaa-1',
      'aaaaaaab-1',
    ])
    expect(cells.elements[1]?.geometry).toEqual({
      kind: 'polygon',
      rings: [
        [
          { x: 25, y: 5 },
          { x: 35, y: 5 },
          { x: 35, y: 15 },
        ],
      ],
    })
    expect(nuclei.map((element) => element.id)).toEqual([
      'aaaaaaaa-1',
      'aaaaaaab-1',
      'aaaaaaab-1#nucleus-2',
    ])
  })

  it('adds counts and areas to ROI cells', async () => {
    const { dataset } = createDataset()

    const cells = await dataset.cells({
      kind: 'box',
      bbox: {
        minX: micrometers(0),
        minY: micrometers(0),
        maxX: micrometers(50),
        maxY: micrometers(50),
      },
    })

    expect(cells).toEqual([
      expect.objectContaining({
        id: 'aaaaaaaa-1',
        transcriptCount: 3,
        cellArea: 50,
        cellFeatureMatrixRow: 0,
      }),
      expect.objectContaining({ id: 'aaaaaaab-1', transcriptCount: 5 }),
    ])
  })

  it('reports Atera metadata with the experiment pixel size', async () => {
    const { dataset } = createDataset()

    const meta = await dataset.meta()

    expect(meta).toMatchObject({
      platform: 'atera',
      units: { micrometersPerPixel: 0.2125 },
      capabilities: { cellBoundaries: true, pyramidImage: true },
      extent: { minX: 10, minY: 10, maxX: 200, maxY: 200 },
    })
    expect(meta.segmentations?.map((segmentation) => segmentation.kind)).toEqual([
      'cell',
      'nucleus',
    ])
    await expect(dataset.morphologyUrl()).resolves.toBe(
      `${BASE_URL}/morphology_2d/ch0000_dapi.ome.tif`,
    )
  })

  it('prefers manifest file locations over experiment.spatial', async () => {
    const { dataset } = createDataset({
      files: { morphology: 'https://images.example.test/he.ome.tif' },
    })

    await expect(dataset.morphologyUrl()).resolves.toBe(
      'https://images.example.test/he.ome.tif',
    )
    await expect(dataset.fileUrl('cells')).resolves.toBe(`${BASE_URL}/cells.zarr.zip`)
  })

  it('rejects a CSC matrix whose feature count differs from the matrix', async () => {
    const { dataset } = createDataset({
      experiment: {
        explorer_files: { cell_feature_viz_zarr_filepath: 'cells.zarr.zip' },
      },
    })

    await expect(dataset.geneExpression(WHOLE_SLIDE, ['GENEA'])).rejects.toThrow()
  })
})

describe('Atera matrix metadata selection', () => {
  it('keeps X, obs, obsm, and the var columns the viewer reads', () => {
    expect(
      [
        '.zattrs',
        'X/indptr/.zarray',
        'obs/leiden_res_1.0/codes/.zarray',
        'obsm/X_umap/.zattrs',
        'var/.zattrs',
        'var/feature_name/.zarray',
        'var/feature_type/categories/.zarray',
        'var/de_leiden_res_1.0_c2_logfc/.zarray',
        'var/highly_variable/.zarray',
        'uns/.zgroup',
        'X/indptr/0',
      ].filter(isAteraTableMetadataKey),
    ).toEqual([
      '.zattrs',
      'X/indptr/.zarray',
      'obs/leiden_res_1.0/codes/.zarray',
      'obsm/X_umap/.zattrs',
      'var/.zattrs',
      'var/feature_name/.zarray',
      'var/feature_type/categories/.zarray',
    ])
  })

  it('lists arrays and groups from their metadata keys', () => {
    expect(
      zarrNodesFromMetadataKeys(['.zgroup', '.zattrs', 'obs/.zgroup', 'obs/x/.zarray']),
    ).toEqual([
      { path: '', kind: 'group' },
      { path: 'obs', kind: 'group' },
      { path: 'obs/x', kind: 'array' },
    ])
  })
})
