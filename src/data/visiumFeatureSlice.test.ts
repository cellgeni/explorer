import { describe, expect, it, vi } from 'vitest'
import { createH5Bytes, writeTinyFeatureSlice } from '../test/h5Fixtures'
import {
  featureSliceBinningScale,
  gexFromVisiumFeatureSliceH5,
  parseVisiumFeatureSliceMetadata,
  readVisiumFeatureSliceH5Metadata,
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

  it('parses the spot-to-pixel transform, and leaves out one it cannot read', () => {
    const metadata = (transform: unknown) =>
      parseVisiumFeatureSliceMetadata({
        nrows: 3350,
        ncols: 3350,
        spot_pitch: 2,
        transform_matrices: { spot_colrow_to_microscope_colrow: transform },
      })

    expect(
      metadata([
        [-9.03, 0.025, 32358.3],
        [0.025, 9.03, 6582.9],
        [2e-9, 1e-9, 1],
      ]).spotToFullresTransform,
    ).toEqual([-9.03, 0.025, 32358.3, 0.025, 9.03, 6582.9, 2e-9, 1e-9, 1])

    for (const malformed of [
      undefined,
      'identity',
      [
        [1, 0, 0],
        [0, 1, 0],
      ],
      [
        [1, 0, 0],
        [0, 1],
        [0, 0, 1],
      ],
      [
        [1, 0, 0],
        [0, 1, null],
        [0, 0, 1],
      ],
    ]) {
      expect(metadata(malformed)).toEqual({
        nrows: 3350,
        ncols: 3350,
        spotPitchMicrometers: 2,
      })
    }
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(bytes.slice())),
    )

    const result = await gexFromVisiumFeatureSliceH5(
      'https://example.test/visium/feature_slice-fixture-a.h5',
      [
        { id: 'BC-0', row: 0, col: 0 },
        { id: 'BC-1', row: 1, col: 0 },
        { id: 'BC-empty', row: 2, col: 2 },
      ],
      ['Actb', 'Gad1', 'NegControlProbe_001', 'Actb'],
      { binSizeMicrometers: 16 },
    ).finally(() => {
      vi.unstubAllGlobals()
    })

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
        { binSizeMicrometers: 16 },
      )

      expect(second.cells.get('BC-0')).toEqual({ geneNames: ['Actb'], counts: [5] })
      expect(fetcher).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reads a hosted file metadata in the worker its gene reads then use', async () => {
    const bytes = await createTinyFeatureSliceH5()
    const fetcher = vi.fn(async () => new Response(bytes.slice()))
    const url = 'https://example.test/visium/metadata/feature_slice.h5'
    vi.stubGlobal('fetch', fetcher)

    try {
      await expect(readVisiumFeatureSliceH5Metadata(url)).resolves.toEqual({
        nrows: 32,
        ncols: 32,
        spotPitchMicrometers: 2,
        spotToFullresTransform: [8, 0, 100, 0, 8, 200, 0, 0, 1],
      })

      const genes = await gexFromVisiumFeatureSliceH5(
        url,
        [{ id: 'BC-0', row: 0, col: 0 }],
        ['Actb'],
        { binSizeMicrometers: 16 },
      )

      expect(genes.cells.get('BC-0')).toEqual({ geneNames: ['Actb'], counts: [5] })
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
