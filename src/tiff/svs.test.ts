import { afterEach, describe, expect, it, vi } from 'vitest'
import { openTiff } from './loader'
import {
  isSvsAssociatedImageAfterPyramid,
  isSvsDescription,
  isSvsUrl,
  parseSvsDescription,
  svsAssociatedImageName,
  svsChannelInfo,
  svsLayout,
} from './svs'
import type { SvsIfdSummary } from './svs'
import { buildTiffFile, stubRangeFetch, u16 } from '../test/tiffFixtures'
import type { TestTiffImage } from '../test/tiffFixtures'

afterEach(() => {
  vi.unstubAllGlobals()
})

const APERIO_DESCRIPTION = [
  'Aperio Image Library v12.0.15 ',
  '64x64 [0,0 64x64] (32x32) JPEG/RGB Q=30|AppMag = 20|StripeWidth = 2032|MPP = 0.4990|Left = 28.9',
].join('\n')

describe('SVS detection', () => {
  it('recognizes SVS file names', () => {
    expect(isSvsUrl('https://example.test/slides/CMU-1.svs')).toBe(true)
    expect(isSvsUrl('https://example.test/slides/CMU-1.SVS?token=1')).toBe(true)
    expect(isSvsUrl('https://example.test/slides/CMU-1.svs.json')).toBe(false)
    expect(isSvsUrl('https://example.test/slides/CMU-1.tif')).toBe(false)
  })

  it('recognizes Aperio image descriptions', () => {
    expect(isSvsDescription(APERIO_DESCRIPTION)).toBe(true)
    expect(
      isSvsDescription('Aperio Image, Grundium Ocus\n|MPP =0.250552|AppMag=40'),
    ).toBe(true)
    expect(isSvsDescription('<?xml version="1.0"?><OME />')).toBe(false)
    expect(isSvsDescription(undefined)).toBe(false)
  })
})

describe('parseSvsDescription', () => {
  it('reads the pixel size and objective power', () => {
    expect(parseSvsDescription(APERIO_DESCRIPTION)).toEqual({
      micrometersPerPixel: 0.499,
      objectivePower: 20,
    })
  })

  it('reads properties with any spacing around the equals sign', () => {
    expect(
      parseSvsDescription('Aperio Image, Grundium Ocus\n|MPP =0.250552|AppMag=40'),
    ).toEqual({ micrometersPerPixel: 0.250552, objectivePower: 40 })
    expect(
      parseSvsDescription(
        'Aperio Leica Biosystems GT450 DX v1.2.4 \n59342x63009 [0,0,59342x63009] (256x256) JPEG/YCC Q=91|AppMag = 40|MPP = 0.263516|Gamma = 2.2',
      ),
    ).toEqual({ micrometersPerPixel: 0.263516, objectivePower: 40 })
  })

  it('reads an Aperio FL channel file’s dye and display colour', () => {
    // Zenodo 10.5281/zenodo.841835, as ImageScope exported it.
    const description = [
      'Aperio Image Library v12.0.14 ',
      '74255x44965 [40601,0 18417x21256] (256x256) RAW;Aperio Image Library v12.0.11 ',
      '77376x45065 [0,100 74255x44965] (256x256) LZW|AppMag = 20|StripeWidth = 992|MPP = 0.4626|Dye = DAPI|Excitation Wavelength = 345|Emission Wavelength = 455|Exposure Time = 200|DisplayColor = 1279|Acquisition Bit Depth = 10',
    ].join('\r\n')

    expect(parseSvsDescription(description)).toEqual({
      micrometersPerPixel: 0.4626,
      objectivePower: 20,
      dye: 'DAPI',
      displayColor: [0, 4, 255],
    })
    expect(
      parseSvsDescription('Aperio Image\n|Dye = Alexa Fluor 568|DisplayColor = 16711680'),
    ).toMatchObject({ dye: 'Alexa Fluor 568', displayColor: [255, 0, 0] })
    expect(parseSvsDescription('Aperio Image\n|DisplayColor = -1|Dye =')).toEqual({})
  })

  it('leaves out missing or unreadable values', () => {
    expect(parseSvsDescription('Aperio Image Library v10\nlabel 387x463')).toEqual({})
    expect(parseSvsDescription('Aperio Image\n|MPP = n/a|AppMag = 0')).toEqual({})
    expect(parseSvsDescription('ImageJ=1.54\nMPP = 0.5')).toEqual({})
  })
})

