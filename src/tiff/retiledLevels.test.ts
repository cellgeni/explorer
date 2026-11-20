import { afterEach, describe, expect, it } from 'vitest'
import { decodeTiffTilePixels } from '../codecs/tiffTile'
import { buildTiffFile, TIFF_LONG, type TestTiffImage } from '../test/tiffFixtures'
import { clearOpenTiffFiles, openTiff, type TiffPyramidLoader } from './loader'

const SUBIFDS_TAG = 330

function omeDescription(physicalSizeY = 0.5): string {
  return `<?xml version="1.0" encoding="UTF-8"?><OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06"><Image ID="Image:0"><Pixels ID="Pixels:0" DimensionOrder="XYZCT" Type="uint16" SizeX="96" SizeY="64" SizeZ="1" SizeC="1" SizeT="1" PhysicalSizeX="0.5" PhysicalSizeY="${physicalSizeY}"><Channel ID="Channel:0:0" SamplesPerPixel="1"/><TiffData/></Pixels></Image></OME>`
}

// Level 0 in 32 px tiles, with level 1 as its SubIFD in 16 px tiles, each
// tile's samples holding its own value.
function subIfdPyramid(description = omeDescription()): Uint8Array<ArrayBuffer> {
  const level0: TestTiffImage = {
    width: 96,
    height: 64,
    tile: 32,
    subfileType: 0,
    description,
    value: (tile) => tile,
    extraTags: [[SUBIFDS_TAG, TIFF_LONG, [0]]],
  }
  const level1: TestTiffImage = {
    width: 48,
    height: 32,
    tile: 16,
    subfileType: 1,
    description: '',
    value: (tile) => 100 + tile,
  }
  const { bytes, ifdOffsets } = buildTiffFile([level0, level1])
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const first = ifdOffsets[0] ?? 0
  const entries = view.getUint16(first, true)

  // Level 1 becomes level 0's SubIFD rather than the next page.
  for (let entry = 0; entry < entries; entry += 1) {
    const at = first + 2 + entry * 12
    if (view.getUint16(at, true) === SUBIFDS_TAG) {
      view.setUint32(at + 8, ifdOffsets[1] ?? 0, true)
    }
  }
  view.setUint32(first + 2 + entries * 12, 0, true)

  return new Uint8Array(bytes)
}

async function levelPixels(
  loader: TiffPyramidLoader,
  level: number,
): Promise<readonly (readonly number[])[]> {
  const { width, height } = loader.levelSize(level)
  const pixels = Array.from({ length: height }, () => new Array<number>(width).fill(-1))

  for (const { col, row } of loader.tilesForLevel(level)) {
    const decoded = await decodeTiffTilePixels(
      await loader.fetchTileBytes(level, col, row),
      loader.tileDecodeOptions(level, col, row),
    )
    const visible = loader.tileSourceSize(level, col, row)

    for (let y = 0; y < visible.height; y += 1) {
      for (let x = 0; x < visible.width; x += 1) {
        const line = pixels[row * loader.tileHeight + y]
        if (line !== undefined) {
          line[col * loader.tileWidth + x] = decoded.pixels[y * decoded.width + x] ?? -2
        }
      }
    }
  }

  return pixels
}

afterEach(() => {
  clearOpenTiffFiles()
})

describe('TIFF levels tiled unlike level 0 (EXP-015)', () => {
  it('cuts a level stored in smaller tiles into the pyramid tile size', async () => {
    const loader = await openTiff(
      'https://example.test/levels.ome.tif',
      undefined,
      undefined,
      {
        bytes: subIfdPyramid(),
      },
    )

    expect(loader.numLevels).toBe(2)
    expect([loader.tileWidth, loader.tileHeight]).toEqual([32, 32])
    // 48 x 32 in 32 px tiles: two, the second 16 px wide.
    expect(loader.tilesForLevel(1)).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ])
    expect(loader.tileDecodeOptions(1, 0, 0)).toMatchObject({
      compression: 1,
      tileWidth: 32,
      tileHeight: 32,
    })
    // Every pixel is its stored tile's value: 3 tiles of 16 px across.
    expect(await levelPixels(loader, 1)).toEqual(
      Array.from({ length: 32 }, (_, y) =>
        Array.from(
          { length: 48 },
          (_, x) => 100 + Math.floor(y / 16) * 3 + Math.floor(x / 16),
        ),
      ),
    )
    // Level 0 is read as stored.
    expect((await levelPixels(loader, 0))[40]?.slice(30, 34)).toEqual([3, 3, 4, 4])
  })

  it('refuses an OME-TIFF whose pixels are not square, unless given a pixel size', async () => {
    await expect(
      openTiff('https://example.test/aniso.ome.tif', undefined, undefined, {
        bytes: subIfdPyramid(omeDescription(1)),
      }),
    ).rejects.toThrow(
      "The image's pixels are 0.5 µm wide and 1 µm tall (OME PhysicalSizeX and PhysicalSizeY).",
    )

    clearOpenTiffFiles()
    const given = await openTiff(
      'https://example.test/aniso.ome.tif',
      undefined,
      undefined,
      {
        bytes: subIfdPyramid(omeDescription(1)),
        micrometersPerPixel: 0.5,
      },
    )
    expect(given.units.micrometersPerPixel).toBe(0.5)
  })
})
