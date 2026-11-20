import type { Dispatch, SetStateAction } from 'react'
import type { ContinuousCellMetadataTrack } from '../../data/customAnnotations'
import type { GeneExpressionDetailMode } from '../../data/geneExpressionLod'
import type { GeneExpressionBatch } from '../../datasets/xeniumDataset'
import type { ObservationColorMode } from '../../rendering/cellStyling'
import type {
  GeneExpressionColorScale,
  GeneExpressionScoreMode,
} from '../../rendering/deckLayers'
import { normalizeCellPointScale } from '../../rendering/cellPointStyle'
import { percentToOpacity } from '../../rendering/layerOpacity'
import type { AppendDebugEvent } from '../app-shell/appRuntimeModel'
import type { UndoOffer } from '../app-shell/useUndoToast'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import type {
  GeneExpressionScaleDomain,
  GeneExpressionState,
  GenePanelState,
} from '../genes/geneControlsModel'
import type { GeneScaleRange } from '../genes/geneScaleRange'
import { useGeneControlsWorkflow } from '../genes/useGeneControlsWorkflow'

// Cells, spots or bins: how they are drawn, which genes are selected, and
// what colours them (plan 15.2-A): the Cells section.
export interface CellsSectionModel {
  readonly appearance: CellAppearanceModel
  readonly genes: GeneSelectionModel
  readonly colour: CellColourModel
}

export interface CellAppearanceModel {
  // False for a plain image, which has no cells.
  readonly available: boolean
  readonly nucleusBoundariesAvailable: boolean
  readonly showCellBoundaries: boolean
  readonly onShowCellBoundariesChange: (enabled: boolean) => void
  readonly showNucleusBoundaries: boolean
  readonly onShowNucleusBoundariesChange: (enabled: boolean) => void
  // Opacities are 0–1; the controls show percent.
  readonly fillOpacity: number
  readonly onFillOpacityPercentChange: (percent: number) => void
  readonly boundaryOpacity: number
  readonly onBoundaryOpacityPercentChange: (percent: number) => void
  // Multiplier on the size cells drawn as points have.
  readonly pointScale: number
  readonly onPointScaleChange: (scale: number) => void
  // Set when the cells are placed in 3D, so the 3D view can show them.
  readonly view: CellViewModel | null
}

export interface CellViewModel {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}

// The Cells section's View: every cell in the plane, or the 3D view of
// cells placed in 3D.
export type CellView = '2d' | '3d'

export function parseCellView(value: string | undefined): CellView | undefined {
  return value === '2d' || value === '3d' ? value : undefined
}

export interface GeneSelectionModel {
  readonly panelState: GenePanelState<StructuredLoadError>
  readonly options: readonly string[]
  readonly selected: readonly string[]
  // The score mode a saved gene set keeps.
  readonly scoreMode: GeneExpressionScoreMode
  readonly onToggle: (gene: string) => void
  // Replaces the selection and colours cells by it.
  readonly onApply: (
    genes: readonly string[],
    scoreMode?: GeneExpressionScoreMode | undefined,
  ) => void
  // For the picker's own actions, such as saving a gene set.
  readonly log: AppendDebugEvent
  // Removing a saved gene set offers Undo (15.3-C).
  readonly onOfferUndo: (offer: UndoOffer) => void
}

export interface CellColourModel {
  // The Analysis header chip and the status line under the controls.
  readonly headerCopy: string
  readonly statusCopy: string
  readonly isLoading: boolean
  readonly mode: ObservationColorMode
  readonly onModeChange: (mode: ObservationColorMode) => void
  readonly hasAnnotationColors: boolean
  readonly metadataTracks: readonly ContinuousCellMetadataTrack[]
  readonly selectedMetadataTrackId: string | null
  readonly onMetadataTrackChange: (trackId: string) => void
  // "Combine genes" shows with two or more genes.
  readonly selectedGeneCount: number
  readonly scoreMode: GeneExpressionScoreMode
  readonly onScoreModeChange: (mode: GeneExpressionScoreMode) => void
  readonly colorScale: GeneExpressionColorScale
  readonly onColorScaleChange: (scale: GeneExpressionColorScale) => void
  // The scores at the ends of the scale, and the range that sets them; an
  // Auto end is 0 or autoScaleMax, the top at the range's percentile (99th
  // unless set) of the scores seen.
  readonly scaleMin: number
  readonly scaleMax: number
  readonly autoScaleMax: number
  readonly highestScore: number
  readonly scaleRange: GeneScaleRange
  readonly onScaleRangeChange: (range: GeneScaleRange) => void
  readonly detailMode: GeneExpressionDetailMode
  readonly onDetailModeChange: (mode: GeneExpressionDetailMode) => void
}

