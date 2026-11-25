import { describe, expect, it, vi } from 'vitest'
import { micrometers } from '../data/coords'
import type { ImagePyramidLoader } from '../data/imagePyramid'
import { SpatialDataDataset, type SpatialDataImageRequest } from './spatialDataDataset'
import {
  shapesFromRows,
  SpatialDataShapesBuilder,
  type SpatialDataShapesReader,
} from './spatialDataShapes'
import { withCellMetadata } from '../test/cellMetadataFixtures'
import { byteRangeFetcher, zipArchive, type ZipFixtureFile } from '../test/zipFixtures'

const STORE_URL = 'https://example.test/sample.sdata.zarr'
const XY = { name: 'xy', axes: [{ name: 'x' }, { name: 'y' }] }
const CYX = { name: 'cyx', axes: [{ name: 'c' }, { name: 'y' }, { name: 'x' }] }

describe('SpatialDataDataset', () => {
  it('joins table rows to shapes on instance IDs above 2^53 exactly', async () => {
    // As spatialdata-io keeps MERSCOPE EntityIDs. As numbers, all three round
    // to 2305843009213693952.
    const ids = [
      2_305_843_009_213_693_964n,
      2_305_843_009_213_693_965n,
      2_305_843_009_213_693_966n,
    ]
    const open = (cellIds?: readonly bigint[]) =>
      new SpatialDataDataset({
        url: STORE_URL,
        fetcher: inMemoryZarrFetcher(
          storeFixture(cellIds === undefined ? {} : { cellIds }),
        ),
        readShapes: shapesReaderFixture({
          cells: polygonRows().map((row, index) =>
            cellIds === undefined ? row : { ...row, id: cellIds[index] },
          ),
        }),
        openImage: imageOpenerFixture(),
      })
    const placed = async (dataset: SpatialDataDataset) =>
      (await dataset.overview()).map((cell) => [cell.cellId, cell.position])

    // The same places as the small IDs give.
    await expect(placed(open(ids))).resolves.toEqual(await placed(open()))
    await expect(placed(open(ids))).resolves.toHaveLength(2)
  })

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
      images: ['he'],
      table: 'table',
      tables: ['table'],
      regions: ['cells'],
      boundaries: 'cells',
      skippedElements: [],
      units: {
        micrometersPerUnit: 1,
        source: 'unknown',
        detail: 'coordinate system axes have no physical unit',
      },
    })

    const overview = await dataset.overview()
    // cell-c annotates an instance missing from the shapes element.
    expect(overview.map((cell) => cell.cellId)).toEqual(['cell-a', 'cell-b'])
    expect(overview[0]?.position).toEqual({ x: 1, y: 1 })
    expect(withCellMetadata(overview)[1]?.metadata).toEqual({
      region: 'cells',
      cell_id: 11,
    })
    await expect(dataset.genePanel()).resolves.toEqual(['Actb', 'Gad1'])
    await expect(dataset.geneAliases()).resolves.toEqual(new Map())

    const matrix = await dataset.matrix(['cell-b', 'cell-c'])
    expect(matrix.cells.get('cell-b')).toEqual({ geneNames: ['Gad1'], counts: [2] })
    expect(matrix.cells.get('cell-c')).toEqual({
      geneNames: ['Actb', 'Gad1'],
      counts: [3, 4],
    })

    // The table's expression batch passes through.
    await expect(
      dataset.geneExpression(
        {
          minX: micrometers(0),
          maxX: micrometers(10),
          minY: micrometers(0),
          maxY: micrometers(10),
        },
        ['Actb'],
      ),
    ).resolves.toMatchObject({ population: 'all' })

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

  it('opens an image with swapped and flipped axes through a frame placement', async () => {
    const openImage = imageOpenerFixture()
    const dataset = new SpatialDataDataset({
      url: STORE_URL,
      fetcher: inMemoryZarrFetcher(storeFixture({ flippedImage: true })),
      readShapes: shapesReaderFixture({ cells: polygonRows() }),
      openImage,
    })

    await expect(dataset.summary()).resolves.toMatchObject({
      image: 'he',
      images: ['he'],
      skippedElements: [],
    })
    const meta = await dataset.meta()

    expect(openImage).toHaveBeenCalledWith(
      expect.objectContaining({
        transform: {
          scaleX: 0.5,
          scaleY: 0.5,
          translateX: 0,
          translateY: 0,
          placement: { a: 0, b: 1, c: 10, d: -1, e: 0, f: 60 },
        },
      }),
    )
    // The 50 × 50 µm frame lands at x 10-60, y 10-60.
    expect(meta.extent).toEqual({ minX: 1, minY: 1, maxX: 60, maxY: 60 })
  })

  it('loads boundaries when the image cannot be opened', async () => {
    const dataset = new SpatialDataDataset({
      url: STORE_URL,
      fetcher: inMemoryZarrFetcher(storeFixture()),
      readShapes: shapesReaderFixture({ cells: polygonRows() }),
      openImage: vi.fn(async () => {
        throw new Error('OME-Zarr image has invalid width.')
      }),
    })

    await expect(dataset.meta()).resolves.toMatchObject({
      capabilities: { cellBoundaries: true, pyramidImage: false },
      extent: { minX: 1, minY: 1, maxX: 5, maxY: 1 },
    })
    const elements = await dataset.elements({
      minX: micrometers(0),
      maxX: micrometers(10),
      minY: micrometers(0),
      maxY: micrometers(10),
    })
    expect(elements.elements.map((element) => element.id)).toEqual(['cell-a', 'cell-b'])
    await expect(dataset.image()).rejects.toThrow('OME-Zarr image has invalid width.')
  })

  it('matches rows to shapes stored in another order and outlines region circles', async () => {
    const dataset = new SpatialDataDataset({
      url: STORE_URL,
      fetcher: inMemoryZarrFetcher(storeFixture()),
      readShapes: shapesReaderFixture({
        cells: [
          { geometry: { type: 'Point', coordinates: [2.5, 0.5] }, radius: 1, id: 11n },
          { geometry: { type: 'Point', coordinates: [0.5, 0.5] }, radius: 1, id: 10n },
        ],
      }),
      openImage: imageOpenerFixture(),
    })
    const bbox = {
      minX: micrometers(0),
      maxX: micrometers(10),
      minY: micrometers(0),
      maxY: micrometers(10),
    }

    const overview = await dataset.overview()
    expect(overview.map((cell) => [cell.cellId, cell.position])).toEqual([
      ['cell-a', { x: 1, y: 1 }],
      ['cell-b', { x: 5, y: 1 }],
    ])

    const { elements } = await dataset.elements(bbox)
    const outline =
      elements[0]?.geometry.kind === 'polygon' ? elements[0].geometry.rings[0] : undefined
    expect(elements.map((element) => element.id)).toEqual(['cell-a', 'cell-b'])
    // A 32-segment polygon around the circle at (1, 1) with radius 2.
    expect(outline).toHaveLength(32)
    expect(outline?.[0]).toEqual({ x: 3, y: 1 })
    // Cells still in view keep their element objects.
    expect((await dataset.elements(bbox)).elements[0]).toBe(elements[0])
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

describe('SpatialDataDataset nucleus boundaries', () => {
  const everywhere = {
    minX: micrometers(0),
    maxX: micrometers(100),
    minY: micrometers(0),
    maxY: micrometers(100),
  }
  const nucleus = (x: number, id: unknown) => ({
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [x, 0],
          [x + 0.5, 0],
          [x + 0.5, 0.5],
        ],
      ],
    },
    id,
  })

  it('matches nuclei to table rows through the region shapes', async () => {
    const progress: string[] = []
    const dataset = new SpatialDataDataset({
      url: STORE_URL,
      fetcher: inMemoryZarrFetcher(storeFixture({ nucleusBoundaries: true })),
      readShapes: shapesReaderFixture({
        cells: polygonRows(),
        // Cell 10 has two nuclei; 77 matches no shape.
        nucleus_boundaries: [
          nucleus(0, 10n),
          nucleus(0.25, 10n),
          nucleus(2, 11n),
          nucleus(4, 77n),
        ],
      }),
      openImage: imageOpenerFixture(),
      onProgress: (message) => {
        progress.push(message)
      },
    })

    await expect(dataset.summary()).resolves.toMatchObject({
      boundaries: 'cells',
      nuclei: 'nucleus_boundaries',
      skippedElements: [],
    })
    await expect(dataset.meta()).resolves.toMatchObject({
      segmentations: [
        {
          id: 'cell',
          kind: 'cell',
          sourceKind: 'parquet',
          path: 'shapes/cells/shapes.parquet',
        },
        {
          id: 'nucleus',
          kind: 'nucleus',
          sourceKind: 'parquet',
          path: 'shapes/nucleus_boundaries/shapes.parquet',
        },
      ],
    })

    const nuclei = await dataset.segmentationElements('nucleus', everywhere)
    expect(nuclei.map((element) => element.id)).toEqual([
      'cell-a',
      'cell-a#nucleus-2',
      'cell-b',
    ])
    // Each nucleus names its cell, for hover and the Cell card.
    expect(nuclei.map((element) => element.metadata?.segmentation?.cellId)).toEqual([
      'cell-a',
      'cell-a',
      'cell-b',
    ])
    expect(nuclei[0]).toMatchObject({
      metadata: { segmentation: { kind: 'nucleus' } },
      // The element transform scales shapes by 2.
      geometry: {
        rings: [
          [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
          ],
        ],
      },
    })
    expect(progress).toContain(
      'SpatialData shapes nucleus_boundaries: 3 of 4 nuclei match table rows',
    )

    const inView = await dataset.segmentationElements('nucleus', {
      minX: micrometers(3),
      maxX: micrometers(10),
      minY: micrometers(0),
      maxY: micrometers(10),
    })
    expect(inView.map((element) => element.id)).toEqual(['cell-b'])
    // Nuclei still in view keep their element objects.
    expect(inView[0]).toBe(nuclei[2])
    await expect(dataset.segmentationElements('cell', everywhere)).resolves.toHaveLength(
      2,
    )
  })

  it('draws every nucleus when none matches a table row', async () => {
    const progress: string[] = []
    const dataset = new SpatialDataDataset({
      url: STORE_URL,
      fetcher: inMemoryZarrFetcher(storeFixture({ nucleusBoundaries: true })),
      readShapes: shapesReaderFixture({
        cells: polygonRows(),
        nucleus_boundaries: [nucleus(0, 'n-1'), nucleus(2, 'n-2')],
      }),
      openImage: imageOpenerFixture(),
      onProgress: (message) => {
        progress.push(message)
      },
    })

    const nuclei = await dataset.segmentationElements('nucleus', everywhere)

    expect(nuclei.map((element) => element.id)).toEqual([
      'nucleus_boundaries#n-1',
      'nucleus_boundaries#n-2',
    ])
    expect(nuclei[0]?.metadata).toEqual({ segmentation: { kind: 'nucleus' } })
    expect(progress).toContain(
      'SpatialData shapes nucleus_boundaries: no nucleus matches a row of table table; drawing every nucleus',
    )
  })

  it('matches nuclei by table cell id when the table annotates labels', async () => {
    const dataset = new SpatialDataDataset({
      url: STORE_URL,
      fetcher: inMemoryZarrFetcher(labelsStoreFixture({ nucleusBoundaries: true })),
      readShapes: shapesReaderFixture({
        nucleus_boundaries: [nucleus(1, 'cell-b'), nucleus(3, 'cell-z')],
      }),
      openImage: imageOpenerFixture(),
    })

    await expect(dataset.meta()).resolves.toMatchObject({
      segmentations: [
        { kind: 'cell', sourceKind: 'zarr', path: 'labels/seg' },
        { kind: 'nucleus', sourceKind: 'parquet' },
      ],
    })
    const nuclei = await dataset.segmentationElements('nucleus', everywhere)
    expect(nuclei.map((element) => element.id)).toEqual(['cell-b'])
  })

  it('has no nucleus layer without a nucleus shapes element', async () => {
    const readShapes = shapesReaderFixture({ cells: polygonRows() })
    const dataset = new SpatialDataDataset({
      url: STORE_URL,
      fetcher: inMemoryZarrFetcher(storeFixture()),
      readShapes,
      openImage: imageOpenerFixture(),
    })

    expect((await dataset.summary()).nuclei).toBeUndefined()
    expect((await dataset.meta()).segmentations?.map((entry) => entry.kind)).toEqual([
      'cell',
    ])
    await expect(dataset.segmentationElements('nucleus', everywhere)).resolves.toEqual([])
  })
})

