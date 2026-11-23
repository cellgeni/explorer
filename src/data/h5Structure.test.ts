import { describe, expect, it, vi } from 'vitest'
import { createH5Bytes, writeBrowsableH5ad } from '../test/h5Fixtures'
import { H5_RANGE_UNSUPPORTED_ERROR } from '../workers/h5FileMessages'
import {
  H5FileNotFoundError,
  H5RangeRequiredError,
  NotH5FileError,
  readH5Structure,
  type H5Structure,
} from './h5Structure'
import { H5T_CLASS, type H5StructureNode } from './h5StructureTypes'
import { openH5WorkerFile, type H5WorkerFile } from './h5WorkerFile'

const URL_ = 'https://bucket.test/run/sample.h5ad'

async function openFixture(): Promise<H5WorkerFile> {
  return openH5WorkerFile(await createH5Bytes(writeBrowsableH5ad))
}

function nodeAt(structure: H5Structure, path: string): H5StructureNode {
  let node: H5StructureNode | undefined = structure.root

  for (const name of path.split('/')) {
    node = node?.children.find((child) => child.name === name)
  }

  if (node === undefined) throw new Error(`No node at ${path}`)
  return node
}

describe('readH5Structure', () => {
  it('walks groups, datasets, attributes and links', async () => {
    const onProgress = vi.fn()
    const structure = await readH5Structure(URL_, { open: openFixture, onProgress })

    try {
      expect(structure.root.name).toBe('sample.h5ad')
      expect(structure.root.attributes).toEqual({
        'encoding-type': 'anndata',
        'encoding-version': '0.1.0',
      })
      expect(structure.root.children.map((child) => child.name).sort()).toEqual([
        'X',
        'broken_link',
        'external_link',
        'obs',
        'obsm',
        'umap_link',
        'uns',
      ])
      expect(structure.groupCount).toBe(6)
      // The soft link to an existing dataset is walked as that dataset.
      expect(structure.datasetCount).toBe(6)
      expect(structure.otherCount).toBe(2)
      expect(structure.truncated).toBe(false)
      expect(onProgress).toHaveBeenLastCalledWith(14)

      const data = nodeAt(structure, 'X/data').dataset
      expect(data?.shape).toEqual([1000])
      expect(data?.chunks).toEqual([256])
      expect(data?.dtype).toMatchObject({ typeClass: H5T_CLASS.FLOAT, size: 4 })
      expect(data?.filters).toEqual([{ id: 1, name: 'deflate', values: [4] }])

      expect(nodeAt(structure, 'X').attributes).toEqual({
        'encoding-type': 'csr_matrix',
        shape: [250, 30],
      })
      expect(nodeAt(structure, 'obs/_index').dataset?.dtype).toMatchObject({
        typeClass: H5T_CLASS.STRING,
        vlen: true,
      })
      expect(nodeAt(structure, 'umap_link').kind).toBe('dataset')
      expect(nodeAt(structure, 'broken_link')).toMatchObject({
        kind: 'soft-link',
        link: { target: '/missing' },
      })
      expect(nodeAt(structure, 'external_link')).toMatchObject({
        kind: 'external-link',
        link: { target: '/data', file: 'other.h5' },
      })
      expect(nodeAt(structure, 'uns/pi').dataset?.shape).toEqual([])
    } finally {
      structure.close()
    }
  })

  it('stops at the node limit and marks the groups it did not finish', async () => {
    const structure = await readH5Structure(URL_, { open: openFixture, maxNodes: 4 })

    try {
      expect(structure.truncated).toBe(true)
      expect(structure.groupCount + structure.datasetCount + structure.otherCount).toBe(4)
      expect(structure.root.unlisted).toBe(true)
    } finally {
      structure.close()
    }
  })

  it('reads the first values of a dataset', async () => {
    const structure = await readH5Structure(URL_, { open: openFixture })

    try {
      // Variable-length strings, which h5wasm's own slice cannot free.
      const names = await structure.readValues('obs/_index', new AbortController().signal)
      expect(names.shape).toEqual([100])
      expect(names.values.slice(0, 3)).toEqual(['cell-0', 'cell-1', 'cell-2'])
      expect(names.values.at(-1)).toBe('cell-99')

      const umap = await structure.readValues('obsm/X_umap', new AbortController().signal)
      expect(umap.shape).toEqual([100, 20])
      expect(umap.values.slice(0, 2)).toEqual([0, 1])
      // Row 1 starts 30 values in.
      expect(umap.values[20]).toBe(30)

      const scalar = await structure.readValues('uns/pi', new AbortController().signal)
      expect(scalar).toEqual({ shape: [], values: [3.5] })

      // The worker still answers after the string read.
      const data = await structure.readValues('X/data', new AbortController().signal)
      expect(data.values.slice(0, 3)).toEqual([0, 0.5, 1])
    } finally {
      structure.close()
    }
  })

  it('closes the file when the read is cancelled', async () => {
    const file = await openFixture()
    const close = vi.spyOn(file, 'close')
    const controller = new AbortController()
    const read = readH5Structure(URL_, {
      open: async () => file,
      signal: controller.signal,
    })
    controller.abort()

    await expect(read).rejects.toMatchObject({ name: 'AbortError' })
    expect(close).toHaveBeenCalled()
  })

  it('names the errors of an open', async () => {
    const failWith = (error: Error) => () => Promise.reject(error)
    const unsupported = new Error('sample.h5ad ignored a range request (HTTP 200).')
    unsupported.name = H5_RANGE_UNSUPPORTED_ERROR

    await expect(
      readH5Structure(URL_, {
        open: failWith(new Error('sample.h5ad returned HTTP 404.')),
      }),
    ).rejects.toBeInstanceOf(H5FileNotFoundError)
    await expect(
      readH5Structure(URL_, {
        open: failWith(new Error('The file is not a readable HDF5 file.')),
      }),
    ).rejects.toBeInstanceOf(NotH5FileError)
    await expect(
      readH5Structure(URL_, { open: failWith(unsupported) }),
    ).rejects.toBeInstanceOf(H5RangeRequiredError)
  })
})
