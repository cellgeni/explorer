// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { micrometers, type BBox } from '../data/coords'
import { clearOpenTiffFiles } from '../tiff/loader'
import { buildTiff, u32 } from '../test/tiffFixtures'
import { openImportedSegmentation } from './importedSegmentation'
import type { SpatialElement } from './spatialDataset'
import type { SegmentationSource } from './segmentationSource'
import { readVectorSegmentation } from './vectorSegmentation'

const PLACEMENT = { micrometersPerPixel: 0.5, imageWidth: 8, imageHeight: 8 }

function bbox(minX: number, minY: number, maxX: number, maxY: number): BBox {
  return {
    minX: micrometers(minX),
    minY: micrometers(minY),
    maxX: micrometers(maxX),
    maxY: micrometers(maxY),
  }
}

function polygonBounds(element: SpatialElement): readonly number[] {
  if (element.geometry.kind !== 'polygon') {
    return []
  }

  const points = element.geometry.rings[0] ?? []
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

function wktSource(
  text: string,
  coordinates: 'pixels' | 'micrometers',
): SegmentationSource {
  return { url: 'cells.wkt', file: new Blob([text]), format: 'wkt', coordinates }
}

// An 8 x 8 mask: label 70,000 fills the top-left 4 x 4 pixels and label 2
// the bottom-right 4 x 4, as 32-bit samples.
function labelAt(x: number, y: number): number {
  return x < 4 && y < 4 ? 70_000 : x >= 4 && y >= 4 ? 2 : 0
}

function maskTiff(layout: 'tiled' | 'stripped'): Uint8Array<ArrayBuffer> {
  const samples = (x0: number, y0: number, width: number, height: number) =>
    Array.from({ length: height }, (_row, y) =>
      Array.from({ length: width }, (_column, x) => u32(labelAt(x0 + x, y0 + y))),
    ).flat(2)

  return Uint8Array.from(
    buildTiff([
      {
        width: 8,
        height: 8,
        subfileType: 0,
        description: '',
        bitsPerSample: 32,
        value: () => 0,
        ...(layout === 'tiled'
          ? {
              tile: 4,
              tileBytes: (tile: number) =>
                samples((tile % 2) * 4, Math.floor(tile / 2) * 4, 4, 4),
            }
          : {
              rowsPerStrip: 2,
              tileBytes: (strip: number) => samples(0, strip * 2, 8, 2),
            }),
      },
    ]),
  )
}

describe('openImportedSegmentation', () => {
  it('places pixel polygons by the image pixel size and counts them in a box', async () => {
    const segmentation = await openImportedSegmentation(
      wktSource(
        'id,geometry\na,"POLYGON ((0 0, 2 0, 2 2, 0 2, 0 0))"\nb,"POLYGON ((6 6, 8 6, 8 8, 6 8, 6 6))"\n',
        'pixels',
      ),
      PLACEMENT,
      { readVector: readVectorSegmentation },
    )

    expect(segmentation.shapeCount).toBe(2)
    expect(segmentation.warning).toBeUndefined()
    expect(segmentation.estimateCount(bbox(0, 0, 1, 1))).toBe(1)
    expect(segmentation.estimateCount(bbox(0, 0, 4, 4))).toBe(2)

    const first = await segmentation.outlines(bbox(0, 0, 1.5, 1.5))
    expect(first.elements.map((element) => element.id)).toEqual(['a'])
    expect(polygonBounds(first.elements[0] as SpatialElement)).toEqual([0, 0, 1, 1])

    // Outlines still in view keep their objects.
    const second = await segmentation.outlines(bbox(0, 0, 4, 4))
    expect(second.elements[0]).toBe(first.elements[0])
  })

  it('warns when polygons look like they are in other units', async () => {
    const outside = await openImportedSegmentation(
      wktSource('POLYGON ((0 0, 20 0, 20 20, 0 0))\n', 'micrometers'),
      PLACEMENT,
      { readVector: readVectorSegmentation },
    )
    expect(outside.warning).toContain('reach beyond the image')

    const corner = await openImportedSegmentation(
      wktSource('POLYGON ((0 0, 1 0, 1 1, 0 0))\n', 'pixels'),
      PLACEMENT,
      { readVector: readVectorSegmentation },
    )
    expect(corner.warning).toContain('top-left part')
  })

  it.each(['tiled', 'stripped'] as const)(
    'traces a %s 32-bit label TIFF over the image',
    async (layout) => {
      clearOpenTiffFiles()
      const segmentation = await openImportedSegmentation(
        {
          url: `cp_masks_${layout}.tif`,
          file: new Blob([maskTiff(layout)]),
          format: 'label-tiff',
          coordinates: 'pixels',
        },
        PLACEMENT,
      )

      expect(segmentation.shapeCount).toBeUndefined()
      expect(segmentation.maskSize).toEqual({ width: 8, height: 8 })
      // Before any trace, the count is unknown.
      expect(segmentation.estimateCount(bbox(0, 0, 4, 4))).toBe(1)

      const batch = await segmentation.outlines(bbox(0, 0, 4, 4))
      const byId = new Map(batch.elements.map((element) => [element.id, element]))

      expect([...byId.keys()].sort()).toEqual(['2', '70000'])
      expect(polygonBounds(byId.get('70000') as SpatialElement)).toEqual([0, 0, 2, 2])
      expect(polygonBounds(byId.get('2') as SpatialElement)).toEqual([2, 2, 4, 4])
      // Two labels over the 16 µm² image.
      expect(segmentation.estimateCount(bbox(0, 0, 2, 4))).toBe(1)
      expect(segmentation.estimateCount(bbox(0, 0, 40, 40))).toBe(2)
    },
  )

  it('stops a mask at the boundary limit, since its count is known only once traced', async () => {
    clearOpenTiffFiles()
    const segmentation = await openImportedSegmentation(
      {
        url: 'mask.tif',
        file: new Blob([maskTiff('tiled')]),
        format: 'label-tiff',
        coordinates: 'pixels',
      },
      PLACEMENT,
    )

    await expect(
      segmentation.outlines(bbox(0, 0, 4, 4), { cellLimit: 1 }),
    ).resolves.toEqual({
      elements: [],
      overLimit: { count: 2 },
    })
  })

  it('names a picked file as it is named, and a URL by its decoded last part', async () => {
    const open = (url: string, file?: Blob) =>
      openImportedSegmentation(
        {
          url,
          ...(file === undefined ? {} : { file }),
          format: 'wkt',
          coordinates: 'micrometers',
        },
        PLACEMENT,
        {
          readVector: async (options) =>
            readVectorSegmentation({
              ...options,
              file: {
                kind: 'file',
                file: new Blob(['POLYGON ((0 0, 1 0, 1 1, 0 0))\n']),
              },
            }),
        },
      )

    const blob = new Blob([''])
    await expect(open('Sample#1_cells.wkt', blob)).resolves.toMatchObject({
      name: 'Sample#1_cells.wkt',
    })
    await expect(open('cells%20v2.wkt', blob)).resolves.toMatchObject({
      name: 'cells%20v2.wkt',
    })
    await expect(
      open('https://example.test/seg/cells%20v2.wkt?sig=1'),
    ).resolves.toMatchObject({ name: 'cells v2.wkt' })
  })

  it('warns when a mask is not the image shape', async () => {
    clearOpenTiffFiles()
    const segmentation = await openImportedSegmentation(
      {
        url: 'mask.tif',
        file: new Blob([maskTiff('tiled')]),
        format: 'label-tiff',
        coordinates: 'pixels',
      },
      { micrometersPerPixel: 1, imageWidth: 16, imageHeight: 8 },
    )

    expect(segmentation.warning).toContain('stretched to cover the image')
  })

  it('places polygons and masks by the pixel width and height', async () => {
    // 0.5 µm wide and 0.25 µm tall pixels: the 8 x 8 image is 4 x 2 µm.
    const placement = { ...PLACEMENT, yMicrometersPerPixel: 0.25 }
    const polygons = await openImportedSegmentation(
      wktSource('POLYGON ((4 4, 8 4, 8 8, 4 8, 4 4))\n', 'pixels'),
      placement,
      { readVector: readVectorSegmentation },
    )
    const polygonBatch = await polygons.outlines(bbox(0, 0, 4, 2))
    expect(polygonBatch.elements.map(polygonBounds)).toEqual([[2, 1, 4, 2]])

    clearOpenTiffFiles()
    const mask = await openImportedSegmentation(
      {
        url: 'mask.tif',
        file: new Blob([maskTiff('tiled')]),
        format: 'label-tiff',
        coordinates: 'pixels',
      },
      placement,
    )
    const maskBatch = await mask.outlines(bbox(0, 0, 4, 2))
    const label2 = maskBatch.elements.find((element) => element.id === '2')
    expect(label2 === undefined ? [] : polygonBounds(label2)).toEqual([2, 1, 4, 2])
  })

  it('refuses a picked Zarr label image', async () => {
    await expect(
      openImportedSegmentation(
        {
          url: 'labels.zarr',
          file: new Blob([]),
          format: 'label-zarr',
          coordinates: 'pixels',
        },
        PLACEMENT,
      ),
    ).rejects.toThrow('opened from its URL')
  })
})
