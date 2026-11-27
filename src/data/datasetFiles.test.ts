import { afterEach, describe, expect, it } from 'vitest'
import { parseDatasetCollection } from '../datasets/datasetCollection'
import { parseDatasetManifest } from '../datasets/datasetManifest'
import {
  clearDatasetImages,
  collectionCustomImagesFor,
  datasetFileUrl,
  datasetFileUrlFor,
  registerCollectionImages,
  setDatasetManifest,
} from './datasetFiles'

const FOLDER = 'https://acct.blob.core.windows.net/c/xenium?sv=2024&sig=abc'
const TOKEN = '?sv=2024&sig=abc'

afterEach(() => {
  setDatasetManifest(FOLDER, undefined)
})

describe('dataset file URLs', () => {
  // A host that grants the folder by query wants it on every file, with a
  // manifest found in the folder as without one (EXP-235).
  it('keeps the folder query on files resolved through a manifest found there', () => {
    expect(datasetFileUrlFor(FOLDER, 'analysis')).toBe(
      `https://acct.blob.core.windows.net/c/xenium/analysis.zarr.zip${TOKEN}`,
    )

    setDatasetManifest(
      FOLDER,
      parseDatasetManifest(
        { version: 1, platform: 'xenium', files: { cells: 'outs/cells.parquet' } },
        `https://acct.blob.core.windows.net/c/xenium/explorer.json${TOKEN}`,
      ),
    )

    expect(datasetFileUrlFor(FOLDER, 'analysis')).toBe(
      `https://acct.blob.core.windows.net/c/xenium/analysis.zarr.zip${TOKEN}`,
    )
    expect(datasetFileUrlFor(FOLDER, 'cells')).toBe(
      `https://acct.blob.core.windows.net/c/xenium/outs/cells.parquet${TOKEN}`,
    )
    expect(datasetFileUrl(FOLDER, 'analysis/umap/projection.csv')).toBe(
      `https://acct.blob.core.windows.net/c/xenium/analysis/umap/projection.csv${TOKEN}`,
    )
  })
})

describe('collection custom image layers', () => {
  afterEach(() => {
    clearDatasetImages()
  })

  const collection = (customImages?: unknown) =>
    parseDatasetCollection(
      {
        version: 1,
        datasets: [
          { dataset: 'run-7/', ...(customImages === undefined ? {} : { customImages }) },
        ],
      },
      'https://example.test/study/collection.json',
    )

  it('keeps a collection’s list per dataset until another collection lists the dataset', () => {
    registerCollectionImages(collection([{ url: 'run-7/he.ome.tif' }]))

    expect(collectionCustomImagesFor('https://example.test/study/run-7')).toEqual([
      { path: 'run-7/he.ome.tif', url: 'https://example.test/study/run-7/he.ome.tif' },
    ])

    // A later collection without a list for the dataset drops it.
    registerCollectionImages(collection())
    expect(collectionCustomImagesFor('https://example.test/study/run-7')).toBeUndefined()
  })
})
