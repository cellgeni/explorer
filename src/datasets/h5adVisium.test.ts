import { afterEach, describe, expect, it, vi } from 'vitest'
import { micrometers } from '../data/coords'
import { AnnDataH5adDataset } from './h5adDataset'

const MICROMETERS_PER_PIXEL = 0.8

interface VisiumH5adOptions {
  // Second library whose spots share the pixel space; rows name their
  // library in obs `library_id`.
  readonly secondLibrary?: boolean
  readonly arrayCoordinates?: boolean
  readonly coordinateKey?: string
  // obs `in_tissue`, with the first six spots off the tissue.
  readonly inTissue?: boolean
}

// Scanpy `read_visium` layout: obs array_row/array_col, obsm spatial in
// full-res pixels (int64), uns/spatial/<library>/{scalefactors,images}.
async function createVisiumH5ad(options: VisiumH5adOptions = {}): Promise<Uint8Array> {
  const h5wasm = (await import('h5wasm')).default
  const { FS } = await h5wasm.ready
  const fileName = '/vitest-visium.h5ad'
  const rows: { row: number; col: number; x: number; y: number }[] = []

  for (let row = 0; row < 6; row += 1) {
    for (let index = 0; index < 6; index += 1) {
      const col = (row % 2) + index * 2
      rows.push({
        row,
        col,
        x: Math.round(1000 + (col * 50) / MICROMETERS_PER_PIXEL),
        y: Math.round(500 + (row * 50 * Math.sqrt(3)) / MICROMETERS_PER_PIXEL),
      })
    }
  }

  try {
    FS.unlink(fileName)
  } catch {
    // No fixture from an earlier run.
  }

  const file = new h5wasm.File(fileName, 'w')
  const obs = file.create_group('obs')
  const columns = [
    ...(options.inTissue === true ? ['in_tissue'] : []),
    ...(options.arrayCoordinates === false ? [] : ['array_row', 'array_col']),
    ...(options.secondLibrary === true ? ['library_id'] : []),
  ]
  obs.create_attribute('_index', '_index')
  obs.create_attribute('column-order', columns)
  obs.create_dataset({
    name: '_index',
    data: rows.map((_row, index) => `spot-${index.toString()}`),
  })

  if (options.inTissue === true) {
    obs.create_dataset({
      name: 'in_tissue',
      data: new Int32Array(rows.map((_row, index) => (index < 6 ? 0 : 1))),
    })
  }

  if (options.arrayCoordinates !== false) {
    obs.create_dataset({
      name: 'array_row',
      data: new Int32Array(rows.map((row) => row.row)),
    })
    obs.create_dataset({
      name: 'array_col',
      data: new Int32Array(rows.map((row) => row.col)),
    })
  }

  if (options.secondLibrary === true) {
    const library = obs.create_group('library_id')
    library.create_attribute('encoding-type', 'categorical')
    library.create_dataset({ name: 'categories', data: ['lib-A', 'lib-B'] })
    library.create_dataset({
      name: 'codes',
      data: new Int8Array(rows.map((_row, index) => (index < 24 ? 0 : 1))),
    })
  }

  // CELLxGENE layout: Ensembl IDs as the index, symbols in a categorical.
  const varGroup = file.create_group('var')
  varGroup.create_attribute('_index', '_index')
  varGroup.create_dataset({ name: '_index', data: ['ENSMUSG01', 'ENSMUSG02'] })
  const featureName = varGroup.create_group('feature_name')
  featureName.create_attribute('encoding-type', 'categorical')
  featureName.create_dataset({ name: 'categories', data: ['Gad1', 'Actb'] })
  featureName.create_dataset({ name: 'codes', data: new Int8Array([1, 0]) })
  file.create_dataset({
    name: 'X',
    data: new Float32Array(rows.flatMap((_row, index) => [index, index % 2])),
    shape: [rows.length, 2],
  })
  const obsm = file.create_group('obsm')
  obsm.create_dataset({
    name: options.coordinateKey ?? 'spatial',
    data: new BigInt64Array(rows.flatMap((row) => [BigInt(row.x), BigInt(row.y)])),
    shape: [rows.length, 2],
  })

  const spatial = file.create_group('uns').create_group('spatial')
  spatial.create_dataset({ name: 'is_single', data: 1 })

  for (const libraryId of options.secondLibrary === true
    ? ['lib-A', 'lib-B']
    : ['lib-A']) {
    const library = spatial.create_group(libraryId)
    const scalefactors = library.create_group('scalefactors')
    scalefactors.create_dataset({ name: 'tissue_hires_scalef', data: 0.25 })
    scalefactors.create_dataset({ name: 'tissue_lowres_scalef', data: 0.075 })
    scalefactors.create_dataset({ name: 'spot_diameter_fullres', data: 81.25 })
    const images = library.create_group('images')
    // 2 x 3 RGB, 0-1 floats as scanpy reads PNGs.
    images.create_dataset({
      name: 'hires',
      data: new Float32Array(18).fill(0.5),
      shape: [2, 3, 3],
    })
    library.create_group('metadata').create_dataset({
      name: 'software_version',
      data: 'spaceranger-2.1.0',
    })
  }

  file.close()
  const bytes = FS.readFile(fileName)
  FS.unlink(fileName)
  return bytes
}

