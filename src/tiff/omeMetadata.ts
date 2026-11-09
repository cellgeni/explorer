export interface TiffChannelContrast {
  readonly min: number
  readonly max: number
}

// Where one image plane is stored: an IFD of this file, or of `fileName` in a
// multi-file OME-TIFF.
export interface TiffPlaneRef {
  readonly ifdIndex: number
  readonly fileName?: string
}

export interface TiffChannelInfo {
  readonly id: string
  readonly index: number
  readonly name: string
  readonly color: readonly [number, number, number]
  readonly contrast: TiffChannelContrast
  readonly samplesPerPixel?: number
  readonly fileName?: string
  readonly ifdIndex?: number
  // The channel's plane at each z (t = 0), indexed by z. Only set for z-stacks.
  readonly zPlanes?: readonly TiffPlaneRef[]
  readonly alphaFromIntensity?: boolean
  readonly purpose?: string
}

export interface OmeTiffZStack {
  readonly sizeZ: number
  readonly micrometersPerPlane?: number
}

export interface OmeTiffMetadata {
  readonly micrometersPerPixel: number
  readonly channels: readonly TiffChannelInfo[]
  // Set when SizeZ > 1 and every channel's z planes are located.
  readonly zStack?: OmeTiffZStack
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
  const tiffDataByChannel = readChannelTiffData(pixels)
  const channelElements = elements(pixels, 'Channel')
  const zPlanesForChannel = readChannelZPlanes(pixels, channelElements.length)
  const channels = channelElements.map((channel, index) => {
    const channelIndex = readChannelIndex(channel, index)
    const purpose = readChannelPurpose(channel, purposes)
    const samplesPerPixel = readIntegerAttribute(channel, 'SamplesPerPixel') ?? 1
    const interleaved = pixels.getAttribute('Interleaved') === 'true'
    const isRgb = samplesPerPixel >= 3 || (interleaved && samplesPerPixel > 1)
    const name =
      readOptionalAttribute(channel, 'Name') ?? purpose ?? `Channel ${channelIndex + 1}`
    const zPlanes = zPlanesForChannel?.(channelIndex)
    // A z-stack channel's file and IFD are those of its first plane.
    const tiffData = zPlanes?.[0] ?? tiffDataByChannel.get(channelIndex)
    const color = isRgb
      ? ([255, 255, 255] as const)
      : (parseOmeColor(channel.getAttribute('Color')) ??
        defaultChannelColor({
          index: channelIndex,
          name,
          ...(purpose === undefined ? {} : { purpose }),
        }))

    return {
      id: readOptionalAttribute(channel, 'ID') ?? `Channel:${channelIndex}`,
      index: channelIndex,
      name,
      color,
      contrast,
      ...(samplesPerPixel > 1 ? { samplesPerPixel } : {}),
      ...(tiffData?.fileName === undefined ? {} : { fileName: tiffData.fileName }),
      ...(tiffData?.ifdIndex === undefined ? {} : { ifdIndex: tiffData.ifdIndex }),
      ...(zPlanes === undefined ? {} : { zPlanes }),
      ...(isRgb ? { alphaFromIntensity: false } : {}),
      ...(purpose === undefined ? {} : { purpose }),
    }
  })
  const sizeZ = readIntegerAttribute(pixels, 'SizeZ') ?? 1
  const micrometersPerPlane = readPhysicalSizeZMicrometers(pixels)
  const isZStack =
    sizeZ > 1 &&
    channels.length > 0 &&
    channels.every((channel) => channel.zPlanes !== undefined)

  return {
    micrometersPerPixel: parsePhysicalSizeMicrometersPerPixel(description),
    channels,
    ...(isZStack
      ? {
          zStack: {
            sizeZ,
            ...(micrometersPerPlane === undefined ? {} : { micrometersPerPlane }),
          },
        }
      : {}),
  }
}