describe('SpatialDataDataset with a table and no spatial element', () => {
  it('places the rows from obsm', async () => {
    const dataset = new SpatialDataDataset({
      url: STORE_URL,
      fetcher: inMemoryZarrFetcher(tableOnlyStoreFixture()),
    })

    const overview = await dataset.overview()
    expect(overview.map((cell) => [cell.cellId, cell.position])).toEqual([
      ['cell-a', { x: 1, y: 2 }],
      ['cell-b', { x: 3, y: 4 }],
      ['cell-c', { x: 5, y: 6 }],
    ])
    await expect(dataset.summary()).resolves.toMatchObject({
      coordinateSystem: 'global',
      coordinateSystems: [],
      table: 'table',
    })
  })
})

describe('SpatialDataDataset units and labels', () => {
  it('scales placements, boundaries, and the image by the µm-per-unit override', async () => {
    const openImage = imageOpenerFixture()
    const dataset = new SpatialDataDataset({
      url: STORE_URL,
      fetcher: inMemoryZarrFetcher(storeFixture()),
      readShapes: shapesReaderFixture({ cells: polygonRows() }),
      openImage,
      micrometersPerUnit: 0.25,
    })

    const overview = await dataset.overview()
    expect(overview[0]?.position).toEqual({ x: 0.25, y: 0.25 })
    await expect(dataset.units()).resolves.toMatchObject({
      micrometersPerUnit: 0.25,
      source: 'override',
    })

    await dataset.meta()
    expect(openImage).toHaveBeenCalledWith(
      expect.objectContaining({
        transform: { scaleX: 0.125, scaleY: 0.125, translateX: 5, translateY: 2.5 },
      }),
    )

    const elements = await dataset.elements({
      minX: micrometers(0),
      maxX: micrometers(1),
      minY: micrometers(0),
      maxY: micrometers(1),
    })
    const ring = elements.elements[0]?.geometry
    expect(ring?.kind === 'polygon' ? ring.rings[0]?.[2] : undefined).toEqual({
      x: 0.5,
      y: 0.5,
    })
  })

  it('opens the image on a Xenium table pixel size without reading shapes', async () => {
    const readShapes = shapesReaderFixture({ cells: polygonRows() })
    const openImage = imageOpenerFixture()
    const dataset = new SpatialDataDataset({
      url: STORE_URL,
      fetcher: inMemoryZarrFetcher(withXeniumPixelSize(storeFixture(), 0.25)),
      readShapes,
      openImage,
    })

    await dataset.image()
    expect(readShapes).not.toHaveBeenCalled()
    expect(openImage).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `${STORE_URL}/images/he`,
        transform: { scaleX: 0.125, scaleY: 0.125, translateX: 5, translateY: 2.5 },
      }),
    )
    await expect(dataset.units()).resolves.toEqual({
      micrometersPerUnit: 0.25,
      source: 'declared',
      detail: 'Xenium pixel_size 0.25 µm in table table',
    })
    const overview = await dataset.overview()
    expect(overview[0]?.position).toEqual({ x: 0.25, y: 0.25 })
  })

  it('reads a Xenium pixel size only beside a Xenium morphology image', async () => {
    const dataset = new SpatialDataDataset({
      url: STORE_URL,
      fetcher: inMemoryZarrFetcher(withXeniumPixelSize(storeFixture(), 0.25, 'if')),
      readShapes: shapesReaderFixture({ cells: polygonRows() }),
      openImage: imageOpenerFixture(),
    })

    await expect(dataset.units()).resolves.toMatchObject({ source: 'unknown' })
  })

  it('selects a requested image from the coordinate system', async () => {
    const dataset = new SpatialDataDataset({
      url: STORE_URL,
      fetcher: inMemoryZarrFetcher(storeFixture({ secondImage: true })),
      readShapes: shapesReaderFixture({ cells: polygonRows() }),
      openImage: imageOpenerFixture(),
      image: 'if',
    })

    await expect(dataset.summary()).resolves.toMatchObject({
      image: 'if',
      images: ['he', 'if'],
    })
    await expect(dataset.imageUrl()).resolves.toBe(`${STORE_URL}/images/if`)
  })

  it('places label-annotated rows and traces their outlines', async () => {
    const dataset = new SpatialDataDataset({
      url: STORE_URL,
      fetcher: inMemoryZarrFetcher(labelsStoreFixture()),
      openImage: imageOpenerFixture(),
    })

    const overview = await dataset.overview()
    expect(overview.map((cell) => [cell.cellId, cell.position])).toEqual([
      ['cell-a', { x: 4, y: 2 }],
      ['cell-b', { x: 11, y: 3 }],
    ])
    await expect(dataset.summary()).resolves.toMatchObject({
      regions: ['seg'],
      boundaries: 'seg',
    })
    await expect(dataset.meta()).resolves.toMatchObject({
      capabilities: { cellBoundaries: true },
    })

    const elements = await dataset.elements({
      minX: micrometers(0),
      maxX: micrometers(12),
      minY: micrometers(0),
      maxY: micrometers(8),
    })
    const bounds = new Map(
      elements.elements.map((element) => {
        const ring =
          element.geometry.kind === 'polygon' ? (element.geometry.rings[0] ?? []) : []
        return [
          element.id,
          [
            Math.min(...ring.map((point) => point.x)),
            Math.max(...ring.map((point) => point.x)),
            Math.min(...ring.map((point) => point.y)),
            Math.max(...ring.map((point) => point.y)),
          ],
        ]
      }),
    )

    // Label 1 spans both chunks and is drawn as one outline.
    expect(bounds.get('cell-a')).toEqual([0, 8, 0, 4])
    expect(bounds.get('cell-b')).toEqual([10, 12, 2, 6])
  })
})

