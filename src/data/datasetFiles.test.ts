import { afterEach, describe, expect, it } from 'vitest'
import { parseDatasetManifest } from '../datasets/datasetManifest'
import { datasetFileUrl, datasetFileUrlFor, setDatasetManifest } from './datasetFiles'

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
