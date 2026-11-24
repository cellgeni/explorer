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

  // Tiles were read a byte per sample: a 1-bit mask of ones drew as 255s
  // and zeros (EXP-330).
  it.each([
    ['a bilevel mask', 1],
    ['packed 12-bit samples', 12],
    ['32-bit samples', 32],
  ])('refuses tiles of %s in an image', async (_name, bitsPerSample) => {
    await expect(
      openTiff('https://example.test/odd.tif', undefined, undefined, {
        bytes: image({ bitsPerSample, tileBytes: () => [0xff, 0x00] }),
      }),
    ).rejects.toThrow(
      `The image stores ${bitsPerSample}-bit samples, which the viewer cannot read from its tiles.`,
    )
  })

  it('reads 32-bit tiles in labels, and 8- and 16-bit tiles in images', async () => {
    const labels = await openTiff(
      'https://example.test/labels.tif',
      undefined,
      undefined,
      {
        bytes: image({
          bitsPerSample: 32,
          tileBytes: () => new Array<number>(16 * 16 * 4).fill(0),
        }),
        labels: true,
      },
    )
    expect(labels.tileDecodeOptions(0, 0, 0)).toMatchObject({ bitsPerSample: [32] })

    for (const bitsPerSample of [8, 16]) {
      clearOpenTiffFiles()
      await expect(
        openTiff(`https://example.test/${bitsPerSample}.tif`, undefined, undefined, {
          bytes: image({
            bitsPerSample,
            tileBytes: () => new Array<number>((16 * 16 * bitsPerSample) / 8).fill(1),
          }),
        }),
      ).resolves.toBeDefined()
    }
  })
})
