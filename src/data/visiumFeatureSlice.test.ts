import { describe, expect, it, vi } from 'vitest'
import {
  FeatureSliceFullFileBudgetExceededError,
  featureSliceBinningScale,
  gexFromVisiumFeatureSliceH5,
  parseVisiumFeatureSliceMetadata,
  type VisiumFeatureSliceWorkerLike,
} from './visiumFeatureSlice'
import type {
  VisiumFeatureSliceWorkerRequest,
  VisiumFeatureSliceWorkerResponse,
} from '../workers/visiumFeatureSliceMessages'

describe('Visium HD Feature Slice H5', () => {
  it('parses Feature Slice metadata', () => {
    expect(
      parseVisiumFeatureSliceMetadata(
        JSON.stringify({
          nrows: 3350,
          ncols: 3340,
          spot_pitch: 2,
        }),
      ),
    ).toEqual({
      nrows: 3350,
      ncols: 3340,
      spotPitchMicrometers: 2,
    })
  })

  it('normalizes integer binning scales from 2 µm feature slices', () => {
    expect(featureSliceBinningScale(8, 2)).toBe(4)
    expect(featureSliceBinningScale(16, 2)).toBe(8)
    expect(() => featureSliceBinningScale(10, 3)).toThrow(
      'cannot be represented as an integer multiple',
    )
  })

  it('reads selected feature COO slices and bins them to active Visium HD bins', async () => {
    const bytes = await createTinyFeatureSliceH5()
    const body = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(body).set(bytes)
    const fetcher = vi.fn(async () => new Response(body))

    const result = await gexFromVisiumFeatureSliceH5(
      'https://example.test/visium/feature_slice-fixture-a.h5',
      [
        { id: 'BC-0', row: 0, col: 0 },
        { id: 'BC-1', row: 1, col: 0 },
        { id: 'BC-empty', row: 2, col: 2 },
      ],
      ['Actb', 'Gad1', 'NegControlProbe_001', 'Actb'],
      {
        binSizeMicrometers: 16,
        fetcher,
      },
    )

    expect(result.geneNames).toEqual(['Actb', 'Gad1', 'NegControlProbe_001'])
    expect(result.cells.get('BC-0')).toEqual({
      geneNames: ['Actb'],
      counts: [5],
    })
    expect(result.cells.get('BC-1')).toEqual({
      geneNames: ['Actb', 'Gad1'],
      counts: [12, 4],
    })
    expect(result.cells.get('BC-empty')).toEqual({
      geneNames: [],
      counts: [],
    })
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/visium/feature_slice-fixture-a.h5',
      {},
    )
  })

  it('rejects oversized Feature Slice H5 files before full fetch', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        return new Response(null, {
          headers: {
            'content-length': String(512 * 1024 * 1024),
          },
        })
      }

      throw new Error('Unexpected full Feature Slice fetch')
    })

    await expect(
      gexFromVisiumFeatureSliceH5(
        'https://example.test/visium/feature_slice-too-large.h5',
        [{ id: 'BC-0', row: 0, col: 0 }],
        ['Actb'],
        {
          binSizeMicrometers: 16,
          fetcher,
          maxFullFileBytes: 128 * 1024 * 1024,
        },
      ),
    ).rejects.toBeInstanceOf(FeatureSliceFullFileBudgetExceededError)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'HEAD' })
  })

  it('dispatches hosted reads through the lazy range worker backend', async () => {
    const workers: FakeFeatureSliceWorker[] = []
    const workerFactory = () => {
      const worker = new FakeFeatureSliceWorker((request) => ({
        id: request.id,
        ok: true,
        geneNames: request.genes,
        cells: [
          {
            id: 'BC-1',
            geneNames: ['Actb'],
            counts: [9],
          },
        ],
      }))
      workers.push(worker)
      return worker
    }
    const stageLabels: string[] = []

    const result = await gexFromVisiumFeatureSliceH5(
      'https://example.test/visium/feature_slice.h5',
      [
        { id: 'BC-1', row: 3, col: 4 },
        { id: 'BC-empty', row: 8, col: 9 },
      ],
      ['Actb', 'Actb'],
      {
        backend: 'lazy-range-worker',
        binSizeMicrometers: 16,
        maxFullFileBytes: 1,
        workerFactory,
        onStageTiming: (timing) => {
          stageLabels.push(timing.label)
        },
      },
    )

    expect(workers).toHaveLength(1)
    expect(workers[0]?.requests).toEqual([
      expect.objectContaining({
        url: 'https://example.test/visium/feature_slice.h5',
        genes: ['Actb'],
        binSizeMicrometers: 16,
        targets: [
          { id: 'BC-1', row: 3, col: 4 },
          { id: 'BC-empty', row: 8, col: 9 },
        ],
      }),
    ])
    expect(workers[0]?.terminated).toBe(true)
    expect(stageLabels).toEqual(['Feature Slice H5 lazy range read'])
    expect(result.geneNames).toEqual(['Actb'])
    expect(result.cells.get('BC-1')).toEqual({
      geneNames: ['Actb'],
      counts: [9],
    })
    expect(result.cells.get('BC-empty')).toEqual({
      geneNames: [],
      counts: [],
    })
  })
})

