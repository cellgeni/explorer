import { describe, expect, it } from 'vitest'
import {
  featureBarcodeMatrixH5Reader,
  type H5FileLike,
} from '../data/featureBarcodeMatrixH5'
import { createH5Bytes, writeLargeFeatureBarcodeMatrix } from '../test/h5Fixtures'
import {
  contentRangeSize,
  createXhrRangeRead,
  mountRangeFile,
  type RangeFileSystem,
} from './h5RangeFile'
import { RangeBlockCache } from './rangeBlockCache'

const KiB = 1024
let nextMountNumber = 1

async function loadH5wasm() {
  const h5wasm = (await import('h5wasm')).default
  const { FS } = await h5wasm.ready
  return { h5wasm, fs: FS as unknown as RangeFileSystem }
}

async function createMatrixFile() {
  let matrix: ReturnType<typeof writeLargeFeatureBarcodeMatrix> | null = null
  const bytes = await createH5Bytes((file) => {
    matrix = writeLargeFeatureBarcodeMatrix(file)
  })

  return {
    bytes,
    matrix: matrix as unknown as ReturnType<typeof writeLargeFeatureBarcodeMatrix>,
  }
}

// Mounts `bytes` as a range file whose requests can be made to fail.
async function mountBytes(bytes: Uint8Array) {
  const { h5wasm, fs } = await loadH5wasm()
  let failFrom = Number.POSITIVE_INFINITY
  const cache = new RangeBlockCache(
    bytes.byteLength,
    (start, end) => {
      if (end > failFrom) {
        throw new Error(`HTTP 503 for bytes ${start}-${end - 1}`)
      }

      return bytes.slice(start, end)
    },
    { blockSize: 4 * KiB, firstFetchBytes: 16 * KiB, maxFetchBytes: 256 * KiB },
  )
  const name = `vitest-range-${nextMountNumber}.h5`
  nextMountNumber += 1
  const range = mountRangeFile(fs, name, cache)

  return {
    h5wasm,
    fs,
    cache,
    range,
    failFrom(position: number) {
      failFrom = position
    },
  }
}

describe('mountRangeFile', () => {
  it('lets h5wasm read a matrix while fetching a fraction of the file', async () => {
    const { bytes, matrix } = await createMatrixFile()
    const { h5wasm, fs, cache, range } = await mountBytes(bytes)
    const file = new h5wasm.File(range.path, 'r')

    try {
      const read = featureBarcodeMatrixH5Reader(file as unknown as H5FileLike)
      const ids = [matrix.barcodes[123] ?? '', matrix.barcodes[30_001] ?? '']
      const result = read(ids)

      expect(result.cells.get(ids[0] ?? '')).toEqual(matrix.cell(123))
      expect(result.cells.get(ids[1] ?? '')).toEqual(matrix.cell(30_001))
      expect(range.takeError()).toBeNull()
      // The 2 MiB of padding is never read.
      expect(bytes.byteLength).toBeGreaterThan(2 * 1024 * KiB)
      expect(cache.stats().fetchedBytes).toBeLessThan(bytes.byteLength / 2)
    } finally {
      file.close()
      fs.unlink(range.path)
    }
  })

  it('records a failed read that h5wasm would hide, and keeps working after it', async () => {
    const { bytes, matrix } = await createMatrixFile()
    const { h5wasm, fs, range, failFrom } = await mountBytes(bytes)
    const file = new h5wasm.File(range.path, 'r')

    try {
      const indptr = file.get('/matrix/indptr') as { readonly value: unknown }
      failFrom(0)

      // h5wasm returns or throws something; either way the cause is recorded.
      try {
        void (file.get('/matrix/data') as { readonly value: unknown }).value
      } catch {
        // Checked below.
      }

      expect(range.takeError()?.message).toMatch(/^HTTP 503 for bytes \d+-\d+$/)
      expect(range.takeError()).toBeNull()

      failFrom(Number.POSITIVE_INFINITY)
      const read = featureBarcodeMatrixH5Reader(file as unknown as H5FileLike)
      const id = matrix.barcodes[7] ?? ''
      expect(read([id]).cells.get(id)).toEqual(matrix.cell(7))
      expect(indptr.value).toBeInstanceOf(BigInt64Array)
      expect(range.takeError()).toBeNull()
    } finally {
      file.close()
      fs.unlink(range.path)
    }
  })

  it('reports the size of the remote file to HDF5', async () => {
    const { bytes } = await createMatrixFile()
    const { fs, range } = await mountBytes(bytes)
    const stat = (fs as unknown as { stat(path: string): { size: number } }).stat(
      range.path,
    )

    expect(stat.size).toBe(bytes.byteLength)
    fs.unlink(range.path)
  })
})