describe('svsLayout', () => {
  it('reads every tiled IFD the TIFF loader can use as a pyramid level', () => {
    expect(
      svsLayout([
        summary(0, 46_000, 32_914),
        summary(1, 1024, 732, { tiled: false }),
        summary(2, 11_500, 8_228),
        // Another tile size is left out.
        summary(3, 5_750, 4_114, { tile: 512 }),
        summary(4, 2_875, 2_057),
        // Not smaller than the level before it.
        summary(5, 2_875, 2_057),
        summary(6, 387, 463, { tiled: false }),
      ]),
    ).toEqual([0, 2, 4])
  })

  it('has no levels when IFD 0 is stripped', () => {
    expect(
      svsLayout([summary(0, 100, 100, { tiled: false }), summary(1, 50, 50)]),
    ).toEqual([])
  })

  it('treats a stripped reduced-resolution IFD as the label or macro', () => {
    expect(isSvsAssociatedImageAfterPyramid({ tiled: false, subfileType: 1 })).toBe(true)
    expect(isSvsAssociatedImageAfterPyramid({ tiled: false, subfileType: 9 })).toBe(true)
    // The thumbnail comes before the reduced levels.
    expect(isSvsAssociatedImageAfterPyramid({ tiled: false, subfileType: 0 })).toBe(false)
    expect(isSvsAssociatedImageAfterPyramid({ tiled: true, subfileType: 1 })).toBe(false)
  })
})

describe('svsAssociatedImageName', () => {
  const stripped = { tiled: false, subfileType: 0 }

  it('names a stripped IFD 1 the thumbnail', () => {
    expect(svsAssociatedImageName({ ...stripped, index: 1 })).toBe('thumbnail')
    // Leica GT450 states only the size.
    expect(
      svsAssociatedImageName({
        ...stripped,
        index: 1,
        description:
          'Aperio Leica Biosystems GT450 DX v1.2.4 \n1017x1080 [0,0,1017x1080] (1017x1080) JPEG/YCC Q=100|AppMag = 40',
      }),
    ).toBe('thumbnail')
    expect(svsAssociatedImageName({ ...stripped, index: 1, tiled: true })).toBeUndefined()
  })

  it('names other IFDs by their description, then by subfile type', () => {
    expect(
      svsAssociatedImageName({
        ...stripped,
        index: 6,
        subfileType: 1,
        description: 'Aperio Image Library v11.2.1 \r\nlabel 387x463',
      }),
    ).toBe('label')
    expect(
      svsAssociatedImageName({
        ...stripped,
        index: 7,
        description: 'Aperio Image\nmacro 1200x400',
      }),
    ).toBe('macro')
    expect(svsAssociatedImageName({ ...stripped, index: 5, subfileType: 1 })).toBe(
      'label',
    )
    expect(svsAssociatedImageName({ ...stripped, index: 5, subfileType: 9 })).toBe(
      'macro',
    )
    expect(
      svsAssociatedImageName({
        ...stripped,
        index: 3,
        description: 'Aperio Image\n 3072x3072',
      }),
    ).toBeUndefined()
  })
})

describe('svsChannelInfo', () => {
  it('shows an RGB slide as stored', () => {
    expect(svsChannelInfo(3, 8)).toEqual({
      id: 'Channel:0',
      index: 0,
      name: 'RGB',
      color: [255, 255, 255],
      contrast: { min: 0, max: 255 },
      ifdIndex: 0,
      samplesPerPixel: 3,
      alphaFromIntensity: false,
    })
  })

  it('gives a single-sample slide the window of its bit depth', () => {
    expect(svsChannelInfo(1, 16)).toMatchObject({
      name: 'Channel 1',
      contrast: { min: 0, max: 65_535 },
    })
    expect(svsChannelInfo(1, 16)).not.toHaveProperty('samplesPerPixel')
  })

  it('names and colours a fluorescence channel by its description', () => {
    const channel = { dye: 'DAPI', displayColor: [0, 4, 255] } as const

    expect(svsChannelInfo(1, 16, undefined, channel)).toMatchObject({
      name: 'DAPI',
      color: [0, 4, 255],
      contrast: { min: 0, max: 65_535 },
    })
    // A name the caller gives wins.
    expect(svsChannelInfo(1, 16, 'Nuclei', channel)).toMatchObject({ name: 'Nuclei' })
  })
})

