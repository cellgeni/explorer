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
  bboxAroundDeckPoint,
  bboxAroundDeckPolygon,
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
    genes: {
      copy: 'Genes loading',
      state: { status: 'idle' as const },
      reference: { status: 'idle' as const },
      selectedGenes: [],
      onShowGene: vi.fn(),
    },
    lens: lens(),
    loading: false,
    name: 'ROI 1',
    nameDisabled: false,
    onClose: vi.fn(),
    onDelete: vi.fn(),
    onExportCells: vi.fn(),
    onExportGeoJson: vi.fn(),
    onExportTranscripts: vi.fn(),
    onNameChange: vi.fn(),
    onSave: vi.fn(),
    roiState,
    status: '6,229 cells',
    summary: { cellCount: 6229, meanTranscriptCount: 112.25, meanCellArea: 48 },
    transcriptExportState: { status: 'idle' as const },
    zoomToBbox: vi.fn(),
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
        { label: 'Mean area', value: '48 µm²' },
      ],
    })
    expect(
      card?.variant === 'geometry' ? [] : card?.exports.map((action) => action.label),
    ).toEqual(['Export GeoJSON', 'Export Cells', 'Export Transcripts'])
  })

  it('offers Export Transcripts only where the platform reads transcripts', () => {
    const card = cellsSelectionCard({
      ...cellsInput({
        status: 'ready',
        url: 'https://example.test',
        bbox: BBOX,
        selection: SELECTION,
        cells: [],
        hitCellLimit: false,
      }),
      onExportTranscripts: null,
    })

    expect(
      card?.variant === 'geometry' ? [] : card?.exports.map((action) => action.label),
    ).toEqual(['Export GeoJSON', 'Export Cells'])
  })

  it('writes areas in units where the dataset has none', () => {
    const card = cellsSelectionCard({
      ...cellsInput({
        status: 'ready',
        url: 'https://example.test',
        bbox: BBOX,
        selection: SELECTION,
        cells: [],
        hitCellLimit: false,
      }),
      unitLabel: 'units',
    })

    expect(card).toMatchObject({
      summary: '6,229 cells · 5,000 units²',
      stats: [{}, {}, { label: 'Mean area', value: '48 units²' }],
    })
  })

  it('leaves out means the cells carry no value for', () => {
    const card = cellsSelectionCard({
      ...cellsInput({
        status: 'ready',
        url: 'https://example.test',
        bbox: BBOX,
        selection: SELECTION,
        cells: [],
        hitCellLimit: false,
      }),
      summary: { cellCount: 12, meanTranscriptCount: undefined, meanCellArea: undefined },
    })

    expect(card?.variant === 'geometry' ? [] : card?.stats).toEqual([
      { label: 'Cells', value: '12' },
    ])
  })

  it('goes to the whole selection', () => {
    const input = cellsInput({
      status: 'ready',
      url: 'https://example.test',
      bbox: BBOX,
      selection: SELECTION,
      cells: [],
      hitCellLimit: false,
    })
    const card = cellsSelectionCard(input)

    if (card?.variant !== 'cells') throw new Error('Expected a cell selection')
    card.onGoTo()

    expect(input.zoomToBbox).toHaveBeenCalledWith(BBOX)
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
      genes: {
        copy: '',
        state: { status: 'idle' },
        reference: { status: 'idle' },
        selectedGenes: [],
        onShowGene: vi.fn(),
      },
      lens: lens(),
      name: 'ROI 2',
      nameDisabled: false,
      onClose: vi.fn(),
      onDelete: vi.fn(),
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
      zoomToBbox: vi.fn(),
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

  it('sizes a selection holding no bin by its tier, never "0"', () => {
    const input = {
      genes: {
        copy: '',
        state: { status: 'idle' as const },
        reference: { status: 'idle' as const },
        selectedGenes: [],
        onShowGene: vi.fn(),
      },
      lens: lens(),
      name: 'ROI 3',
      nameDisabled: false,
      onClose: vi.fn(),
      onDelete: vi.fn(),
      onExportBarcodes: vi.fn(),
      onExportGeoJson: vi.fn(),
      onNameChange: vi.fn(),
      status: '0 bins',
      summary: { binCount: 0, inTissueCount: undefined, binSizeMicrometers: undefined },
      zoomToBbox: vi.fn(),
    }
    const roiState = {
      status: 'ready' as const,
      url: 'https://example.test',
      bbox: BBOX,
      selection: SELECTION,
      bins: [],
      hitBinLimit: false,
    }
    const binSizeOf = (card: ReturnType<typeof binsSelectionCard>) =>
      card?.variant === 'bins'
        ? card.stats.find((stat) => stat.label === 'Bin size')?.value
        : undefined

    expect(
      binSizeOf(
        binsSelectionCard({
          ...input,
          roiState: { ...roiState, binSizeMicrometers: 16 },
        }),
      ),
    ).toBe('16 µm')
    expect(binSizeOf(binsSelectionCard({ ...input, roiState }))).toBeUndefined()
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
    readonly nuclei?: readonly CellBoundaryDatum[]
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
      nuclei: selected.nuclei ?? [],
      onClose: vi.fn(),
      zoomToBbox: vi.fn(),
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

  it('carries the selected cell nuclei to the cell and boundary cards', () => {
    const nuclei = [{ id: 'nucleus-1', cellId: 'cell-1' } as CellBoundaryDatum]

    expect(cellCard(input({ cell, nuclei }))).toMatchObject({ kind: 'cell', nuclei })
    expect(cellCard(input({ boundary, nuclei }))).toMatchObject({
      kind: 'boundary',
      nuclei,
    })
  })
})

describe('Go To regions', () => {
  it('turns deck.gl points and polygons into data boxes, y down', () => {
    expect(bboxAroundDeckPoint([10, -20, 0], 5)).toEqual({
      minX: 5,
      maxX: 15,
      minY: 15,
      maxY: 25,
    })
    expect(
      bboxAroundDeckPolygon(
        [
          [0, -10],
          [8, -10],
          [8, -4],
        ],
        1,
      ),
    ).toEqual({ minX: -1, maxX: 9, minY: 3, maxY: 11 })
  })

  it('goes to a cell, a bin and a pinned transcript', () => {
    const zoomToBbox = vi.fn()
    const card = cellCard({
      cell: {
        selected: { id: 'cell-1', position: [100, -200] } as unknown as OverviewCellDatum,
        title: 'Cell',
        status: 'Selected',
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
      nuclei: [],
      onClose: vi.fn(),
      zoomToBbox,
    })
    const transcript = transcriptCard({
      capabilityState: { status: 'idle' },
      onClose: vi.fn(),
      pinned: {
        aggregate: { position: [0, 0], binSizeMicrometers: 16 },
      } as unknown as ViewerTranscriptHoverDetail,
      zoomToBbox,
    })

    card?.onGoTo()
    transcript?.onGoTo()

    expect(zoomToBbox).toHaveBeenNthCalledWith(1, {
      minX: 60,
      maxX: 140,
      minY: 160,
      maxY: 240,
    })
    expect(zoomToBbox).toHaveBeenNthCalledWith(2, {
      minX: -32,
      maxX: 32,
      minY: -32,
      maxY: 32,
    })
  })
})

describe('transcript card', () => {
  it('shows the pinned transcript or bin', () => {
    const point = { transcript: { id: 't1' } } as ViewerTranscriptHoverDetail
    const bin = { aggregate: { featureName: 'SNAP25' } } as ViewerTranscriptHoverDetail
    const base = {
      capabilityState: { status: 'idle' } as const,
      onClose: vi.fn(),
      zoomToBbox: vi.fn(),
    }

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
          nuclei: [],
          onClose: vi.fn(),
        },
        transcript: null,
        magicLens: null,
        zoomToBbox: vi.fn(),
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
