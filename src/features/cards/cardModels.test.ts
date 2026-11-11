import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ViewerTranscriptHoverDetail } from '../../components/ViewerCore'
import { micrometers, type BBox } from '../../data/coords'
import type { RoiSelection } from '../../data/roiSelection'
import type {
  CellBoundaryDatum,
  GridCellDatum,
  OverviewCellDatum,
} from '../../rendering/deckLayers'
import type { MagicLensState } from '../roi/magicLensModel'
import type { RoiState } from '../roi/roiModel'
import {
  binsSelectionCard,
  cellCard,
  cellsSelectionCard,
  geometrySelectionCard,
  magicLensCard,
  selectionSummary,
  transcriptCard,
  useCardStackModel,
} from './cardModels'

const BBOX: BBox = {
  minX: micrometers(0),
  minY: micrometers(0),
  maxX: micrometers(100),
  maxY: micrometers(50),
}
const SELECTION: RoiSelection = { kind: 'box', bbox: BBOX }
const SUMMARY = {
  transcriptCount: 10,
  cellCount: 2,
  geneCount: 1,
  selectedGeneTranscriptCount: 0,
  topGenes: [],
  hitLimit: false,
}

function lens(state: MagicLensState = { status: 'idle' }) {
  return { available: true, enabled: true, label: 'Transcripts', state, onRun: vi.fn() }
}

function cellsInput(roiState: RoiState) {
  return {
    elementNoun: { singular: 'cell', plural: 'cells' },
    genes: { copy: 'Genes loading', state: { status: 'idle' as const } },
    lens: lens(),
    loading: false,
    name: 'ROI 1',
    nameDisabled: false,
    onClose: vi.fn(),
    onExportCells: vi.fn(),
    onExportGeoJson: vi.fn(),
    onExportTranscripts: vi.fn(),
    onNameChange: vi.fn(),
    onSave: vi.fn(),
    roiState,
    status: '6,229 cells',
    summary: { cellCount: 6229, meanTranscriptCount: 112.25, meanCellArea: 48 },
    transcriptExportState: { status: 'idle' as const },
  }
}