describe('SpatialDataDataset labels at a plane (plan 28-D9)', () => {
  it("traces the labels at the image's time point", async () => {
    const dataset = new SpatialDataDataset({
      url: STORE_URL,
      fetcher: inMemoryZarrFetcher(labelsStoreFixture({ timeLapse: true })),
      openImage: imageOpenerFixture(),
    })
    const bbox = {
      minX: micrometers(0),
      maxX: micrometers(12),
      minY: micrometers(0),
      maxY: micrometers(8),
    }
    const cellB = async (t: number) => {
      const batch = await dataset.elements(bbox, { plane: { t } })
      const element = batch.elements.find((candidate) => candidate.id === 'cell-b')
      const ring =
        element?.geometry.kind === 'polygon' ? (element.geometry.rings[0] ?? []) : []
      return {
        plane: batch.plane,
        planeNotice: batch.planeNotice,
        minX: Math.min(...ring.map((point) => point.x)),
      }
    }

    await expect(cellB(0)).resolves.toEqual({
      plane: ':0',
      planeNotice: undefined,
      minX: 10,
    })
    await expect(cellB(1)).resolves.toEqual({
      plane: ':1',
      planeNotice: undefined,
      minX: 8,
    })
    // Past the labels' time points: the last, with a notice.
    await expect(cellB(4)).resolves.toEqual({
      plane: ':4',
      planeNotice: 'The labels have 2 time points; later ones show the last.',
      minX: 8,
    })
  })

  it('names no plane for labels without z or t', async () => {
    const dataset = new SpatialDataDataset({
      url: STORE_URL,
      fetcher: inMemoryZarrFetcher(labelsStoreFixture()),
      openImage: imageOpenerFixture(),
    })
    const batch = await dataset.elements(
      {
        minX: micrometers(0),
        maxX: micrometers(12),
        minY: micrometers(0),
        maxY: micrometers(8),
      },
      { plane: { t: 3 } },
    )

    expect(batch.elements).toHaveLength(2)
    expect(batch.plane).toBeUndefined()
  })
})

