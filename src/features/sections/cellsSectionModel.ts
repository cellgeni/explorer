import type { Dispatch, SetStateAction } from 'react'
import type { ContinuousCellMetadataTrack } from '../../data/customAnnotations'
import type { GeneExpressionDetailMode } from '../../data/geneExpressionLod'
import type { GeneExpressionBatch } from '../../datasets/xeniumDataset'
import type { ObservationColorMode } from '../../rendering/cellStyling'
import type {
  GeneExpressionColorScale,
  GeneExpressionScoreMode,
} from '../../rendering/deckLayers'
import { percentToOpacity } from '../../rendering/layerOpacity'
import type { AppendDebugEvent } from '../app-shell/appRuntimeModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import type {
  GeneExpressionScaleDomain,
  GeneExpressionState,
  GenePanelState,
} from '../genes/geneControlsModel'
import { useGeneControlsWorkflow } from '../genes/useGeneControlsWorkflow'

// Cells, spots or bins: how they are drawn, which genes are selected, and
// what colours them (UNIFIED_PLAN.md, 15.2-A): the Cells section.
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
  readonly scaleMax: number
  readonly detailMode: GeneExpressionDetailMode
  readonly onDetailModeChange: (mode: GeneExpressionDetailMode) => void
}

export interface CellsSectionModelInput {
  readonly analysisHeaderCopy: string
  readonly appendDebugEvent: AppendDebugEvent
  readonly cellBoundaryOpacity: number
  readonly cellFillOpacity: number
  readonly cellLayerControlsVisible: boolean
  readonly cellMetadataTracks: readonly ContinuousCellMetadataTrack[]
  readonly geneExpressionBatch: GeneExpressionBatch | null
  readonly geneExpressionColorScale: GeneExpressionColorScale
  readonly geneExpressionCopy: string
  readonly geneExpressionDetailMode: GeneExpressionDetailMode
  readonly geneExpressionScaleDatasetUrl: string
  readonly geneExpressionScaleMax: number
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
  readonly setGeneExpressionColorScale: Dispatch<SetStateAction<GeneExpressionColorScale>>
  readonly setGeneExpressionDetailMode: Dispatch<SetStateAction<GeneExpressionDetailMode>>
  readonly setGeneExpressionScaleDomain: Dispatch<
    SetStateAction<GeneExpressionScaleDomain>
  >
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
  cellBoundaryOpacity,
  cellFillOpacity,
  cellLayerControlsVisible,
  cellMetadataTracks,
  geneExpressionBatch,
  geneExpressionColorScale,
  geneExpressionCopy,
  geneExpressionDetailMode,
  geneExpressionScaleDatasetUrl,
  geneExpressionScaleMax,
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
  setGeneExpressionColorScale,
  setGeneExpressionDetailMode,
  setGeneExpressionScaleDomain,
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
    },
    genes: {
      panelState: genePanelState,
      options: geneOptions,
      selected: selectedGenes,
      scoreMode: geneExpressionScoreMode,
      onToggle: toggleGene,
      onApply: applyGenes,
      log: appendDebugEvent,
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
      scaleMax: geneExpressionScaleMax,
      detailMode: geneExpressionDetailMode,
      onDetailModeChange: handleGeneExpressionDetailModeChange,
    },
  }
}
