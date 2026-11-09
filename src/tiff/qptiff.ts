import { defaultChannelColor, DEFAULT_MICROMETERS_PER_PIXEL } from './omeMetadata'
import type { TiffChannelInfo } from './omeMetadata'

// Akoya (PerkinElmer) QPTIFF, written by PhenoCycler, PhenoImager, and Vectra
// scanners. Every image is a top-level IFD: one full-resolution IFD per
// channel, a thumbnail, then each pyramid level as one reduced-resolution IFD
// per channel, then the slide overview and label. Each IFD's ImageDescription
// is a PerkinElmer-QPI-ImageDescription XML naming the image type and, for
// channel images, the fluorophore, biomarker, and display colour.

const QPI_ROOT_ELEMENT = 'PerkinElmer-QPI-ImageDescription'

// Biomarker text that names no marker, as in Akoya's blank cycles.
const PLACEHOLDER_BIOMARKERS = new Set(['', '--', 'none'])

export interface QptiffDescription {
  readonly imageType?: string
  readonly name?: string
  readonly biomarker?: string
  readonly color?: readonly [number, number, number]
}

// The IFD fields that place an image in the QPTIFF layout.
export interface QptiffIfdSummary {
  readonly index: number
  readonly width: number
  readonly height: number
  readonly samplesPerPixel: number
  // Undefined for stripped IFDs.
  readonly tileWidth?: number
  readonly tileHeight?: number
  // NewSubfileType bit 0.
  readonly reducedResolution: boolean
  readonly description: QptiffDescription
}

export interface QptiffLayout {
  // levels[level][channel] is the IFD index of that channel at that level.
  // Level 0 is full resolution; each later level is smaller.
  readonly levels: readonly (readonly number[])[]
}

