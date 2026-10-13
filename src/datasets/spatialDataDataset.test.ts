import { describe, expect, it, vi } from 'vitest'
import { micrometers } from '../data/coords'
import type { ImagePyramidLoader } from '../data/imagePyramid'
import { SpatialDataDataset, type SpatialDataImageRequest } from './spatialDataDataset'
import { shapesFromRows, type SpatialDataShapesReader } from './spatialDataShapes'

const STORE_URL = 'https://example.test/sample.sdata.zarr'
const XY = { name: 'xy', axes: [{ name: 'x' }, { name: 'y' }] }
const CYX = { name: 'cyx', axes: [{ name: 'c' }, { name: 'y' }, { name: 'x' }] }

describe('SpatialDataDataset', () => {
  it('places table rows on annotated shapes and exposes AnnData readers', async () => {
    const progress: string[] = []
    const dataset = new SpatialDataDataset({
      url: STORE_URL,
      fetcher: inMemoryZarrFetcher(storeFixture()),
      readShapes: shapesReaderFixture({ cells: polygonRows() }),
      openImage: imageOpenerFixture(),
      onProgress: (message) => {
        progress.push(message)
      },
    })

    await expect(dataset.summary()).resolves.toEqual({
      coordinateSystem: 'global',
      coordinateSystems: ['global'],
      image: 'he',
      table: 'table',
      regions: ['cells'],
      boundaries: 'cells',
      skippedElements: [],
    })

    const overview = await dataset.overview()
    // cell-c annotates an instance missing from the shapes element.
    expect(overview.map((cell) => cell.cellId)).toEqual(['cell-a', 'cell-b'])
    expect(overview[0]?.position).toEqual({ x: 1, y: 1 })
    expect(overview[1]?.metadata).toEqual({ region: 'cells', cell_id: 11 })
    await expect(dataset.genePanel()).resolves.toEqual(['Actb', 'Gad1'])

    const matrix = await dataset.matrix(['cell-b', 'cell-c'])
    expect(matrix.cells.get('cell-b')).toEqual({ geneNames: ['Gad1'], counts: [2] })
    expect(matrix.cells.get('cell-c')).toEqual({
      geneNames: ['Actb', 'Gad1'],
      counts: [3, 4],
    })

    const elements = await dataset.elements({
      minX: micrometers(3),
      maxX: micrometers(10),
      minY: micrometers(0),
      maxY: micrometers(10),
    })
    expect(elements.elements.map((element) => element.id)).toEqual(['cell-b'])
    expect(progress).toContain('SpatialData placed 2 of 3 table rows in global')
  })

  it('opens the image with its coordinate-system placement', async () => {
    const openImage = imageOpenerFixture()
    const dataset = new SpatialDataDataset({
      url: STORE_URL,
      fetcher: inMemoryZarrFetcher(storeFixture()),
      readShapes: shapesReaderFixture({ cells: polygonRows() }),
      openImage,
    })

    const meta = await dataset.meta()

    expect(openImage).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `${STORE_URL}/images/he`,
        transform: { scaleX: 0.5, scaleY: 0.5, translateX: 20, translateY: 10 },
      }),
    )
    expect(meta).toMatchObject({
      platform: 'spatialdata',
      capabilities: {
        cellBoundaries: true,
        pyramidImage: true,
        transcripts: false,
      },
      extent: { minX: 1, minY: 1, maxX: 70, maxY: 60 },
    })

    const image = await dataset.image()
    expect(image?.kind).toBe('pyramid')
    if (image?.kind === 'pyramid') {
      await image.openChannelLoader?.(`${STORE_URL}/images/he#c=1`)
    }
    expect(openImage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        url: `${STORE_URL}/images/he#c=1`,
        transform: { scaleX: 0.5, scaleY: 0.5, translateX: 20, translateY: 10 },
      }),
    )
  })

  it('draws a polygon companion element instead of region circles', async () => {
    const readShapes = shapesReaderFixture({
      cells: [
        { geometry: { type: 'Point', coordinates: [0.5, 0.5] }, radius: 1, id: 10n },
        { geometry: { type: 'Point', coordinates: [2.5, 0.5] }, radius: 1, id: 11n },
      ],
      cell_boundaries: polygonRows(),
    })
    const dataset = new SpatialDataDataset({
      url: STORE_URL,
      fetcher: inMemoryZarrFetcher(storeFixture({ companionBoundaries: true })),
      readShapes,
      openImage: imageOpenerFixture(),
    })

    const elements = await dataset.elements({
      minX: micrometers(0),
      maxX: micrometers(10),
      minY: micrometers(0),
      maxY: micrometers(10),
    })

    expect(elements.elements.map((element) => element.id)).toEqual(['cell-a', 'cell-b'])
    expect(elements.elements[0]?.geometry).toMatchObject({
      kind: 'polygon',
      rings: [
        [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 2, y: 2 },
          { x: 0, y: 2 },
        ],
      ],
    })
    await expect(dataset.summary()).resolves.toMatchObject({
      boundaries: 'cell_boundaries',
    })
  })
})

