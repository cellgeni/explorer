import { act, renderHook, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Annotation } from '../../data/annotation'
import type { CellId } from '../../data/cellid'
import type { OverviewCellDatum } from '../../rendering/deckLayerTypes'
import type { CellQueryCondition } from './cellQuery'
import { createCellQuerySession } from './cellQuerySession'
import { useCellQueryModel, type CellQueryModelInput } from './useCellQueryModel'

function cell(id: string, transcriptCount: number): OverviewCellDatum {
  return {
    id,
    position: [0, 0, 0],
    radiusPixels: 2,
    fillColor: [0, 0, 0, 255],
    transcriptCount,
  }
}

const CELLS = [cell('c1', 10), cell('c2', 25), cell('c3', 40), cell('c4', 5)]

function ids(...values: string[]): readonly CellId[] {
  return values as unknown as readonly CellId[]
}

const noop = () => undefined

interface HarnessProps {
  readonly initial?: readonly CellQueryCondition[]
  readonly overrides?: Partial<CellQueryModelInput>
}

// The hook with its conditions held in state, as App holds them, on a
// four-cell dataset with no sets, tracks or image unless given.
function useQueryHarness({ initial = [], overrides = {} }: HarnessProps) {
  const [conditions, setConditions] = useState(initial)
  return useCellQueryModel({
    open: true,
    available: true,
    datasetUrl: 'https://example.test/sample.h5ad',
    datasetReady: true,
    cells: CELLS,
    elementNoun: 'cells',
    annotations: [],
    datasetSets: [],
    annotationGroups: [],
    loadSetAnnotations: async () => [],
    savedSelections: [],
    loadSelectionCells: async () => [],
    metadataTracks: [],
    loadMetadataTrackValues: async () => [],
    conditions,
    onConditionsChange: setConditions,
    selectedCellId: null,
    onSelectCell: noop,
    onSaveClass: noop,
    pictureImage: null,
    loadCellOutlines: async () => new Map(),
    imageChannels: [],
    imageZPlane: null,
    appendDebugEvent: noop,
    createSession: () => createCellQuerySession(null),
    ...overrides,
  })
}

describe('useCellQueryModel', () => {
  it('keeps a condition on the set Clusters showed once Clusters shows another', async () => {
    const leiden: readonly Annotation<CellId>[] = [
      { id: 'analysis:leiden:0', label: 'leiden: T cells', cellIds: ids('c1', 'c2') },
      { id: 'analysis:leiden:1', label: 'leiden: B cells', cellIds: ids('c3', 'c4') },
    ]
    const kmeans: readonly Annotation<CellId>[] = [
      { id: 'analysis:kmeans:0', label: 'kmeans: A', cellIds: ids('c1') },
      { id: 'analysis:kmeans:1', label: 'kmeans: B', cellIds: ids('c2', 'c3', 'c4') },
    ]
    const annotationGroups = [
      { id: 'analysis:leiden', label: 'leiden' },
      { id: 'analysis:kmeans', label: 'kmeans' },
    ]
    const loadSetAnnotations = vi.fn<CellQueryModelInput['loadSetAnnotations']>(
      async (_url, options) => (options?.groupId === 'analysis:leiden' ? leiden : kmeans),
    )
    const { result, rerender } = renderHook(
      (props: HarnessProps) => useQueryHarness(props),
      {
        initialProps: {
          initial: [
            {
              kind: 'category',
              columnId: 'set:analysis:leiden',
              operator: 'in',
              classIds: ['analysis:leiden:1'],
            },
          ],
          // Clusters shows leiden; kmeans is the dataset's other set.
          overrides: {
            annotations: leiden,
            datasetSets: [{ groupId: 'analysis:kmeans', label: 'kmeans', classCount: 2 }],
            annotationGroups,
            loadSetAnnotations,
          },
        } as HarnessProps,
      },
    )
    await waitFor(() => {
      expect(result.current.status).toBe('2 of 4 cells match')
    })

    // Clusters shows kmeans: leiden is read for the condition alone.
    act(() => {
      rerender({
        overrides: {
          annotations: kmeans,
          datasetSets: [{ groupId: 'analysis:leiden', label: 'leiden', classCount: 2 }],
          annotationGroups,
          loadSetAnnotations,
        },
      })
    })

    await waitFor(() => {
      expect(loadSetAnnotations).toHaveBeenCalledWith(
        'https://example.test/sample.h5ad',
        expect.objectContaining({ groupId: 'analysis:leiden' }),
      )
    })
    await waitFor(() => {
      expect(result.current.status).toBe('2 of 4 cells match')
    })
    expect(result.current.conditions[0]?.message).toBeNull()
  })
})
