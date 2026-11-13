import { describe, expect, it, vi } from 'vitest'
import { createH5Bytes, writeFeatureBarcodeMatrix } from '../test/h5Fixtures'
import { createH5FileHandler, type H5FileHandler } from '../workers/h5FileCore'
import type {
  H5FileWorkerRequest,
  H5FileWorkerResponse,
  H5TreeGroup,
} from '../workers/h5FileMessages'
import {
  createInProcessH5Worker,
  h5TreeNodeAt,
  openH5WorkerFile,
  openH5WorkerFileFromUrl,
  type H5WorkerLike,
} from './h5WorkerFile'

// Runs the real handler behind a structured-clone boundary, as a worker does:
// transferred buffers are detached on the sending side.
class CloningH5Worker implements H5WorkerLike {
  onmessage: ((event: MessageEvent<H5FileWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly requests: H5FileWorkerRequest['op'][] = []
  terminated = false
  private readonly handler: H5FileHandler

  constructor() {
    this.handler = createH5FileHandler((response, transfer) => {
      const data = structuredClone(response, { transfer })
      queueMicrotask(() => {
        if (!this.terminated) {
          this.onmessage?.(new MessageEvent('message', { data }))
        }
      })
    })
  }

  postMessage(message: H5FileWorkerRequest, transfer: Transferable[]): void {
    this.requests.push(message.op)
    const data = structuredClone(message, { transfer })
    void this.handler.handle(data)
  }

  terminate(): void {
    this.terminated = true
    this.handler.close()
  }
}

// Never answers, like a worker still copying a large file.
class SilentH5Worker implements H5WorkerLike {
  onmessage: ((event: MessageEvent<H5FileWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminated = false

  postMessage(): void {}

  terminate(): void {
    this.terminated = true
  }
}

async function createSmallFile(): Promise<Uint8Array> {
  return createH5Bytes((file) => {
    file.create_attribute('library_ids', ['lib-1'])
    const group = file.create_group('group')
    group.create_dataset({ name: 'values', data: new Int32Array([4, 5, 6]) })
    group.create_dataset({ name: 'names', data: ['x', 'y'] })
  })
}

describe('openH5WorkerFile', () => {
  it('transfers the bytes, then reads datasets through the worker', async () => {
    const worker = new CloningH5Worker()
    const bytes = await createSmallFile()
    const file = await openH5WorkerFile(bytes, {
      tree: true,
      workerFactory: () => worker,
    })

    expect(bytes.byteLength).toBe(0)
    expect(file.tree?.attrs).toEqual([['library_ids', ['lib-1']]])
    // structuredClone under jsdom makes typed arrays of another realm, so the
    // contents are compared.
    expect(Array.from((await file.read('/group/values')) as Int32Array)).toEqual([
      4, 5, 6,
    ])
    await expect(file.read('group/names')).resolves.toEqual(['x', 'y'])
    await expect(file.read('/group')).rejects.toThrow('H5 path /group is not a dataset.')

    file.close()

    expect(worker.terminated).toBe(true)
    await expect(file.read('/group/values')).rejects.toThrow('The H5 file was closed.')
  })

  it('reads feature-barcode matrix rows', async () => {
    const bytes = await createH5Bytes((file) => {
      writeFeatureBarcodeMatrix(file, ['AAAC-1', 'TTGG-1'])
    })
    const file = await openH5WorkerFile(bytes, {
      workerFactory: () => new CloningH5Worker(),
    })

    const result = await file.matrixCells(['TTGG-1', 'AAAC-1'])

    expect(result.geneNames).toEqual(['Actb', 'Gad1'])
    expect(Array.from(result.cells)).toEqual([
      ['AAAC-1', { geneNames: ['Actb'], counts: [5] }],
      ['TTGG-1', { geneNames: ['Actb', 'Gad1'], counts: [2, 3] }],
    ])
    file.close()
  })

  it('opens a URL the worker fetches', async () => {
    const bytes = await createSmallFile()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(bytes.slice())),
    )

    try {
      const worker = new CloningH5Worker()
      const file = await openH5WorkerFileFromUrl('https://example.test/a.h5', 'a.h5', {
        workerFactory: () => worker,
      })

      expect(worker.requests).toEqual(['open'])
      await expect(file.read('group/names')).resolves.toEqual(['x', 'y'])
      file.close()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('terminates the worker when the bytes are not HDF5', async () => {
    const worker = new CloningH5Worker()

    await expect(
      openH5WorkerFile(new Uint8Array([1, 2, 3, 4]), { workerFactory: () => worker }),
    ).rejects.toThrow('The file is not a readable HDF5 file.')
    expect(worker.terminated).toBe(true)
  })

  it('terminates the worker when the open is aborted', async () => {
    const worker = new SilentH5Worker()
    const controller = new AbortController()
    const opening = openH5WorkerFile(new Uint8Array(8), {
      signal: controller.signal,
      workerFactory: () => worker,
    })

    controller.abort()

    await expect(opening).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.terminated).toBe(true)
  })

  it('rejects waiting and later requests when the worker fails', async () => {
    const worker = new CloningH5Worker()
    const file = await openH5WorkerFile(await createSmallFile(), {
      workerFactory: () => worker,
    })
    worker.postMessage = () => {}
    const reading = file.read('/group/values')

    worker.onerror?.(new ErrorEvent('error', { message: 'Worker crashed' }))

    await expect(reading).rejects.toThrow('Worker crashed')
    await expect(file.read('/group/names')).rejects.toThrow('Worker crashed')
  })

  it('keeps the error name a worker reports', async () => {
    const worker = new SilentH5Worker()
    const opening = openH5WorkerFile(new Uint8Array(8), { workerFactory: () => worker })

    worker.onmessage?.(
      new MessageEvent('message', {
        data: { id: 1, ok: false, error: 'Out of memory', errorName: 'RangeError' },
      }),
    )

    await expect(opening).rejects.toMatchObject({
      name: 'RangeError',
      message: 'Out of memory',
    })
  })
})

describe('createInProcessH5Worker', () => {
  it('serves the same protocol on this thread', async () => {
    const file = await openH5WorkerFile(await createSmallFile(), {
      tree: true,
      workerFactory: createInProcessH5Worker,
    })

    await expect(file.read('/group/values')).resolves.toEqual(new Int32Array([4, 5, 6]))
    file.close()
    await expect(file.read('/group/values')).rejects.toThrow('The H5 file was closed.')
  })
})

describe('h5TreeNodeAt', () => {
  const tree: H5TreeGroup = {
    kind: 'group',
    attrs: [],
    children: [
      [
        'matrix',
        {
          kind: 'group',
          attrs: [],
          children: [['barcodes', { kind: 'dataset', attrs: [], shape: [2] }]],
        },
      ],
    ],
  }

  it('finds nodes by slash-separated path', () => {
    expect(h5TreeNodeAt(tree, '')).toBe(tree)
    expect(h5TreeNodeAt(tree, '/matrix/barcodes')).toMatchObject({ kind: 'dataset' })
    expect(h5TreeNodeAt(tree, 'matrix/missing')).toBeUndefined()
    expect(h5TreeNodeAt(tree, 'matrix/barcodes/below')).toBeUndefined()
  })
})
