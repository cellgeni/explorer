import type { ViewerTranscriptHoverDetail } from '../../components/ViewerCore'
import { micrometers, type BBox } from '../../data/coords'
import { roiSelectionArea, type RoiSelection } from '../../data/roiSelection'
import { formatSquareMicrometers, withMicrometers } from '../../data/units'
import type {
  CellBoundaryDatum,
  GridCellDatum,
  OverviewCellDatum,
} from '../../rendering/deckLayers'
import type { CellInfoPanelVariant } from '../cells/CellInfoPanel'
import type {
  CellDetailState,
  CellTranscriptDistributionState,
} from '../cells/cellDetailModel'
import type { CellExpressionProfileState } from '../cells/cellExpressionProfileModel'
import type { CellGeneExpressionStatus } from '../cells/cellGeneExpressionStatus'
import type { GridCellAssignmentState } from '../cells/gridCellAssignmentModel'
import type { MagicLensScope, MagicLensState } from '../roi/magicLensModel'
import type {
  RoiGeneStatsState,
  RoiState,
  RoiSummary,
  RoiTranscriptExportState,
} from '../roi/roiModel'
import type { VisiumHdRoiState, VisiumHdRoiSummary } from '../roi/visiumHdRoiModel'
import type { RoiReferenceState } from '../roi/roiEnrichmentModel'
import type { TranscriptCapabilityState } from '../transcripts/transcriptLayerModel'

// The cards (UNIFIED_PLAN.md, 15.2-D) stack at the top left of the canvas in
// this order. Each is null while there is nothing to show, and closing one
// clears what it shows.
export interface CardStackModel {
  readonly selection: SelectionCardModel | null
  readonly cell: CellCardModel | null
  readonly transcript: TranscriptCardModel | null
  readonly magicLens: MagicLensCardModel | null
}

// Selection

export interface SelectionStat {
  readonly label: string
  readonly value: string
}

export interface SelectionGenesModel {
  readonly copy: string
  readonly state: RoiGeneStatsState
  // The comparison outside the selection, for enriched genes (15.4-B).
  readonly reference: RoiReferenceState
  readonly selectedGenes: readonly string[]
  // Colours by the gene (Colour by › Gene expression).
  readonly onShowGene: (gene: string) => void
  readonly title: string
  readonly elementSingular: string
  readonly elementPlural: string
  // Visium HD says so when a ready selection has no expression.
  readonly emptyMessage: string | null
}

export interface SelectionExport {
  readonly label: string
  readonly title: string
  readonly busy: boolean
  readonly busyLabel?: string | undefined
  readonly onExport: () => void
}

// The Transcripts tab: Magic Lens over the selection (D14).
export interface SelectionLensModel {
  // "Transcripts", or "Expression" where the lens counts UMIs or values.
  readonly label: string
  // The lens result while it is for the selection, else idle.
  readonly state: MagicLensState
  readonly canRun: boolean
  readonly onRun: () => void
}

interface SelectionCardBase {
  readonly name: string
  readonly nameLabel: string
  readonly onNameChange: (name: string) => void
  readonly nameDisabled: boolean
  // "Querying genes", "6,229 cells", "Drawing box".
  readonly status: string
  readonly loading: boolean
  readonly closeTitle: string
  readonly onClose: () => void
}

export interface RegionSelectionCardModel extends SelectionCardBase {
  readonly variant: 'cells' | 'bins'
  // Shows the whole selection (zoomToBbox, 15.2-E).
  readonly onGoTo: () => void
  // "6,229 cells · 943,210 µm²", once the selection is read.
  readonly summary: string | null
  // The tab with the counts: "Cells", "Spots" or "Bins".
  readonly elementsLabel: string
  readonly stats: readonly SelectionStat[]
  readonly genes: SelectionGenesModel
  readonly ready: boolean
  // Cells only: save the selection as an annotation.
  readonly onSave: (() => void) | null
  // Removes the selection from the list (15.4-A); closing only hides the
  // card.
  readonly onDelete: () => void
  readonly exports: readonly SelectionExport[]
  readonly lens: SelectionLensModel | null
}

// On an image, drawing makes a GeoJSON shape; the card names the next one.
export interface GeometrySelectionCardModel extends SelectionCardBase {
  readonly variant: 'geometry'
}

