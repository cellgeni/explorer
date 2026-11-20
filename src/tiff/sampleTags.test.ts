import { afterEach, describe, expect, it } from 'vitest'
import { decodeTiffTilePixels } from '../codecs/tiffTile'
import { buildTiff, TIFF_SHORT, type TestTiffImage } from '../test/tiffFixtures'
import { clearOpenTiffFiles, openTiff } from './loader'

const SAMPLE_FORMAT_TAG = 339

function image(overrides: Partial<TestTiffImage> = {}): Uint8Array<ArrayBuffer> {
  return new Uint8Array(
    buildTiff([
      {
        width: 16,
        height: 16,
        tile: 16,
        subfileType: 0,
        description: 'test',
        value: () => 500,
        ...overrides,
      },
    ]),
  )
}

afterEach(() => {
  clearOpenTiffFiles()
})

describe('TIFF sample tags (EXP-015)', () => {
  it('reads tiles without a Compression tag as uncompressed', async () => {
    const loader = await openTiff(
      'https://example.test/untagged.tif',
      undefined,
      undefined,
      {
        bytes: image({ compression: null }),
      },
    )

    expect(loader.tileDecodeOptions(0, 0, 0)).toMatchObject({ compression: 1 })
    const decoded = await decodeTiffTilePixels(
      await loader.fetchTileBytes(0, 0, 0),
      loader.tileDecodeOptions(0, 0, 0),
    )
    expect([...decoded.pixels.slice(0, 3)]).toEqual([500, 500, 500])
  })

  it('refuses signed samples in an image, but reads them in labels', async () => {
    const signed = image({ extraTags: [[SAMPLE_FORMAT_TAG, TIFF_SHORT, [2]]] })

    await expect(
      openTiff('https://example.test/signed.tif', undefined, undefined, {
        bytes: signed,
      }),
    ).rejects.toThrow(
      'The image stores signed 16-bit samples (TIFF SampleFormat 2), which the viewer cannot show.',
    )

    clearOpenTiffFiles()
    const labels = await openTiff(
      'https://example.test/signed.tif',
      undefined,
      undefined,
      {
        bytes: signed,
        labels: true,
      },
    )
    expect(labels.tileDecodeOptions(0, 0, 0)).toMatchObject({ sampleFormat: 2 })
  })
})