export interface CellsSectionModelInput {
  readonly analysisHeaderCopy: string
  readonly appendDebugEvent: AppendDebugEvent
  readonly offerUndo: (offer: UndoOffer) => void
  readonly cellBoundaryOpacity: number
  readonly cellFillOpacity: number
  readonly cellPointScale: number
  readonly cellLayerControlsVisible: boolean
  readonly cellViewAvailable: boolean
  readonly cellViewOpen: boolean
  readonly setCellViewOpen: (open: boolean) => void
  readonly cellMetadataTracks: readonly ContinuousCellMetadataTrack[]
  readonly geneExpressionBatch: GeneExpressionBatch | null
  readonly geneExpressionColorScale: GeneExpressionColorScale
  readonly geneExpressionCopy: string
  readonly geneExpressionDetailMode: GeneExpressionDetailMode
  readonly geneExpressionScaleDatasetUrl: string
  readonly geneExpressionScaleMin: number
  readonly geneExpressionScaleMax: number
  readonly geneExpressionAutoScaleMax: number
  readonly geneExpressionHighestScore: number
  readonly geneExpressionScaleRange: GeneScaleRange
  readonly geneExpressionScoreMode: GeneExpressionScoreMode
  readonly geneExpressionState: GeneExpressionState<StructuredLoadError>
  readonly geneOptions: readonly string[]
  readonly genePanelState: GenePanelState<StructuredLoadError>
  readonly hasAnnotationColors: boolean
  readonly nucleusBoundaryControlsVisible: boolean
  readonly observationColorMode: ObservationColorMode
  readonly rememberGeneExpressionScaleMax: (
    key: string,
    batch: GeneExpressionBatch,
    scoreMode: GeneExpressionScoreMode,
  ) => void
  readonly resetGeneExpressionSelectionState: () => void
  readonly selectedCellMetadataTrackId: string | null
  readonly selectedGenes: readonly string[]
  readonly setCellBoundaryOpacity: Dispatch<SetStateAction<number>>
  readonly setCellFillOpacity: Dispatch<SetStateAction<number>>
  readonly setCellPointScale: Dispatch<SetStateAction<number>>
  readonly setGeneExpressionColorScale: Dispatch<SetStateAction<GeneExpressionColorScale>>
  readonly setGeneExpressionDetailMode: Dispatch<SetStateAction<GeneExpressionDetailMode>>
  readonly setGeneExpressionScaleDomain: Dispatch<
    SetStateAction<GeneExpressionScaleDomain>
  >
  readonly setGeneExpressionScaleRange: Dispatch<SetStateAction<GeneScaleRange>>
  readonly setGeneExpressionScoreMode: Dispatch<SetStateAction<GeneExpressionScoreMode>>
  readonly setManualTranscriptExactRequestKey: Dispatch<SetStateAction<string | null>>
  readonly setObservationColorMode: Dispatch<SetStateAction<ObservationColorMode>>
  readonly setSelectedCellMetadataTrackId: Dispatch<SetStateAction<string | null>>
  readonly setSelectedGenes: Dispatch<SetStateAction<readonly string[]>>
  readonly setShowCellBoundaries: Dispatch<SetStateAction<boolean>>
  readonly setShowNucleusBoundaries: Dispatch<SetStateAction<boolean>>
  readonly showCellBoundaries: boolean
  readonly showNucleusBoundaries: boolean
  readonly toggleGene: (gene: string) => void
  readonly transcriptViewportKeyRef: { current: string | null }
}

