export interface TiffChannelContrast {
  readonly min: number
  readonly max: number
}

export interface TiffChannelInfo {
  readonly id: string
  readonly index: number
  readonly name: string
  readonly color: readonly [number, number, number]
  readonly contrast: TiffChannelContrast
  readonly fileName?: string
  readonly purpose?: string
}

export interface OmeTiffMetadata {
  readonly micrometersPerPixel: number
  readonly channels: readonly TiffChannelInfo[]
}

const DEFAULT_MICROMETERS_PER_PIXEL = 0.2125
const DEFAULT_CHANNEL_COLORS: readonly (readonly [number, number, number])[] = [
  [88, 144, 255],
  [32, 166, 122],
  [240, 200, 75],
  [215, 63, 124],
  [255, 253, 247],
]

export function parseOmeTiffMetadata(description: string | undefined): OmeTiffMetadata {
  const xml = description?.replace(/\0/g, '').trim()

  if (xml === undefined || xml.length === 0) {
    return {
      micrometersPerPixel: DEFAULT_MICROMETERS_PER_PIXEL,
      channels: [],
    }
  }

  const document = parseXml(xml)

  if (document === null) {
    return {
      micrometersPerPixel: parsePhysicalSizeMicrometersPerPixel(description),
      channels: [],
    }
  }

  const pixels = firstElement(document, 'Pixels')

  if (pixels === null) {
    return {
      micrometersPerPixel: parsePhysicalSizeMicrometersPerPixel(description),
      channels: [],
    }
  }

  const contrast = contrastForPixelType(pixels.getAttribute('Type'))
  const purposes = readAnnotationPurposes(document)
  const fileNamesByChannel = readChannelFileNames(pixels)
  const channels = elements(pixels, 'Channel').map((channel, index) => {
    const channelIndex = readChannelIndex(channel, index)
    const purpose = readChannelPurpose(channel, purposes)
    const name =
      readOptionalAttribute(channel, 'Name') ?? purpose ?? `Channel ${channelIndex + 1}`
    const fileName = fileNamesByChannel.get(channelIndex)
    const color =
      parseOmeColor(channel.getAttribute('Color')) ??
      defaultChannelColor({
        index: channelIndex,
        name,
        ...(purpose === undefined ? {} : { purpose }),
      })

    return {
      id: readOptionalAttribute(channel, 'ID') ?? `Channel:${channelIndex}`,
      index: channelIndex,
      name,
      color,
      contrast,
      ...(fileName === undefined ? {} : { fileName }),
      ...(purpose === undefined ? {} : { purpose }),
    }
  })

  return {
    micrometersPerPixel: parsePhysicalSizeMicrometersPerPixel(description),
    channels,
  }
}

export function parsePhysicalSizeMicrometersPerPixel(
  description: string | undefined,
): number {
  if (description === undefined) {
    return DEFAULT_MICROMETERS_PER_PIXEL
  }

  const match = description.match(/PhysicalSizeX="([^"]+)"/)
  const value = match?.[1] === undefined ? Number.NaN : Number.parseFloat(match[1])

  return value > 0 ? value : DEFAULT_MICROMETERS_PER_PIXEL
}

function parseXml(xml: string): Document | null {
  if (typeof DOMParser === 'undefined') {
    return null
  }

  const document = new DOMParser().parseFromString(xml, 'application/xml')

  if (firstElement(document, 'parsererror') !== null) {
    return null
  }

  return document
}

function readAnnotationPurposes(document: Document): ReadonlyMap<string, string> {
  const purposes = new Map<string, string>()

  for (const annotation of elements(document, 'MapAnnotation')) {
    const id = readOptionalAttribute(annotation, 'ID')

    if (id === undefined) {
      continue
    }

    for (const entry of elements(annotation, 'M')) {
      if (entry.getAttribute('K') !== 'Purpose') {
        continue
      }

      const purpose = entry.textContent?.trim()

      if (purpose !== undefined && purpose.length > 0) {
        purposes.set(id, purpose)
      }
    }
  }

  return purposes
}