describe('openTiff with an SVS', () => {
  it('opens the tiled IFDs as pyramid levels, each with its own JPEG tables', async () => {
    const url = 'https://example.test/slides/slide.svs'
    const fetcher = stubRangeFetch(url, svsFile())

    const loader = await openTiff(url)

    expect(loader.imageWidth).toBe(64)
    expect(loader.imageHeight).toBe(64)
    expect(loader.tileWidth).toBe(32)
    expect(loader.numLevels).toBe(2)
    expect(loader.units.micrometersPerPixel).toBe(0.499)
    expect(loader.channels).toEqual([svsChannelInfo(3, 8)])
    expect(loader.tilesForLevel(0)).toHaveLength(4)
    expect(loader.tilesForLevel(1)).toHaveLength(1)
    expect(loader.tileDecodeOptions(0, 0, 0)).toMatchObject({
      compression: 7,
      photometric: 2,
      samplesPerPixel: 3,
      jpegTables: Uint8Array.from(LEVEL_TABLES[0]),
    })
    expect(loader.tileDecodeOptions(1, 0, 0)).toMatchObject({
      compression: 7,
      jpegTables: Uint8Array.from(LEVEL_TABLES[1]),
    })
    await expect(loader.fetchTileBytes(1, 0, 0)).resolves.toEqual(
      Uint8Array.from(jpegTile(1, 0)),
    )

    // Upcoming tiles stored back to back are read in one request.
    const requestsBeforeLevelZero = fetcher.mock.calls.length
    await expect(
      loader.fetchTileBytes(0, 0, 0, undefined, {
        upcoming: [
          { col: 0, row: 1 },
          { col: 1, row: 1 },
        ],
      }),
    ).resolves.toEqual(Uint8Array.from(jpegTile(0, 0)))
    await expect(loader.fetchTileBytes(0, 0, 1)).resolves.toEqual(
      Uint8Array.from(jpegTile(0, 2)),
    )
    await expect(loader.fetchTileBytes(0, 1, 1)).resolves.toEqual(
      Uint8Array.from(jpegTile(0, 3)),
    )
    expect(fetcher.mock.calls.length).toBe(requestsBeforeLevelZero + 1)

    // A zero-length tile reads as empty bytes without a request.
    await expect(loader.fetchTileBytes(0, 1, 0)).resolves.toEqual(new Uint8Array(0))
    expect(fetcher.mock.calls.length).toBe(requestsBeforeLevelZero + 1)
  })

  it('draws the minimap from the thumbnail, stretched over the slide', async () => {
    const url = 'https://example.test/thumbnail/slide.svs'
    stubRangeFetch(url, svsFile())

    const loader = await openTiff(url, undefined, undefined, {
      origin: { x: 100, y: 200 },
    })
    const overview = loader.overview

    expect(overview).toBeDefined()
    expect(overview?.url).toBe(`${url}#ifd=1`)
    expect(overview?.imageWidth).toBe(64)
    expect(overview?.imageHeight).toBe(64)
    expect(overview?.units).toEqual(loader.units)
    expect(overview?.channels).toEqual(loader.channels)
    expect(overview?.numLevels).toBe(1)
    expect(overview?.tilesForLevel(0)).toEqual([{ col: 0, row: 0 }])
    // The 8-pixel thumbnail covers the 64-pixel slide where the slide is.
    expect(overview?.tileBounds(0, 0, 0)).toEqual(loader.tileBounds(1, 0, 0))
    expect(overview?.tileBounds(0, 0, 0)).toMatchObject({ minX: 100, minY: 200 })
    expect(overview?.bestLevel(1)).toBe(0)

    const tile = await overview?.fetchTileBytes?.(0, 0, 0)
    const thumbnail = stripPixels(8, 8, THUMBNAIL_SEED)

    // Tiles cut from strips are 256 pixels; the thumbnail is the top left.
    expect(tile?.subarray(0, 24)).toEqual(thumbnail.subarray(0, 24))
    expect(tile?.subarray(256 * 3 * 7, 256 * 3 * 7 + 24)).toEqual(
      thumbnail.subarray(24 * 7),
    )
    expect(overview?.tileDecodeOptions?.(0, 0, 0)).toMatchObject({
      compression: 1,
      samplesPerPixel: 3,
      bitsPerSample: [8, 8, 8],
    })
  })

  // The open stops at the label (see the broken-macro test below).
  it('lists the thumbnail, label, and macro when asked', async () => {
    const url = 'https://example.test/associated/slide.svs'
    const fetcher = stubRangeFetch(url, buildTiffFile(svsImages()).bytes)

    const loader = await openTiff(url)
    const images = await loader.associatedImages?.()

    expect(
      images?.map(({ name, ifdIndex, width, height }) => ({
        name,
        ifdIndex,
        width,
        height,
      })),
    ).toEqual([
      { name: 'thumbnail', ifdIndex: 1, width: 8, height: 8 },
      { name: 'label', ifdIndex: 4, width: 8, height: 8 },
      { name: 'macro', ifdIndex: 5, width: 16, height: 8 },
    ])

    const macro = images?.[2]?.loader
    expect(macro?.url).toBe(`${url}#ifd=5`)
    expect(macro?.units.micrometersPerPixel).toBe(1)
    expect(macro?.channels[0]).toMatchObject({ name: 'RGB', color: [255, 255, 255] })
    const macroTile = await macro?.fetchTileBytes?.(0, 0, 0)
    expect(macroTile?.subarray(0, 48)).toEqual(
      stripPixels(16, 8, MACRO_SEED).subarray(0, 48),
    )

    // Listed once per loader.
    const requestsAfterListing = fetcher.mock.calls.length
    await expect(loader.associatedImages?.()).resolves.toBe(images)
    expect(fetcher.mock.calls.length).toBe(requestsAfterListing)
  })

  it('opens an associated image on its own with #ifd=N', async () => {
    const url = 'https://example.test/label/slide.svs'
    stubRangeFetch(url, buildTiffFile(svsImages()).bytes)

    const label = await openTiff(`${url}#ifd=4`)

    expect(label.imageWidth).toBe(8)
    expect(label.numLevels).toBe(1)
    await expect(label.fetchTileBytes(0, 0, 0)).resolves.toHaveLength(256 * 256 * 3)
    await expect(openTiff(`${url}#ifd=3`)).rejects.toThrow(
      'IFD 3 is not a full-resolution channel of the SVS.',
    )
  })

  it('reports associated images it cannot list', async () => {
    const url = 'https://example.test/broken-macro/slide.svs'
    stubRangeFetch(url, svsFile())

    const loader = await openTiff(url)

    await expect(loader.associatedImages?.()).rejects.toThrow()
  })

  it('opens an SVS saved under a .tif name', async () => {
    const url = 'https://example.test/renamed/slide.tif'
    stubRangeFetch(url, svsFile())

    const loader = await openTiff(url)

    expect(loader.numLevels).toBe(2)
    expect(loader.units.micrometersPerPixel).toBe(0.499)
  })

  it('rejects a slide whose full-resolution image is stripped', async () => {
    const url = 'https://example.test/stripped/slide.svs'
    stubRangeFetch(
      url,
      buildTiffFile([
        {
          width: 64,
          height: 64,
          subfileType: 0,
          description: APERIO_DESCRIPTION,
          samplesPerPixel: 3,
          bitsPerSample: 8,
          value: () => 0,
        },
      ]).bytes,
    )

    await expect(openTiff(url)).rejects.toThrow(
      'The SVS is not tiled, so it cannot be read by tile.',
    )
  })

  it('reports a sidecar named for an SVS as unused', async () => {
    const url = 'https://example.test/sidecar/slide.svs'
    stubRangeFetch(url, svsFile())
    const onFallback = vi.fn()

    await openTiff(url, undefined, onFallback, {
      zchunkStoreUrl: 'https://example.test/sidecar/slide.zchunkstore',
    })

    expect(onFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('the image is an SVS'),
        coalesceKey: 'zchunkstore-svs:https://example.test/sidecar/slide.zchunkstore',
      }),
    )
  })
})

