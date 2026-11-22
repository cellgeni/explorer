import { useState } from 'react'
import type { CellId } from '../data/cellid'
import type { CellQueryCondition } from '../features/query/cellQuery'
import { createCellQuerySession } from '../features/query/cellQuerySession'
import {
  useCellQueryModel,
  type CellQueryModelInput,
} from '../features/query/useCellQueryModel'
import type { OverviewCellDatum } from '../rendering/deckLayerTypes'

// Cell Query's model with its conditions held in state, as App holds them,
// on four cells (transcripts 10, 25, 40 and 5) with no sets, tracks or
// image unless the overrides give them.

export const CELL_QUERY_TEST_URL = 'https://example.test/sample.h5ad'

function cell(id: string, transcriptCount: number): OverviewCellDatum {
  return {
    id,
    position: [0, 0, 0],
    radiusPixels: 2,
    fillColor: [0, 0, 0, 255],
    transcriptCount,
  }
}

export const CELL_QUERY_TEST_CELLS: readonly OverviewCellDatum[] = [
  cell('c1', 10),
  cell('c2', 25),
  cell('c3', 40),
  cell('c4', 5),
]

export function testCellIds(...values: string[]): readonly CellId[] {
  return values as unknown as readonly CellId[]
}

export interface CellQueryHarnessProps {
  readonly initial?: readonly CellQueryCondition[]
  readonly overrides?: Partial<CellQueryModelInput>
}

const noop = () => undefined

export function useCellQueryHarness({
  initial = [],
  overrides = {},
}: CellQueryHarnessProps) {
  const [conditions, setConditions] = useState(initial)
  return useCellQueryModel({
    open: true,
    available: true,
    datasetUrl: CELL_QUERY_TEST_URL,
    datasetReady: true,
    cells: CELL_QUERY_TEST_CELLS,
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