export function isQptiffUrl(url: string): boolean {
  return /\.qptiff?(?:$|[?#])/i.test(url)
}

export function isQptiffDescription(description: string | undefined): boolean {
  return description?.includes(`<${QPI_ROOT_ELEMENT}`) === true
}

export function parseQptiffDescription(
  description: string | undefined,
): QptiffDescription {
  if (!isQptiffDescription(description)) {
    return {}
  }

  const fields = topLevelElementText(description ?? '')
  const imageType = nonEmpty(fields.get('ImageType'))
  const name = nonEmpty(fields.get('Name'))
  const biomarker = nonEmpty(fields.get('Biomarker'))
  const color = parseQptiffColor(fields.get('Color'))

  return {
    ...(imageType === undefined ? {} : { imageType }),
    ...(name === undefined ? {} : { name }),
    ...(biomarker === undefined ? {} : { biomarker }),
    ...(color === undefined ? {} : { color }),
  }
}

// Channels are the leading run of IFDs shaped like the first; each pyramid
// level is a later run of reduced-resolution IFDs with one IFD per channel,
// the same layout tifffile reads. Levels the TIFF loader cannot use (stripped,
// another tile size, or the wrong IFD count) are left out.
export function qptiffLayout(ifds: readonly QptiffIfdSummary[]): QptiffLayout {
  const first = ifds[0]

  if (first === undefined) {
    return { levels: [] }
  }

  const channels: QptiffIfdSummary[] = []

  for (const ifd of ifds) {
    if (!isFullResolutionChannel(ifd, first)) {
      break
    }

    channels.push(ifd)
  }

  const levels: (readonly number[])[] = [channels.map((ifd) => ifd.index)]
  let previousWidth = first.width

  for (const group of consecutiveSameShape(
    ifds.slice(channels.length).filter(isReducedResolution),
  )) {
    const groupFirst = group[0]

    if (
      groupFirst === undefined ||
      group.length !== channels.length ||
      groupFirst.width >= previousWidth ||
      groupFirst.tileWidth !== first.tileWidth ||
      groupFirst.tileHeight !== first.tileHeight
    ) {
      continue
    }

    levels.push(group.map((ifd) => ifd.index))
    previousWidth = groupFirst.width
  }

  return { levels }
}

export function qptiffChannelInfos(
  channels: readonly QptiffIfdSummary[],
  bitsPerSample: number | undefined,
): readonly TiffChannelInfo[] {
  const nameCounts = new Map<string, number>()
  const contrast = { min: 0, max: (bitsPerSample ?? 16) <= 8 ? 255 : 65_535 }

  return channels.map((ifd, index) => {
    const isRgb = ifd.samplesPerPixel >= 3
    const baseName =
      qptiffChannelName(ifd.description) ?? (isRgb ? 'RGB' : `Channel ${index + 1}`)
    const count = (nameCounts.get(baseName) ?? 0) + 1
    nameCounts.set(baseName, count)
    const name = count === 1 ? baseName : `${baseName} (${count})`

    return {
      id: `Channel:${index}`,
      index,
      name,
      color: isRgb
        ? ([255, 255, 255] as const)
        : (ifd.description.color ?? defaultChannelColor({ index, name })),
      contrast,
      ifdIndex: ifd.index,
      ...(isRgb
        ? { samplesPerPixel: ifd.samplesPerPixel, alphaFromIntensity: false }
        : {}),
    }
  })
}

// µm per pixel from the TIFF XResolution (pixels per ResolutionUnit), which
// is where QPTIFF stores the pixel size.
export function qptiffMicrometersPerPixel(
  xResolution: number | undefined,
  resolutionUnit: number | undefined,
): number {
  const micrometersPerUnit =
    resolutionUnit === 2 ? 25_400 : resolutionUnit === 3 ? 10_000 : undefined

  if (
    micrometersPerUnit === undefined ||
    xResolution === undefined ||
    !(xResolution > 0)
  ) {
    return DEFAULT_MICROMETERS_PER_PIXEL
  }

  const micrometersPerPixel = micrometersPerUnit / xResolution

  return Number.isFinite(micrometersPerPixel)
    ? micrometersPerPixel
    : DEFAULT_MICROMETERS_PER_PIXEL
}

function qptiffChannelName(description: QptiffDescription): string | undefined {
  const biomarker = description.biomarker

  if (
    biomarker !== undefined &&
    !PLACEHOLDER_BIOMARKERS.has(biomarker.trim().toLowerCase())
  ) {
    return biomarker
  }

  return description.name
}

function isFullResolutionChannel(
  ifd: QptiffIfdSummary,
  first: QptiffIfdSummary,
): boolean {
  const imageType = ifd.description.imageType

  return (
    (imageType === undefined ? !ifd.reducedResolution : imageType === 'FullResolution') &&
    ifd.width === first.width &&
    ifd.height === first.height &&
    ifd.samplesPerPixel === first.samplesPerPixel
  )
}

function isReducedResolution(ifd: QptiffIfdSummary): boolean {
  const imageType = ifd.description.imageType

  return imageType === undefined
    ? ifd.reducedResolution
    : imageType === 'ReducedResolution'
}

function consecutiveSameShape(
  ifds: readonly QptiffIfdSummary[],
): readonly (readonly QptiffIfdSummary[])[] {
  const groups: QptiffIfdSummary[][] = []

  for (const ifd of ifds) {
    const group = groups.at(-1)
    const groupFirst = group?.[0]

    if (
      group !== undefined &&
      groupFirst !== undefined &&
      groupFirst.width === ifd.width &&
      groupFirst.height === ifd.height
    ) {
      group.push(ifd)
    } else {
      groups.push([ifd])
    }
  }

  return groups
}

// Text of each direct child of the root element, first occurrence only.
// Nested elements such as the filter <Name>s are skipped.
function topLevelElementText(xml: string): ReadonlyMap<string, string> {
  const fields = new Map<string, string>()
  const tagPattern = /<(\/?)([A-Za-z_][\w.:-]*)[^>]*?(\/?)>/g
  let depth = 0
  let fieldName: string | undefined
  let fieldStart = 0

  for (const match of xml.matchAll(tagPattern)) {
    const [tag, closing, name, selfClosing] = match

    if (name === undefined) {
      continue
    }

    if (closing === '/') {
      depth -= 1

      if (depth === 1 && name === fieldName && !fields.has(name)) {
        fields.set(name, decodeXmlText(xml.slice(fieldStart, match.index).trim()))
      }

      continue
    }

    if (selfClosing === '/') {
      continue
    }

    depth += 1

    if (depth === 2) {
      fieldName = name
      fieldStart = match.index + tag.length
    }
  }

  return fields
}

function decodeXmlText(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function parseQptiffColor(
  value: string | undefined,
): readonly [number, number, number] | undefined {
  const parts = value?.split(',').map((part) => Number(part.trim()))

  if (
    parts?.length !== 3 ||
    !parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    return undefined
  }

  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}
