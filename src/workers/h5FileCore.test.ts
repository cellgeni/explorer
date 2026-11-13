import { describe, expect, it, vi } from 'vitest'
import { createH5Bytes, writeFeatureBarcodeMatrix } from '../test/h5Fixtures'
import { createH5FileHandler } from './h5FileCore'
import type { H5FileWorkerRequest, H5FileWorkerResponse } from './h5FileMessages'
import { unpackGexResult } from './h5MatrixCellsPayload'

type RequestWithoutId = H5FileWorkerRequest extends infer Request
  ? Request extends H5FileWorkerRequest
    ? Omit<Request, 'id'>
    : never
  : never

interface Reply {
  readonly response: H5FileWorkerResponse
  readonly transfer: readonly Transferable[]
}

function createHarness() {
  const replies: Reply[] = []
  const handler = createH5FileHandler((response, transfer) => {
    replies.push({ response, transfer })
  })
  let nextId = 1

  return {
    handler,
    async send(request: RequestWithoutId): Promise<Reply> {
      const id = nextId
      nextId += 1
      await handler.handle({ ...request, id } as H5FileWorkerRequest)
      const reply = replies.find((candidate) => candidate.response.id === id)

      if (reply === undefined) {
        throw new Error(`No reply to request ${id}.`)
      }

      return reply
    },
  }
}

async function createAnnDataLikeFile(): Promise<Uint8Array> {
  return createH5Bytes((file) => {
    file.create_attribute('encoding-type', 'anndata')
    const obs = file.create_group('obs')
    obs.create_attribute('_index', 'cell_id')
    obs.create_attribute('column-order', ['score'])
    obs.create_dataset({ name: 'cell_id', data: ['a', 'b', 'c'] })
    obs.create_dataset({ name: 'score', data: new Float32Array([0.5, 1.5, 2.5]) })
    const obsm = file.create_group('obsm')
    obsm.create_dataset({
      name: 'spatial',
      data: new Float64Array([0, 0, 1, 1, 2, 2]),
      shape: [3, 2],
    })
    file.create_soft_link('/obs/score', 'score_link')
  })
}