describe('SpatialDataDataset with one labels element per field of view', () => {
  it('traces the outlines of every labels region the table annotates', async () => {
    const dataset = new SpatialDataDataset({
      url: STORE_URL,
      fetcher: inMemoryZarrFetcher(fieldOfViewLabelsStoreFixture()),
    })

    const overview = await dataset.overview()
    expect(overview.map((cell) => [cell.cellId, cell.position])).toEqual([
      ['cell-a', { x: 2, y: 2 }],
      ['cell-b', { x: 102, y: 2 }],
    ])
    await expect(dataset.summary()).resolves.toMatchObject({
      regions: ['fov1', 'fov2'],
      boundaries: 'fov1, fov2',
    })
    await expect(dataset.meta()).resolves.toMatchObject({
      segmentations: [
        { kind: 'cell', label: 'Cell boundaries (fov1, fov2)', sourceKind: 'zarr' },
      ],
    })

    const { elements } = await dataset.elements({
      minX: micrometers(0),
      maxX: micrometers(110),
      minY: micrometers(0),
      maxY: micrometers(4),
    })
    expect(elements.map((element) => element.id).sort()).toEqual(['cell-a', 'cell-b'])
  })
})

describe('SpatialDataDataset incomplete stores', () => {
  it('logs table chunks that were read as fill values', async () => {
    const progress: string[] = []
    const dataset = new SpatialDataDataset({
      url: STORE_URL,
      fetcher: inMemoryZarrFetcher(
        withoutFiles(storeFixture(), '/tables/table/obs/region/codes/0'),
        {
          missingStatus: 404,
        },
      ),
      readShapes: shapesReaderFixture({ cells: polygonRows() }),
      openImage: imageOpenerFixture(),
      onProgress: (message) => {
        progress.push(message)
      },
    })

    await expect(dataset.overview()).resolves.toHaveLength(2)
    expect(progress).toContain(
      'SpatialData table read missing chunks as fill values; the store may be incomplete: 1 chunk is missing (tables/table/obs/region/codes/0).',
    )
  })

  it('blames missing chunks when the table cannot be placed', async () => {
    const dataset = new SpatialDataDataset({
      url: STORE_URL,
      fetcher: inMemoryZarrFetcher(
        withoutFiles(storeFixture(), '/tables/table/obs/cell_id/0'),
        { missingStatus: 404 },
      ),
      readShapes: shapesReaderFixture({ cells: polygonRows() }),
      openImage: imageOpenerFixture(),
    })

    await expect(dataset.overview()).rejects.toMatchObject({
      name: 'SpatialDataIncompleteStoreError',
      missingKeys: ['tables/table/obs/cell_id/0'],
    })
  })

  it('skips an unreadable region column for a single-region table', async () => {
    const progress: string[] = []
    const dataset = new SpatialDataDataset({
      url: STORE_URL,
      fetcher: inMemoryZarrFetcher(
        withoutFiles(storeFixture(), '/tables/table/obs/region/codes/0'),
      ),
      readShapes: shapesReaderFixture({ cells: polygonRows() }),
      openImage: imageOpenerFixture(),
      onProgress: (message) => {
        progress.push(message)
      },
    })

    await expect(dataset.overview()).resolves.toHaveLength(2)
    expect(progress).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^SpatialData table table: region column unreadable, using cells\./,
        ),
        expect.stringMatching(/^SpatialData table table: skipped obs column region\./),
      ]),
    )
  })

  it('reads anndata 0.13 nullable string indexes and instance keys', async () => {
    const dataset = new SpatialDataDataset({
      url: STORE_URL,
      fetcher: inMemoryZarrFetcher(withNullableTableStrings(storeFixture())),
      readShapes: shapesReaderFixture({ cells: polygonRows() }),
      openImage: imageOpenerFixture(),
    })

    const overview = await dataset.overview()
    // cell-c's masked instance id is not matched to a shape.
    expect(overview.map((cell) => cell.cellId)).toEqual(['cell-a', 'cell-b'])
    expect(withCellMetadata(overview)[1]?.metadata).toEqual({
      region: 'cells',
      cell_id: '11',
    })
    await expect(dataset.genePanel()).resolves.toEqual(['Actb', 'var-1'])
  })

  it('leaves out uns arrays zarrita cannot open', async () => {
    const dataset = new SpatialDataDataset({
      url: STORE_URL,
      fetcher: inMemoryZarrFetcher(withRankGenesGroups(storeFixture())),
      readShapes: shapesReaderFixture({ cells: polygonRows() }),
      openImage: imageOpenerFixture(),
    })

    await expect(dataset.overview()).resolves.toHaveLength(2)
  })

  it('reports forbidden chunks directly', async () => {
    const dataset = new SpatialDataDataset({
      url: STORE_URL,
      fetcher: inMemoryZarrFetcher(
        withoutFiles(storeFixture(), '/tables/table/var/_index/0'),
      ),
      readShapes: shapesReaderFixture({ cells: polygonRows() }),
      openImage: imageOpenerFixture(),
    })

    await expect(dataset.overview()).rejects.toMatchObject({
      name: 'ZarrChunkUnavailableError',
      status: 403,
    })
  })
})

describe('SpatialDataDataset long tables', () => {
  it('reads numeric obs ranges of tables too long to spread into Math.min', async () => {
    const rows = 150_000
    const dataset = new SpatialDataDataset({
      url: STORE_URL,
      fetcher: inMemoryZarrFetcher(longTableFixture(rows)),
      readShapes: vi.fn(async () => {
        const shapes = new SpatialDataShapesBuilder()

        for (let index = 0; index < rows; index += 1) {
          shapes.addCircle(String(index), index, 0, 1)
        }

        return shapes.build()
      }),
      openImage: imageOpenerFixture(),
    })

    await expect(dataset.metadataTracks()).resolves.toContainEqual(
      expect.objectContaining({ label: 'cell_id', min: 0, max: rows - 1 }),
    )
  })

  it('builds the overview once, and per-cell metadata only when asked', async () => {
    const rows = 150_000
    const dataset = new SpatialDataDataset({
      url: STORE_URL,
      fetcher: inMemoryZarrFetcher(longTableFixture(rows)),
      readShapes: vi.fn(async () => {
        const shapes = new SpatialDataShapesBuilder()

        for (let index = 0; index < rows; index += 1) {
          shapes.addCircle(String(index), index, 0, 1)
        }

        return shapes.build()
      }),
      openImage: imageOpenerFixture(),
    })

    await dataset.summary()
    const overview = await dataset.overview()

    expect(overview).toHaveLength(rows)
    expect(await dataset.overview()).toBe(overview)
    expect(overview[7]?.metadata).toBeUndefined()
    expect(overview[7]?.readMetadata?.()).toEqual({
      cell_id: 7,
      barcode: 'b7',
      batch: 'b2',
    })
    // Distinct values stop being counted past 10,000, so a column of cell
    // barcodes reads as 10,001 groups.
    await expect(dataset.annotationGroups()).resolves.toEqual([
      expect.objectContaining({ label: 'barcode', groupCount: 10_001 }),
      expect.objectContaining({ label: 'batch', groupCount: 2 }),
    ])
  })
})