export type SelectionCardModel = RegionSelectionCardModel | GeometrySelectionCardModel

function countLabel(count: number, singular: string, plural: string, more = false) {
  return `${count.toLocaleString()}${more ? '+' : ''} ${count === 1 ? singular : plural}`
}

function formatMean(value: number | undefined): string {
  return value === undefined
    ? '0'
    : value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

// Go To regions, in data µm (y down) from deck.gl positions (y up).
export type ZoomToBbox = (bbox: BBox) => void

const GO_TO_CELL_HALF_SIZE = 40
const GO_TO_MARGIN = 20

export function bboxAroundDeckPoint(
  position: ArrayLike<number>,
  halfSizeMicrometers: number,
): BBox {
  const x = position[0] ?? 0
  const y = -(position[1] ?? 0)

  return {
    minX: micrometers(x - halfSizeMicrometers),
    maxX: micrometers(x + halfSizeMicrometers),
    minY: micrometers(y - halfSizeMicrometers),
    maxY: micrometers(y + halfSizeMicrometers),
  }
}

export function bboxAroundDeckPolygon(
  polygon: readonly ArrayLike<number>[],
  marginMicrometers: number,
): BBox {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const point of polygon) {
    const x = point[0] ?? 0
    const deckY = point[1] ?? 0
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, -deckY)
    maxY = Math.max(maxY, -deckY)
  }

  return {
    minX: micrometers(minX - marginMicrometers),
    maxX: micrometers(maxX + marginMicrometers),
    minY: micrometers(minY - marginMicrometers),
    maxY: micrometers(maxY + marginMicrometers),
  }
}

export function selectionSummary(
  count: number,
  noun: { readonly singular: string; readonly plural: string },
  hitLimit: boolean,
  selection: RoiSelection,
): string {
  return `${countLabel(count, noun.singular, noun.plural, hitLimit)} · ${formatSquareMicrometers(
    roiSelectionArea(selection),
  )}`
}

interface SelectionNameInput {
  readonly name: string
  readonly onNameChange: (name: string) => void
  readonly nameDisabled: boolean
}

type SelectionGenesInput = Pick<
  SelectionGenesModel,
  'copy' | 'state' | 'reference' | 'selectedGenes' | 'onShowGene'
>

interface SelectionLensInput {
  readonly available: boolean
  readonly enabled: boolean
  readonly label: string
  readonly state: MagicLensState
  readonly onRun: () => void
}

function selectionLens(lens: SelectionLensInput): SelectionLensModel | null {
  if (!lens.available) return null

  const forSelection = lens.state.status !== 'idle' && lens.state.scope === 'roi'

  return {
    label: lens.label,
    state: forSelection ? lens.state : { status: 'idle' },
    canRun: lens.enabled && lens.state.status !== 'loading',
    onRun: lens.onRun,
  }
}

