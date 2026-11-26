import type { Platform } from './spatialDataset'

// The readers that can be chosen for an address in place of detection: the
// cog on the address field, and `reader=` in a link. Detection stays the way
// in; a chosen reader is for an address it cannot route, such as a file
// whose name hides its format.
export const DATASET_READERS = [
  'xenium',
  'atera',
  'visium',
  'visium-hd',
  'merscope',
  'h5ad',
  'spatialdata',
  'image',
] as const satisfies readonly Platform[]

export type DatasetReader = (typeof DATASET_READERS)[number]

// Each platform as the top bar's summary, the info drawer and the reader menu
// name it.
export const DATASET_READER_NAMES: Readonly<Record<DatasetReader, string>> = {
  xenium: 'Xenium',
  atera: 'Atera',
  visium: 'Visium',
  'visium-hd': 'Visium HD',
  merscope: 'MERSCOPE',
  h5ad: 'H5AD',
  spatialdata: 'SpatialData',
  image: 'Image',
}

export function isDatasetReader(value: unknown): value is DatasetReader {
  return (
    typeof value === 'string' && (DATASET_READERS as readonly string[]).includes(value)
  )
}

// A link's or a stored entry's reader; anything else is detection.
export function parseDatasetReader(value: unknown): DatasetReader | null {
  return isDatasetReader(value) ? value : null
}
