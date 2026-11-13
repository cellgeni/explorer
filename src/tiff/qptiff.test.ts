import { afterEach, describe, expect, it, vi } from 'vitest'
import { openTiff, tiffImageSelectionUrl } from './loader'
import {
  isQptiffDescription,
  isQptiffUrl,
  parseQptiffDescription,
  qptiffChannelInfos,
  qptiffLayout,
  qptiffMicrometersPerPixel,
} from './qptiff'
import type { QptiffIfdSummary } from './qptiff'
import { buildTiff, stubRangeFetch } from '../test/tiffFixtures'
import type { TestTiffImage } from '../test/tiffFixtures'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('QPTIFF detection', () => {
  it('recognizes QPTIFF file names', () => {
    expect(isQptiffUrl('https://example.test/scan.qptiff')).toBe(true)
    expect(isQptiffUrl('https://example.test/Scan1.er.qptiff?token=1')).toBe(true)
    expect(isQptiffUrl('https://example.test/scan.QPTIF#ifd=3')).toBe(true)
    expect(isQptiffUrl('https://example.test/scan.ome.tiff')).toBe(false)
    expect(isQptiffUrl('https://example.test/scan.qptiff/metadata.json')).toBe(false)
  })

  it('recognizes PerkinElmer image descriptions', () => {
    expect(isQptiffDescription(qpiDescription({ imageType: 'FullResolution' }))).toBe(
      true,
    )
    expect(isQptiffDescription('<OME><Image/></OME>')).toBe(false)
    expect(isQptiffDescription(undefined)).toBe(false)
  })
})

describe('parseQptiffDescription', () => {
  it('reads the top-level image type, name, biomarker, and colour', () => {
    expect(
      parseQptiffDescription(
        qpiDescription({
          imageType: 'FullResolution',
          name: 'ATTO 550',
          biomarker: 'Keratin 8/18 &amp; 19',
          color: '255,128,0',
        }),
      ),
    ).toEqual({
      imageType: 'FullResolution',
      name: 'ATTO 550',
      biomarker: 'Keratin 8/18 & 19',
      color: [255, 128, 0],
    })
  })

  it('leaves out missing fields and colours it cannot read', () => {
    expect(
      parseQptiffDescription(qpiDescription({ imageType: 'Thumbnail', color: 'red' })),
    ).toEqual({ imageType: 'Thumbnail' })
    expect(parseQptiffDescription('<OME/>')).toEqual({})
  })
})

describe('qptiffLayout', () => {
  it('groups channels and reduced levels the TIFF loader can read', () => {
    const ifds = [
      summary(0, 1000, 800, 'FullResolution'),
      summary(1, 1000, 800, 'FullResolution'),
      summary(2, 50, 40, 'Thumbnail', { tiled: false }),
      summary(3, 500, 400, 'ReducedResolution'),
      summary(4, 500, 400, 'ReducedResolution'),
      // Only one IFD for two channels.
      summary(5, 300, 240, 'ReducedResolution'),
      summary(6, 250, 200, 'ReducedResolution'),
      summary(7, 250, 200, 'ReducedResolution'),
      // Stripped.
      summary(8, 125, 100, 'ReducedResolution', { tiled: false }),
      summary(9, 125, 100, 'ReducedResolution', { tiled: false }),
      summary(10, 400, 300, 'Overview', { tiled: false }),
      summary(11, 200, 100, 'Label', { tiled: false }),
    ]

    expect(qptiffLayout(ifds).levels).toEqual([
      [0, 1],
      [3, 4],
      [6, 7],
    ])
  })

  it('uses NewSubfileType when the IFDs have no QPI description', () => {
    const ifds = [
      summary(0, 1000, 800),
      summary(1, 1000, 800),
      summary(2, 500, 400, undefined, { reduced: true }),
      summary(3, 500, 400, undefined, { reduced: true }),
    ]

    expect(qptiffLayout(ifds).levels).toEqual([
      [0, 1],
      [2, 3],
    ])
  })
})