function summary(
  index: number,
  width: number,
  height: number,
  options: { readonly tiled?: boolean; readonly tile?: number } = {},
): SvsIfdSummary {
  const tile = options.tile ?? 256

  return {
    index,
    width,
    height,
    samplesPerPixel: 3,
    ...(options.tiled === false ? {} : { tileWidth: tile, tileHeight: tile }),
  }
}

const THUMBNAIL_SEED = 1
const MACRO_SEED = 3

// Uncompressed RGB samples that differ by position and image.
function stripPixels(width: number, height: number, seed: number): Uint8Array {
  return Uint8Array.from(
    { length: width * height * 3 },
    (_unused, index) => (index * 7 + seed * 50) % 256,
  )
}

// Stand-ins for JPEG data: the loader stores and returns them unread.
const LEVEL_TABLES = [
  [0xff, 0xd8, 0xff, 0xdb, 0x00, 0x03, 0x00, 0xff, 0xd9],
  [0xff, 0xd8, 0xff, 0xdb, 0x00, 0x03, 0x01, 0xff, 0xd9],
] as const

function jpegTile(level: number, tileIndex: number): number[] {
  return [0xff, 0xd8, level, tileIndex, 0xff, 0xd9]
}

// A 64 x 64 slide in 32-pixel JPEG tiles (the second one left out), a
// thumbnail, a 32 x 32 level, a level with another tile size, the label, and
// the macro, as Aperio orders them.
function svsImages(): readonly TestTiffImage[] {
  const jpegLevel = (
    level: number,
    width: number,
    height: number,
    tile: number,
    description: string,
  ): TestTiffImage => ({
    width,
    height,
    tile,
    subfileType: 0,
    description,
    samplesPerPixel: 3,
    bitsPerSample: 8,
    compression: 7,
    photometric: 2,
    jpegTables: LEVEL_TABLES[level] ?? [],
    value: () => 0,
    tileBytes: (tileIndex) =>
      level === 0 && tileIndex === 1 ? [] : jpegTile(level, tileIndex),
  })
  const stripped = (
    width: number,
    height: number,
    subfileType: number,
    description: string,
    seed: number,
  ): TestTiffImage => ({
    width,
    height,
    subfileType,
    description: `Aperio Image Library v12.0.15 \n${description}`,
    samplesPerPixel: 3,
    bitsPerSample: 8,
    value: () => 0,
    tileBytes: () => Array.from(stripPixels(width, height, seed)),
  })

  return [
    jpegLevel(0, 64, 64, 32, APERIO_DESCRIPTION),
    stripped(8, 8, 0, '64x64 -> 8x8 - |AppMag = 20|MPP = 0.4990', THUMBNAIL_SEED),
    jpegLevel(
      1,
      32,
      32,
      32,
      'Aperio Image Library v12.0.15 \n64x64 -> 32x32 JPEG/RGB Q=70',
    ),
    jpegLevel(
      1,
      16,
      16,
      16,
      'Aperio Image Library v12.0.15 \n64x64 -> 16x16 JPEG/RGB Q=70',
    ),
    stripped(8, 8, 1, 'label 8x8', 2),
    stripped(16, 8, 9, 'macro 16x8', MACRO_SEED),
  ]
}

// The macro IFD claims 65,535 entries, past the end of the file, so the
// open fails if the IFD walk goes past the label.
function svsFile(): Uint8Array {
  const { bytes, ifdOffsets } = buildTiffFile(svsImages())
  const macroIfd = ifdOffsets.at(-1) ?? 0

  bytes.set(u16(0xffff), macroIfd)
  return bytes
}