describe('createH5FileHandler', () => {
  it('opens a file into a tree of groups, datasets and attributes', async () => {
    const harness = createHarness()
    const { response } = await harness.send({
      op: 'open',
      source: { kind: 'bytes', bytes: await createAnnDataLikeFile() },
      tree: true,
    })

    expect(response).toMatchObject({ ok: true, op: 'open' })

    if (!response.ok || response.op !== 'open' || response.tree === null) {
      throw new Error('Expected a tree.')
    }

    const tree = response.tree
    expect(tree.attrs).toEqual([['encoding-type', 'anndata']])
    expect(tree.children.map(([name]) => name)).toEqual(['obs', 'obsm', 'score_link'])

    const obs = tree.children[0]?.[1]
    expect(obs).toMatchObject({
      kind: 'group',
      attrs: expect.arrayContaining([
        ['_index', 'cell_id'],
        ['column-order', ['score']],
      ]),
    })
    expect(obs?.kind === 'group' ? obs.children : []).toEqual([
      ['cell_id', { kind: 'dataset', attrs: [], shape: [3] }],
      ['score', { kind: 'dataset', attrs: [], shape: [3] }],
    ])
    // A soft link to a dataset resolves to that dataset.
    expect(tree.children[2]?.[1]).toMatchObject({ kind: 'dataset', shape: [3] })
    expect(tree.children[1]?.[1]).toEqual({
      kind: 'group',
      attrs: [],
      children: [['spatial', { kind: 'dataset', attrs: [], shape: [3, 2] }]],
    })
  })

  it('opens without a tree when none is asked for', async () => {
    const harness = createHarness()
    const { response } = await harness.send({
      op: 'open',
      source: { kind: 'bytes', bytes: await createAnnDataLikeFile() },
      tree: false,
    })

    expect(response).toEqual({ id: 1, ok: true, op: 'open', tree: null })
  })

  it('reads datasets by path and transfers typed arrays', async () => {
    const harness = createHarness()
    await harness.send({
      op: 'open',
      source: { kind: 'bytes', bytes: await createAnnDataLikeFile() },
      tree: false,
    })

    const strings = await harness.send({ op: 'read', path: '/obs/cell_id' })
    expect(strings.response).toMatchObject({ ok: true, value: ['a', 'b', 'c'] })
    expect(strings.transfer).toEqual([])

    const numbers = await harness.send({ op: 'read', path: 'obsm/spatial' })
    const value =
      numbers.response.ok && numbers.response.op === 'read'
        ? numbers.response.value
        : null
    expect(value).toEqual(new Float64Array([0, 0, 1, 1, 2, 2]))
    expect(numbers.transfer).toEqual([(value as Float64Array).buffer])
  })

  it('answers a read of a group, a missing path or a closed file with an error', async () => {
    const harness = createHarness()

    await expect(harness.send({ op: 'read', path: '/obs' })).resolves.toMatchObject({
      response: { ok: false, error: 'The H5 file is not open.' },
    })

    await harness.send({
      op: 'open',
      source: { kind: 'bytes', bytes: await createAnnDataLikeFile() },
      tree: false,
    })

    await expect(harness.send({ op: 'read', path: '/obs' })).resolves.toMatchObject({
      response: { ok: false, error: 'H5 path /obs is not a dataset.' },
    })
    await expect(harness.send({ op: 'read', path: '/missing' })).resolves.toMatchObject({
      response: { ok: false, error: 'H5 path /missing is not a dataset.' },
    })

    harness.handler.close()

    await expect(
      harness.send({ op: 'read', path: '/obs/cell_id' }),
    ).resolves.toMatchObject({
      response: { ok: false, error: 'The H5 file is not open.' },
    })
  })

  it('refuses a second file and bytes that are not HDF5', async () => {
    const harness = createHarness()

    await expect(
      harness.send({
        op: 'open',
        source: { kind: 'bytes', bytes: new Uint8Array([1, 2, 3, 4]) },
        tree: false,
      }),
    ).resolves.toMatchObject({
      response: { ok: false, error: 'The file is not a readable HDF5 file.' },
    })

    await harness.send({
      op: 'open',
      source: { kind: 'bytes', bytes: await createAnnDataLikeFile() },
      tree: false,
    })
    await expect(
      harness.send({
        op: 'open',
        source: { kind: 'bytes', bytes: await createAnnDataLikeFile() },
        tree: false,
      }),
    ).resolves.toMatchObject({
      response: { ok: false, error: 'The H5 file worker already holds a file.' },
    })
  })

  it('runs requests in order, so a read sent with open waits for the file', async () => {
    const replies: H5FileWorkerResponse[] = []
    const handler = createH5FileHandler((response) => {
      replies.push(response)
    })
    const bytes = await createAnnDataLikeFile()

    await Promise.all([
      handler.handle({
        id: 1,
        op: 'open',
        source: { kind: 'bytes', bytes },
        tree: false,
      }),
      handler.handle({ id: 2, op: 'read', path: '/obs/cell_id' }),
    ])

    expect(replies.map((reply) => [reply.id, reply.ok])).toEqual([
      [1, true],
      [2, true],
    ])
  })

  it('reads feature-barcode matrix rows into a packed result', async () => {
    const harness = createHarness()
    await harness.send({
      op: 'open',
      source: {
        kind: 'bytes',
        bytes: await createH5Bytes((file) => {
          writeFeatureBarcodeMatrix(file, ['AAAC-1', 'TTGG-1'])
        }),
      },
      tree: false,
    })

    const first = await harness.send({
      op: 'matrix-cells',
      elementIds: ['TTGG-1', 'missing', 'AAAC-1'],
    })

    if (!first.response.ok || first.response.op !== 'matrix-cells') {
      throw new Error('Expected matrix cells.')
    }

    expect(first.transfer).toHaveLength(3)
    const result = unpackGexResult<string>(first.response.cells)
    expect(result.geneNames).toEqual(['Actb', 'Gad1'])
    expect(result.cells.get('AAAC-1')).toEqual({ geneNames: ['Actb'], counts: [5] })
    expect(result.cells.get('TTGG-1')).toEqual({
      geneNames: ['Actb', 'Gad1'],
      counts: [2, 3],
    })
    expect(result.cells.get('missing')).toEqual({ geneNames: [], counts: [] })

    // The barcodes are read once; a second request reuses them.
    const second = await harness.send({ op: 'matrix-cells', elementIds: ['AAAC-1'] })
    expect(second.response).toMatchObject({ ok: true, op: 'matrix-cells' })
  })

  it('fetches a URL source itself', async () => {
    const bytes = await createAnnDataLikeFile()
    const fetcher = vi.fn(async () => new Response(bytes.slice()))
    vi.stubGlobal('fetch', fetcher)

    try {
      const harness = createHarness()
      await expect(
        harness.send({
          op: 'open',
          source: { kind: 'url', url: 'https://example.test/a.h5', label: 'a.h5' },
          tree: false,
        }),
      ).resolves.toMatchObject({ response: { ok: true, op: 'open' } })
      expect(fetcher).toHaveBeenCalledWith('https://example.test/a.h5')
      await expect(
        harness.send({ op: 'read', path: '/obs/cell_id' }),
      ).resolves.toMatchObject({ response: { ok: true, value: ['a', 'b', 'c'] } })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('names a URL source in its HTTP error and keeps a fetch error name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('missing', { status: 404 })),
    )

    try {
      await expect(
        createHarness().send({
          op: 'open',
          source: { kind: 'url', url: 'https://example.test/a.h5', label: 'a.h5' },
          tree: false,
        }),
      ).resolves.toMatchObject({
        response: { ok: false, error: 'a.h5 returned HTTP 404.' },
      })

      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('Failed to fetch')
        }),
      )

      await expect(
        createHarness().send({
          op: 'open',
          source: { kind: 'url', url: 'https://example.test/a.h5', label: 'a.h5' },
          tree: false,
        }),
      ).resolves.toMatchObject({
        response: { ok: false, error: 'Failed to fetch', errorName: 'TypeError' },
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('answers a matrix read of a file without /matrix with an error', async () => {
    const harness = createHarness()
    await harness.send({
      op: 'open',
      source: { kind: 'bytes', bytes: await createAnnDataLikeFile() },
      tree: false,
    })

    await expect(
      harness.send({ op: 'matrix-cells', elementIds: ['a'] }),
    ).resolves.toMatchObject({
      response: { ok: false, error: 'Expected /matrix/barcodes to be an HDF5 dataset.' },
    })
  })
})