describe('SpatialDataDataset zipped stores', () => {
  const ZIP_URL = 'https://example.test/sample.zarr.zip'
  const SHAPES = new TextEncoder().encode('PAR1 shapes PAR1')

  it('reads the store and its shapes from a zip', async () => {
    const readShapes = shapesReaderFixture({ cells: polygonRows() })
    const dataset = new SpatialDataDataset({
      url: ZIP_URL,
      fetcher: zippedStoreFetcher(ZIP_URL, [
        { name: 'sample.zarr/shapes/cells/shapes.parquet', data: SHAPES },
      ]),
      readShapes,
      openImage: imageOpenerFixture(),
    })

    const overview = await dataset.overview()
    expect(overview.map((cell) => cell.cellId)).toEqual(['cell-a', 'cell-b'])
    const matrix = await dataset.matrix(['cell-c'])
    expect(matrix.cells.get('cell-c')).toEqual({
      geneNames: ['Actb', 'Gad1'],
      counts: [3, 4],
    })

    const request = vi.mocked(readShapes).mock.calls[0]?.[0]
    expect(request?.url).toBe(`${ZIP_URL}/shapes/cells/shapes.parquet`)
    expect(new TextDecoder().decode(await request?.file?.slice(0))).toBe(
      'PAR1 shapes PAR1',
    )
  })

  it('names a shapes file missing from the zip', async () => {
    const readShapes = shapesReaderFixture({ cells: polygonRows() })
    const dataset = new SpatialDataDataset({
      url: 'https://example.test/no-shapes.zarr.zip',
      fetcher: zippedStoreFetcher('https://example.test/no-shapes.zarr.zip', []),
      readShapes,
      openImage: imageOpenerFixture(),
    })

    await expect(dataset.overview()).rejects.toThrow(
      'shapes/cells/shapes.parquet is missing from the zip',
    )
    expect(readShapes).not.toHaveBeenCalled()
  })
})

// storeFixture() zipped in a sample.zarr/ folder, with the matrix chunks
// deflated and the rest stored.
function zippedStoreFetcher(url: string, extra: readonly ZipFixtureFile[]): typeof fetch {
  const files = Array.from(storeFixture(), ([path, data]) => ({
    name: `sample.zarr${path}`,
    data,
    deflate: path.startsWith('/tables/table/X/'),
  }))

  return byteRangeFetcher(new Map([[url, zipArchive([...files, ...extra])]]))
}