function storeFixture(
  options: { readonly companionBoundaries?: boolean } = {},
): ReadonlyMap<string, Uint8Array> {
  const shapesTransform = (name: string) => ({
    'encoding-type': 'ngff:shapes',
    coordinateTransformations: [
      {
        type: 'scale',
        scale: [2, 2],
        input: XY,
        output: { name: 'global', axes: XY.axes },
      },
    ],
    spatialdata_attrs: { version: '0.2', name },
  })
  const metadata: Record<string, unknown> = {
    '.zgroup': { zarr_format: 2 },
    '.zattrs': { spatialdata_attrs: { version: '0.1' } },
    'images/.zgroup': { zarr_format: 2 },
    'images/he/.zgroup': { zarr_format: 2 },
    'images/he/.zattrs': {
      multiscales: [
        {
          axes: CYX.axes,
          datasets: [{ path: '0' }],
          coordinateTransformations: [
            {
              type: 'sequence',
              input: CYX,
              output: { name: 'global', axes: CYX.axes },
              transformations: [
                { type: 'scale', scale: [1, 0.5, 0.5], input: CYX, output: CYX },
                {
                  type: 'translation',
                  translation: [0, 10, 20],
                  input: CYX,
                  output: CYX,
                },
              ],
            },
          ],
        },
      ],
    },
    'shapes/.zgroup': { zarr_format: 2 },
    'shapes/cells/.zgroup': { zarr_format: 2 },
    'shapes/cells/.zattrs': shapesTransform('cells'),
    ...(options.companionBoundaries === true
      ? {
          'shapes/cell_boundaries/.zgroup': { zarr_format: 2 },
          'shapes/cell_boundaries/.zattrs': shapesTransform('cell_boundaries'),
        }
      : {}),
    'tables/.zgroup': { zarr_format: 2 },
    'tables/table/.zgroup': { zarr_format: 2 },
    'tables/table/.zattrs': {
      'encoding-type': 'anndata',
      region: 'cells',
      region_key: 'region',
      instance_key: 'cell_id',
    },
    'tables/table/obs/.zgroup': { zarr_format: 2 },
    'tables/table/obs/.zattrs': {
      _index: '_index',
      'column-order': ['region', 'cell_id'],
      'encoding-type': 'dataframe',
    },
    'tables/table/obs/_index/.zarray': arrayMeta([3], '|S6'),
    'tables/table/obs/cell_id/.zarray': arrayMeta([3], '<i8'),
    'tables/table/obs/region/.zgroup': { zarr_format: 2 },
    'tables/table/obs/region/.zattrs': { 'encoding-type': 'categorical' },
    'tables/table/obs/region/codes/.zarray': arrayMeta([3], '|i1'),
    'tables/table/obs/region/categories/.zarray': arrayMeta([1], '|S5'),
    'tables/table/var/.zgroup': { zarr_format: 2 },
    'tables/table/var/.zattrs': { _index: '_index', 'encoding-type': 'dataframe' },
    'tables/table/var/_index/.zarray': arrayMeta([2], '|S4'),
    'tables/table/obsm/.zgroup': { zarr_format: 2 },
    'tables/table/X/.zgroup': { zarr_format: 2 },
    'tables/table/X/.zattrs': { 'encoding-type': 'csr_matrix', shape: [3, 2] },
    'tables/table/X/data/.zarray': arrayMeta([4], '<f4'),
    'tables/table/X/indices/.zarray': arrayMeta([4], '<i4'),
    'tables/table/X/indptr/.zarray': arrayMeta([4], '<i4'),
  }
  const encoder = new TextEncoder()

  return new Map<string, Uint8Array>([
    [
      '/zmetadata',
      encoder.encode(JSON.stringify({ zarr_consolidated_format: 1, metadata })),
    ],
    ['/tables/table/obs/_index/0', fixedStrings(['cell-a', 'cell-b', 'cell-c'], 6)],
    ['/tables/table/obs/cell_id/0', bytes(new BigInt64Array([10n, 11n, 99n]))],
    ['/tables/table/obs/region/codes/0', bytes(new Int8Array([0, 0, 0]))],
    ['/tables/table/obs/region/categories/0', fixedStrings(['cells'], 5)],
    ['/tables/table/var/_index/0', fixedStrings(['Actb', 'Gad1'], 4)],
    ['/tables/table/X/data/0', bytes(new Float32Array([1, 2, 3, 4]))],
    ['/tables/table/X/indices/0', bytes(new Int32Array([0, 1, 0, 1]))],
    ['/tables/table/X/indptr/0', bytes(new Int32Array([0, 1, 2, 4]))],
  ])
}

