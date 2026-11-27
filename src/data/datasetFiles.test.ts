import { afterEach, describe, expect, it } from 'vitest'
import { parseDatasetCollection } from '../datasets/datasetCollection'
import { parseDatasetManifest } from '../datasets/datasetManifest'
import {
  clearCollectionDatasets,
  collectionChannelSettingsFor,
  collectionCustomImagesFor,
  datasetFileUrl,
  datasetFileUrlFor,
  registerCollectionDatasets,
  setDatasetManifest,
} from './datasetFiles'

const FOLDER = 'https://acct.blob.core.windows.net/c/xenium?sv=2024&sig=abc'
const TOKEN = '?sv=2024&sig=abc'

afterEach(() => {
  setDatasetManifest(FOLDER, undefined)
  clearCollectionDatasets()
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
    clearCollectionDatasets()
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
    registerCollectionDatasets(collection([{ url: 'run-7/he.ome.tif' }]))

    expect(collectionCustomImagesFor('https://example.test/study/run-7')).toEqual([
      { path: 'run-7/he.ome.tif', url: 'https://example.test/study/run-7/he.ome.tif' },
    ])

    // A later collection without a list for the dataset drops it.
    registerCollectionDatasets(collection())
    expect(collectionCustomImagesFor('https://example.test/study/run-7')).toBeUndefined()
  })
})

describe('collection channel settings', () => {
  const collection = (defaults?: unknown) =>
    parseDatasetCollection(
      {
        version: 1,
        datasets: [{ dataset: 'a.zarr' }, { dataset: 'b.zarr' }],
        ...(defaults === undefined ? {} : { defaults }),
      },
      'https://example.test/study/collection.json',
    )

  it('gives every dataset of the collection its channel settings', () => {
    registerCollectionDatasets(
      collection({ channelSettings: { DAPI: { color: '#5890FF' } } }),
    )

    for (const dataset of ['a.zarr', 'b.zarr']) {
      expect(
        collectionChannelSettingsFor(`https://example.test/study/${dataset}`),
      ).toEqual({ DAPI: { color: [88, 144, 255] } })
    }

    // A later collection listing the datasets without settings replaces them.
    registerCollectionDatasets(collection())

    expect(collectionChannelSettingsFor('https://example.test/study/a.zarr')).toBe(
      undefined,
    )
  })
})
