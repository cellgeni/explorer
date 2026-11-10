import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { micrometers } from '../data/coords'
import { createVisiumDataset, type VisiumFileUrls } from './visiumDataset'
import { VISIUM_SPOT_AREA_SQUARE_MICROMETERS } from './visiumFormat'

const ROOT = 'https://example.test/visium/outs'
const MICROMETERS_PER_PIXEL = 0.5

interface Spot {
  readonly barcode: string
  readonly row: number
  readonly col: number
  readonly x: number
  readonly y: number
}

// Six rows of a Visium lattice, 36 spots, at 0.5 µm per full-res pixel.
const SPOTS: readonly Spot[] = Array.from({ length: 6 }, (_row, row) =>
  Array.from({ length: 6 }, (_col, index) => {
    const col = (row % 2) + index * 2
    return {
      barcode: `SPOT${row.toString()}${index.toString()}-1`,
      row,
      col,
      x: 400 + (col * 50) / MICROMETERS_PER_PIXEL,
      y: 300 + (row * 100 * Math.sqrt(3)) / 2 / MICROMETERS_PER_PIXEL,
    }
  }),
).flat()

const SCALEFACTORS = {
  spot_diameter_fullres: 130,
  fiducial_diameter_fullres: 200,
  tissue_hires_scalef: 0.2,
  tissue_lowres_scalef: 0.06,
}

function positionsCsv(options: { readonly header: boolean }): string {
  const rows = [
    ...SPOTS.map(
      (spot) => `${spot.barcode},1,${spot.row},${spot.col},${spot.y},${spot.x}`,
    ),
    'OUTSIDE-1,0,10,10,9000,9000',
  ]

  return [
    ...(options.header
      ? ['barcode,in_tissue,array_row,array_col,pxl_row_in_fullres,pxl_col_in_fullres']
      : []),
    ...rows,
  ].join('\n')
}

// Actb = spot index + 1 everywhere; Gad1 = 2 in even spots. An extra matrix
// barcode has no position.
async function createSpaceRangerMatrix(): Promise<Uint8Array> {
  const h5wasm = (await import('h5wasm')).default
  const { FS } = await h5wasm.ready
  const fileName = '/vitest-visium-filtered-matrix.h5'
  const barcodes = [...SPOTS.map((spot) => spot.barcode), 'UNPLACED-1']
  const indices: bigint[] = []
  const data: number[] = []
  const indptr: bigint[] = [0n]

  barcodes.forEach((_barcode, index) => {
    indices.push(0n)
    data.push(index + 1)

    if (index % 2 === 0) {
      indices.push(1n)
      data.push(2)
    }

    indptr.push(BigInt(indices.length))
  })

  try {
    FS.unlink(fileName)
  } catch {
    // No fixture from an earlier run.
  }

  const file = new h5wasm.File(fileName, 'w')
  file.create_attribute('library_ids', ['sample-A'])
  file.create_attribute('chemistry_description', "Spatial 3' v1")
  const matrix = file.create_group('matrix')
  const features = matrix.create_group('features')
  matrix.create_dataset({ name: 'barcodes', data: barcodes })
  features.create_dataset({ name: 'name', data: ['Actb', 'Gad1', 'Mbp'] })
  features.create_dataset({ name: 'id', data: ['ENSMUSG1', 'ENSMUSG2', 'ENSMUSG3'] })
  features.create_dataset({
    name: 'feature_type',
    data: ['Gene Expression', 'Gene Expression', 'Gene Expression'],
  })
  matrix.create_dataset({ name: 'data', data: new Int32Array(data) })
  matrix.create_dataset({ name: 'indices', data: new BigInt64Array(indices) })
  matrix.create_dataset({ name: 'indptr', data: new BigInt64Array(indptr) })
  matrix.create_dataset({ name: 'shape', data: new Int32Array([3, barcodes.length]) })
  file.close()

  const bytes = FS.readFile(fileName)
  FS.unlink(fileName)
  return bytes
}

function fetcherFor(
  files: Readonly<Record<string, BodyInit | Uint8Array>>,
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input)
    const body = files[url]

    if (body === undefined) {
      return new Response(null, { status: 404 })
    }

    return new Response(body instanceof Uint8Array ? body.slice() : body, {
      status: 200,
      headers:
        body instanceof Uint8Array ? { 'Content-Length': String(body.byteLength) } : {},
    })
  }) as typeof fetch
}