export function cellsSelectionCard({
  elementNoun,
  genes,
  lens,
  loading,
  name,
  nameDisabled,
  onClose,
  onDelete,
  onExportCells,
  onExportGeoJson,
  onExportTranscripts,
  onNameChange,
  onSave,
  roiState,
  status,
  summary,
  transcriptExportState,
  zoomToBbox,
}: SelectionNameInput & {
  readonly elementNoun: { readonly singular: string; readonly plural: string }
  readonly genes: SelectionGenesInput
  readonly lens: SelectionLensInput
  readonly loading: boolean
  readonly onClose: () => void
  readonly onDelete: () => void
  readonly onExportCells: () => void
  readonly onExportGeoJson: () => void
  readonly onExportTranscripts: () => void
  readonly onSave: () => void
  readonly roiState: RoiState
  readonly status: string
  readonly summary: RoiSummary | null
  readonly transcriptExportState: RoiTranscriptExportState
  readonly zoomToBbox: ZoomToBbox
}): SelectionCardModel | null {
  if (roiState.status === 'idle') return null

  const ready = roiState.status === 'ready'
  const hitLimit = ready && roiState.hitCellLimit
  const exporting = transcriptExportState.status === 'loading'
  const elementsLabel =
    elementNoun.plural.charAt(0).toUpperCase() + elementNoun.plural.slice(1)

  return {
    variant: 'cells',
    onGoTo: () => {
      zoomToBbox(roiState.selection.bbox)
    },
    name,
    nameLabel: 'ROI name',
    onNameChange,
    nameDisabled,
    status,
    loading,
    closeTitle: 'Close selection',
    onClose,
    summary:
      summary === null
        ? null
        : selectionSummary(summary.cellCount, elementNoun, hitLimit, roiState.selection),
    elementsLabel,
    stats:
      summary === null
        ? []
        : [
            {
              label: elementsLabel,
              value: `${summary.cellCount.toLocaleString()}${hitLimit ? '+' : ''}`,
            },
            { label: 'Mean transcripts', value: formatMean(summary.meanTranscriptCount) },
            { label: 'Mean area', value: formatMean(summary.meanCellArea) },
          ],
    genes: {
      ...genes,
      title: 'Top ROI genes',
      elementSingular: elementNoun.singular,
      elementPlural: elementNoun.plural,
      emptyMessage: null,
    },
    ready,
    onSave,
    onDelete,
    exports: [
      {
        label: 'Export GeoJSON',
        title: 'Export ROI as GeoJSON',
        busy: false,
        onExport: onExportGeoJson,
      },
      {
        label: 'Export Cells',
        title: 'Export ROI cells',
        busy: false,
        onExport: onExportCells,
      },
      {
        label: 'Export Transcripts',
        title: 'Export ROI transcripts',
        busy: exporting,
        busyLabel: 'Exporting…',
        onExport: onExportTranscripts,
      },
    ],
    lens: selectionLens(lens),
  }
}

export function binsSelectionCard({
  genes,
  lens,
  name,
  nameDisabled,
  onClose,
  onDelete,
  onExportBarcodes,
  onExportGeoJson,
  onNameChange,
  roiState,
  status,
  summary,
  zoomToBbox,
}: SelectionNameInput & {
  readonly genes: SelectionGenesInput
  readonly lens: SelectionLensInput
  readonly onClose: () => void
  readonly onDelete: () => void
  readonly onExportBarcodes: () => void
  readonly onExportGeoJson: () => void
  readonly roiState: VisiumHdRoiState
  readonly status: string
  readonly summary: VisiumHdRoiSummary | null
  readonly zoomToBbox: ZoomToBbox
}): SelectionCardModel | null {
  if (roiState.status === 'idle') return null

  const noun = { singular: 'bin', plural: 'bins' }
  const stats: SelectionStat[] =
    summary === null
      ? []
      : [
          {
            label: 'Bins',
            value: `${summary.binCount.toLocaleString()}${roiState.hitBinLimit ? '+' : ''}`,
          },
          {
            label: 'Bin size',
            value:
              summary.binSizeMicrometers === undefined
                ? '0'
                : withMicrometers(String(summary.binSizeMicrometers)),
          },
          ...(summary.inTissueCount === undefined
            ? []
            : [{ label: 'In tissue', value: summary.inTissueCount.toLocaleString() }]),
        ]

  return {
    variant: 'bins',
    onGoTo: () => {
      zoomToBbox(roiState.selection.bbox)
    },
    name,
    nameLabel: 'ROI name',
    onNameChange,
    nameDisabled,
    status,
    loading: genes.state.status === 'loading',
    closeTitle: 'Close selection',
    onClose,
    summary:
      summary === null
        ? null
        : selectionSummary(
            summary.binCount,
            noun,
            roiState.hitBinLimit,
            roiState.selection,
          ),
    elementsLabel: 'Bins',
    stats,
    genes: {
      ...genes,
      title: 'ROI genes',
      elementSingular: noun.singular,
      elementPlural: noun.plural,
      emptyMessage:
        genes.state.status === 'idle' ? 'No detected ROI gene expression' : null,
    },
    ready: true,
    onSave: null,
    onDelete,
    exports: [
      {
        label: 'Export GeoJSON',
        title: 'Export ROI as GeoJSON',
        busy: false,
        onExport: onExportGeoJson,
      },
      {
        label: 'Export Barcodes',
        title: 'Export selected barcodes',
        busy: false,
        onExport: onExportBarcodes,
      },
    ],
    lens: selectionLens(lens),
  }
}