function readChannelPurpose(
  channel: Element,
  purposes: ReadonlyMap<string, string>,
): string | undefined {
  for (const ref of elements(channel, 'AnnotationRef')) {
    const id = readOptionalAttribute(ref, 'ID')

    if (id === undefined) {
      continue
    }

    const purpose = purposes.get(id)

    if (purpose !== undefined) {
      return purpose
    }
  }

  return undefined
}

function readChannelFileNames(pixels: Element): ReadonlyMap<number, string> {
  const fileNames = new Map<number, string>()

  for (const tiffData of elements(pixels, 'TiffData')) {
    const firstC = readIntegerAttribute(tiffData, 'FirstC')

    if (firstC === undefined) {
      continue
    }

    const uuid = firstElement(tiffData, 'UUID')
    const fileName = uuid?.getAttribute('FileName')?.trim()

    if (fileName !== undefined && fileName.length > 0) {
      fileNames.set(firstC, fileName)
    }
  }

  return fileNames
}

function readChannelIndex(channel: Element, fallback: number): number {
  const id = channel.getAttribute('ID')
  const indexFromId = id?.match(/(?:^|:)(\d+)$/)?.[1]
  const parsed = indexFromId === undefined ? Number.NaN : Number(indexFromId)

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

function contrastForPixelType(type: string | null): TiffChannelContrast {
  switch (type) {
    case 'uint8':
      return { min: 0, max: 255 }
    case 'uint16':
      return { min: 0, max: 65_535 }
    case 'uint32':
      return { min: 0, max: 4_294_967_295 }
    case 'int8':
      return { min: -128, max: 127 }
    case 'int16':
      return { min: -32_768, max: 32_767 }
    case 'int32':
      return { min: -2_147_483_648, max: 2_147_483_647 }
    case 'float':
    case 'double':
      return { min: 0, max: 1 }
    default:
      return { min: 0, max: 65_535 }
  }
}

function parseOmeColor(color: string | null): readonly [number, number, number] | null {
  if (color === null || color.trim().length === 0) {
    return null
  }

  const numeric = Number(color)

  if (!Number.isFinite(numeric)) {
    return null
  }

  const unsigned = numeric >>> 0

  return [(unsigned >> 16) & 0xff, (unsigned >> 8) & 0xff, unsigned & 0xff]
}

function defaultChannelColor(options: {
  readonly index: number
  readonly name: string
  readonly purpose?: string
}): readonly [number, number, number] {
  const label = `${options.name} ${options.purpose ?? ''}`.toLowerCase()

  if (label.includes('dapi') || label.includes('nuclear')) {
    return [88, 144, 255]
  }

  if (label.includes('boundary') || label.includes('cadherin')) {
    return [32, 166, 122]
  }

  if (label.includes('rna') || label.includes('18s')) {
    return [240, 200, 75]
  }

  if (label.includes('protein') || label.includes('vimentin')) {
    return [215, 63, 124]
  }

  return (
    DEFAULT_CHANNEL_COLORS[options.index % DEFAULT_CHANNEL_COLORS.length] ?? [
      255, 253, 247,
    ]
  )
}

function firstElement(parent: Document | Element, localName: string): Element | null {
  return elements(parent, localName)[0] ?? null
}

function elements(parent: Document | Element, localName: string): readonly Element[] {
  return Array.from(parent.getElementsByTagNameNS('*', localName))
}

function readOptionalAttribute(element: Element, name: string): string | undefined {
  const value = element.getAttribute(name)?.trim()
  return value === undefined || value.length === 0 ? undefined : value
}

function readIntegerAttribute(element: Element, name: string): number | undefined {
  const value = element.getAttribute(name)
  const parsed = value === null ? Number.NaN : Number(value)

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}