function fileUrls(overrides: Partial<VisiumFileUrls> = {}): VisiumFileUrls {
  return {
    tissuePositions: [`${ROOT}/spatial/tissue_positions.csv`],
    scalefactors: `${ROOT}/spatial/scalefactors_json.json`,
    filteredMatrix: `${ROOT}/filtered_feature_bc_matrix.h5`,
    images: {
      hires: `${ROOT}/spatial/tissue_hires_image.png`,
      lowres: `${ROOT}/spatial/tissue_lowres_image.png`,
    },
    analysis: {
      clusters: [
        `${ROOT}/analysis/clustering/gene_expression_graphclust/clusters.csv`,
        `${ROOT}/analysis/clustering/graphclust/clusters.csv`,
      ],
      umap: [`${ROOT}/analysis/umap/gene_expression_2_components/projection.csv`],
    },
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createVisiumDataset', () => {
  it('reads Space Ranger output as 55 µm spots in micrometres', async () => {
    const matrix = await createSpaceRangerMatrix()
    const dataset = createVisiumDataset({
      baseUrl: ROOT,
      files: fileUrls(),
      fetcher: fetcherFor({
        [`${ROOT}/spatial/tissue_positions.csv`]: positionsCsv({ header: true }),
        [`${ROOT}/spatial/scalefactors_json.json`]: JSON.stringify(SCALEFACTORS),
        [`${ROOT}/filtered_feature_bc_matrix.h5`]: matrix,
        // Space Ranger 1.x path, found after the 2.0+ one is missing.
        [`${ROOT}/analysis/clustering/graphclust/clusters.csv`]: [
          'Barcode,Cluster',
          ...SPOTS.map((spot, index) => `${spot.barcode},${(index % 3) + 1}`),
        ].join('\n'),
        [`${ROOT}/analysis/umap/gene_expression_2_components/projection.csv`]: [
          'Barcode,UMAP-1,UMAP-2',
          ...SPOTS.map((spot, index) => `${spot.barcode},${index},${-index}`),
        ].join('\n'),
      }),
    })

    const [meta, summary, cells] = await Promise.all([
      dataset.meta(),
      dataset.visiumSummary(),
      dataset.overview(),
    ])

    expect(meta.platform).toBe('visium')
    expect(meta.units.micrometersPerPixel).toBeCloseTo(MICROMETERS_PER_PIXEL, 6)
    expect(meta.capabilities.cellBoundaries).toBe(true)
    expect(summary).toMatchObject({
      libraryId: 'sample-A',
      libraryIds: ['sample-A'],
      spotCount: SPOTS.length,
      spotDiameterMicrometers: 55,
      units: { source: 'spot-grid' },
      images: ['hires', 'lowres'],
      chemistry: "Spatial 3' v1",
      scalefactors: { tissueHiresScalef: 0.2, spotDiameterFullres: 130 },
    })

    // The matrix barcode without a position is left out.
    expect(cells).toHaveLength(SPOTS.length)
    const first = cells[0]
    expect(first?.cellId).toBe(SPOTS[0]?.barcode)
    expect(first?.position.x).toBeCloseTo((SPOTS[0]?.x ?? 0) * MICROMETERS_PER_PIXEL)
    expect(first?.position.y).toBeCloseTo((SPOTS[0]?.y ?? 0) * MICROMETERS_PER_PIXEL)
    expect(first?.cellArea).toBeCloseTo(VISIUM_SPOT_AREA_SQUARE_MICROMETERS)
    expect(first?.metadata).toMatchObject({
      graphclust: '1',
      in_tissue: 1,
      array_row: 0,
      total_counts: 3,
      n_genes_by_counts: 2,
    })

    expect(await dataset.genePanel()).toEqual(['Actb', 'Gad1', 'Mbp'])
    expect(await dataset.annotationGroups()).toEqual([
      expect.objectContaining({ label: 'graphclust', groupCount: 3 }),
    ])
    expect((await dataset.embeddingOptions()).map((option) => option.kind)).toEqual([
      'X_umap',
      'spatial',
    ])

    const expression = await dataset.geneExpression(meta.extent, ['Gad1'])
    expect(expression.maxCount).toBe(2)
    expect(
      expression.elements.find((element) => element.id === SPOTS[0]?.barcode),
    ).toMatchObject({
      count: 2,
      cellArea: VISIUM_SPOT_AREA_SQUARE_MICROMETERS,
    })

    const profile = await dataset.matrix([SPOTS[3]?.barcode ?? ''])
    expect(profile.cells.get(SPOTS[3]?.barcode ?? '')).toEqual({
      geneNames: ['Actb'],
      counts: [4],
    })

    const center = first?.position ?? { x: micrometers(0), y: micrometers(0) }
    const nearby = await dataset.elements({
      minX: micrometers(center.x - 1),
      maxX: micrometers(center.x + 1),
      minY: micrometers(center.y - 1),
      maxY: micrometers(center.y + 1),
    })
    expect(nearby.elements.map((element) => element.id)).toEqual([SPOTS[0]?.barcode])
    expect(nearby.elements[0]?.geometry).toMatchObject({ kind: 'polygon' })

    expect(await dataset.image()).toEqual({
      kind: 'flat',
      url: `${ROOT}/spatial/tissue_hires_image.png`,
      scaleFactor: 0.2,
    })
    expect(await dataset.tissueImage('lowres')).toEqual({
      kind: 'flat',
      url: `${ROOT}/spatial/tissue_lowres_image.png`,
      scaleFactor: 0.06,
    })
  })

  it('reads the Space Ranger 1.x headerless positions list without images or analysis', async () => {
    const matrix = await createSpaceRangerMatrix()
    const dataset = createVisiumDataset({
      baseUrl: ROOT,
      files: fileUrls({
        tissuePositions: [`${ROOT}/spatial/tissue_positions_list.csv`],
        images: {},
        analysis: {},
      }),
      fetcher: fetcherFor({
        [`${ROOT}/spatial/tissue_positions_list.csv`]: positionsCsv({ header: false }),
        [`${ROOT}/spatial/scalefactors_json.json`]: JSON.stringify(SCALEFACTORS),
        [`${ROOT}/filtered_feature_bc_matrix.h5`]: matrix,
      }),
    })

    expect(await dataset.visiumSummary()).toMatchObject({
      spotCount: SPOTS.length,
      images: [],
    })
    expect(await dataset.image()).toBeNull()
    expect(await dataset.annotationGroups()).toEqual([])
  })

  it('reads gzipped GEO files, decompressing a .png.gz tissue image once', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:hires')
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const geo = 'https://ftp.example.test/geo/GSM1'
    const dataset = createVisiumDataset({
      baseUrl: geo,
      files: {
        tissuePositions: [`${geo}/GSM1_tissue_positions_list.csv.gz`],
        scalefactors: `${geo}/GSM1_scalefactors_json.json.gz`,
        filteredMatrix: `${geo}/GSM1_filtered_feature_bc_matrix.h5`,
        images: { hires: `${geo}/GSM1_tissue_hires_image.png.gz` },
        analysis: {},
      },
      fetcher: fetcherFor({
        [`${geo}/GSM1_tissue_positions_list.csv.gz`]: gzipSync(
          positionsCsv({ header: false }),
        ),
        [`${geo}/GSM1_scalefactors_json.json.gz`]: gzipSync(JSON.stringify(SCALEFACTORS)),
        [`${geo}/GSM1_filtered_feature_bc_matrix.h5`]: await createSpaceRangerMatrix(),
        [`${geo}/GSM1_tissue_hires_image.png.gz`]: gzipSync(png),
      }),
    })

    expect(await dataset.visiumSummary()).toMatchObject({ spotCount: SPOTS.length })
    expect(await dataset.image()).toEqual({
      kind: 'flat',
      url: 'blob:hires',
      scaleFactor: 0.2,
    })
    await dataset.tissueImage('hires')

    expect(createObjectUrl).toHaveBeenCalledTimes(1)
    const blob = createObjectUrl.mock.calls[0]?.[0] as Blob
    expect(blob.type).toBe('image/png')
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(png)
  })

  it('reports a filtered matrix above the browser load limit', async () => {
    const dataset = createVisiumDataset({
      baseUrl: ROOT,
      files: fileUrls({ analysis: {} }),
      fetcher: (async (input: RequestInfo | URL) => {
        const url = String(input)

        if (url.endsWith('.h5')) {
          return new Response('x', {
            status: 200,
            headers: { 'Content-Length': String(400 * 1024 * 1024) },
          })
        }

        return new Response(
          url.endsWith('.json')
            ? JSON.stringify(SCALEFACTORS)
            : positionsCsv({ header: true }),
        )
      }) as typeof fetch,
    })

    await expect(dataset.overview()).rejects.toThrow(
      /400\.0 MB, above the 300\.0 MB browser load limit/,
    )
  })
})