describe('qptiffChannelInfos', () => {
  it('names channels by biomarker, falling back to the fluorophore', () => {
    const channels = qptiffChannelInfos(
      [
        summary(0, 10, 10, 'FullResolution', {
          name: 'DAPI',
          biomarker: 'DAPI',
          color: [0, 0, 255],
        }),
        summary(1, 10, 10, 'FullResolution', { name: 'Cy5', biomarker: '--' }),
        summary(2, 10, 10, 'FullResolution', { name: 'Cy5' }),
        summary(3, 10, 10, 'FullResolution'),
      ],
      16,
    )

    expect(channels.map((channel) => channel.name)).toEqual([
      'DAPI',
      'Cy5',
      'Cy5 (2)',
      'Channel 4',
    ])
    expect(channels[0]).toMatchObject({
      id: 'Channel:0',
      index: 0,
      ifdIndex: 0,
      color: [0, 0, 255],
      contrast: { min: 0, max: 65_535 },
    })
    expect(channels[3]?.ifdIndex).toBe(3)
  })

  it('treats a three-sample image as native RGB', () => {
    const [channel] = qptiffChannelInfos(
      [summary(0, 10, 10, 'FullResolution', { samplesPerPixel: 3 })],
      8,
    )

    expect(channel).toMatchObject({
      name: 'RGB',
      color: [255, 255, 255],
      contrast: { min: 0, max: 255 },
      samplesPerPixel: 3,
      alphaFromIntensity: false,
    })
  })
})

describe('qptiffMicrometersPerPixel', () => {
  it('converts pixels per centimetre or inch', () => {
    expect(qptiffMicrometersPerPixel(20_000, 3)).toBe(0.5)
    expect(qptiffMicrometersPerPixel(50_800, 2)).toBe(0.5)
  })

  it('falls back to the TIFF default without a usable resolution', () => {
    expect(qptiffMicrometersPerPixel(20_000, 1)).toBe(0.2125)
    expect(qptiffMicrometersPerPixel(undefined, 3)).toBe(0.2125)
    expect(qptiffMicrometersPerPixel(0, 3)).toBe(0.2125)
  })
})

describe('openTiff with a QPTIFF', () => {
  it('opens each channel with its reduced-resolution IFDs as pyramid levels', async () => {
    const url = 'https://example.test/levels/scan.qptiff'
    const file = buildTiff(qptiffImages())
    const fetcher = stubRangeFetch(url, file)

    const loader = await openTiff(url)

    expect(loader.imageWidth).toBe(64)
    expect(loader.imageHeight).toBe(32)
    expect(loader.tileWidth).toBe(32)
    expect(loader.numLevels).toBe(2)
    expect(loader.units.micrometersPerPixel).toBe(0.5)
    expect(loader.channels.map((channel) => channel.name)).toEqual(['DAPI', 'CD4'])
    expect(loader.channels[1]).toMatchObject({ ifdIndex: 1, color: [0, 255, 255] })
    expect(loader.tilesForLevel(0)).toHaveLength(2)
    expect(loader.tilesForLevel(1)).toHaveLength(1)
    expect(loader.tileDecodeOptions()).toMatchObject({
      compression: 1,
      bitsPerSample: [16],
    })
    expect(tileValue(await loader.fetchTileBytes(0, 1, 0))).toBe(101)
    expect(tileValue(await loader.fetchTileBytes(1, 0, 0))).toBe(110)

    const requestsBeforeChannel = fetcher.mock.calls.length
    const cd4 = await openTiff(tiffImageSelectionUrl(url, 1))

    // The IFD chain is read once per file.
    expect(fetcher.mock.calls.length).toBe(requestsBeforeChannel)
    expect(tileValue(await cd4.fetchTileBytes(0, 0, 0))).toBe(200)
    expect(tileValue(await cd4.fetchTileBytes(1, 0, 0))).toBe(210)
  })

  it('opens a QPTIFF saved under a .tif name', async () => {
    const url = 'https://example.test/renamed/scan.tif'
    stubRangeFetch(url, buildTiff(qptiffImages()))

    const loader = await openTiff(url)

    expect(loader.numLevels).toBe(2)
    expect(loader.channels.map((channel) => channel.name)).toEqual(['DAPI', 'CD4'])
  })

  it('rejects an IFD that is not a channel', async () => {
    const url = 'https://example.test/selection/scan.qptiff'
    stubRangeFetch(url, buildTiff(qptiffImages()))

    await expect(openTiff(tiffImageSelectionUrl(url, 2))).rejects.toThrow(
      'IFD 2 is not a full-resolution channel of the QPTIFF.',
    )
  })

  it('reports a sidecar named for a QPTIFF as unused', async () => {
    const url = 'https://example.test/sidecar/scan.qptiff'
    stubRangeFetch(url, buildTiff(qptiffImages()))
    const onFallback = vi.fn()

    await openTiff(url, undefined, onFallback, {
      zchunkStoreUrl: 'https://example.test/sidecar/scan.zchunkstore',
    })

    expect(onFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        coalesceKey: 'zchunkstore-qptiff:https://example.test/sidecar/scan.zchunkstore',
      }),
    )
  })
})