describe('selection card', () => {
  it('counts the selection and gives its area', () => {
    expect(
      selectionSummary(6229, { singular: 'cell', plural: 'cells' }, false, SELECTION),
    ).toBe('6,229 cells · 5,000 µm²')
    expect(
      selectionSummary(1, { singular: 'bin', plural: 'bins' }, true, {
        kind: 'lasso',
        bbox: BBOX,
        points: [
          { x: micrometers(0), y: micrometers(0) },
          { x: micrometers(4), y: micrometers(0) },
          { x: micrometers(0), y: micrometers(3) },
        ],
      }),
    ).toBe('1+ bin · 6 µm²')
  })

  it('shows a cell selection once there is one', () => {
    expect(cellsSelectionCard(cellsInput({ status: 'idle' }))).toBeNull()

    const card = cellsSelectionCard(
      cellsInput({
        status: 'ready',
        url: 'https://example.test',
        bbox: BBOX,
        selection: SELECTION,
        cells: [],
        hitCellLimit: true,
      }),
    )

    expect(card).toMatchObject({
      variant: 'cells',
      nameLabel: 'ROI name',
      summary: '6,229+ cells · 5,000 µm²',
      elementsLabel: 'Cells',
      ready: true,
      stats: [
        { label: 'Cells', value: '6,229+' },
        { label: 'Mean transcripts', value: '112.3' },
        { label: 'Mean area', value: '48' },
      ],
    })
    expect(
      card?.variant === 'geometry' ? [] : card?.exports.map((action) => action.label),
    ).toEqual(['Export GeoJSON', 'Export Cells', 'Export Transcripts'])
  })

  it('keeps exports off while the selection loads, and marks a running export', () => {
    const card = cellsSelectionCard({
      ...cellsInput({
        status: 'loading',
        url: 'https://example.test',
        bbox: BBOX,
        selection: SELECTION,
      }),
      transcriptExportState: { status: 'loading', url: 'https://example.test' },
    })

    expect(card).toMatchObject({ ready: false })
    expect(card?.variant === 'geometry' ? null : card?.exports[2]).toMatchObject({
      busy: true,
      busyLabel: 'Exporting…',
    })
  })

  it('shows only a Magic Lens result for the selection', () => {
    const ready = {
      status: 'ready',
      url: 'https://example.test',
      bbox: BBOX,
      selection: SELECTION,
      cells: [],
      hitCellLimit: false,
    } as const
    const forView = cellsSelectionCard({
      ...cellsInput(ready),
      lens: lens({ status: 'ready', url: '', scope: 'viewport', summary: SUMMARY }),
    })
    const forSelection = cellsSelectionCard({
      ...cellsInput(ready),
      lens: lens({ status: 'loading', url: '', scope: 'roi' }),
    })
    const unavailable = cellsSelectionCard({
      ...cellsInput(ready),
      lens: { ...lens(), available: false },
    })

    expect(forView?.variant === 'geometry' ? null : forView?.lens).toMatchObject({
      state: { status: 'idle' },
      canRun: true,
    })
    expect(
      forSelection?.variant === 'geometry' ? null : forSelection?.lens,
    ).toMatchObject({ state: { status: 'loading', scope: 'roi' }, canRun: false })
    expect(unavailable?.variant === 'geometry' ? undefined : unavailable?.lens).toBeNull()
  })

  it('shows a Visium HD bin selection with its bin size', () => {
    const card = binsSelectionCard({
      genes: { copy: '', state: { status: 'idle' } },
      lens: lens(),
      name: 'ROI 2',
      nameDisabled: false,
      onClose: vi.fn(),
      onExportBarcodes: vi.fn(),
      onExportGeoJson: vi.fn(),
      onNameChange: vi.fn(),
      roiState: {
        status: 'ready',
        url: 'https://example.test',
        bbox: BBOX,
        selection: SELECTION,
        bins: [],
        hitBinLimit: false,
      },
      status: '12 bins',
      summary: { binCount: 12, inTissueCount: 10, binSizeMicrometers: 8 },
    })

    expect(card).toMatchObject({
      variant: 'bins',
      summary: '12 bins · 5,000 µm²',
      elementsLabel: 'Bins',
      onSave: null,
      stats: [
        { label: 'Bins', value: '12' },
        { label: 'Bin size', value: '8 µm' },
        { label: 'In tissue', value: '10' },
      ],
      genes: { emptyMessage: 'No detected ROI gene expression' },
    })
  })

  it('names the next shape on an image while drawing', () => {
    const input = {
      name: 'Shape 3',
      nameDisabled: false,
      onClose: vi.fn(),
      onNameChange: vi.fn(),
      shapeCount: 2,
    }

    expect(geometrySelectionCard({ ...input, drawing: null })).toBeNull()
    expect(geometrySelectionCard({ ...input, drawing: 'lasso' })).toMatchObject({
      variant: 'geometry',
      nameLabel: 'Shape name',
      status: 'Drawing lasso · 2 shapes',
      closeTitle: 'Stop drawing',
    })
  })
})

