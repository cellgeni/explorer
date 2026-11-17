import { defaultChannelColor } from './omeMetadata'
import type { TiffChannelInfo } from './omeMetadata'

// Aperio SVS, written by Aperio/Leica scanners and by others that copy the
// layout (Grundium). IFD 0 is the full-resolution image; the other tiled IFDs
// are the pyramid levels; stripped IFDs are associated images: a thumbnail
// after IFD 0, and the label and macro (slide overview) at the end. IFD 0's
// ImageDescription starts with "Aperio" and carries `key = value` properties
// separated by `|`, such as `MPP = 0.2520|AppMag = 20`. Aperio FL scanners
// write one SVS per fluorescence channel, 16-bit, whose properties name the
// channel (`Dye`, `DisplayColor`); an `.afi` file lists a scan's channel
// files. Their `Acquisition Bit Depth` (10) is the camera's: samples are
// scaled to the full 16 bits, so it does not bound the window.

const SVS_DESCRIPTION_PREFIX = 'Aperio'

export interface SvsDescription extends SvsChannelDescription {
  readonly micrometersPerPixel?: number
  readonly objectivePower?: number
}

// What an Aperio FL channel file says about its channel.
export interface SvsChannelDescription {
  readonly dye?: string
  // `DisplayColor`, a packed 0xRRGGBB integer.
  readonly displayColor?: readonly [number, number, number]
}

// The IFD fields that place an image in the SVS layout.
export interface SvsIfdSummary {
  readonly index: number
  readonly width: number
  readonly height: number
  readonly samplesPerPixel: number
  // Undefined for stripped IFDs.
  readonly tileWidth?: number
  readonly tileHeight?: number
}

export function isSvsUrl(url: string): boolean {
  return /\.svs(?:$|[?#])/i.test(url)
}

export function isSvsDescription(description: string | undefined): boolean {
  return description?.trimStart().startsWith(SVS_DESCRIPTION_PREFIX) === true
}

export function parseSvsDescription(description: string | undefined): SvsDescription {
  if (!isSvsDescription(description)) {
    return {}
  }

  const properties = svsProperties(description ?? '')
  const micrometersPerPixel = positiveNumber(properties.get('MPP'))
  const objectivePower = positiveNumber(properties.get('AppMag'))
  const dye = properties.get('Dye')
  const displayColor = packedRgb(properties.get('DisplayColor'))

  return {
    ...(micrometersPerPixel === undefined ? {} : { micrometersPerPixel }),
    ...(objectivePower === undefined ? {} : { objectivePower }),
    ...(dye === undefined || dye.length === 0 ? {} : { dye }),
    ...(displayColor === undefined ? {} : { displayColor }),
  }
}

// A stripped IFD flagged as reduced resolution (NewSubfileType bit 0) is the
// label (1) or macro (9). Aperio writes them after every pyramid level, so
// the IFD walk can stop there.
export function isSvsAssociatedImageAfterPyramid(ifd: {
  readonly tiled: boolean
  readonly subfileType: number
}): boolean {
  return !ifd.tiled && (ifd.subfileType & 1) === 1
}

export type SvsAssociatedImageName = 'thumbnail' | 'label' | 'macro'

const SVS_ASSOCIATED_IMAGE_NAMES: readonly SvsAssociatedImageName[] = [
  'thumbnail',
  'label',
  'macro',
]

// Names a stripped IFD as OpenSlide does: IFD 1 is the thumbnail; another
// is named by the first word of its description's second line ("label
// 387x463", "macro 1280x431"). Without that word, NewSubfileType decides:
// 1 for the label, 9 for the macro.
export function svsAssociatedImageName(ifd: {
  readonly index: number
  readonly tiled: boolean
  readonly subfileType: number
  readonly description?: string | undefined
}): SvsAssociatedImageName | undefined {
  if (ifd.tiled) {
    return undefined
  }

  if (ifd.index === 1) {
    return 'thumbnail'
  }

  const secondLine = ifd.description?.split(/\r?\n/)[1]?.trim() ?? ''
  const word = secondLine.split(/[\s|]/, 1)[0]?.toLowerCase()
  const named = SVS_ASSOCIATED_IMAGE_NAMES.find((name) => name === word)

  if (named !== undefined) {
    return named
  }

  return ifd.subfileType === 1 ? 'label' : ifd.subfileType === 9 ? 'macro' : undefined
}

// Every tiled IFD is a pyramid level, as OpenSlide reads SVS. The TIFF
// loader needs one tile size and sample count, and levels that shrink, so a
// tiled IFD that differs from IFD 0 in those is left out.
export function svsLayout(ifds: readonly SvsIfdSummary[]): readonly number[] {
  const first = ifds[0]

  if (first?.tileWidth === undefined || first.tileHeight === undefined) {
    return []
  }

  const levels = [first.index]
  let previousWidth = first.width

  for (const ifd of ifds.slice(1)) {
    if (
      ifd.tileWidth !== first.tileWidth ||
      ifd.tileHeight !== first.tileHeight ||
      ifd.samplesPerPixel !== first.samplesPerPixel ||
      ifd.width >= previousWidth
    ) {
      continue
    }

    levels.push(ifd.index)
    previousWidth = ifd.width
  }

  return levels
}

// Brightfield slides are RGB, drawn as stored. A single-sample slide gets
// one channel with the full window of its bit depth; a fluorescence channel
// file names its dye and colour.
export function svsChannelInfo(
  samplesPerPixel: number,
  bitsPerSample: number | undefined,
  channelName?: string,
  channel: SvsChannelDescription = {},
): TiffChannelInfo {
  if (samplesPerPixel >= 3) {
    return {
      id: 'Channel:0',
      index: 0,
      name: 'RGB',
      color: [255, 255, 255],
      contrast: { min: 0, max: 255 },
      ifdIndex: 0,
      samplesPerPixel,
      alphaFromIntensity: false,
    }
  }

  const name = channelName ?? channel.dye ?? 'Channel 1'
  const bits = Math.min(16, Math.max(8, bitsPerSample ?? 8))

  return {
    id: 'Channel:0',
    index: 0,
    name,
    color: channel.displayColor ?? defaultChannelColor({ index: 0, name }),
    // 12-bit samples (MERSCOPE) end at 4095.
    contrast: { min: 0, max: 2 ** bits - 1 },
    ifdIndex: 0,
  }
}

// Properties are the `|`-separated fields after the first, as `key = value`
// with any spacing around `=`.
function svsProperties(description: string): ReadonlyMap<string, string> {
  const properties = new Map<string, string>()

  for (const field of description.split('|').slice(1)) {
    const separator = field.indexOf('=')

    if (separator < 0) {
      continue
    }

    const key = field.slice(0, separator).trim()

    if (key.length > 0 && !properties.has(key)) {
      properties.set(key, field.slice(separator + 1).trim())
    }
  }

  return properties
}

function packedRgb(value: string | undefined): [number, number, number] | undefined {
  const packed = value === undefined || value.length === 0 ? NaN : Number(value)

  return Number.isInteger(packed) && packed >= 0 && packed <= 0xff_ffff
    ? [(packed >> 16) & 0xff, (packed >> 8) & 0xff, packed & 0xff]
    : undefined
}

function positiveNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.length === 0) {
    return undefined
  }

  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}
