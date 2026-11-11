import type { Dispatch, SetStateAction } from 'react'
import type { ViewerTranscriptHoverDetail } from '../../components/ViewerCore'
import type {
  TranscriptDetailMode,
  TranscriptFeatureFilterMode,
} from '../../data/transcriptOverlay'
import type {
  TranscriptDensityColorScale,
  TranscriptPointColorMode,
} from '../../rendering/deckLayers'
import type { AppendDebugEvent } from '../app-shell/appRuntimeModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import type { GenePanelState } from '../genes/geneControlsModel'
import type {
  TranscriptCapabilityState,
  TranscriptLayerState,
} from '../transcripts/transcriptLayerModel'
import { useTranscriptControlsWorkflow } from '../transcripts/useTranscriptControlsWorkflow'

// Transcript display, gene filter, appearance and filters, the exact-point
// budget, and the hovered or pinned transcript (UNIFIED_PLAN.md, 15.2-A).
export interface TranscriptsSectionModel {
  readonly loadEnabled: boolean
  // The header chip.
  readonly headerCopy: string
  readonly isLoading: boolean
  readonly capabilityState: TranscriptCapabilityState
  readonly layerState: TranscriptLayerState
  readonly visibleEstimate: number
  readonly show: boolean
  readonly onShowChange: (enabled: boolean) => void
  readonly detailMode: TranscriptDetailMode
  readonly onDetailModeChange: (mode: TranscriptDetailMode) => void
  readonly exactPointLimit: number
  readonly onExactPointLimitChange: (limit: number) => void
  readonly onLoadExactViewport: (requestKey: string) => void
  readonly features: TranscriptFeatureModel
  readonly densityColorScale: TranscriptDensityColorScale
  readonly onDensityColorScaleChange: (scale: TranscriptDensityColorScale) => void
  readonly densityScaleMax: number | undefined
  readonly densityScaleLabels: readonly [string, string, string]
  readonly pointColorMode: TranscriptPointColorMode
  readonly onPointColorModeChange: (mode: TranscriptPointColorMode) => void
  readonly minQv: number
  readonly onMinQvChange: (minQv: number) => void
  readonly geneOnly: boolean
  // Off for outputs that hold only gene transcripts (Atera).
  readonly geneOnlyFilterEnabled: boolean
  readonly onGeneOnlyChange: (enabled: boolean) => void
  // 0–1; the control shows percent.
  readonly opacity: number
  readonly onOpacityPercentChange: (percent: number) => void
  readonly pointSize: number
  readonly onPointSizeChange: (pointSize: number) => void
  readonly hoveredTranscript: ViewerTranscriptHoverDetail | null
  readonly pinnedTranscript: ViewerTranscriptHoverDetail | null
  readonly onPinTranscript: (detail: ViewerTranscriptHoverDetail) => void
  readonly onClearPinnedTranscript: () => void
}

export interface TranscriptFeatureModel {
  // The filter in effect: All features while no gene is selected.
  readonly filterMode: TranscriptFeatureFilterMode
  readonly onFilterModeChange: (mode: TranscriptFeatureFilterMode) => void
  readonly panelState: GenePanelState<StructuredLoadError>
  readonly options: readonly string[]
  readonly selected: readonly string[]
  readonly onToggle: (gene: string) => void
  // Adds a gene and filters to it; false when it is not in the panel.
  readonly onPick: (gene: string) => boolean
}

export interface TranscriptsSectionModelInput {
  readonly appendDebugEvent: AppendDebugEvent
  readonly effectiveTranscriptFeatureFilterMode: TranscriptFeatureFilterMode
  readonly geneOnlyFilterEnabled: boolean
  readonly geneOptions: readonly string[]
  readonly genePanelState: GenePanelState<StructuredLoadError>
  readonly handlePinTranscript: (detail: ViewerTranscriptHoverDetail) => void
  readonly hoveredTranscript: ViewerTranscriptHoverDetail | null
  readonly loadEnabled: boolean
  readonly pinnedTranscript: ViewerTranscriptHoverDetail | null
  readonly resetGeneExpressionSelectionState: () => void
  readonly selectedGenes: readonly string[]
  readonly setManualTranscriptExactRequestKey: Dispatch<SetStateAction<string | null>>
  readonly setPinnedTranscript: Dispatch<
    SetStateAction<ViewerTranscriptHoverDetail | null>
  >
  readonly setSelectedGenes: Dispatch<SetStateAction<readonly string[]>>
  readonly setShowTranscriptOverlay: Dispatch<SetStateAction<boolean>>
  readonly setTranscriptDensityColorScale: Dispatch<
    SetStateAction<TranscriptDensityColorScale>
  >
  readonly setTranscriptDetailMode: Dispatch<SetStateAction<TranscriptDetailMode>>
  readonly setTranscriptExactPointLimit: Dispatch<SetStateAction<number>>
  readonly setTranscriptFeatureFilterMode: Dispatch<
    SetStateAction<TranscriptFeatureFilterMode>
  >
  readonly setTranscriptGeneOnly: Dispatch<SetStateAction<boolean>>
  readonly setTranscriptMinQv: Dispatch<SetStateAction<number>>
  readonly setTranscriptOpacity: Dispatch<SetStateAction<number>>
  readonly setTranscriptPointColorMode: Dispatch<SetStateAction<TranscriptPointColorMode>>
  readonly setTranscriptPointSize: Dispatch<SetStateAction<number>>
  readonly showTranscriptOverlay: boolean
  readonly toggleGene: (gene: string) => void
  readonly transcriptCapabilityState: TranscriptCapabilityState
  readonly transcriptCopy: string
  readonly transcriptDensityColorScale: TranscriptDensityColorScale
  readonly transcriptDensityScaleLabels: readonly [string, string, string]
  readonly transcriptDensityScaleMax: number | undefined
  readonly transcriptDetailMode: TranscriptDetailMode
  readonly transcriptExactPointLimit: number
  readonly transcriptGeneOnly: boolean
  readonly transcriptLayerState: TranscriptLayerState
  readonly transcriptMinQv: number
  readonly transcriptOpacity: number
  readonly transcriptPointColorMode: TranscriptPointColorMode
  readonly transcriptPointSize: number
  readonly transcriptViewportKeyRef: { current: string | null }
  readonly visibleTranscriptEstimate: number
}

