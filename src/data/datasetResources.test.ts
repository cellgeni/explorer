import { afterEach, describe, expect, it } from 'vitest'
import { DatasetCache, retainDataset } from '../datasets/datasetCache'
import { setDatasetManifest } from './datasetFiles'
import { datasetReadsFile, releaseWithDatasets } from './datasetResources'
import type { H5FileWorkerRequest, H5FileWorkerResponse } from '../workers/h5FileMessages'
import type { H5WorkerLike } from './h5WorkerFile'
import { readVisiumFeatureSliceH5Metadata } from './visiumFeatureSlice'

// Since O19, resources opened for a dataset's files outside the dataset
// object, such as the Feature Slice file's H5 worker, are released once no
// viewer, preview or cache holds the dataset's URL.

const DATASET = 'https://example.test/o19/visium-hd'
const FEATURE_SLICE = `${DATASET}/feature_slice.h5`

afterEach(() => {
  setDatasetManifest(DATASET, undefined)
})

describe('dataset resources (O19)', () => {
  it("ends a file's worker when the last holder of its dataset releases it", async () => {
    const workers: FakeH5Worker[] = []
    const open = () =>
      readVisiumFeatureSliceH5Metadata(FEATURE_SLICE, {
        workerFactory: () => {
          const worker = new FakeH5Worker()
          workers.push(worker)
          return worker
        },
      })
    const viewer = retainDataset(DATASET)
    const preview = retainDataset(DATASET)

    await expect(open()).resolves.toMatchObject({ nrows: 3 })
    // Opened once, and kept for the next read.
    await open()
    expect(workers).toHaveLength(1)

    viewer()
    await settle()
    expect(workers[0]?.terminated).toBe(false)

    preview()
    await settle()
    expect(workers[0]?.terminated).toBe(true)

    // The next read opens the file again.
    await open()
    expect(workers).toHaveLength(2)
  })

  it('keeps a file while a cached dataset or another holder can read it', async () => {
    const cache = new DatasetCache<{ dispose?(): void }>(1)
    const released: string[] = []
    const files = new Map([
      [FEATURE_SLICE, 'slice'],
      [`${DATASET}x/feature_slice.h5`, 'sibling'],
      ['https://example.test/elsewhere/image.tif', 'unrelated'],
    ])
    const stop = releaseWithDatasets(files, (value) => released.push(value))

    try {
      const release = retainDataset(DATASET)
      await cache.get('hd', DATASET, async () => ({}))
      const parent = retainDataset('https://example.test/o19')
      release()
      // Inactive but cached: still held.
      expect(released).toEqual([])

      // A second dataset pushes it out of the cache, but the parent folder,
      // also a dataset, can read the file.
      await cache.get('other', 'https://example.test/other', async () => ({}))
      expect(released).toEqual([])

      // The parent could read the sibling folder's file too; a file no
      // released dataset reads stays.
      parent()
      expect(released).toEqual(['slice', 'sibling'])
      expect([...files.keys()]).toEqual(['https://example.test/elsewhere/image.tif'])
    } finally {
      stop()
    }
  })

  it("counts a manifest's root and named files as the dataset's", () => {
    setDatasetManifest(DATASET, {
      platform: 'visium-hd',
      url: `${DATASET}/manifest.json`,
      rootUrl: 'https://bucket.test/run-7/outs/',
      files: {
        featureSlice: {
          path: 'https://other.test/slices/run-7.h5',
          url: 'https://other.test/slices/run-7.h5',
        },
      },
      options: {},
    } as unknown as Parameters<typeof setDatasetManifest>[1])

    expect(datasetReadsFile(DATASET, `${DATASET}/binned_outputs/x.parquet`)).toBe(true)
    expect(datasetReadsFile(DATASET, `${DATASET}?v=2`)).toBe(true)
    expect(datasetReadsFile(DATASET, `${DATASET}x/feature_slice.h5`)).toBe(false)
    expect(
      datasetReadsFile(
        DATASET,
        'https://bucket.test/run-7/outs/barcode_mappings.parquet',
      ),
    ).toBe(true)
    expect(datasetReadsFile(DATASET, 'https://other.test/slices/run-7.h5')).toBe(true)
    expect(datasetReadsFile(DATASET, 'https://other.test/slices/run-8.h5')).toBe(false)
  })
})

async function settle(): Promise<void> {
  for (let tick = 0; tick < 5; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

// Answers an open and a Feature Slice metadata read.
class FakeH5Worker implements H5WorkerLike {
  onmessage: ((event: MessageEvent<H5FileWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminated = false

  postMessage(message: H5FileWorkerRequest): void {
    const reply = (response: H5FileWorkerResponse) => {
      queueMicrotask(() => {
        this.onmessage?.({ data: response } as MessageEvent<H5FileWorkerResponse>)
      })
    }

    if (message.op === 'open') {
      reply({ id: message.id, ok: true, op: 'open', tree: null, range: null })
    } else if (message.op === 'feature-slice-metadata') {
      reply({
        id: message.id,
        ok: true,
        op: 'feature-slice-metadata',
        metadata: { nrows: 3, ncols: 3, spotPitchMicrometers: 2 },
      })
    }
  }

  terminate(): void {
    this.terminated = true
  }
}