function storeFixture(
  options: {
    readonly companionBoundaries?: boolean
    // he is placed with its x and y swapped and flipped, as STHELAR's H&E.
    readonly flippedImage?: boolean
    readonly nucleusBoundaries?: boolean
    readonly secondImage?: boolean
    // The table's int64 cell_id values; defaults to 10, 11 and 99.
    readonly cellIds?: readonly bigint[]
  } = {},
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
            options.flippedImage === true
              ? {
                  // x = 0.5 * y_px + 10, y = -0.5 * x_px + 60.
                  type: 'affine',
                  input: CYX,
                  output: {
                    name: 'global',
                    axes: [{ name: 'c' }, { name: 'x' }, { name: 'y' }],
                  },
                  affine: [
                    [1, 0, 0, 0],
                    [0, 0.5, 0, 10],
                    [0, 0, -0.5, 60],
                  ],
                }
              : {
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
    ...(options.secondImage === true
      ? {
          'images/if/.zgroup': { zarr_format: 2 },
          'images/if/.zattrs': {
            multiscales: [
              {
                axes: CYX.axes,
                datasets: [{ path: '0' }],
                coordinateTransformations: [
                  {
                    type: 'scale',
                    scale: [1, 1, 1],
                    input: CYX,
                    output: { name: 'global', axes: CYX.axes },
                  },
                ],
              },
            ],
          },
        }
      : {}),
    'shapes/.zgroup': { zarr_format: 2 },
    'shapes/cells/.zgroup': { zarr_format: 2 },
    'shapes/cells/.zattrs': shapesTransform('cells'),
    ...(options.companionBoundaries === true
      ? {
          'shapes/cell_boundaries/.zgroup': { zarr_format: 2 },
          'shapes/cell_boundaries/.zattrs': shapesTransform('cell_boundaries'),
        }
      : {}),
    ...(options.nucleusBoundaries === true
      ? {
          'shapes/nucleus_boundaries/.zgroup': { zarr_format: 2 },
          'shapes/nucleus_boundaries/.zattrs': shapesTransform('nucleus_boundaries'),
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
    [
      '/tables/table/obs/cell_id/0',
      bytes(BigInt64Array.from(options.cellIds ?? [10n, 11n, 99n])),
    ],
    ['/tables/table/obs/region/codes/0', bytes(new Int8Array([0, 0, 0]))],
    ['/tables/table/obs/region/categories/0', fixedStrings(['cells'], 5)],
    ['/tables/table/var/_index/0', fixedStrings(['Actb', 'Gad1'], 4)],
    ['/tables/table/X/data/0', bytes(new Float32Array([1, 2, 3, 4]))],
    ['/tables/table/X/indices/0', bytes(new Int32Array([0, 1, 0, 1]))],
    ['/tables/table/X/indptr/0', bytes(new Int32Array([0, 1, 2, 4]))],
  ])
}

// One shapes region of `rows` circles annotated by a table with an integer
// cell_id column and a single gene.
function longTableFixture(rows: number): ReadonlyMap<string, Uint8Array> {
  const metadata: Record<string, unknown> = {
    '.zgroup': { zarr_format: 2 },
    '.zattrs': { spatialdata_attrs: { version: '0.1' } },
    'shapes/.zgroup': { zarr_format: 2 },
    'shapes/cells/.zgroup': { zarr_format: 2 },
    'shapes/cells/.zattrs': {
      'encoding-type': 'ngff:shapes',
      coordinateTransformations: [
        { type: 'identity', input: XY, output: { name: 'global', axes: XY.axes } },
      ],
    },
    'tables/.zgroup': { zarr_format: 2 },
    'tables/table/.zgroup': { zarr_format: 2 },
    'tables/table/.zattrs': {
      'encoding-type': 'anndata',
      region: 'cells',
      instance_key: 'cell_id',
    },
    'tables/table/obs/.zgroup': { zarr_format: 2 },
    'tables/table/obs/.zattrs': {
      _index: '_index',
      'column-order': ['cell_id', 'barcode', 'batch'],
      'encoding-type': 'dataframe',
    },
    'tables/table/obs/_index/.zarray': arrayMeta([rows], '|S7'),
    'tables/table/obs/cell_id/.zarray': arrayMeta([rows], '<i8'),
    // Plain string columns: one value per cell, and two values in all.
    'tables/table/obs/barcode/.zarray': arrayMeta([rows], '|S7'),
    'tables/table/obs/batch/.zarray': arrayMeta([rows], '|S2'),
    'tables/table/var/.zgroup': { zarr_format: 2 },
    'tables/table/var/.zattrs': { _index: '_index', 'encoding-type': 'dataframe' },
    'tables/table/var/_index/.zarray': arrayMeta([1], '|S4'),
    'tables/table/obsm/.zgroup': { zarr_format: 2 },
    'tables/table/X/.zgroup': { zarr_format: 2 },
    'tables/table/X/.zattrs': { 'encoding-type': 'csr_matrix', shape: [rows, 1] },
    'tables/table/X/data/.zarray': arrayMeta([1], '<f4'),
    'tables/table/X/indices/.zarray': arrayMeta([1], '<i4'),
    'tables/table/X/indptr/.zarray': arrayMeta([rows + 1], '<i4'),
  }
  const indptr = new Int32Array(rows + 1)
  indptr[rows] = 1

  return new Map<string, Uint8Array>([
    [
      '/zmetadata',
      new TextEncoder().encode(JSON.stringify({ zarr_consolidated_format: 1, metadata })),
    ],
    [
      '/tables/table/obs/_index/0',
      fixedStrings(
        Array.from({ length: rows }, (_value, index) => `c${index.toString()}`),
        7,
      ),
    ],
    [
      '/tables/table/obs/cell_id/0',
      bytes(BigInt64Array.from({ length: rows }, (_value, index) => BigInt(index))),
    ],
    [
      '/tables/table/obs/barcode/0',
      fixedStrings(
        Array.from({ length: rows }, (_value, index) => `b${index.toString()}`),
        7,
      ),
    ],
    [
      '/tables/table/obs/batch/0',
      fixedStrings(
        Array.from({ length: rows }, (_value, index) => (index % 2 === 0 ? 'b1' : 'b2')),
        2,
      ),
    ],
    ['/tables/table/var/_index/0', fixedStrings(['Actb'], 4)],
    ['/tables/table/X/data/0', bytes(new Float32Array([1]))],
    ['/tables/table/X/indices/0', bytes(new Int32Array([0]))],
    ['/tables/table/X/indptr/0', bytes(indptr)],
  ])
}

// Labels raster (6 x 4 pixels in two 3-column chunks) annotated by a table
// whose instance key holds strings and whose `cell_labels` column holds the
// label ids. Label pixels are 2 global units. `timeLapse` gives the raster a
// `t` axis of 2 time points, one chunk each; at the second, label 2 is one
// pixel further left.
function labelsStoreFixture(
  options: { readonly nucleusBoundaries?: boolean; readonly timeLapse?: boolean } = {},
): ReadonlyMap<string, Uint8Array> {
  const YX = { name: 'yx', axes: [{ name: 'y' }, { name: 'x' }] }
  const labelAxes =
    options.timeLapse === true ? [{ name: 't', type: 'time' }, ...YX.axes] : YX.axes
  const metadata: Record<string, unknown> = {
    '.zgroup': { zarr_format: 2 },
    '.zattrs': { spatialdata_attrs: { version: '0.1' } },
    ...(options.nucleusBoundaries === true
      ? {
          'shapes/.zgroup': { zarr_format: 2 },
          'shapes/nucleus_boundaries/.zgroup': { zarr_format: 2 },
          'shapes/nucleus_boundaries/.zattrs': {
            'encoding-type': 'ngff:shapes',
            coordinateTransformations: [
              { type: 'identity', input: XY, output: { name: 'global', axes: XY.axes } },
            ],
          },
        }
      : {}),
    'labels/.zgroup': { zarr_format: 2 },
    'labels/seg/.zgroup': { zarr_format: 2 },
    'labels/seg/.zattrs': {
      'image-label': { version: '0.4' },
      multiscales: [
        {
          axes: labelAxes,
          datasets: [
            {
              path: '0',
              coordinateTransformations: [
                { type: 'scale', scale: labelAxes.map(() => 1) },
              ],
            },
          ],
          coordinateTransformations: [
            {
              type: 'scale',
              scale: [2, 2],
              input: YX,
              output: { name: 'global', axes: YX.axes },
            },
          ],
        },
      ],
    },
    'labels/seg/0/.zarray':
      options.timeLapse === true
        ? { ...arrayMeta([2, 4, 6], '<i4'), chunks: [1, 4, 3] }
        : { ...arrayMeta([4, 6], '<i4'), chunks: [4, 3] },
    'tables/.zgroup': { zarr_format: 2 },
    'tables/table/.zgroup': { zarr_format: 2 },
    'tables/table/.zattrs': {
      'encoding-type': 'anndata',
      region: 'seg',
      region_key: 'region',
      instance_key: 'cell_id',
    },
    'tables/table/obs/.zgroup': { zarr_format: 2 },
    'tables/table/obs/.zattrs': {
      _index: '_index',
      'column-order': ['region', 'cell_id', 'cell_labels'],
      'encoding-type': 'dataframe',
    },
    'tables/table/obs/_index/.zarray': arrayMeta([2], '|S6'),
    'tables/table/obs/cell_id/.zarray': arrayMeta([2], '|S2'),
    'tables/table/obs/cell_labels/.zarray': arrayMeta([2], '<i8'),
    'tables/table/obs/region/.zgroup': { zarr_format: 2 },
    'tables/table/obs/region/.zattrs': { 'encoding-type': 'categorical' },
    'tables/table/obs/region/codes/.zarray': arrayMeta([2], '|i1'),
    'tables/table/obs/region/categories/.zarray': arrayMeta([1], '|S3'),
    'tables/table/obsm/.zgroup': { zarr_format: 2 },
    'tables/table/obsm/spatial/.zarray': arrayMeta([2, 2], '<f8'),
    'tables/table/var/.zgroup': { zarr_format: 2 },
    'tables/table/var/.zattrs': { _index: '_index', 'encoding-type': 'dataframe' },
    'tables/table/var/_index/.zarray': arrayMeta([1], '|S4'),
    'tables/table/X/.zgroup': { zarr_format: 2 },
    'tables/table/X/.zattrs': { 'encoding-type': 'csr_matrix', shape: [2, 1] },
    'tables/table/X/data/.zarray': arrayMeta([1], '<f4'),
    'tables/table/X/indices/.zarray': arrayMeta([1], '<i4'),
    'tables/table/X/indptr/.zarray': arrayMeta([3], '<i4'),
  }
  const encoder = new TextEncoder()
  // Full raster:
  //   1 1 1 | 1 0 0
  //   1 1 1 | 1 0 2
  //   0 0 0 | 0 0 2
  //   0 0 0 | 0 0 0
  const leftChunk = new Int32Array([1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0])
  const rightChunk = new Int32Array([1, 0, 0, 1, 0, 2, 0, 0, 2, 0, 0, 0])
  // The second time point's right chunk, with label 2 a column left.
  const laterRightChunk = new Int32Array([1, 0, 0, 1, 2, 0, 0, 2, 0, 0, 0, 0])
  const labelChunks: [string, Uint8Array][] =
    options.timeLapse === true
      ? [
          ['/labels/seg/0/0.0.0', bytes(leftChunk)],
          ['/labels/seg/0/0.0.1', bytes(rightChunk)],
          ['/labels/seg/0/1.0.0', bytes(leftChunk)],
          ['/labels/seg/0/1.0.1', bytes(laterRightChunk)],
        ]
      : [
          ['/labels/seg/0/0.0', bytes(leftChunk)],
          ['/labels/seg/0/0.1', bytes(rightChunk)],
        ]

  return new Map<string, Uint8Array>([
    [
      '/zmetadata',
      encoder.encode(JSON.stringify({ zarr_consolidated_format: 1, metadata })),
    ],
    ...labelChunks,
    ['/tables/table/obs/_index/0', fixedStrings(['cell-a', 'cell-b'], 6)],
    ['/tables/table/obs/cell_id/0', fixedStrings(['aa', 'bb'], 2)],
    ['/tables/table/obs/cell_labels/0', bytes(new BigInt64Array([1n, 2n]))],
    ['/tables/table/obs/region/codes/0', bytes(new Int8Array([0, 0]))],
    ['/tables/table/obs/region/categories/0', fixedStrings(['seg'], 3)],
    // Label-pixel centroids.
    ['/tables/table/obsm/spatial/0.0', bytes(new Float64Array([2, 1, 5.5, 1.5]))],
    ['/tables/table/var/_index/0', fixedStrings(['Actb'], 4)],
    ['/tables/table/X/data/0', bytes(new Float32Array([1]))],
    ['/tables/table/X/indices/0', bytes(new Int32Array([0]))],
    ['/tables/table/X/indptr/0', bytes(new Int32Array([0, 1, 1]))],
  ])
}

// Two 4 x 4 labels elements, as spatialdata-io writes one per CosMx field of
// view, the second 100 units right of the first, annotated by one table. Each
// holds label 1 on the 2 x 2 block at x 1-2, y 1-2.
function fieldOfViewLabelsStoreFixture(): ReadonlyMap<string, Uint8Array> {
  const YX = { name: 'yx', axes: [{ name: 'y' }, { name: 'x' }] }
  const labelsElement = (translateX: number) => ({
    'image-label': { version: '0.4' },
    multiscales: [
      {
        axes: YX.axes,
        datasets: [
          { path: '0', coordinateTransformations: [{ type: 'scale', scale: [1, 1] }] },
        ],
        coordinateTransformations: [
          {
            type: 'translation',
            translation: [0, translateX],
            input: YX,
            output: { name: 'global', axes: YX.axes },
          },
        ],
      },
    ],
  })
  const metadata: Record<string, unknown> = {
    '.zgroup': { zarr_format: 2 },
    '.zattrs': { spatialdata_attrs: { version: '0.1' } },
    'labels/.zgroup': { zarr_format: 2 },
    'labels/fov1/.zgroup': { zarr_format: 2 },
    'labels/fov1/.zattrs': labelsElement(0),
    'labels/fov1/0/.zarray': arrayMeta([4, 4], '<i4'),
    'labels/fov2/.zgroup': { zarr_format: 2 },
    'labels/fov2/.zattrs': labelsElement(100),
    'labels/fov2/0/.zarray': arrayMeta([4, 4], '<i4'),
    'tables/.zgroup': { zarr_format: 2 },
    'tables/table/.zgroup': { zarr_format: 2 },
    'tables/table/.zattrs': {
      'encoding-type': 'anndata',
      region: ['fov1', 'fov2'],
      region_key: 'region',
      instance_key: 'cell_ID',
    },
    'tables/table/obs/.zgroup': { zarr_format: 2 },
    'tables/table/obs/.zattrs': {
      _index: '_index',
      'column-order': ['region', 'cell_ID'],
      'encoding-type': 'dataframe',
    },
    'tables/table/obs/_index/.zarray': arrayMeta([2], '|S6'),
    'tables/table/obs/cell_ID/.zarray': arrayMeta([2], '<i8'),
    'tables/table/obs/region/.zgroup': { zarr_format: 2 },
    'tables/table/obs/region/.zattrs': { 'encoding-type': 'categorical' },
    'tables/table/obs/region/codes/.zarray': arrayMeta([2], '|i1'),
    'tables/table/obs/region/categories/.zarray': arrayMeta([2], '|S4'),
    'tables/table/obsm/.zgroup': { zarr_format: 2 },
    'tables/table/obsm/spatial/.zarray': arrayMeta([2, 2], '<f8'),
    'tables/table/var/.zgroup': { zarr_format: 2 },
    'tables/table/var/.zattrs': { _index: '_index', 'encoding-type': 'dataframe' },
    'tables/table/var/_index/.zarray': arrayMeta([1], '|S4'),
    'tables/table/X/.zgroup': { zarr_format: 2 },
    'tables/table/X/.zattrs': { 'encoding-type': 'csr_matrix', shape: [2, 1] },
    'tables/table/X/data/.zarray': arrayMeta([1], '<f4'),
    'tables/table/X/indices/.zarray': arrayMeta([1], '<i4'),
    'tables/table/X/indptr/.zarray': arrayMeta([3], '<i4'),
  }
  const raster = new Int32Array(16)

  for (const index of [5, 6, 9, 10]) {
    raster[index] = 1
  }

  return new Map<string, Uint8Array>([
    [
      '/zmetadata',
      new TextEncoder().encode(JSON.stringify({ zarr_consolidated_format: 1, metadata })),
    ],
    ['/labels/fov1/0/0.0', bytes(raster)],
    ['/labels/fov2/0/0.0', bytes(raster)],
    ['/tables/table/obs/_index/0', fixedStrings(['cell-a', 'cell-b'], 6)],
    ['/tables/table/obs/cell_ID/0', bytes(new BigInt64Array([1n, 1n]))],
    ['/tables/table/obs/region/codes/0', bytes(new Int8Array([0, 1]))],
    ['/tables/table/obs/region/categories/0', fixedStrings(['fov1', 'fov2'], 4)],
    // Label-pixel centroids of the block in each field of view.
    ['/tables/table/obsm/spatial/0.0', bytes(new Float64Array([2, 2, 2, 2]))],
    ['/tables/table/var/_index/0', fixedStrings(['Actb'], 4)],
    ['/tables/table/X/data/0', bytes(new Float32Array([1]))],
    ['/tables/table/X/indices/0', bytes(new Int32Array([0]))],
    ['/tables/table/X/indptr/0', bytes(new Int32Array([0, 1, 1]))],
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

// A store whose only element is a table, placed by its obsm/spatial.
function tableOnlyStoreFixture(): ReadonlyMap<string, Uint8Array> {
  const metadata: Record<string, unknown> = {
    '.zgroup': { zarr_format: 2 },
    '.zattrs': { spatialdata_attrs: { version: '0.1' } },
    'tables/.zgroup': { zarr_format: 2 },
    'tables/table/.zgroup': { zarr_format: 2 },
    'tables/table/.zattrs': { 'encoding-type': 'anndata' },
    'tables/table/obs/.zgroup': { zarr_format: 2 },
    'tables/table/obs/.zattrs': {
      _index: '_index',
      'column-order': [],
      'encoding-type': 'dataframe',
    },
    'tables/table/obs/_index/.zarray': arrayMeta([3], '|S6'),
    'tables/table/var/.zgroup': { zarr_format: 2 },
    'tables/table/var/.zattrs': { _index: '_index', 'encoding-type': 'dataframe' },
    'tables/table/var/_index/.zarray': arrayMeta([1], '|S4'),
    'tables/table/obsm/.zgroup': { zarr_format: 2 },
    'tables/table/obsm/spatial/.zarray': arrayMeta([3, 2], '<f8'),
    'tables/table/X/.zgroup': { zarr_format: 2 },
    'tables/table/X/.zattrs': { 'encoding-type': 'csr_matrix', shape: [3, 1] },
    'tables/table/X/data/.zarray': arrayMeta([1], '<f4'),
    'tables/table/X/indices/.zarray': arrayMeta([1], '<i4'),
    'tables/table/X/indptr/.zarray': arrayMeta([4], '<i4'),
  }

  return new Map<string, Uint8Array>([
    [
      '/zmetadata',
      new TextEncoder().encode(JSON.stringify({ zarr_consolidated_format: 1, metadata })),
    ],
    ['/tables/table/obs/_index/0', fixedStrings(['cell-a', 'cell-b', 'cell-c'], 6)],
    ['/tables/table/var/_index/0', fixedStrings(['Actb'], 4)],
    ['/tables/table/obsm/spatial/0.0', bytes(new Float64Array([1, 2, 3, 4, 5, 6]))],
    ['/tables/table/X/data/0', bytes(new Float32Array([1]))],
    ['/tables/table/X/indices/0', bytes(new Int32Array([0]))],
    ['/tables/table/X/indptr/0', bytes(new Int32Array([0, 1, 1, 1]))],
  ])
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
    const { scaleX, translateX, translateY, placement } = request.transform

    return {
      url: request.url,
      ...(placement === undefined ? {} : { placement }),
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

function inMemoryZarrFetcher(
  files: ReadonlyMap<string, Uint8Array>,
  options: { readonly missingStatus?: number } = {},
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const path = url.pathname.replace(/^\/sample\.sdata\.zarr/, '')
    const body = files.get(path)

    // Object stores that deny listing answer missing keys with 403.
    return body === undefined
      ? new Response(null, { status: options.missingStatus ?? 403 })
      : new Response(Uint8Array.from(body), { status: 200 })
  }) as unknown as typeof fetch
}

function withoutFiles(
  files: ReadonlyMap<string, Uint8Array>,
  ...paths: readonly string[]
): ReadonlyMap<string, Uint8Array> {
  return new Map(Array.from(files).filter(([path]) => !paths.includes(path)))
}

// The table as anndata 0.13 writes it under pandas 3: the obs and var indexes
// and the string instance key are nullable-string-array groups. cell-c's
// instance id is masked; unmasked, it would match shape 11.
function withNullableTableStrings(
  files: ReadonlyMap<string, Uint8Array>,
): ReadonlyMap<string, Uint8Array> {
  const consolidated = JSON.parse(new TextDecoder().decode(files.get('/zmetadata'))) as {
    metadata: Record<string, unknown>
  }
  const output = new Map(files)
  const arrays = {
    'tables/table/obs/_index': {
      values: ['cell-a', 'cell-b', 'cell-c'],
      mask: [0, 0, 0],
    },
    'tables/table/obs/cell_id': { values: ['10', '11', '11'], mask: [0, 0, 1] },
    'tables/table/var/_index': { values: ['Actb', 'Gad1'], mask: [0, 1] },
  }

  for (const [path, { values, mask }] of Object.entries(arrays)) {
    delete consolidated.metadata[`${path}/.zarray`]
    output.delete(`/${path}/0`)
    Object.assign(consolidated.metadata, {
      [`${path}/.zgroup`]: { zarr_format: 2 },
      [`${path}/.zattrs`]: {
        'encoding-type': 'nullable-string-array',
        'encoding-version': '0.1.0',
        'na-value': 'NaN',
      },
      [`${path}/values/.zarray`]: arrayMeta([values.length], '|S6'),
      [`${path}/mask/.zarray`]: arrayMeta([mask.length], '|b1'),
    })
    output.set(`/${path}/values/0`, fixedStrings(values, 6))
    output.set(`/${path}/mask/0`, Uint8Array.from(mask))
  }

  output.set('/zmetadata', new TextEncoder().encode(JSON.stringify(consolidated)))
  return output
}

// A spatialdata-io Xenium store: the morphology image in pixels of the
// coordinate system, and the run's pixel size (µm per pixel) in the table's
// uns/xenium.
function withXeniumPixelSize(
  files: ReadonlyMap<string, Uint8Array>,
  pixelSize: number,
  imageName = 'morphology_focus',
): ReadonlyMap<string, Uint8Array> {
  const consolidated = JSON.parse(new TextDecoder().decode(files.get('/zmetadata'))) as {
    metadata: Record<string, unknown>
  }
  Object.assign(consolidated.metadata, {
    [`images/${imageName}/.zgroup`]: { zarr_format: 2 },
    [`images/${imageName}/.zattrs`]: {
      multiscales: [
        {
          axes: CYX.axes,
          datasets: [{ path: '0' }],
          coordinateTransformations: [
            { type: 'identity', input: CYX, output: { name: 'global', axes: CYX.axes } },
          ],
        },
      ],
    },
    'tables/table/uns/.zgroup': { zarr_format: 2 },
    'tables/table/uns/xenium/.zgroup': { zarr_format: 2 },
    'tables/table/uns/xenium/pixel_size/.zarray': arrayMeta([], '<f8'),
    'tables/table/uns/xenium/pixel_size/.zattrs': { 'encoding-type': 'numeric-scalar' },
  })
  const output = new Map(files)
  output.set('/zmetadata', new TextEncoder().encode(JSON.stringify(consolidated)))
  output.set(
    '/tables/table/uns/xenium/pixel_size/0',
    bytes(new Float64Array([pixelSize])),
  )
  return output
}

// scanpy's rank_genes_groups result in uns: record arrays with one field per
// group, which zarr-python writes with a structured dtype.
function withRankGenesGroups(
  files: ReadonlyMap<string, Uint8Array>,
): ReadonlyMap<string, Uint8Array> {
  const consolidated = JSON.parse(new TextDecoder().decode(files.get('/zmetadata'))) as {
    metadata: Record<string, unknown>
  }
  Object.assign(consolidated.metadata, {
    'tables/table/uns/.zgroup': { zarr_format: 2 },
    'tables/table/uns/rank_genes_groups/.zgroup': { zarr_format: 2 },
    'tables/table/uns/rank_genes_groups/names/.zarray': {
      ...arrayMeta([2], '|S4'),
      dtype: [
        ['0', '<U9'],
        ['1', '<U9'],
      ],
    },
  })
  const output = new Map(files)
  output.set('/zmetadata', new TextEncoder().encode(JSON.stringify(consolidated)))
  return output
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