function polygonRows(): readonly Record<string, unknown>[] {
  const square = (x: number) => [
    [
      [x, 0],
      [x + 1, 0],
      [x + 1, 1],
      [x, 1],
    ],
  ]

  return [
    { geometry: { type: 'Polygon', coordinates: square(0) }, id: 10n },
    { geometry: { type: 'Polygon', coordinates: square(2) }, id: 11n },
  ]
}

function shapesReaderFixture(
  rowsByElement: Readonly<Record<string, readonly Record<string, unknown>[]>>,
): SpatialDataShapesReader {
  return vi.fn(async ({ url, affine }) => {
    const name = /\/shapes\/([^/]+)\/shapes\.parquet$/.exec(url)?.[1] ?? ''

    return shapesFromRows(
      rowsByElement[name] ?? [],
      {
        columns: ['geometry', 'radius', 'id'],
        geometryColumn: 'geometry',
        radiusColumn: 'radius',
        index: { kind: 'column', column: 'id' },
      },
      affine,
    )
  })
}

function imageOpenerFixture() {
  return vi.fn(async (request: SpatialDataImageRequest) => {
    const { scaleX, translateX, translateY } = request.transform

    return {
      url: request.url,
      units: {
        dataUnit: 'micrometer',
        imageUnit: 'pixel',
        micrometersPerPixel: micrometers(scaleX),
        origin: 'top-left',
        imageYAxis: 'down',
      },
      imageWidth: 100,
      imageHeight: 100,
      channels: [],
      tileBounds: () => ({
        minX: micrometers(translateX),
        maxX: micrometers(translateX + 1),
        minY: micrometers(translateY),
        maxY: micrometers(translateY + 1),
      }),
    } as unknown as ImagePyramidLoader
  })
}

function inMemoryZarrFetcher(files: ReadonlyMap<string, Uint8Array>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const path = url.pathname.replace(/^\/sample\.sdata\.zarr/, '')
    const body = files.get(path)

    // Object stores that deny listing answer missing keys with 403.
    return body === undefined
      ? new Response('Forbidden', { status: 403 })
      : new Response(Uint8Array.from(body), { status: 200 })
  }) as unknown as typeof fetch
}

function arrayMeta(shape: readonly number[], dtype: string): Record<string, unknown> {
  return {
    zarr_format: 2,
    shape,
    chunks: shape,
    dtype,
    compressor: null,
    fill_value: null,
    order: 'C',
    filters: null,
  }
}

function bytes(value: ArrayBufferView): Uint8Array {
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
}

function fixedStrings(values: readonly string[], width: number): Uint8Array {
  const encoder = new TextEncoder()
  const output = new Uint8Array(values.length * width)

  values.forEach((value, index) => {
    output.set(encoder.encode(value).slice(0, width), index * width)
  })

  return output
}