export function parsePhysicalSizeMicrometersPerPixel(
  description: string | undefined,
): number {
  if (description === undefined) {
    return DEFAULT_MICROMETERS_PER_PIXEL
  }

  const rawValue = readXmlAttributeFromText(description, 'PhysicalSizeX')
  const value = rawValue === undefined ? Number.NaN : Number.parseFloat(rawValue)

  if (!(value > 0)) {
    return DEFAULT_MICROMETERS_PER_PIXEL
  }

  return micrometersPerPixelFromPhysicalSize(
    value,
    readXmlAttributeFromText(description, 'PhysicalSizeXUnit'),
  )
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

interface ChannelTiffData {
  readonly fileName?: string
  readonly ifdIndex?: number
}

function readChannelTiffData(pixels: Element): ReadonlyMap<number, ChannelTiffData> {
  const tiffDataByChannel = new Map<number, ChannelTiffData>()
  const sizeC = readIntegerAttribute(pixels, 'SizeC') ?? 1
  const sizeZ = readIntegerAttribute(pixels, 'SizeZ') ?? 1
  const sizeT = readIntegerAttribute(pixels, 'SizeT') ?? 1

  for (const tiffData of elements(pixels, 'TiffData')) {
    const firstC = readIntegerAttribute(tiffData, 'FirstC') ?? 0
    const firstIfd = readIntegerAttribute(tiffData, 'IFD')
    const planeCount = readIntegerAttribute(tiffData, 'PlaneCount') ?? 1
    const channelsInPlaneRun =
      sizeZ === 1 && sizeT === 1 ? Math.min(planeCount, sizeC - firstC) : 1
    const uuid = firstElement(tiffData, 'UUID')
    const fileName = uuid?.getAttribute('FileName')?.trim()

    if (channelsInPlaneRun <= 0) {
      continue
    }

    for (let offset = 0; offset < channelsInPlaneRun; offset += 1) {
      const channelIndex = firstC + offset
      const current = tiffDataByChannel.get(channelIndex)
      const next = {
        ...(current ?? {}),
        ...(fileName === undefined || fileName.length === 0 ? {} : { fileName }),
        ...(firstIfd === undefined ? {} : { ifdIndex: firstIfd + offset }),
      }

      if (Object.keys(next).length > 0) {
        tiffDataByChannel.set(channelIndex, next)
      }
    }
  }

  return tiffDataByChannel
}

type PlaneDimension = 'Z' | 'C' | 'T'

interface PlaneRun {
  readonly firstPlane: number
  readonly count: number
  readonly firstIfd: number
  readonly fileName?: string
}

const PLANE_DIMENSION_ORDERS: ReadonlyMap<string, readonly PlaneDimension[]> = new Map([
  ['XYZCT', ['Z', 'C', 'T']],
  ['XYZTC', ['Z', 'T', 'C']],
  ['XYCZT', ['C', 'Z', 'T']],
  ['XYCTZ', ['C', 'T', 'Z']],
  ['XYTZC', ['T', 'Z', 'C']],
  ['XYTCZ', ['T', 'C', 'Z']],
])

// Locates each channel's z planes at t = 0 following the OME-TIFF TiffData
// rules: planes are numbered in DimensionOrder (first letter after XY varies
// fastest); a TiffData stores `PlaneCount` planes from its FirstC/FirstZ/FirstT
// position in consecutive IFDs from `IFD` (default 0); `PlaneCount` defaults
// to 1 when `IFD` is given and to every remaining plane otherwise; with no
// TiffData at all, plane N is IFD N. Returns undefined for 2D images, and
// undefined for a channel with any plane not located.
function readChannelZPlanes(
  pixels: Element,
  channelCount: number,
): ((channelIndex: number) => readonly TiffPlaneRef[] | undefined) | undefined {
  const sizeZ = readIntegerAttribute(pixels, 'SizeZ') ?? 1

  if (sizeZ <= 1) {
    return undefined
  }

  // SizeC counts RGB samples; planes are counted per Channel element.
  const sizes: Readonly<Record<PlaneDimension, number>> = {
    Z: sizeZ,
    C: channelCount > 0 ? channelCount : (readIntegerAttribute(pixels, 'SizeC') ?? 1),
    T: readIntegerAttribute(pixels, 'SizeT') ?? 1,
  }
  const order =
    PLANE_DIMENSION_ORDERS.get(pixels.getAttribute('DimensionOrder')?.trim() ?? '') ??
    (['Z', 'C', 'T'] as const)
  const planeCount = sizes.Z * sizes.C * sizes.T
  const planeIndex = (position: Readonly<Record<PlaneDimension, number>>): number => {
    let index = 0
    let stride = 1

    for (const dimension of order) {
      index += position[dimension] * stride
      stride *= sizes[dimension]
    }

    return index
  }
  const tiffDataElements = elements(pixels, 'TiffData')
  // Each run stores `count` planes from `firstPlane` in consecutive IFDs.
  const runs: readonly PlaneRun[] =
    tiffDataElements.length === 0
      ? [{ firstPlane: 0, count: planeCount, firstIfd: 0 }]
      : tiffDataElements.flatMap((tiffData) => {
          const position = {
            Z: readIntegerAttribute(tiffData, 'FirstZ') ?? 0,
            C: readIntegerAttribute(tiffData, 'FirstC') ?? 0,
            T: readIntegerAttribute(tiffData, 'FirstT') ?? 0,
          }

          if (position.Z >= sizes.Z || position.C >= sizes.C || position.T >= sizes.T) {
            return []
          }

          const firstPlane = planeIndex(position)
          const firstIfd = readIntegerAttribute(tiffData, 'IFD')
          const fileName = firstElement(tiffData, 'UUID')
            ?.getAttribute('FileName')
            ?.trim()

          return [
            {
              firstPlane,
              count:
                readIntegerAttribute(tiffData, 'PlaneCount') ??
                (firstIfd === undefined ? planeCount - firstPlane : 1),
              firstIfd: firstIfd ?? 0,
              ...(fileName === undefined || fileName.length === 0 ? {} : { fileName }),
            },
          ]
        })
  const planeRef = (plane: number): TiffPlaneRef | undefined => {
    // A later TiffData wins where two overlap.
    const run = runs.findLast(
      (candidate) =>
        plane >= candidate.firstPlane && plane < candidate.firstPlane + candidate.count,
    )

    return run === undefined
      ? undefined
      : {
          ifdIndex: run.firstIfd + plane - run.firstPlane,
          ...(run.fileName === undefined ? {} : { fileName: run.fileName }),
        }
  }

  return (channelIndex) => {
    if (channelIndex >= sizes.C) {
      return undefined
    }

    const channelPlanes: TiffPlaneRef[] = []

    for (let z = 0; z < sizes.Z; z += 1) {
      const plane = planeRef(planeIndex({ Z: z, C: channelIndex, T: 0 }))

      if (plane === undefined) {
        return undefined
      }

      channelPlanes.push(plane)
    }

    return channelPlanes
  }
}

function readPhysicalSizeZMicrometers(pixels: Element): number | undefined {
  const value = Number.parseFloat(pixels.getAttribute('PhysicalSizeZ') ?? '')
  const micrometersPerUnit = micrometersPerUnitFor(
    normalizePhysicalSizeUnit(pixels.getAttribute('PhysicalSizeZUnit') ?? undefined),
  )

  return value > 0 && micrometersPerUnit !== undefined
    ? value * micrometersPerUnit
    : undefined
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

  // OME packs Color as a signed 32-bit RGBA integer, red in the high byte.
  const unsigned = numeric >>> 0

  return [(unsigned >>> 24) & 0xff, (unsigned >>> 16) & 0xff, (unsigned >>> 8) & 0xff]
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

function readXmlAttributeFromText(xml: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = xml.match(new RegExp(`${escapedName}=(["'])(.*?)\\1`))
  const value = match?.[2]?.trim()

  return value === undefined || value.length === 0 ? undefined : value
}

function micrometersPerPixelFromPhysicalSize(
  value: number,
  unit: string | undefined,
): number {
  const normalizedUnit = normalizePhysicalSizeUnit(unit)
  const micrometersPerUnit = micrometersPerUnitFor(normalizedUnit)

  if (micrometersPerUnit === undefined) {
    return value
  }

  if (looksLikePixelsPerUnit(value, normalizedUnit)) {
    return micrometersPerUnit / value
  }

  return value * micrometersPerUnit
}

function normalizePhysicalSizeUnit(unit: string | undefined): string | undefined {
  const normalized = unit
    ?.trim()
    .toLowerCase()
    .replace(/[\u03bc\u00b5]/g, 'u')

  if (normalized === undefined || normalized.length === 0) {
    return undefined
  }

  switch (normalized) {
    case 'um':
    case 'micrometer':
    case 'micrometers':
    case 'micrometre':
    case 'micrometres':
    case 'micron':
    case 'microns':
      return 'um'
    case 'nm':
    case 'nanometer':
    case 'nanometers':
    case 'nanometre':
    case 'nanometres':
      return 'nm'
    case 'mm':
    case 'millimeter':
    case 'millimeters':
    case 'millimetre':
    case 'millimetres':
      return 'mm'
    case 'cm':
    case 'centimeter':
    case 'centimeters':
    case 'centimetre':
    case 'centimetres':
      return 'cm'
    case 'm':
    case 'meter':
    case 'meters':
    case 'metre':
    case 'metres':
      return 'm'
    default:
      return normalized
  }
}

function micrometersPerUnitFor(unit: string | undefined): number | undefined {
  switch (unit) {
    case undefined:
    case 'um':
      return 1
    case 'nm':
      return 0.001
    case 'mm':
      return 1_000
    case 'cm':
      return 10_000
    case 'm':
      return 1_000_000
    default:
      return undefined
  }
}

function looksLikePixelsPerUnit(value: number, unit: string | undefined): boolean {
  switch (unit) {
    case 'cm':
      return value >= 1_000
    case 'mm':
      return value >= 100
    default:
      return false
  }
}
