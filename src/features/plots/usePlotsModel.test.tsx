import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Annotation } from '../../data/annotation'
import type { GeneValuesSource } from '../../data/geneValues'
import { usePlotsModel, type PlotsModelInput } from './usePlotsModel'

const ROW_IDS = ['a', 'b', 'c', 'd']
const annotations: readonly Annotation<string>[] = [
  { id: 'analysis:cluster:a', label: 'cluster: A', cellIds: ['a', 'b'] },
  { id: 'analysis:cluster:b', label: 'cluster: B', cellIds: ['c', 'd'] },
]
const allClasses = annotations.map((annotation) => ({
  id: annotation.id,
  color: '#123456',
}))

// A scaled matrix: a negative value, so log1p is off.
const source: GeneValuesSource = {
  geneValuesRowIds: async () => ROW_IDS,
  estimateGeneValuesRead: async () => ({ kind: 'read', bytes: 0 }),
  geneValues: async (genes) =>
    genes.map((gene) => ({
      gene,
      rows: new Uint32Array([0, 2]),
      values: new Float32Array([-1.5, 2.5]),
    })),
}
const getSpatialDataset = (async () =>
  source) as unknown as PlotsModelInput['getSpatialDataset']
const selectedGenes = ['Actb']

function input(visibleClasses: PlotsModelInput['visibleClasses']): PlotsModelInput {
  return {
    open: true,
    plotKind: 'dot',
    onPlotKindChange: vi.fn(),
    available: true,
    datasetUrl: 'https://example.test/scaled.h5ad',
    datasetReady: true,
    platformLabel: 'H5AD',
    getSpatialDataset,
    annotations,
    visibleClasses,
    selection: null,
    savedSelections: [],
    loadSelectionCells: vi.fn(),
    datasetSets: [],
    loadSetAnnotations: vi.fn(),
    selectedGenes,
    colorScale: 'viridis',
    elementNoun: 'cells',
    appendDebugEvent: vi.fn(),
  }
}

describe('usePlotsModel', () => {
  it('says it is grouping, not that no gene could be read, while the groups change', async () => {
    const seen: { message: string | null; loading: boolean; log1pAvailable: boolean }[] =
      []
    const { result, rerender } = renderHook(
      (props: PlotsModelInput) => {
        const model = usePlotsModel(props)
        if (model.plot === null) {
          seen.push({
            message: model.message,
            loading: model.loading,
            log1pAvailable: model.log1pAvailable,
          })
        }
        return model
      },
      { initialProps: input(allClasses) },
    )
    await waitFor(() => {
      expect(result.current.plot).not.toBeNull()
    })
    seen.length = 0

    // Hide class B: the read gene is grouped anew in the worker.
    act(() => {
      rerender(input(allClasses.slice(0, 1)))
    })
    await waitFor(() => {
      expect(result.current.plot).not.toBeNull()
    })

    expect(seen.length).toBeGreaterThan(0)
    expect(seen).toEqual(
      seen.map(() => ({
        message: 'Grouping the cells…',
        loading: true,
        log1pAvailable: false,
      })),
    )
  })
})
