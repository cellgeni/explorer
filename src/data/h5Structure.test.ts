import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createStructuredLoadError } from '../features/errors/loadErrorModel'
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

  // HDF5 resolves at most 16 soft links in one path, so a link back to a
  // group above failed the whole walk before the 32-level limit (EXP-258).
  it('lists a soft link to a group above it without following it', async () => {
    const bytes = await createH5Bytes((file) => {
      const a = file.create_group('a')
      a.create_group('b')
      a.create_soft_link('/', 'to_root')
      a.create_soft_link('/a', 'to_self')
      file.create_soft_link('/a/b', 'to_b')
    })
    const structure = await readH5Structure(URL_, {
      open: async () => openH5WorkerFile(bytes),
    })

    try {
      expect(structure.truncated).toBe(false)
      expect(nodeAt(structure, 'a/to_root')).toMatchObject({
        kind: 'soft-link',
        link: { target: '/', enclosing: true },
      })
      expect(nodeAt(structure, 'a/to_self')).toMatchObject({
        kind: 'soft-link',
        link: { target: '/a', enclosing: true },
      })
      // A soft link elsewhere is still walked as its target.
      expect(nodeAt(structure, 'to_b').kind).toBe('group')
    } finally {
      structure.close()
    }
  })

  // The walk went depth first with one budget, so two hard links back to the
  // root spent it all in the first and left the root's later children out
  // (EXP-271).
  it("lists the root's children before going deeper", async () => {
    const bytes = await createH5Bytes((file) => {
      file.create_group('a1')
      file.create_hard_link('/', 'loop')
      file.create_hard_link('/', 'loop2')
      file.create_dataset({ name: 'zzz', data: [1, 2, 3] })
    })
    const structure = await readH5Structure(URL_, {
      open: async () => openH5WorkerFile(bytes),
      maxNodes: 50,
    })

    try {
      expect(structure.truncated).toBe(true)
      expect(structure.root.children.map((child) => child.name).sort()).toEqual([
        'a1',
        'loop',
        'loop2',
        'zzz',
      ])
      expect(structure.root.unlisted).toBeUndefined()
    } finally {
      structure.close()
    }
  })

  // HDF5 allocates each variable-length string; they were never freed, so
  // each read of long strings grew the worker's heap (EXP-271).
  it('frees the strings a block of variable-length strings is read into', async () => {
    const h5wasm = (await import('h5wasm')).default
    const module = await h5wasm.ready
    const strings = 32
    const note = 'x'.repeat(512 * 1024)
    const bytes = await createH5Bytes((file) => {
      file.create_dataset({
        name: 'notes',
        data: Array.from({ length: strings }, () => note),
      })
    })
    const structure = await readH5Structure(URL_, {
      open: async () => openH5WorkerFile(bytes.slice()),
    })

    try {
      const read = () => structure.readValues('notes', new AbortController().signal)
      expect((await read()).values).toHaveLength(strings)
      const afterFirst = module.HEAPU8.byteLength
      for (let index = 0; index < 3; index += 1) await read()
      expect(module.HEAPU8.byteLength - afterFirst).toBeLessThan(strings * note.length)
    } finally {
      structure.close()
    }
  }, 60_000)

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

  it('calls only 403, 404 and 410 a missing file', async () => {
    const errorFor = async (status: number) => {
      try {
        await readH5Structure(URL_, {
          open: () => Promise.reject(new Error(`sample.h5ad returned HTTP ${status}.`)),
        })
      } catch (error) {
        return error
      }
      throw new Error('The read should have failed.')
    }

    for (const status of [403, 404, 410]) {
      expect(await errorFor(status)).toBeInstanceOf(H5FileNotFoundError)
    }

    const titles = await Promise.all(
      [503, 429, 401].map(async (status) => {
        const error = await errorFor(status)
        expect(error).not.toBeInstanceOf(H5FileNotFoundError)
        return createStructuredLoadError('Store structure', error).title
      }),
    )
    expect(titles).toEqual(['HTTP 503 response', 'Too many requests', 'Access denied'])
  })
})

// Written with the HDF5 C library (src/test/fixtures/h5/odd-types.c), as h5wasm
// cannot write these types.
function oddTypes(): Promise<H5Structure> {
  const bytes = new Uint8Array(
    readFileSync(join(process.cwd(), 'src/test/fixtures/h5/odd-types.h5')),
  )
  return readH5Structure('https://bucket.test/odd.h5', {
    open: () => openH5WorkerFile(bytes),
  })
}

describe('readH5Structure values of other types', () => {
  it('gives one value per element: opaque and bitfield bytes, array elements', async () => {
    const structure = await oddTypes()
    const read = (path: string) =>
      structure.readValues(path, new AbortController().signal)

    try {
      // As h5dump writes them.
      expect(await read('opaque')).toEqual({
        shape: [3],
        values: [
          '64:65:66:67:68:69:6a:6b',
          '6c:6d:6e:6f:70:71:72:73',
          '74:75:76:77:78:79:7a:7b',
        ],
      })
      expect(await read('bitfield')).toEqual({
        shape: [3],
        values: ['02:01', '04:03', '06:05'],
      })

      // h5wasm nests a 2-D array type by the dataset's whole shape.
      const array2d = await read('array2d')
      expect(array2d.shape).toEqual([2, 20])
      expect(array2d.values).toHaveLength(40)
      expect(array2d.values[1]).toEqual([3, 4, 5])
      // Row 1, column 0 is element 30.
      expect(array2d.values[20]).toEqual([90, 91, 92])
      expect((await read('array1d')).values[1]).toEqual([3, 4, 5])
    } finally {
      structure.close()
    }
  })

  it('fails a read HDF5 cannot make, rather than showing memory', async () => {
    const structure = await oddTypes()

    try {
      await expect(
        structure.readValues('external', new AbortController().signal),
      ).rejects.toThrow(/external storage/)
    } finally {
      structure.close()
    }
  })
})

describe('readH5Structure attributes', () => {
  it('keeps NaN, infinity, large integers and shape, and names references', async () => {
    const structure = await readH5Structure(URL_, {
      open: async () =>
        openH5WorkerFile(
          await createH5Bytes((file) => {
            const target = file.create_dataset({
              name: 'target',
              data: new Int32Array([1]),
            })
            file.create_attribute('scores', new Float64Array([1, Number.NaN, Infinity]))
            file.create_attribute('total', new BigUint64Array([9_007_199_254_740_993n]))
            file.create_attribute('count', new BigInt64Array([42n]))
            file.create_attribute('grid', new Int32Array([1, 2, 3, 4, 5, 6]), [2, 3])
            file.create_attribute('points_at', [target.create_reference()])
          }),
        ),
    })

    try {
      expect(structure.root.attributes).toEqual({
        scores: [1, Number.NaN, Infinity],
        // Shape [1], so lists, as before.
        total: [9_007_199_254_740_993n],
        count: [42],
        grid: [
          [1, 2, 3],
          [4, 5, 6],
        ],
        points_at: ['object reference'],
      })
    } finally {
      structure.close()
    }
  })

  it('writes an opaque attribute as its bytes', async () => {
    const structure = await oddTypes()

    try {
      expect(structure.root.attributes['opaque_attr']).toBe('01:02:03:04')
    } finally {
      structure.close()
    }
  })
})