describe('cell card', () => {
  const cell = { id: 'cell-1' } as OverviewCellDatum
  const boundary = { id: 'boundary-1' } as CellBoundaryDatum
  const bin = { id: 'bin-1' } as GridCellDatum

  function input(selected: {
    readonly cell?: OverviewCellDatum
    readonly boundary?: CellBoundaryDatum
    readonly bin?: GridCellDatum
  }) {
    return {
      cell: {
        selected: selected.cell ?? null,
        title: 'Spot',
        status: 'Loading',
        annotationLabels: [],
        state: {
          status: 'loading',
          url: 'https://example.test',
          cellId: 'cell-1',
        } as const,
        distributionState: { status: 'idle' } as const,
        distributionVisible: true,
        variant: 'default' as const,
      },
      boundary: { selected: selected.boundary ?? null, expressionStatus: undefined },
      gridCell: {
        selected: selected.bin ?? null,
        assignmentState: { status: 'idle' } as const,
        expressionStatus: undefined,
      },
      profile: { state: undefined, onLoad: undefined },
      onClose: vi.fn(),
    }
  }

  it('shows the selected cell, spot, bin or Visium HD cell', () => {
    expect(cellCard(input({}))).toBeNull()
    expect(cellCard(input({ cell }))).toMatchObject({
      kind: 'cell',
      title: 'Spot',
      loading: true,
    })
    expect(cellCard(input({ bin }))).toMatchObject({ kind: 'bin', title: 'Bin' })
    expect(cellCard(input({ bin, boundary }))).toMatchObject({
      kind: 'boundary',
      title: 'Cell',
    })
  })
})

describe('transcript card', () => {
  it('shows the pinned transcript or bin', () => {
    const point = { transcript: { id: 't1' } } as ViewerTranscriptHoverDetail
    const bin = { aggregate: { featureName: 'SNAP25' } } as ViewerTranscriptHoverDetail
    const base = { capabilityState: { status: 'idle' } as const, onClose: vi.fn() }

    expect(transcriptCard({ ...base, pinned: null })).toBeNull()
    expect(transcriptCard({ ...base, pinned: point })).toMatchObject({
      title: 'Transcript',
      showFov: true,
    })
    expect(transcriptCard({ ...base, pinned: bin })?.title).toBe('Feature bin')
    expect(
      transcriptCard({
        ...base,
        capabilityState: {
          status: 'ready',
          capabilities: { geneRanges: {} },
        } as never,
        pinned: { aggregate: {} } as ViewerTranscriptHoverDetail,
      }),
    ).toMatchObject({ title: 'Density bin', showFov: false })
  })
})

describe('magic lens card', () => {
  const base = { onClose: vi.fn(), status: 'Move cursor' }

  it('holds the cursor lens and Summarise View, not a selection', () => {
    expect(
      magicLensCard({ ...base, cursorActive: false, state: { status: 'idle' } }),
    ).toBe(null)
    expect(
      magicLensCard({ ...base, cursorActive: true, state: { status: 'idle' } }),
    ).toMatchObject({ scope: 'cursor', loading: false })
    expect(
      magicLensCard({
        ...base,
        cursorActive: false,
        state: { status: 'loading', url: '', scope: 'viewport' },
      }),
    ).toMatchObject({ scope: 'viewport', loading: true })
    expect(
      magicLensCard({
        ...base,
        cursorActive: false,
        state: { status: 'ready', url: '', scope: 'roi', summary: SUMMARY },
      }),
    ).toBeNull()
  })
})

describe('useCardStackModel', () => {
  it('builds the selection card for the platform and leaves out missing cards', () => {
    const { result } = renderHook(() =>
      useCardStackModel({
        selection: {
          variant: 'geometry',
          drawing: 'box',
          name: 'Shape 1',
          nameDisabled: false,
          onClose: vi.fn(),
          onNameChange: vi.fn(),
          shapeCount: 0,
        },
        cell: {
          cell: {
            selected: null,
            title: 'Cell',
            status: 'No selection',
            annotationLabels: [],
            state: { status: 'idle' },
            distributionState: { status: 'idle' },
            distributionVisible: false,
            variant: 'default',
          },
          boundary: { selected: null, expressionStatus: undefined },
          gridCell: {
            selected: null,
            assignmentState: { status: 'idle' },
            expressionStatus: undefined,
          },
          profile: { state: undefined, onLoad: undefined },
          onClose: vi.fn(),
        },
        transcript: null,
        magicLens: null,
      }),
    )

    expect(result.current).toMatchObject({
      selection: { variant: 'geometry', status: 'Drawing box · 0 shapes' },
      cell: null,
      transcript: null,
      magicLens: null,
    })
  })
})