class FakeFeatureSliceWorker implements VisiumFeatureSliceWorkerLike {
  onmessage: ((event: MessageEvent<VisiumFeatureSliceWorkerResponse>) => void) | null =
    null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly requests: VisiumFeatureSliceWorkerRequest[] = []
  terminated = false

  constructor(
    private readonly respond: (
      request: VisiumFeatureSliceWorkerRequest,
    ) => VisiumFeatureSliceWorkerResponse,
  ) {}

  postMessage(message: VisiumFeatureSliceWorkerRequest): void {
    this.requests.push(message)
    const response = this.respond(message)

    queueMicrotask(() => {
      this.onmessage?.({
        data: response,
      } as MessageEvent<VisiumFeatureSliceWorkerResponse>)
    })
  }

  terminate(): void {
    this.terminated = true
  }
}

async function createTinyFeatureSliceH5(): Promise<Uint8Array> {
  const h5wasm = (await import('h5wasm')).default
  const { FS } = await h5wasm.ready
  const fileName = '/vitest-visium-feature-slice.h5'

  try {
    FS.unlink(fileName)
  } catch {
    // No previous fixture file exists for the first run.
  }

  const file = new h5wasm.File(fileName, 'w')
  file.create_attribute(
    'metadata_json',
    JSON.stringify({
      nrows: 32,
      ncols: 32,
      spot_pitch: 2,
    }),
  )
  const features = file.create_group('features')
  features.create_dataset({
    name: 'name',
    data: ['Actb', 'Gad1', 'NegControlProbe_001'],
  })
  features.create_dataset({
    name: 'feature_type',
    data: ['Gene Expression', 'Gene Expression', 'Gene Expression'],
  })

  const featureSlices = file.create_group('feature_slices')
  const actb = featureSlices.create_group('0')
  actb.create_dataset({ name: 'row', data: new Int32Array([0, 7, 8, 9, 16]) })
  actb.create_dataset({ name: 'col', data: new Int32Array([0, 0, 0, 1, 0]) })
  actb.create_dataset({ name: 'data', data: new Int32Array([2, 3, 5, 7, 11]) })

  const gad1 = featureSlices.create_group('1')
  gad1.create_dataset({ name: 'row', data: new Int32Array([8]) })
  gad1.create_dataset({ name: 'col', data: new Int32Array([0]) })
  gad1.create_dataset({ name: 'data', data: new Int32Array([4]) })

  const negative = featureSlices.create_group('2')
  negative.create_dataset({ name: 'row', data: new Int32Array([0]) })
  negative.create_dataset({ name: 'col', data: new Int32Array([0]) })
  negative.create_dataset({ name: 'data', data: new Int32Array([99]) })
  file.close()

  const bytes = FS.readFile(fileName)
  FS.unlink(fileName)

  return bytes
}
