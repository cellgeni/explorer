// `collection=` opens a collection JSON file, or an AnnData table that holds
// several sections split into them: `<file>#obs.<column>` lists one dataset
// per value of the obs column, and a table URL without a fragment is split by
// its first column named like a section column (SECTION_COLUMN_NAMES). The
// sections are registered to each other, as they share the table's obsm
// coordinates, and stack in 3D when each has a depth.

import {
  annDataSectionUrl,
  isSectionColumnName,
  parseAnnDataSectionUrl,
} from './annDataSections'
import {
  DatasetCollectionError,
  fetchDatasetCollection,
  type DatasetCollection,
  type FetchDatasetCollectionOptions,
} from './datasetCollection'
import { cachedSpatialDataset } from './datasetFactory'
import type { AnnDataSection } from './h5adDataset'

export interface SplittableAnnData {
  sectionColumns(): Promise<readonly string[]>
  sections(column: string): Promise<readonly AnnDataSection[]>
}

export interface LoadDatasetCollectionOptions extends FetchDatasetCollectionOptions {
  // Opens the table to split; defaults to the cached dataset the viewer reads.
  readonly openDataset?: (url: string) => Promise<unknown>
}

interface AnnDataSplit {
  readonly fileUrl: string
  // Null to take the first section column the table has.
  readonly column: string | null
}

const ANNDATA_URL = /\.(?:h5ad|zarr|icechunk)\/*(?:$|[?#])/i

export async function loadDatasetCollection(
  url: string,
  options: LoadDatasetCollectionOptions = {},
): Promise<DatasetCollection> {
  const split = annDataSplitFor(url)

  return split === null
    ? fetchDatasetCollection(url, options)
    : splitAnnDataCollection(url, split, options)
}

function annDataSplitFor(url: string): AnnDataSplit | null {
  const trimmed = url.trim()
  const section = parseAnnDataSectionUrl(trimmed)

  if (section !== null) {
    if (section.value !== null) {
      throw new DatasetCollectionError(
        url,
        `this names one section; open it with dataset= in the address, or split the table with ${annDataSectionUrl(section.fileUrl, section.column)}.`,
      )
    }

    return { fileUrl: section.fileUrl, column: section.column }
  }

  return ANNDATA_URL.test(trimmed)
    ? { fileUrl: trimmed.replace(/\/+$/, ''), column: null }
    : null
}

async function splitAnnDataCollection(
  url: string,
  { fileUrl, column: namedColumn }: AnnDataSplit,
  { openDataset = cachedSpatialDataset, signal }: LoadDatasetCollectionOptions,
): Promise<DatasetCollection> {
  const read = async <T>(reading: () => Promise<T>): Promise<T> => {
    try {
      return await reading()
    } catch (error) {
      if (signal?.aborted === true) throw error

      throw new DatasetCollectionError(
        url,
        `the table could not be split into sections: ${errorMessage(error)}`,
        { cause: error },
      )
    }
  }
  const dataset = await read(() => openDataset(fileUrl))

  if (!isSplittable(dataset)) {
    throw new DatasetCollectionError(
      url,
      'this is not an AnnData table, so it has no obs columns to split into sections. collection= takes a collection JSON file or an AnnData table.',
    )
  }

  const columns = await read(() => dataset.sectionColumns())
  const column = namedColumn ?? columns.find(isSectionColumnName)

  if (column === undefined) {
    throw new DatasetCollectionError(
      url,
      columns.length === 0
        ? 'obs has no label column with 2 to 500 values to split the table into sections.'
        : `name the obs column that splits the table into sections, as ${annDataSectionUrl(
            fileUrl,
            columns[0] ?? '',
          )}. Columns with 2 to 500 values: ${columns.join(', ')}.`,
    )
  }

  const sections = await read(() => dataset.sections(column))
  // A coordinate system's sections all have a depth, or none does.
  const stacked = sections.length > 0 && sections.every(({ z }) => z !== undefined)
  const fileName = fileLabel(fileUrl)

  return {
    url,
    name: `${fileName} by ${column}`,
    datasets: sections.map(({ value, z }) => {
      const sectionUrl = annDataSectionUrl(fileUrl, column, value)

      return {
        path: sectionUrl,
        url: sectionUrl,
        name: value,
        coordinateSystem: fileName,
        ...(stacked && z !== undefined ? { z } : {}),
      }
    }),
  }
}

function isSplittable(dataset: unknown): dataset is SplittableAnnData {
  return (
    typeof dataset === 'object' &&
    dataset !== null &&
    typeof (dataset as Partial<SplittableAnnData>).sectionColumns === 'function' &&
    typeof (dataset as Partial<SplittableAnnData>).sections === 'function'
  )
}

function fileLabel(url: string): string {
  try {
    return (
      decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? '') ||
      url
    )
  } catch {
    return url
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.replace(/\.$/, '') : String(error)
}
