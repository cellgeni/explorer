import { describe, expect, it, vi } from 'vitest'
import {
  isSpatialDataRootMetadata,
  openSpatialDataStore,
  readSpatialDataCatalog,
  selectSpatialDataView,
  SpatialDataConsolidatedMetadataError,
  type SpatialDataCatalog,
  type SpatialDataElement,
} from './spatialDataCatalog'
import { ICECHUNK_FIXTURE_ORIGIN, icechunkFixtureFetcher } from '../test/icechunkFixtures'

describe('SpatialData catalog', () => {
  it('reads a SpatialData store in an Icechunk repository', async () => {
    const { store, zarrFormat } = await openSpatialDataStore(
      `${ICECHUNK_FIXTURE_ORIGIN}/spatialdata.icechunk`,
      { fetcher: icechunkFixtureFetcher() },
    )
    const catalog = await readSpatialDataCatalog(store, zarrFormat)

    expect(zarrFormat).toBe(3)
    expect(catalog.elements.map((element) => `${element.kind}/${element.name}`)).toEqual([
      'images/image',
      'tables/table',
    ])
    expect(catalog.tables).toEqual([
      {
        name: 'table',
        path: 'tables/table',
        regions: ['image'],
        regionKey: 'region',
        instanceKey: 'cell_id',
      },
    ])
  })

  it('recognizes root attributes but not element attributes', () => {
    expect(isSpatialDataRootMetadata({ spatialdata_attrs: { version: '0.1' } })).toBe(
      true,
    )
    expect(
      isSpatialDataRootMetadata({
        zarr_format: 3,
        node_type: 'group',
        attributes: { spatialdata_attrs: { version: '0.2' } },
      }),
    ).toBe(true)
    expect(
      isSpatialDataRootMetadata({
        spatialdata_attrs: { version: '0.1' },
        multiscales: [],
      }),
    ).toBe(false)
    expect(isSpatialDataRootMetadata({ multiscales: [] })).toBe(false)
  })

  it('prefers the coordinate system holding table regions and an image', () => {
    const catalog = catalogFixture([
      element('images', 'hires', [
        ['global', { a: 10, e: 10 }],
        ['hires', {}],
      ]),
      element('images', 'full', [['global', {}]]),
      element('shapes', 'spots', [
        ['global', {}],
        ['hires', { a: 0.1, e: 0.1 }],
      ]),
      element('shapes', 'cell_boundaries', [['global', {}]]),
      element('points', 'transcripts', [['global', {}]]),
    ])
    const view = selectSpatialDataView(catalog)

    expect(view.coordinateSystem).toBe('global')
    expect(view.coordinateSystems).toEqual(['global', 'hires'])
    expect(view.image?.element.name).toBe('full')
    expect(view.table?.name).toBe('table')
    expect(view.regionShapes.map((entry) => entry.element.name)).toEqual(['spots'])
    expect(view.boundaryCandidates.map((entry) => entry.element.name)).toEqual([
      'cell_boundaries',
    ])
    expect(view.skippedElements.map((entry) => entry.name)).toEqual([
      'hires',
      'transcripts',
    ])
  })

  it('honours an explicit coordinate system', () => {
    const catalog = catalogFixture([
      element('images', 'hires', [['hires', {}]]),
      element('shapes', 'spots', [
        ['global', {}],
        ['hires', { a: 0.1, e: 0.1 }],
      ]),
    ])
    const view = selectSpatialDataView(catalog, { coordinateSystem: 'hires' })

    expect(view.coordinateSystem).toBe('hires')
    expect(view.image?.element.name).toBe('hires')
    expect(view.regionShapes[0]?.affine).toMatchObject({ a: 0.1, e: 0.1 })
  })

  it('opens Visium HD stores on the coarsest bins and honours an explicit table', () => {
    const bins = ['002', '008', '016']
    const catalog: SpatialDataCatalog = {
      zarrFormat: 3,
      nodes: [],
      elements: [
        ...bins.map((bin) =>
          element('shapes', `sample_square_${bin}um`, [['global', {}]]),
        ),
        ...bins.map((bin) => element('tables', `square_${bin}um`, [])),
      ],
      tables: bins.map((bin) => ({
        name: `square_${bin}um`,
        path: `tables/square_${bin}um`,
        regions: [`sample_square_${bin}um`],
      })),
    }
    const regions = (view: ReturnType<typeof selectSpatialDataView>) =>
      view.regionShapes.map((entry) => entry.element.name)

    const coarsest = selectSpatialDataView(catalog)
    expect(coarsest.table?.name).toBe('square_016um')
    expect(coarsest.tables.map((table) => table.name)).toEqual([
      'square_002um',
      'square_008um',
      'square_016um',
    ])
    expect(regions(coarsest)).toEqual(['sample_square_016um'])
    expect(
      coarsest.skippedElements.map((entry) => `${entry.kind}/${entry.name}`),
    ).toEqual([
      'shapes/sample_square_002um',
      'shapes/sample_square_008um',
      'tables/square_002um',
      'tables/square_008um',
    ])

    const chosen = selectSpatialDataView(catalog, { table: 'square_008um' })
    expect(chosen.table?.name).toBe('square_008um')
    expect(regions(chosen)).toEqual(['sample_square_008um'])

    // A table that is not in the store (an old link) falls back to the default.
    expect(selectSpatialDataView(catalog, { table: 'gone' }).table?.name).toBe(
      'square_016um',
    )
  })

  it('keeps the first table by name when no table holds Visium HD bins', () => {
    // As in the STHELAR stores; readSpatialDataCatalog sorts tables by name.
    const catalog: SpatialDataCatalog = {
      ...catalogFixture([element('shapes', 'cell_boundaries', [['global', {}]])]),
      tables: ['table_cells', 'table_nuclei', 'table_scvi'].map((name) => ({
        name,
        path: `tables/${name}`,
        regions: ['cell_boundaries'],
      })),
    }

    expect(selectSpatialDataView(catalog).table?.name).toBe('table_cells')
  })

  it('serves consolidated metadata without probing missing metadata keys', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input))

      if (url.pathname === '/store.zarr/zmetadata') {
        return Response.json({
          zarr_consolidated_format: 1,
          metadata: {
            '.zgroup': { zarr_format: 2 },
            '.zattrs': { spatialdata_attrs: { version: '0.1' } },
            'shapes/.zgroup': { zarr_format: 2 },
            'shapes/spots/.zgroup': { zarr_format: 2 },
            'shapes/spots/.zattrs': {
              coordinateTransformations: [
                {
                  type: 'identity',
                  input: { name: 'xy', axes: ['x', 'y'] },
                  output: { name: 'global' },
                },
              ],
            },
          },
        })
      }

      return new Response('Forbidden', { status: 403 })
    }) as unknown as typeof fetch
    const { store, zarrFormat } = await openSpatialDataStore(
      'https://example.test/store.zarr',
      { fetcher },
    )
    const catalog = await readSpatialDataCatalog(store, zarrFormat)

    expect(zarrFormat).toBe(2)
    expect(catalog.elements.map((entry) => entry.path)).toEqual(['shapes/spots'])
    expect(await store.get('/shapes/spots/geometry/.zattrs')).toBeUndefined()
    // Only the three consolidated-metadata layouts, probed in parallel.
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('reports stores without consolidated metadata', async () => {
    const fetcher = vi.fn(
      async () => new Response(null, { status: 404 }),
    ) as unknown as typeof fetch

    await expect(
      openSpatialDataStore('https://example.test/store.zarr', { fetcher }),
    ).rejects.toBeInstanceOf(SpatialDataConsolidatedMetadataError)
  })
})

function catalogFixture(elements: readonly SpatialDataElement[]): SpatialDataCatalog {
  return {
    zarrFormat: 2,
    nodes: [],
    elements,
    tables: [
      {
        name: 'table',
        path: 'tables/table',
        regions: ['spots'],
        regionKey: 'region',
        instanceKey: 'spot_id',
      },
    ],
  }
}

function element(
  kind: SpatialDataElement['kind'],
  name: string,
  transforms: readonly [string, { readonly a?: number; readonly e?: number }][],
): SpatialDataElement {
  return {
    kind,
    name,
    path: `${kind}/${name}`,
    attrs: {},
    transforms: transforms.map(([coordinateSystem, scale]) => ({
      coordinateSystem,
      affine: { a: scale.a ?? 1, b: 0, c: 0, d: 0, e: scale.e ?? 1, f: 0 },
    })),
  }
}