export function geometrySelectionCard({
  drawing,
  name,
  nameDisabled,
  onClose,
  onNameChange,
  shapeCount,
}: SelectionNameInput & {
  // The box or lasso tool, while it is on.
  readonly drawing: 'box' | 'lasso' | null
  readonly onClose: () => void
  readonly shapeCount: number
}): SelectionCardModel | null {
  if (drawing === null) return null

  return {
    variant: 'geometry',
    name,
    nameLabel: 'Shape name',
    onNameChange,
    nameDisabled,
    status: `Drawing ${drawing} · ${countLabel(shapeCount, 'shape', 'shapes')}`,
    loading: false,
    closeTitle: 'Stop drawing',
    onClose,
  }
}

// Cell, Spot or Bin

interface CellCardBase {
  readonly title: string
  readonly status: string
  readonly loading: boolean
  readonly onGoTo: () => void
  readonly onClose: () => void
}

export type CellCardModel =
  | (CellCardBase & {
      readonly kind: 'cell'
      readonly cell: OverviewCellDatum
      readonly annotationLabels: readonly string[]
      readonly state: CellDetailState
      readonly distributionState: CellTranscriptDistributionState
      readonly distributionVisible: boolean
      readonly variant: CellInfoPanelVariant
    })
  | (CellCardBase & {
      readonly kind: 'boundary'
      readonly cell: CellBoundaryDatum
      readonly expressionStatus: CellGeneExpressionStatus | undefined
      readonly profileState: CellExpressionProfileState | undefined
      readonly onLoadProfile: (() => void) | undefined
    })
  | (CellCardBase & {
      readonly kind: 'bin'
      readonly cell: GridCellDatum
      readonly assignmentState: GridCellAssignmentState
      readonly expressionStatus: CellGeneExpressionStatus | undefined
      readonly profileState: CellExpressionProfileState | undefined
      readonly onLoadProfile: (() => void) | undefined
    })

export function cellCard({
  boundary,
  cell,
  gridCell,
  onClose,
  profile,
  zoomToBbox,
}: {
  readonly cell: {
    readonly selected: OverviewCellDatum | null
    // "Cell" or "Spot".
    readonly title: string
    readonly status: string
    readonly annotationLabels: readonly string[]
    readonly state: CellDetailState
    readonly distributionState: CellTranscriptDistributionState
    readonly distributionVisible: boolean
    readonly variant: CellInfoPanelVariant
  }
  // Visium HD: a cell boundary, which wins over the bin under it.
  readonly boundary: {
    readonly selected: CellBoundaryDatum | null
    readonly expressionStatus: CellGeneExpressionStatus | undefined
  }
  readonly gridCell: {
    readonly selected: GridCellDatum | null
    readonly assignmentState: GridCellAssignmentState
    readonly expressionStatus: CellGeneExpressionStatus | undefined
  }
  readonly profile: {
    readonly state: CellExpressionProfileState | undefined
    readonly onLoad: (() => void) | undefined
  }
  readonly onClose: () => void
  readonly zoomToBbox: ZoomToBbox
}): CellCardModel | null {
  if (boundary.selected !== null) {
    return {
      kind: 'boundary',
      title: 'Cell',
      status: 'Selected cell',
      loading: false,
      onGoTo: () => {
        zoomToBbox(bboxAroundDeckPolygon(boundary.selected?.polygon ?? [], GO_TO_MARGIN))
      },
      onClose,
      cell: boundary.selected,
      expressionStatus: boundary.expressionStatus,
      profileState: profile.state,
      onLoadProfile: profile.onLoad,
    }
  }

  if (gridCell.selected !== null) {
    return {
      kind: 'bin',
      title: 'Bin',
      status: 'Selected bin',
      loading: false,
      onGoTo: () => {
        zoomToBbox(bboxAroundDeckPolygon(gridCell.selected?.polygon ?? [], GO_TO_MARGIN))
      },
      onClose,
      cell: gridCell.selected,
      assignmentState: gridCell.assignmentState,
      expressionStatus: gridCell.expressionStatus,
      profileState: profile.state,
      onLoadProfile: profile.onLoad,
    }
  }

  const selected = cell.selected
  if (selected === null) return null

  return {
    kind: 'cell',
    onGoTo: () => {
      zoomToBbox(bboxAroundDeckPoint(selected.position, GO_TO_CELL_HALF_SIZE))
    },
    title: cell.title,
    status: cell.status,
    loading: cell.state.status === 'loading' && cell.state.cellId === selected.id,
    onClose,
    cell: selected,
    annotationLabels: cell.annotationLabels,
    state: cell.state,
    distributionState: cell.distributionState,
    distributionVisible: cell.distributionVisible,
    variant: cell.variant,
  }
}

