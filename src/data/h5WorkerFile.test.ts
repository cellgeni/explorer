import { describe, expect, it, vi } from 'vitest'
import {
  createH5Bytes,
  writeFeatureBarcodeMatrix,
  writeTinyFeatureSlice,
} from '../test/h5Fixtures'
import { createH5FileHandler, type H5FileHandler } from '../workers/h5FileCore'
import {
  H5_RANGE_UNSUPPORTED_ERROR,
  type H5FileWorkerRequest,
  type H5FileWorkerResponse,
  type H5MatrixCellsPayload,
  type H5TreeGroup,
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

// Answers only when the test replies, like a worker busy with blocking reads.
class ManualH5Worker implements H5WorkerLike {
  onmessage: ((event: MessageEvent<H5FileWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly posted: H5FileWorkerRequest[] = []

  postMessage(message: H5FileWorkerRequest): void {
    this.posted.push(message)
  }

  reply(response: H5FileWorkerResponse): void {
    this.onmessage?.(new MessageEvent('message', { data: response }))
  }

  terminate(): void {}
}

const noCells: H5MatrixCellsPayload = {
  geneNames: [],
  names: [],
  ids: [],
  offsets: new Uint32Array([0]),
  nameIndices: new Uint32Array(),
  counts: new Float64Array(),
}

async function openManualFile() {
  const worker = new ManualH5Worker()
  const opening = openH5WorkerFile(new Uint8Array(8), { workerFactory: () => worker })
  worker.reply({ id: 1, ok: true, op: 'open', tree: null, range: null })

  return { worker, file: await opening }
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

  it('reads Visium HD feature slices', async () => {
    const file = await openH5WorkerFile(await createH5Bytes(writeTinyFeatureSlice), {
      workerFactory: () => new CloningH5Worker(),
    })

    const result = await file.featureSlice(
      [
        { id: 'BC-0', row: 0, col: 0 },
        { id: 'BC-1', row: 1, col: 0 },
      ],
      ['Actb', 'Gad1'],
      16,
    )

    expect(result.geneNames).toEqual(['Actb', 'Gad1'])
    expect(Array.from(result.cells)).toEqual([
      ['BC-0', { geneNames: ['Actb'], counts: [5] }],
      ['BC-1', { geneNames: ['Actb', 'Gad1'], counts: [12, 4] }],
    ])
    file.close()
  })

  it('reads a Visium HD feature slice metadata', async () => {
    const file = await openH5WorkerFile(await createH5Bytes(writeTinyFeatureSlice), {
      workerFactory: () => new CloningH5Worker(),
    })

    await expect(file.featureSliceMetadata()).resolves.toEqual({
      nrows: 32,
      ncols: 32,
      spotPitchMicrometers: 2,
      spotToFullresTransform: [8, 0, 100, 0, 8, 200, 0, 0, 1],
    })
    file.close()
  })

  it('sends one request at a time, and never sends one cancelled while waiting', async () => {
    const { worker, file } = await openManualFile()
    const controller = new AbortController()
    const first = file.matrixCells(['a'])
    const cancelled = file.matrixCells(['b'], controller.signal)
    const last = file.featureSlice([{ id: 'c', row: 0, col: 0 }], ['Actb'], 16)

    expect(worker.posted.map((message) => message.op)).toEqual(['open', 'matrix-cells'])
    controller.abort()
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })

    worker.reply({ id: 2, ok: true, op: 'matrix-cells', cells: noCells })
    await expect(first).resolves.toMatchObject({ geneNames: [] })
    expect(worker.posted.map((message) => [message.id, message.op])).toEqual([
      [1, 'open'],
      [2, 'matrix-cells'],
      [3, 'feature-slice'],
    ])

    worker.reply({ id: 3, ok: true, op: 'feature-slice', cells: noCells })
    await expect(last).resolves.toMatchObject({ geneNames: [] })
  })

  it('rejects a cancelled request at once, and sends the next once the worker answers it', async () => {
    const { worker, file } = await openManualFile()
    const controller = new AbortController()
    const cancelled = file.matrixCells(['a'], controller.signal)
    const next = file.matrixCells(['b'])

    controller.abort()
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.posted).toHaveLength(2)

    worker.reply({ id: 2, ok: true, op: 'matrix-cells', cells: noCells })
    expect(worker.posted.map((message) => message.op)).toEqual([
      'open',
      'matrix-cells',
      'matrix-cells',
    ])
    worker.reply({ id: 3, ok: true, op: 'matrix-cells', cells: noCells })
    await expect(next).resolves.toMatchObject({ geneNames: [] })
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

  it('reads a URL by range, walking only the paths asked for', async () => {
    const bytes = await createSmallFile()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const range = /^bytes=(\d+)-(\d+)$/.exec(
          new Headers(init?.headers).get('range') ?? '',
        )
        const start = Number(range?.[1] ?? 0)
        const end = Math.min(Number(range?.[2] ?? 0) + 1, bytes.byteLength)
        return new Response(bytes.slice(start, end), {
          status: 206,
          headers: { 'content-range': `bytes ${start}-${end - 1}/${bytes.byteLength}` },
        })
      }),
    )

    try {
      // The fixture is smaller than the first range request, so it is read in
      // that request and there are no range reads to report.
      const file = await openH5WorkerFileFromUrl('https://example.test/a.h5', 'a.h5', {
        tree: true,
        treePaths: ['group/values'],
        rangeOnly: true,
        workerFactory: () =>
          createInProcessH5Worker({
            createRangeRead: () => (start, end) => bytes.slice(start, end),
          }),
      })

      expect(file.tree?.children).toEqual([
        [
          'group',
          {
            kind: 'group',
            attrs: [],
            children: [
              ['values', { kind: 'dataset', attrs: [], shape: [3], itemSize: 4 }],
            ],
          },
        ],
      ])
      await expect(file.read('/group/values', { slice: [[1, 3]] })).resolves.toEqual(
        new Int32Array([5, 6]),
      )
      expect(file.range).toBeNull()
      await expect(file.rangeStats()).resolves.toBeNull()
      file.close()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('fails a range-only open with the error name the worker reports', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array(8))),
    )

    try {
      // The in-process handler has no synchronous range reads.
      await expect(
        openH5WorkerFileFromUrl('https://example.test/a.h5', 'a.h5', {
          rangeOnly: true,
          workerFactory: createInProcessH5Worker,
        }),
      ).rejects.toMatchObject({ name: H5_RANGE_UNSUPPORTED_ERROR })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('sends slices and stats requests, and cancels a waiting read', async () => {
    const { worker, file } = await openManualFile()
    const controller = new AbortController()
    const first = file.read('/X/data', { slice: [[2, 5]] })
    const cancelled = file.read('/X/indices', {
      slice: [[2, 5]],
      signal: controller.signal,
    })
    const stats = file.rangeStats()

    controller.abort()
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    worker.reply({ id: 2, ok: true, op: 'read', value: new Float32Array([1, 2, 3]) })
    await expect(first).resolves.toEqual(new Float32Array([1, 2, 3]))
    worker.reply({
      id: 3,
      ok: true,
      op: 'stats',
      range: { size: 100, requests: 2, fetchedBytes: 50 },
    })
    await expect(stats).resolves.toEqual({ size: 100, requests: 2, fetchedBytes: 50 })
    expect(worker.posted).toEqual([
      { id: 1, op: 'open', source: expect.anything(), tree: false },
      { id: 2, op: 'read', path: '/X/data', slice: [[2, 5]] },
      { id: 3, op: 'stats' },
    ])
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
          children: [
            ['barcodes', { kind: 'dataset', attrs: [], shape: [2], itemSize: 8 }],
          ],
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
