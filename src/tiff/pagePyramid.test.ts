import { describe, expect, it } from 'vitest'
import { decodeTiffTilePixels } from '../codecs/tiffTile'
import { readZipDirectory, readZipEntry } from '../data/zipArchive'
import { merscopeFixtureBytes } from '../test/merscopeFixtures'
import { byteRangeFetcher } from '../test/zipFixtures'
import { clearOpenTiffFiles, openTiff } from './loader'

// src/test/fixtures/merscope/region_0.vzg: a 200 × 160 12-bit JPEG BigTIFF
// with its three levels stored as pages, as tifffile writes MERSCOPE
// pyramids, deflated in a zip.
const VZG_URL = 'https://example.test/region_0/region_0.vzg'
const ENTRY = 'pictures/pyrmosaic_DAPI_z3.tif'

async function pyramidBytes(): Promise<Uint8Array<ArrayBuffer>> {
  const fetcher = byteRangeFetcher(
    new Map([[VZG_URL, merscopeFixtureBytes('region_0.vzg')]]),
  )
  const directory = await readZipDirectory(VZG_URL, { fetcher })
  return readZipEntry(VZG_URL, directory.entries.get(ENTRY)!, { fetcher })
}

describe('TIFF page pyramids in memory', () => {
  it('opens pages that shrink as levels, placed at an origin, without requests', async () => {
    clearOpenTiffFiles()
    const reference = JSON.parse(
      new TextDecoder().decode(merscopeFixtureBytes('pyrmosaic_reference.json')),
    ) as { readonly sum: number; readonly firstRow: readonly number[] }
    const loader = await openTiff(`${VZG_URL}/${ENTRY}`, undefined, undefined, {
      bytes: await pyramidBytes(),
      origin: { x: 1000, y: 2000 },
      micrometersPerPixel: 0.5,
      channelName: 'DAPI',
    })

    expect(loader).toMatchObject({
      numLevels: 3,
      imageWidth: 200,
      imageHeight: 160,
      tileWidth: 32,
      units: { micrometersPerPixel: 0.5 },
    })
    expect(loader.channels).toMatchObject([
      { name: 'DAPI', contrast: { min: 0, max: 4095 } },
    ])
    expect(loader.tileBounds(0, 0, 0)).toEqual({
      minX: 1000,
      maxX: 1016,
      minY: 2000,
      maxY: 2016,
    })
    expect(loader.tileBounds(2, 1, 0)).toMatchObject({ minX: 1064, maxX: 1100 })
    expect(
      loader.tilesForBbox(0, { minX: 1010, minY: 2010, maxX: 1020, maxY: 2015 } as never),
    ).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ])
    expect(
      loader.tilesForBbox(0, { minX: 0, minY: 0, maxX: 999, maxY: 1999 } as never),
    ).toEqual([{ col: 0, row: 0 }])

    const decoded = await decodeTiffTilePixels(
      await loader.fetchTileBytes(0, 0, 0),
      loader.tileDecodeOptions(0, 0, 0),
    )
    expect(decoded.pixels).toBeInstanceOf(Uint16Array)
    const firstRow = Array.from(decoded.pixels.subarray(0, 32))
    firstRow.forEach((value, index) => {
      expect(Math.abs(value - (reference.firstRow[index] ?? 0))).toBeLessThanOrEqual(2)
    })
  })
})
