import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeTiffChunkSamples } from '../codecs/tiffTile'
import { clearOpenTiffFiles, openTiff } from './loader'
import {
  isNdpiUrl,
  NDPI_OVER_4GB_MESSAGE,
  ndpiBandByteRange,
  ndpiBlockDecodeOptions,
  ndpiBlockJpeg,
  ndpiBlocksForWindow,
  ndpiBlockWindow,
  ndpiDcWindow,
  ndpiLayout,
  ndpiLevelGeometry,
  ndpiTileBytes,
  parseNdpiJpegHeader,
} from './ndpi'
import type { NdpiIfdSummary, NdpiLevelGeometry, NdpiPlanOptions } from './ndpi'
import { svsChannelInfo } from './svs'
import {
  decodeWholeJpeg,
  mcuStarts,
  NDPI_FIXTURE_SIZES,
  ndpiFixtureFile,
  ndpiFixtureJpeg,
  withZeroFrameWidth,
} from '../test/ndpiFixtures'
import type { NdpiFixtureJpeg } from '../test/ndpiFixtures'
import { stubRangeFetch, TIFF_LONG } from '../test/tiffFixtures'

beforeEach(() => {
  clearOpenTiffFiles()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('NDPI detection', () => {
  it('recognizes NDPI file names', () => {
    expect(isNdpiUrl('https://example.test/slides/kidney.ndpi')).toBe(true)
    expect(isNdpiUrl('https://example.test/slides/KIDNEY.NDPI?token=1')).toBe(true)
    expect(isNdpiUrl('https://example.test/slides/kidney.ndpi.json')).toBe(false)
    expect(isNdpiUrl('https://example.test/slides/kidney.tif')).toBe(false)
  })
})

describe('ndpiLayout', () => {
  it('reads the levels largest first, leaving out the macro image and the map', () => {
    expect(
      ndpiLayout([
        summary(0, 68_096, 37_632, 40),
        summary(1, 34_048, 18_816, 20),
        summary(2, 17_024, 9_408, 10),
        summary(3, 1_048, 356, -1),
        summary(4, 600, 203, -2),
      ]),
    ).toEqual([0, 1, 2])
  })

  it('keeps the focal plane nearest the focus and levels that shrink', () => {
    expect(
      ndpiLayout([
        summary(0, 4_000, 2_000, 40, -1_000),
        summary(1, 4_000, 2_000, 40, 0),
        summary(2, 2_000, 1_000, 20, -1_000),
        summary(3, 2_000, 1_000, 20, 0),
        summary(4, 2_000, 1_000, 20, 0),
        summary(5, 1_000, 500, 10, 0),
      ]),
    ).toEqual([1, 3, 5])
  })

  it('has no levels without a pyramid image', () => {
    expect(ndpiLayout([summary(0, 1_048, 356, -1)])).toEqual([])
  })
})

describe('parseNdpiJpegHeader', () => {
  it('reads the MCU size, restart interval, and where the scan starts', () => {
    const header = parseNdpiJpegHeader(ndpiFixtureJpeg('level0'))

    expect(header).toMatchObject({
      mcuWidth: 16,
      mcuHeight: 16,
      components: 3,
      restartInterval: 4,
    })
    expect(header.length).toBe(mcuStarts(ndpiFixtureJpeg('level0'))[0])
    expect(parseNdpiJpegHeader(ndpiFixtureJpeg('level1'))).toMatchObject({
      mcuWidth: 8,
      mcuHeight: 8,
      restartInterval: 2,
    })
    expect(parseNdpiJpegHeader(ndpiFixtureJpeg('level2')).restartInterval).toBe(0)
  })

  it('points at the frame size it patches', () => {
    const jpeg = ndpiFixtureJpeg('level0')
    const { frameSizeOffset } = parseNdpiJpegHeader(jpeg)

    expect(((jpeg[frameSizeOffset] ?? 0) << 8) | (jpeg[frameSizeOffset + 1] ?? 0)).toBe(
      44,
    )
    expect(
      ((jpeg[frameSizeOffset + 2] ?? 0) << 8) | (jpeg[frameSizeOffset + 3] ?? 0),
    ).toBe(118)
  })

  it('refuses streams it cannot cut into blocks', () => {
    const progressive = ndpiFixtureJpeg('level1')
    progressive[frameMarkerOffset(progressive) + 1] = 0xc2

    expect(() => parseNdpiJpegHeader(progressive)).toThrow('SOF marker 0xc2')
    expect(() => parseNdpiJpegHeader(new Uint8Array([0, 1, 2]))).toThrow(
      'does not start with a JPEG image',
    )
    expect(() => parseNdpiJpegHeader(ndpiFixtureJpeg('level1').subarray(0, 300))).toThrow(
      'ends before its scan starts',
    )
  })
})

describe('ndpiLevelGeometry', () => {
  it('lays out restart intervals along MCU rows', () => {
    const geometry = fixtureGeometry('level0')

    expect(geometry).toMatchObject({
      mcuRows: 3,
      intervalMcus: 4,
      intervalsPerRow: 2,
      // The default plan reads this small level as one block.
      bandMcuRows: 3,
      blockIntervals: 2,
    })
    expect(geometry.header.byteLength).toBe(mcuStarts(ndpiFixtureJpeg('level0'))[0])
  })

  it('shrinks bands, by halving, to the byte and decode limits', () => {
    expect(
      fixtureGeometry('level1', { tileHeight: 32, bandTargetBytes: 1_000 }).bandMcuRows,
    ).toBe(1)
    expect(
      fixtureGeometry('level1', { tileHeight: 32, blockMaxBytes: 2 * 8 * 59 * 3 })
        .bandMcuRows,
    ).toBe(2)
    expect(fixtureGeometry('level1', { blockTargetWidth: 16 }).blockIntervals).toBe(1)
  })

  it('checks the restart offsets against the image size', () => {
    const jpeg = ndpiFixtureJpeg('level1')
    const starts = mcuStarts(jpeg)
    const geometry = (intervalStarts: readonly number[], header = jpeg) =>
      ndpiLevelGeometry({
        width: 59,
        height: 22,
        samplesPerPixel: 3,
        header,
        intervalStarts,
        streamLength: jpeg.byteLength,
      })

    expect(() => geometry(starts.slice(1))).toThrow('not where its JPEG scan starts')
    expect(() => geometry([...starts, jpeg.byteLength - 4])).toThrow(
      'lists 13 restart intervals; its size needs 12',
    )
    expect(() => geometry([starts[0] ?? 0, ...starts.slice(2), 10])).toThrow(
      'out of order',
    )

    const everyThreeMcus = jpeg.slice()
    everyThreeMcus[driOffset(everyThreeMcus) + 5] = 3
    expect(() => geometry(starts, everyThreeMcus)).toThrow(
      'restart intervals of 3 MCUs do not divide its rows of 8 MCUs',
    )
    expect(() =>
      ndpiLevelGeometry({
        width: 30,
        height: 11,
        samplesPerPixel: 3,
        header: ndpiFixtureJpeg('level2'),
        intervalStarts: [623],
        streamLength: 1_000,
      }),
    ).toThrow('its JPEG has none')
  })
})

describe('NDPI blocks', () => {
  it.each([
    { name: 'level0', note: 'with the frame width written as 0' },
    { name: 'level1', note: 'with more restart markers than RST0 to RST7' },
  ] as const)(
    'decode $name to the pixels of the whole image ($note)',
    async ({ name }) => {
      const [width, height] = NDPI_FIXTURE_SIZES[name]
      const stream =
        name === 'level0'
          ? withZeroFrameWidth(ndpiFixtureJpeg(name))
          : ndpiFixtureJpeg(name)
      const whole = await decodeWholeJpeg(name)

      for (const plan of [
        {},
        { tileHeight: 8, bandTargetBytes: 1, blockTargetWidth: 1 },
        { tileHeight: 16, blockTargetWidth: 32 },
      ]) {
        const geometry = fixtureGeometry(name, plan, stream)
        const blocks = ndpiBlocksForWindow(geometry, { left: 0, top: 0, width, height })

        for (const block of blocks) {
          const range = ndpiBandByteRange(geometry, block.band)
          const jpeg = ndpiBlockJpeg(
            geometry,
            stream.slice(range.start, range.end),
            block,
          )
          const window = ndpiBlockWindow(geometry, block)
          const options = ndpiBlockDecodeOptions(geometry, jpeg, 6)
          const decoded = new Uint8Array(
            await decodeTiffChunkSamples(jpeg.bytes, {
              ...options,
              tileWidth: jpeg.width,
              tileHeight: jpeg.height,
            }),
          )

          expect([jpeg.width, jpeg.height]).toEqual([window.width, window.height])
          expect(decoded).toEqual(crop(whole, width, window))
        }
      }
    },
  )

  it.each(['level0', 'level1'] as const)(
    'decode %s from the DC terms to the pixels of the whole image at an eighth',
    async (name) => {
      const [width, height] = NDPI_FIXTURE_SIZES[name]
      const stream = ndpiFixtureJpeg(name)
      const whole = ndpiDcWindow({ left: 0, top: 0, width, height })
      const wholeDc = new Uint8Array(
        await decodeTiffChunkSamples(stream, {
          compression: 7,
          photometric: 6,
          bitsPerSample: [8, 8, 8],
          samplesPerPixel: 3,
          jpegDcOnly: true,
          tileWidth: whole.width,
          tileHeight: whole.height,
        }),
      )
      const geometry = fixtureGeometry(name, {
        tileHeight: 8,
        bandTargetBytes: 1,
        blockTargetWidth: 1,
      })

      for (const block of ndpiBlocksForWindow(geometry, {
        left: 0,
        top: 0,
        width,
        height,
      })) {
        const range = ndpiBandByteRange(geometry, block.band)
        const jpeg = ndpiBlockJpeg(geometry, stream.slice(range.start, range.end), block)
        const window = ndpiDcWindow(ndpiBlockWindow(geometry, block))
        const options = ndpiBlockDecodeOptions(geometry, jpeg, 6, true)
        const decoded = new Uint8Array(
          await decodeTiffChunkSamples(jpeg.bytes, {
            ...options,
            tileWidth: options.width,
            tileHeight: options.stripRows[0] ?? 0,
          }),
        )

        expect([options.width, options.stripRows[0]]).toEqual([
          window.width,
          window.height,
        ])
        expect(decoded).toEqual(crop(wholeDc, whole.width, window))
      }
    },
  )

  it('maps block windows to the DC level, partial blocks included', () => {
    expect(ndpiDcWindow({ left: 64, top: 16, width: 54, height: 28 })).toEqual({
      left: 8,
      top: 2,
      width: 7,
      height: 4,
    })
  })

  it('numbers restart markers afresh and ends with EOI', () => {
    const stream = ndpiFixtureJpeg('level1')
    const geometry = fixtureGeometry('level1')
    const range = ndpiBandByteRange(geometry, 0)
    const jpeg = ndpiBlockJpeg(geometry, stream.slice(range.start, range.end), {
      band: 0,
      group: 0,
    })
    const markers = [...jpeg.bytes.subarray(geometry.header.byteLength).entries()]
      .filter(
        ([index, byte]) =>
          byte === 0xff &&
          (jpeg.bytes[geometry.header.byteLength + index + 1] ?? 0) >= 0xd0,
      )
      .map(([index]) => jpeg.bytes[geometry.header.byteLength + index + 1])

    expect(markers).toEqual([
      0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd0, 0xd1, 0xd2, 0xd9,
    ])
  })

  it('finds the blocks across a window and the bytes of a band', () => {
    const geometry = fixtureGeometry('level1', { tileHeight: 8, blockTargetWidth: 16 })

    expect(
      ndpiBlocksForWindow(geometry, { left: 10, top: 6, width: 10, height: 4 }),
    ).toEqual([
      { band: 0, group: 0 },
      { band: 0, group: 1 },
      { band: 1, group: 0 },
      { band: 1, group: 1 },
    ])
    expect(
      ndpiBlocksForWindow(geometry, { left: 59, top: 0, width: 5, height: 5 }),
    ).toEqual([])
    expect(ndpiBlockWindow(geometry, { band: 2, group: 3 })).toEqual({
      left: 48,
      top: 16,
      width: 11,
      height: 6,
    })

    const starts = mcuStarts(ndpiFixtureJpeg('level1'))
    expect(ndpiBandByteRange(geometry, 1)).toEqual({ start: starts[4], end: starts[8] })
    expect(ndpiBandByteRange(geometry, 2)).toEqual({
      start: starts[8],
      end: ndpiFixtureJpeg('level1').byteLength,
    })
  })

  it('cuts a tile from the blocks across it, zero outside them', () => {
    const block = (left: number, top: number, value: number) => ({
      window: { left, top, width: 2, height: 2 },
      bytes: new Uint8Array(2 * 2).fill(value),
    })

    expect(
      ndpiTileBytes(
        [block(0, 0, 1), block(2, 0, 2), block(0, 2, 3)],
        { left: 1, top: 1, width: 2, height: 2 },
        3,
        3,
        1,
      ),
    ).toEqual(Uint8Array.from([1, 2, 0, 3, 0, 0, 0, 0, 0]))
  })
})

describe('openTiff with an NDPI', () => {
  it('opens the levels, read by block or whole, without the macro image', async () => {
    const url = 'https://example.test/slides/slide.ndpi'
    stubRangeFetch(url, ndpiFixtureFile())

    const loader = await openTiff(url)

    expect(loader).toMatchObject({
      numLevels: 3,
      imageWidth: 118,
      imageHeight: 44,
      tileWidth: 512,
      tileHeight: 512,
      units: { micrometersPerPixel: 0.5 },
    })
    expect(loader.channels).toEqual([svsChannelInfo(3, 8)])
    expect(loader.tileDecodeOptions(0, 0, 0)).toMatchObject({
      compression: 1,
      samplesPerPixel: 3,
      tileWidth: 512,
    })

    for (const [level, name] of [
      [0, 'level0'],
      [1, 'level1'],
      [2, 'level2'],
    ] as const) {
      const [width, height] = NDPI_FIXTURE_SIZES[name]

      expect(loader.tileSourceSize(level, 0, 0)).toEqual({ width, height })
      expect(
        crop(await loader.fetchTileBytes(level, 0, 0), 512, {
          left: 0,
          top: 0,
          width,
          height,
        }),
      ).toEqual(await decodeWholeJpeg(name))
    }
  })

  it('reads each band once for the blocks across it', async () => {
    const url = 'https://example.test/slides/requests.ndpi'
    const fetcher = stubRangeFetch(url, ndpiFixtureFile())
    const loader = await openTiff(url)
    const opened = fetcher.mock.calls.length

    await loader.fetchTileBytes(0, 0, 0)
    // The JPEG header and the one band; the McuStarts tag came with the IFD.
    expect(fetcher.mock.calls.length - opened).toBe(2)

    await loader.fetchTileBytes(0, 0, 0)
    expect(fetcher.mock.calls.length - opened).toBe(2)
  })

  it('opens an NDPI saved under another name, and one IFD on its own', async () => {
    const url = 'https://example.test/renamed/slide.tif'
    stubRangeFetch(url, ndpiFixtureFile())

    expect((await openTiff(url)).numLevels).toBe(3)

    const macro = await openTiff(`${url}#ifd=3`)
    expect([macro.numLevels, macro.imageWidth, macro.imageHeight]).toEqual([1, 40, 20])
  })

  it('leaves out a level it cannot read, but not the first', async () => {
    const url = 'https://example.test/slides/tiled-level.ndpi'
    stubRangeFetch(
      url,
      ndpiFixtureFile({
        withoutMcuStarts: ['level1'],
        levelTags: (name) =>
          name === 'level1'
            ? [
                [322, TIFF_LONG, [16]],
                [323, TIFF_LONG, [16]],
              ]
            : [],
      }),
    )

    const loader = await openTiff(url)
    expect(loader.numLevels).toBe(2)
    expect(loader.tileSourceSize(1, 0, 0)).toEqual({ width: 30, height: 11 })

    // 100,000 x 1,000 RGB pixels in one strip without restart offsets.
    const firstUrl = 'https://example.test/slides/no-first.ndpi'
    stubRangeFetch(
      firstUrl,
      ndpiFixtureFile({
        withoutMcuStarts: ['level0'],
        levelTags: (name) =>
          name === 'level0'
            ? [
                [256, TIFF_LONG, [100_000]],
                [257, TIFF_LONG, [1_000]],
                [278, TIFF_LONG, [1_000]],
              ]
            : [],
      }),
    )
    await expect(openTiff(firstUrl)).rejects.toThrow(
      "The NDPI's full-resolution image cannot be read: TIFF level 0 is stored in compressed strips",
    )
  })

  it('reports restart offsets that do not fit the level when its tiles are read', async () => {
    const url = 'https://example.test/slides/bad-starts.ndpi'
    const starts = mcuStarts(ndpiFixtureJpeg('level1'))
    stubRangeFetch(
      url,
      ndpiFixtureFile({
        levelTags: (name) =>
          name === 'level1' ? [[65426, TIFF_LONG, starts.slice(0, -1)]] : [],
      }),
    )

    const loader = await openTiff(url)

    await expect(loader.fetchTileBytes(1, 0, 0)).rejects.toThrow(
      'lists 11 restart intervals; its size needs 12',
    )
  })

  it('refuses files over 4 GB', async () => {
    const url = 'https://example.test/slides/huge.ndpi'
    stubRangeFetch(
      url,
      ndpiFixtureFile({
        levelTags: (name) => (name === 'level0' ? [[65432, TIFF_LONG, [0, 1]]] : []),
      }),
    )

    await expect(openTiff(url)).rejects.toThrow(NDPI_OVER_4GB_MESSAGE)
  })
})

function summary(
  index: number,
  width: number,
  height: number,
  magnification: number,
  zOffset = 0,
): NdpiIfdSummary {
  return { index, width, height, magnification, zOffset }
}

function fixtureGeometry(
  name: NdpiFixtureJpeg,
  plan: Partial<NdpiPlanOptions> = {},
  stream = ndpiFixtureJpeg(name),
): NdpiLevelGeometry {
  const [width, height] = NDPI_FIXTURE_SIZES[name]

  return ndpiLevelGeometry({
    width,
    height,
    samplesPerPixel: 3,
    header: stream,
    intervalStarts: mcuStarts(stream),
    streamLength: stream.byteLength,
    plan,
  })
}

function crop(
  pixels: Uint8Array,
  rowWidth: number,
  window: { left: number; top: number; width: number; height: number },
): Uint8Array {
  const out = new Uint8Array(window.width * window.height * 3)

  for (let row = 0; row < window.height; row += 1) {
    const start = ((window.top + row) * rowWidth + window.left) * 3
    out.set(pixels.subarray(start, start + window.width * 3), row * window.width * 3)
  }

  return out
}

function frameMarkerOffset(jpeg: Uint8Array): number {
  return markerOffset(jpeg, (marker) => marker === 0xc0 || marker === 0xc1)
}

function driOffset(jpeg: Uint8Array): number {
  return markerOffset(jpeg, (marker) => marker === 0xdd)
}

function markerOffset(jpeg: Uint8Array, matches: (marker: number) => boolean): number {
  let position = 2

  while (!matches(jpeg[position + 1] ?? 0)) {
    position += 2 + (((jpeg[position + 2] ?? 0) << 8) | (jpeg[position + 3] ?? 0))
  }

  return position
}
