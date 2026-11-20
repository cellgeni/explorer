import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AnySpatialDataset } from '../../datasets/datasetFactory'
import { useSectionColumns } from './useSectionColumns'

const TABLE = 'https://example.test/sections-int.h5ad'
const COLUMNS = [{ column: 'section', sectionCount: 3 }]

function loader(dataset: object) {
  return vi.fn(async () => dataset as AnySpatialDataset)
}

describe('useSectionColumns', () => {
  it("reads an AnnData table's section columns once it is open", async () => {
    const getSpatialDataset = loader({
      sectionColumns: async () => COLUMNS,
      sections: async () => [],
    })
    const { result } = renderHook(() =>
      useSectionColumns({ datasetUrl: TABLE, enabled: true, getSpatialDataset }),
    )

    expect(result.current).toEqual([])
    await waitFor(() => {
      expect(result.current).toEqual(COLUMNS)
    })
    expect(getSpatialDataset).toHaveBeenCalledWith(TABLE)
  })

  it('reads nothing for a section, while disabled, or before a dataset is open', () => {
    const getSpatialDataset = loader({})

    for (const props of [
      { datasetUrl: `${TABLE}#obs.section=1`, enabled: true },
      { datasetUrl: TABLE, enabled: false },
      { datasetUrl: null, enabled: true },
    ]) {
      const { result } = renderHook(() =>
        useSectionColumns({ ...props, getSpatialDataset }),
      )
      expect(result.current).toEqual([])
    }
    expect(getSpatialDataset).not.toHaveBeenCalled()
  })

  it('offers no columns for a dataset that cannot be split or fails to open', async () => {
    const failing = vi.fn(async () => {
      throw new Error('gone')
    })
    const { result: plain } = renderHook(() =>
      useSectionColumns({
        datasetUrl: TABLE,
        enabled: true,
        getSpatialDataset: loader({}),
      }),
    )
    const { result: failed } = renderHook(() =>
      useSectionColumns({ datasetUrl: TABLE, enabled: true, getSpatialDataset: failing }),
    )

    await waitFor(() => {
      expect(failing).toHaveBeenCalled()
    })
    expect(plain.current).toEqual([])
    expect(failed.current).toEqual([])
  })

  it('drops columns read for a table that is no longer open', async () => {
    let resolveFirst: (dataset: AnySpatialDataset) => void = () => undefined
    const getSpatialDataset = vi.fn(
      (url: string) =>
        new Promise<AnySpatialDataset>((resolve) => {
          if (url === TABLE) resolveFirst = resolve
          else
            resolve({
              sectionColumns: async () => [{ column: 'slice', sectionCount: 2 }],
              sections: async () => [],
            } as unknown as AnySpatialDataset)
        }),
    )
    const { result, rerender } = renderHook(
      ({ datasetUrl }: { readonly datasetUrl: string }) =>
        useSectionColumns({ datasetUrl, enabled: true, getSpatialDataset }),
      { initialProps: { datasetUrl: TABLE } },
    )

    rerender({ datasetUrl: 'https://example.test/other.h5ad' })
    await waitFor(() => {
      expect(result.current).toEqual([{ column: 'slice', sectionCount: 2 }])
    })
    resolveFirst({
      sectionColumns: async () => COLUMNS,
      sections: async () => [],
    } as unknown as AnySpatialDataset)
    await Promise.resolve()
    expect(result.current).toEqual([{ column: 'slice', sectionCount: 2 }])
  })
})