// Transcript

export interface TranscriptCardModel {
  // "Transcript", "Density bin" or "Feature bin".
  readonly title: string
  readonly detail: ViewerTranscriptHoverDetail
  // Per-gene outputs (Atera) have no FOVs.
  readonly showFov: boolean
  readonly onGoTo: () => void
  readonly onClose: () => void
}

export function transcriptCard({
  capabilityState,
  onClose,
  pinned,
  zoomToBbox,
}: {
  readonly capabilityState: TranscriptCapabilityState
  readonly onClose: () => void
  readonly pinned: ViewerTranscriptHoverDetail | null
  readonly zoomToBbox: ZoomToBbox
}): TranscriptCardModel | null {
  if (pinned === null) return null

  const title =
    pinned.transcript !== undefined
      ? 'Transcript'
      : pinned.aggregate?.featureName === undefined
        ? 'Density bin'
        : 'Feature bin'

  return {
    title,
    detail: pinned,
    showFov:
      capabilityState.status !== 'ready' ||
      capabilityState.capabilities.geneRanges === undefined,
    onGoTo: () => {
      const position = pinned.transcript?.position ?? pinned.aggregate?.position ?? []
      const binSize = pinned.aggregate?.binSizeMicrometers ?? 0
      zoomToBbox(bboxAroundDeckPoint(position, Math.max(GO_TO_MARGIN, binSize * 2)))
    },
    onClose,
  }
}

// Magic Lens

export interface MagicLensCardModel {
  // "Move cursor", "Scanning Viewport", "1,204 transcripts".
  readonly status: string
  readonly loading: boolean
  readonly scope: Exclude<MagicLensScope, 'roi'>
  readonly state: MagicLensState
  readonly onClose: () => void
}

// The card holds the cursor lens while the tool is on, and a Summarise View
// result. A selection's result shows in the Selection card instead.
export function magicLensCard({
  cursorActive,
  onClose,
  state,
  status,
}: {
  readonly cursorActive: boolean
  readonly onClose: () => void
  readonly state: MagicLensState
  readonly status: string
}): MagicLensCardModel | null {
  const scope = state.status === 'idle' ? null : state.scope

  if (scope === 'roi' || (scope === null && !cursorActive)) return null

  return {
    status,
    loading: state.status === 'loading',
    scope: scope ?? 'cursor',
    state,
    onClose,
  }
}

// Stack

type WithoutZoom<T> = Omit<T, 'zoomToBbox'>

export type SelectionCardInput =
  | ({ readonly variant: 'cells' } & WithoutZoom<
      Parameters<typeof cellsSelectionCard>[0]
    >)
  | ({ readonly variant: 'bins' } & WithoutZoom<Parameters<typeof binsSelectionCard>[0]>)
  | ({ readonly variant: 'geometry' } & Parameters<typeof geometrySelectionCard>[0])

export interface CardStackModelInput {
  readonly selection: SelectionCardInput
  readonly cell: WithoutZoom<Parameters<typeof cellCard>[0]>
  // Null where the platform has no transcripts or no Magic Lens.
  readonly transcript: WithoutZoom<Parameters<typeof transcriptCard>[0]> | null
  readonly magicLens: Parameters<typeof magicLensCard>[0] | null
  readonly zoomToBbox: ZoomToBbox
}

// Built in App, like the section models.
export function useCardStackModel({
  selection,
  cell,
  transcript,
  magicLens,
  zoomToBbox,
}: CardStackModelInput): CardStackModel {
  return {
    selection:
      selection.variant === 'cells'
        ? cellsSelectionCard({ ...selection, zoomToBbox })
        : selection.variant === 'bins'
          ? binsSelectionCard({ ...selection, zoomToBbox })
          : geometrySelectionCard(selection),
    cell: cellCard({ ...cell, zoomToBbox }),
    transcript:
      transcript === null ? null : transcriptCard({ ...transcript, zoomToBbox }),
    magicLens: magicLens === null ? null : magicLensCard(magicLens),
  }
}
