// A segmentation imported onto an image: a label mask (TIFF or OME-Zarr) or
// polygon outlines (GeoJSON, WKT text, Parquet), from a URL or a picked file.

export const SEGMENTATION_FORMATS = [
  'label-tiff',
  'label-zarr',
  'geojson',
  'wkt',
  'parquet',
] as const

export type SegmentationFormat = (typeof SEGMENTATION_FORMATS)[number]

export function isSegmentationFormat(value: string): value is SegmentationFormat {
  return (SEGMENTATION_FORMATS as readonly string[]).includes(value)
}

// What polygon coordinates are in. Label masks are placed over the image
// whatever their size, so they take no units.
export type SegmentationCoordinates = 'pixels' | 'micrometers'

export interface SegmentationSource {
  // The file's URL, or a picked file's name.
  readonly url: string
  // A picked file, read in place of `url`.
  readonly file?: Blob
  readonly format: SegmentationFormat
  readonly coordinates: SegmentationCoordinates
}

export const SEGMENTATION_FORMAT_LABELS: Readonly<Record<SegmentationFormat, string>> = {
  'label-tiff': 'Label TIFF',
  'label-zarr': 'Label OME-Zarr',
  geojson: 'GeoJSON',
  wkt: 'WKT',
  parquet: 'Parquet',
}

// Extensions offered by the file picker.
export const SEGMENTATION_FILE_ACCEPT =
  '.tif,.tiff,.geojson,.json,.parquet,.geoparquet,.wkt,.csv,.tsv,.txt,.gz'

export function isLabelSegmentationFormat(format: SegmentationFormat): boolean {
  return format === 'label-tiff' || format === 'label-zarr'
}

// The format a URL names, or null. `.gz` text files are read inflated, so the
// extension before it counts.
export function segmentationFormatFromName(name: string): SegmentationFormat | null {
  return segmentationFormatFromPath(stripQueryAndHash(name))
}

// The format a picked file's name names: all of it is the name, `#`, `?` and
// `%` included.
export function segmentationFormatFromFileName(name: string): SegmentationFormat | null {
  return segmentationFormatFromPath(name)
}

function segmentationFormatFromPath(value: string): SegmentationFormat | null {
  const path = value.replace(/\/+$/, '').toLowerCase()
  const base = path.endsWith('.gz') ? path.slice(0, -3) : path

  if (/\.(?:ome\.)?tiff?$/.test(base)) {
    return path === base ? 'label-tiff' : null
  }

  if (/\.zarr$/.test(base) || /\/(?:zarr\.json|\.zattrs)$/.test(base)) {
    return path === base ? 'label-zarr' : null
  }

  if (/\.(?:geo)?json$/.test(base)) {
    return 'geojson'
  }

  if (/\.(?:geo)?parquet$|\.pq$/.test(base)) {
    return path === base ? 'parquet' : null
  }

  if (/\.(?:wkt|csv|tsv|txt)$/.test(base)) {
    return 'wkt'
  }

  return null
}

// A segmentation named by a link (`segmentation=`, `segmentationFormat=`,
// `segmentationUnits=`); null when its format is unknown.
export function segmentationSourceFromLink(link: {
  readonly url: string
  readonly format?: string | undefined
  readonly units?: string | undefined
}): SegmentationSource | null {
  const format =
    link.format !== undefined && isSegmentationFormat(link.format)
      ? link.format
      : segmentationFormatFromName(link.url)

  return format === null
    ? null
    : {
        url: link.url,
        format,
        coordinates: link.units === 'micrometers' ? 'micrometers' : 'pixels',
      }
}

// What a link writes for a segmentation: the format only when the name does
// not tell it, and the units only for polygons in micrometres. Undefined for
// a picked file, which a link cannot name.
export function segmentationLinkFor(source: SegmentationSource | null):
  | {
      readonly url: string
      readonly format?: string
      readonly units?: string
    }
  | undefined {
  if (source === null || source.file !== undefined) {
    return undefined
  }

  return {
    url: source.url,
    ...(segmentationFormatFromName(source.url) === source.format
      ? {}
      : { format: source.format }),
    ...(source.coordinates === 'micrometers' && !isLabelSegmentationFormat(source.format)
      ? { units: 'micrometers' }
      : {}),
  }
}

// The last part of a URL or path, for display.
export function segmentationSourceName(url: string): string {
  const path = stripQueryAndHash(url).replace(/\/+$/, '')
  const name = path.slice(path.lastIndexOf('/') + 1)

  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

function stripQueryAndHash(value: string): string {
  const hash = value.indexOf('#')
  const withoutHash = hash < 0 ? value : value.slice(0, hash)
  const query = withoutHash.indexOf('?')
  return query < 0 ? withoutHash : withoutHash.slice(0, query)
}