export function useTranscriptsSectionModel({
  appendDebugEvent,
  effectiveTranscriptFeatureFilterMode,
  geneOnlyFilterEnabled,
  geneOptions,
  genePanelState,
  handlePinTranscript,
  hoveredTranscript,
  loadEnabled,
  pinnedTranscript,
  resetGeneExpressionSelectionState,
  selectedGenes,
  setManualTranscriptExactRequestKey,
  setPinnedTranscript,
  setSelectedGenes,
  setShowTranscriptOverlay,
  setTranscriptDensityColorScale,
  setTranscriptDetailMode,
  setTranscriptExactPointLimit,
  setTranscriptFeatureFilterMode,
  setTranscriptGeneOnly,
  setTranscriptMinQv,
  setTranscriptOpacity,
  setTranscriptPointColorMode,
  setTranscriptPointSize,
  showTranscriptOverlay,
  toggleGene,
  transcriptCapabilityState,
  transcriptCopy,
  transcriptDensityColorScale,
  transcriptDensityScaleLabels,
  transcriptDensityScaleMax,
  transcriptDetailMode,
  transcriptExactPointLimit,
  transcriptGeneOnly,
  transcriptLayerState,
  transcriptMinQv,
  transcriptOpacity,
  transcriptPointColorMode,
  transcriptPointSize,
  transcriptViewportKeyRef,
  visibleTranscriptEstimate,
}: TranscriptsSectionModelInput): TranscriptsSectionModel {
  const {
    handleLoadExactViewport,
    handleToggleTranscriptSelectedFeature,
    handleTranscriptDensityColorScaleChange,
    handleTranscriptDetailModeChange,
    handleTranscriptExactPointLimitChange,
    handleTranscriptFeatureFilterModeChange,
    handleTranscriptGeneOnlyChange,
    handleTranscriptMinQvChange,
    handleTranscriptOpacityPercentChange,
    handleTranscriptOverlayChange,
    handleTranscriptPointColorModeChange,
    handleTranscriptPointSizeChange,
    pickTranscriptFeature,
  } = useTranscriptControlsWorkflow({
    callbacks: {
      appendDebugEvent,
      resetGeneExpressionSelectionState,
      toggleGene,
    },
    data: { geneOptions },
    refs: { transcriptViewportKeyRef },
    setters: {
      setManualTranscriptExactRequestKey,
      setSelectedGenes,
      setShowTranscriptOverlay,
      setTranscriptDensityColorScale,
      setTranscriptDetailMode,
      setTranscriptExactPointLimit,
      setTranscriptFeatureFilterMode,
      setTranscriptGeneOnly,
      setTranscriptMinQv,
      setTranscriptOpacity,
      setTranscriptPointColorMode,
      setTranscriptPointSize,
    },
  })

  return {
    loadEnabled,
    headerCopy: transcriptCopy,
    isLoading:
      transcriptCapabilityState.status === 'loading' ||
      transcriptLayerState.status === 'loading',
    capabilityState: transcriptCapabilityState,
    layerState: transcriptLayerState,
    visibleEstimate: visibleTranscriptEstimate,
    show: showTranscriptOverlay,
    onShowChange: handleTranscriptOverlayChange,
    detailMode: transcriptDetailMode,
    onDetailModeChange: handleTranscriptDetailModeChange,
    exactPointLimit: transcriptExactPointLimit,
    onExactPointLimitChange: handleTranscriptExactPointLimitChange,
    onLoadExactViewport: handleLoadExactViewport,
    features: {
      filterMode: effectiveTranscriptFeatureFilterMode,
      onFilterModeChange: handleTranscriptFeatureFilterModeChange,
      panelState: genePanelState,
      options: geneOptions,
      selected: selectedGenes,
      onToggle: handleToggleTranscriptSelectedFeature,
      onPick: pickTranscriptFeature,
    },
    densityColorScale: transcriptDensityColorScale,
    onDensityColorScaleChange: handleTranscriptDensityColorScaleChange,
    densityScaleMax: transcriptDensityScaleMax,
    densityScaleLabels: transcriptDensityScaleLabels,
    pointColorMode: transcriptPointColorMode,
    onPointColorModeChange: handleTranscriptPointColorModeChange,
    minQv: transcriptMinQv,
    onMinQvChange: handleTranscriptMinQvChange,
    geneOnly: transcriptGeneOnly,
    geneOnlyFilterEnabled,
    onGeneOnlyChange: handleTranscriptGeneOnlyChange,
    opacity: transcriptOpacity,
    onOpacityPercentChange: handleTranscriptOpacityPercentChange,
    pointSize: transcriptPointSize,
    onPointSizeChange: handleTranscriptPointSizeChange,
    hoveredTranscript,
    pinnedTranscript,
    onPinTranscript: handlePinTranscript,
    onClearPinnedTranscript: () => {
      setPinnedTranscript(null)
    },
  }
}