function datasetFor(bytes: Uint8Array): AnnDataH5adDataset {
  return new AnnDataH5adDataset({
    url: 'https://example.test/visium.h5ad',
    fetcher: (async () => new Response(bytes.slice(), { status: 200 })) as typeof fetch,
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AnnDataH5adDataset with uns/spatial', () => {
  it('reads the Visium layout: micrometres, spot outlines, and the uns image', async () => {
    const createObjectUrl = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:visium-hires')
    const dataset = datasetFor(await createVisiumH5ad())

    const [meta, summary, cells] = await Promise.all([
      dataset.meta(),
      dataset.visiumSummary(),
      dataset.overview(),
    ])

    expect(meta.platform).toBe('visium')
    expect(meta.units.micrometersPerPixel).toBeCloseTo(MICROMETERS_PER_PIXEL, 2)
    expect(summary).toMatchObject({
      libraryId: 'lib-A',
      libraryIds: ['lib-A'],
      spotCount: 36,
      units: { source: 'spot-grid' },
      images: ['hires'],
      softwareVersion: 'spaceranger-2.1.0',
    })
    expect(cells[0]?.position.x).toBeCloseTo(
      1000 * (summary?.units.micrometersPerPixel ?? 0),
    )
    expect(cells[0]?.cellArea).toBeCloseTo(Math.PI * 27.5 ** 2)

    expect(await dataset.genePanel()).toEqual(['Actb', 'Gad1'])

    const elements = await dataset.elements(meta.extent)
    expect(elements.elements).toHaveLength(36)

    const image = await dataset.image()
    expect(image).toEqual({
      kind: 'flat',
      url: 'blob:visium-hires',
      scaleFactor: 0.25,
      size: [3, 2],
    })
    const blob = createObjectUrl.mock.calls[0]?.[0] as Blob
    expect(blob.type).toBe('image/bmp')
    // 54-byte header plus two 12-byte rows (9 bytes padded to 12).
    expect(blob.size).toBe(54 + 2 * 12)

    // Encoded once per image.
    await dataset.tissueImage('hires')
    expect(createObjectUrl).toHaveBeenCalledTimes(1)
    expect(await dataset.tissueImage('lowres')).toBeNull()
  })

  it('places only the first library when obs names each row’s library', async () => {
    const dataset = datasetFor(await createVisiumH5ad({ secondLibrary: true }))
    const [summary, cells] = await Promise.all([
      dataset.visiumSummary(),
      dataset.overview(),
    ])

    expect(summary).toMatchObject({
      libraryId: 'lib-A',
      libraryIds: ['lib-A', 'lib-B'],
      spotCount: 24,
    })
    expect(cells).toHaveLength(24)
    expect(await dataset.cellIds()).toHaveLength(36)
  })

  it('hides spots off the tissue but fits the scale on the whole array', async () => {
    const dataset = datasetFor(await createVisiumH5ad({ inTissue: true }))
    const [summary, cells] = await Promise.all([
      dataset.visiumSummary(),
      dataset.overview(),
    ])

    expect(summary).toMatchObject({ spotCount: 30, offTissueSpotCount: 6 })
    expect(summary?.units.micrometersPerPixel).toBeCloseTo(MICROMETERS_PER_PIXEL, 2)
    expect(cells).toHaveLength(30)
    expect(cells[0]?.cellId).toBe('spot-6')
  })

  it('falls back to the spot pitch without array coordinates', async () => {
    const dataset = datasetFor(await createVisiumH5ad({ arrayCoordinates: false }))
    const summary = await dataset.visiumSummary()

    expect(summary?.units.source).toBe('spot-pitch')
    expect(summary?.units.micrometersPerPixel).toBeCloseTo(MICROMETERS_PER_PIXEL, 1)
  })

  it('keeps plain H5AD behaviour when coordinates are not obsm spatial', async () => {
    const dataset = datasetFor(await createVisiumH5ad({ coordinateKey: 'X_umap' }))

    expect(await dataset.visiumSummary()).toBeNull()
    expect((await dataset.meta()).platform).toBe('h5ad')
    expect(
      await dataset.elements({
        minX: micrometers(-1e9),
        maxX: micrometers(1e9),
        minY: micrometers(-1e9),
        maxY: micrometers(1e9),
      }),
    ).toEqual({ elements: [] })
    expect(await dataset.image()).toBeNull()
  })
})