function summary(
  index: number,
  width: number,
  height: number,
  imageType?: string,
  options: {
    readonly tiled?: boolean
    readonly reduced?: boolean
    readonly samplesPerPixel?: number
    readonly name?: string
    readonly biomarker?: string
    readonly color?: readonly [number, number, number]
  } = {},
): QptiffIfdSummary {
  return {
    index,
    width,
    height,
    samplesPerPixel: options.samplesPerPixel ?? 1,
    ...(options.tiled === false ? {} : { tileWidth: 256, tileHeight: 256 }),
    reducedResolution: options.reduced ?? imageType === 'ReducedResolution',
    description: {
      ...(imageType === undefined ? {} : { imageType }),
      ...(options.name === undefined ? {} : { name: options.name }),
      ...(options.biomarker === undefined ? {} : { biomarker: options.biomarker }),
      ...(options.color === undefined ? {} : { color: options.color }),
    },
  }
}

// A filter <Name> nested before the channel's own <Name>, as Akoya writes
// filter details around it.
function qpiDescription(fields: {
  readonly imageType: string
  readonly name?: string
  readonly biomarker?: string
  readonly color?: string
}): string {
  return [
    '<?xml version="1.0" encoding="utf-16"?>',
    '<PerkinElmer-QPI-ImageDescription>',
    '<DescriptionVersion>6</DescriptionVersion>',
    `<ImageType>${fields.imageType}</ImageType>`,
    '<Barcode />',
    '<ExcitationFilter><Name>DAPI / ATTO550</Name></ExcitationFilter>',
    fields.name === undefined ? '' : `<Name>${fields.name}</Name>`,
    fields.color === undefined ? '' : `<Color>${fields.color}</Color>`,
    fields.biomarker === undefined ? '' : `<Biomarker>${fields.biomarker}</Biomarker>`,
    '</PerkinElmer-QPI-ImageDescription>',
  ].join('\n')
}

// Two 64 x 32 channels with 32-pixel tiles, a thumbnail, one 32 x 16
// reduced level, a stripped 16 x 8 reduced level, and an overview. Tile
// samples encode channel, level, and tile: 100 * (channel + 1) + 10 * level
// + tile.
function qptiffImages(): readonly TestTiffImage[] {
  const channel = (
    index: number,
    level: number,
    width: number,
    height: number,
    tile: number | undefined,
    name: string,
    biomarker: string,
    color: string,
  ): TestTiffImage => ({
    width,
    height,
    ...(tile === undefined ? {} : { tile }),
    subfileType: level === 0 ? 0 : 1,
    description: qpiDescription({
      imageType: level === 0 ? 'FullResolution' : 'ReducedResolution',
      name,
      biomarker,
      color,
    }),
    value: (tileIndex) => 100 * (index + 1) + 10 * level + tileIndex,
  })

  return [
    channel(0, 0, 64, 32, 32, 'DAPI', 'DAPI', '0,0,255'),
    channel(1, 0, 64, 32, 32, 'Cy5', 'CD4', '0,255,255'),
    {
      width: 8,
      height: 4,
      subfileType: 0,
      samplesPerPixel: 3,
      description: qpiDescription({ imageType: 'Thumbnail' }),
      value: () => 0,
    },
    channel(0, 1, 32, 16, 32, 'DAPI', 'DAPI', '0,0,255'),
    channel(1, 1, 32, 16, 32, 'Cy5', 'CD4', '0,255,255'),
    channel(0, 2, 16, 8, undefined, 'DAPI', 'DAPI', '0,0,255'),
    channel(1, 2, 16, 8, undefined, 'Cy5', 'CD4', '0,255,255'),
    {
      width: 8,
      height: 4,
      subfileType: 0,
      samplesPerPixel: 3,
      description: qpiDescription({ imageType: 'Overview' }),
      value: () => 0,
    },
  ]
}

function tileValue(bytes: Uint8Array): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(0, true)
}