export function useCellsSectionModel({
  analysisHeaderCopy,
  appendDebugEvent,
  offerUndo,
  cellBoundaryOpacity,
  cellFillOpacity,
  cellPointScale,
  cellLayerControlsVisible,
  cellViewAvailable,
  cellViewOpen,
  setCellViewOpen,
  cellMetadataTracks,
  geneExpressionBatch,
  geneExpressionColorScale,
  geneExpressionCopy,
  geneExpressionDetailMode,
  geneExpressionScaleDatasetUrl,
  geneExpressionScaleMin,
  geneExpressionScaleMax,
  geneExpressionAutoScaleMax,
  geneExpressionHighestScore,
  geneExpressionScaleRange,
  geneExpressionScoreMode,
  geneExpressionState,
  geneOptions,
  genePanelState,
  hasAnnotationColors,
  nucleusBoundaryControlsVisible,
  observationColorMode,
  rememberGeneExpressionScaleMax,
  resetGeneExpressionSelectionState,
  selectedCellMetadataTrackId,
  selectedGenes,
  setCellBoundaryOpacity,
  setCellFillOpacity,
  setCellPointScale,
  setGeneExpressionColorScale,
  setGeneExpressionDetailMode,
  setGeneExpressionScaleDomain,
  setGeneExpressionScaleRange,
  setGeneExpressionScoreMode,
  setManualTranscriptExactRequestKey,
  setObservationColorMode,
  setSelectedCellMetadataTrackId,
  setSelectedGenes,
  setShowCellBoundaries,
  setShowNucleusBoundaries,
  showCellBoundaries,
  showNucleusBoundaries,
  toggleGene,
  transcriptViewportKeyRef,
}: CellsSectionModelInput): CellsSectionModel {
  const {
    applyGenes,
    handleGeneExpressionColorScaleChange,
    handleGeneExpressionDetailModeChange,
    handleGeneExpressionScoreModeChange,
    handleObservationColorModeChange,
  } = useGeneControlsWorkflow({
    callbacks: {
      appendDebugEvent,
      rememberGeneExpressionScaleMax,
      resetGeneExpressionSelectionState,
    },
    data: { geneExpressionBatch, geneExpressionScaleDatasetUrl, selectedGenes },
    refs: { transcriptViewportKeyRef },
    setters: {
      setGeneExpressionColorScale,
      setGeneExpressionDetailMode,
      setGeneExpressionScaleDomain,
      setGeneExpressionScoreMode,
      setManualTranscriptExactRequestKey,
      setObservationColorMode,
      setSelectedGenes,
    },
  })

  return {
    appearance: {
      available: cellLayerControlsVisible,
      nucleusBoundariesAvailable: nucleusBoundaryControlsVisible,
      showCellBoundaries,
      onShowCellBoundariesChange: (nextEnabled) => {
        if (showCellBoundaries === nextEnabled) {
          return
        }

        setShowCellBoundaries(nextEnabled)
        appendDebugEvent(
          nextEnabled ? 'Cell boundaries shown' : 'Cell boundaries hidden',
          { coalesceKey: 'cell-boundaries-visible' },
        )
      },
      showNucleusBoundaries,
      onShowNucleusBoundariesChange: (nextEnabled) => {
        if (showNucleusBoundaries === nextEnabled) {
          return
        }

        setShowNucleusBoundaries(nextEnabled)
        appendDebugEvent(
          nextEnabled ? 'Nucleus boundaries shown' : 'Nucleus boundaries hidden',
          { coalesceKey: 'nucleus-boundaries-visible' },
        )
      },
      fillOpacity: cellFillOpacity,
      onFillOpacityPercentChange: (nextPercent) => {
        setCellFillOpacity(percentToOpacity(nextPercent))
        appendDebugEvent(`Cell fill opacity: ${nextPercent}%`, {
          coalesceKey: 'cell-fill-opacity',
        })
      },
      boundaryOpacity: cellBoundaryOpacity,
      onBoundaryOpacityPercentChange: (nextPercent) => {
        setCellBoundaryOpacity(percentToOpacity(nextPercent))
        appendDebugEvent(`Cell boundary opacity: ${nextPercent}%`, {
          coalesceKey: 'cell-boundary-opacity',
        })
      },
      pointScale: cellPointScale,
      onPointScaleChange: (nextScale) => {
        const normalized = normalizeCellPointScale(nextScale)
        setCellPointScale(normalized)
        appendDebugEvent(`Cell point size: ${normalized}x`, {
          coalesceKey: 'cell-point-scale',
        })
      },
      view: cellViewAvailable
        ? {
            open: cellViewOpen,
            onOpenChange: (open) => {
              setCellViewOpen(open)
              appendDebugEvent(open ? 'Cell view: 3D' : 'Cell view: 2D')
            },
          }
        : null,
    },
    genes: {
      panelState: genePanelState,
      options: geneOptions,
      selected: selectedGenes,
      scoreMode: geneExpressionScoreMode,
      onToggle: toggleGene,
      onApply: applyGenes,
      log: appendDebugEvent,
      onOfferUndo: offerUndo,
    },
    colour: {
      headerCopy: analysisHeaderCopy,
      statusCopy: geneExpressionCopy,
      isLoading:
        genePanelState.status === 'loading' || geneExpressionState.status === 'loading',
      mode: observationColorMode,
      onModeChange: handleObservationColorModeChange,
      hasAnnotationColors,
      metadataTracks: cellMetadataTracks,
      selectedMetadataTrackId: selectedCellMetadataTrackId,
      onMetadataTrackChange: setSelectedCellMetadataTrackId,
      selectedGeneCount: selectedGenes.length,
      scoreMode: geneExpressionScoreMode,
      onScoreModeChange: handleGeneExpressionScoreModeChange,
      colorScale: geneExpressionColorScale,
      onColorScaleChange: handleGeneExpressionColorScaleChange,
      scaleMin: geneExpressionScaleMin,
      scaleMax: geneExpressionScaleMax,
      autoScaleMax: geneExpressionAutoScaleMax,
      highestScore: geneExpressionHighestScore,
      scaleRange: geneExpressionScaleRange,
      onScaleRangeChange: setGeneExpressionScaleRange,
      detailMode: geneExpressionDetailMode,
      onDetailModeChange: handleGeneExpressionDetailModeChange,
    },
  }
}