interface FakeReply {
  readonly status?: number
  readonly body?: ArrayBuffer | null
  readonly error?: Error
}

// A synchronous XMLHttpRequest stand-in that answers from a list of replies.
function fakeRequests(replies: FakeReply[]) {
  const sent: { method: string; async: boolean; headers: Record<string, string> }[] = []
  const createRequest = () => {
    const reply = replies.shift() ?? { error: new Error('No reply left.') }
    const headers: Record<string, string> = {}
    let method = ''
    let async = true

    const request = {
      responseType: '',
      timeout: 0,
      status: 0,
      response: null as ArrayBuffer | null,
      open(nextMethod: string, _url: string, nextAsync: boolean) {
        method = nextMethod
        async = nextAsync
      },
      setRequestHeader(name: string, value: string) {
        headers[name] = value
      },
      send() {
        sent.push({ method, async, headers })

        if (reply.error !== undefined) {
          throw reply.error
        }

        request.status = reply.status ?? 206
        request.response = reply.body ?? null
      },
    }

    return request as unknown as XMLHttpRequest
  }

  return { sent, createRequest }
}

describe('createXhrRangeRead', () => {
  it('reads a range with one synchronous request', () => {
    const { sent, createRequest } = fakeRequests([
      { status: 206, body: new Uint8Array([1, 2, 3]).buffer },
    ])
    const read = createXhrRangeRead('https://example.test/m.h5', 'm.h5', {
      createRequest,
    })

    expect(read(10, 13)).toEqual(new Uint8Array([1, 2, 3]))
    expect(sent).toEqual([
      { method: 'GET', async: false, headers: { Range: 'bytes=10-12' } },
    ])
  })

  it('refuses a whole-file reply, an HTTP error and a short body', () => {
    const { createRequest } = fakeRequests([
      { status: 200, body: new ArrayBuffer(100) },
      { status: 403, body: null },
      { status: 206, body: new ArrayBuffer(2) },
    ])
    const read = createXhrRangeRead('https://example.test/m.h5', 'm.h5', {
      createRequest,
    })

    expect(() => read(0, 3)).toThrow(
      'm.h5 ignored a range request (HTTP 200 for bytes 0-2).',
    )
    expect(() => read(0, 3)).toThrow('m.h5 returned HTTP 403 for bytes 0-2.')
    expect(() => read(0, 3)).toThrow('m.h5 returned 2 bytes for bytes 0-2 (3 expected).')
  })

  it('retries a dropped connection and gives up after the last attempt', () => {
    const dropped = new Error('NetworkError')
    const { sent, createRequest } = fakeRequests([
      { error: dropped },
      { status: 0 },
      { status: 206, body: new ArrayBuffer(3) },
      { error: dropped },
      { error: dropped },
      { error: dropped },
    ])
    const read = createXhrRangeRead('https://example.test/m.h5', 'm.h5', {
      createRequest,
    })

    expect(read(0, 3)).toHaveLength(3)
    expect(sent).toHaveLength(3)
    expect(() => read(0, 3)).toThrow(
      'm.h5 bytes 0-2 failed after 3 attempts: NetworkError',
    )
  })
})

describe('contentRangeSize', () => {
  it('reads the total size, or null when there is none', () => {
    expect(contentRangeSize('bytes 0-1023/433324628')).toBe(433_324_628)
    expect(contentRangeSize('bytes 0-1023/*')).toBeNull()
    expect(contentRangeSize(null)).toBeNull()
    expect(contentRangeSize('nonsense')).toBeNull()
  })
})
