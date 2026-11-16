import { describe, expect, it, vi } from 'vitest'
import { createH5Bytes, writeTinyFeatureSlice } from '../test/h5Fixtures'
import {
  FeatureSliceFullFileBudgetExceededError,
  featureSliceBinningScale,
  gexFromVisiumFeatureSliceH5,
  parseVisiumFeatureSliceMetadata,
} from './visiumFeatureSlice'

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
    // The read runs under the shared load's own signal (15.5-E).
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/visium/feature_slice-fixture-a.h5',
      { signal: expect.any(AbortSignal) },
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

  it('reads hosted files in an H5 file worker that stays open', async () => {
    const bytes = await createTinyFeatureSliceH5()
    const fetcher = vi.fn(async () => new Response(bytes.slice()))
    const url = 'https://example.test/visium/range/feature_slice.h5'
    const stageLabels: string[] = []
    vi.stubGlobal('fetch', fetcher)

    try {
      const first = await gexFromVisiumFeatureSliceH5(
        url,
        [
          { id: 'BC-1', row: 1, col: 0 },
          { id: 'BC-empty', row: 8, col: 9 },
        ],
        ['Actb', 'Gad1', 'Actb'],
        {
          backend: 'lazy-range-worker',
          binSizeMicrometers: 16,
          onStageTiming: (timing) => {
            stageLabels.push(timing.label)
          },
        },
      )

      expect(first.geneNames).toEqual(['Actb', 'Gad1'])
      expect(first.cells.get('BC-1')).toEqual({
        geneNames: ['Actb', 'Gad1'],
        counts: [12, 4],
      })
      expect(first.cells.get('BC-empty')).toEqual({ geneNames: [], counts: [] })
      expect(stageLabels).toEqual(['Feature Slice H5 range read'])

      const second = await gexFromVisiumFeatureSliceH5(
        url,
        [{ id: 'BC-0', row: 0, col: 0 }],
        ['Actb'],
        { backend: 'lazy-range-worker', binSizeMicrometers: 16 },
      )

      expect(second.cells.get('BC-0')).toEqual({ geneNames: ['Actb'], counts: [5] })
      expect(fetcher).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('opens a hosted file again after a failed read', async () => {
    const notFeatureSlice = await createH5Bytes((file) => {
      file.create_group('features')
    })
    const fetcher = vi.fn(async () => new Response(notFeatureSlice.slice()))
    const url = 'https://example.test/visium/range/not_feature_slice.h5'
    const read = () =>
      gexFromVisiumFeatureSliceH5(url, [{ id: 'BC-0', row: 0, col: 0 }], ['Actb'], {
        backend: 'lazy-range-worker',
        binSizeMicrometers: 16,
      })
    vi.stubGlobal('fetch', fetcher)

    try {
      // h5wasm's message for the missing metadata_json attribute.
      await expect(read()).rejects.toThrow('error - name not defined!')
      await expect(read()).rejects.toThrow('error - name not defined!')
      expect(fetcher).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

function createTinyFeatureSliceH5(): Promise<Uint8Array> {
  return createH5Bytes(writeTinyFeatureSlice)
}
