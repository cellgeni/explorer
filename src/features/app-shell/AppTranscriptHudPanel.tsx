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
import type { GenePanelState } from '../genes/geneControlsModel'
import { TranscriptHudPanel } from '../transcripts/TranscriptHudPanel'
import type {
  TranscriptCapabilityState,
  TranscriptLayerState,
} from '../transcripts/transcriptLayerModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import type { AppControlIds } from './useAppControlIds'

type AppTranscriptControlIds = Pick<
  AppControlIds,
  | 'transcriptDetailInputId'
  | 'transcriptDensityScaleInputId'
  | 'transcriptPointColorInputId'
  | 'transcriptPointBudgetInputId'
  | 'transcriptMinQvInputId'
  | 'transcriptFeatureFilterInputId'
  | 'transcriptFeatureSearchInputId'
  | 'transcriptOpacityInputId'
  | 'transcriptPointSizeInputId'
>

export interface AppTranscriptHudPanelProps {
  readonly active: boolean
  readonly controlIds: AppTranscriptControlIds
  readonly effectiveTranscriptFeatureFilterMode: TranscriptFeatureFilterMode
  readonly filteredTranscriptFeatures: readonly string[]
  readonly genePanelState: GenePanelState<StructuredLoadError>
  readonly handleLoadExactViewport: (requestKey: string) => void
  readonly handlePinTranscript: (detail: ViewerTranscriptHoverDetail) => void
  readonly handleToggleTranscriptSelectedFeature: (feature: string) => void
  readonly handleTranscriptDensityColorScaleChange: (
    scale: TranscriptDensityColorScale,
  ) => void
  readonly handleTranscriptDetailModeChange: (mode: TranscriptDetailMode) => void
  readonly handleTranscriptExactPointLimitChange: (limit: number) => void
  readonly handleTranscriptFeatureFilterModeChange: (
    mode: TranscriptFeatureFilterMode,
  ) => void
  readonly handleTranscriptGeneOnlyChange: (enabled: boolean) => void
  readonly handleTranscriptMinQvChange: (minQv: number) => void
  readonly handleTranscriptOpacityPercentChange: (percent: number) => void
  readonly handleTranscriptOverlayChange: (enabled: boolean) => void
  readonly handleTranscriptPointColorModeChange: (mode: TranscriptPointColorMode) => void
  readonly handleTranscriptPointSizeChange: (pointSize: number) => void
  readonly hoveredTranscript: ViewerTranscriptHoverDetail | null
  readonly loadEnabled: boolean
  readonly pickTranscriptFeature: (feature: string) => void
  readonly pinnedTranscript: ViewerTranscriptHoverDetail | null
  readonly selectedGenes: readonly string[]
  readonly setPinnedTranscript: Dispatch<
    SetStateAction<ViewerTranscriptHoverDetail | null>
  >
  readonly setTranscriptFeatureSearch: Dispatch<SetStateAction<string>>
  readonly showTranscriptOverlay: boolean
  readonly transcriptCapabilityState: TranscriptCapabilityState<StructuredLoadError>
  readonly transcriptCopy: string
  readonly transcriptDensityColorScale: TranscriptDensityColorScale
  readonly transcriptDensityScaleLabels: readonly [string, string, string]
  readonly transcriptDensityScaleMax: number | undefined
  readonly transcriptDetailMode: TranscriptDetailMode
  readonly transcriptExactPointLimit: number
  readonly transcriptFeatureSearch: string
  readonly transcriptGeneOnly: boolean
  readonly transcriptLayerState: TranscriptLayerState<StructuredLoadError>
  readonly transcriptMinQv: number
  readonly transcriptOpacity: number
  readonly transcriptPointColorMode: TranscriptPointColorMode
  readonly transcriptPointSize: number
  readonly visibleTranscriptEstimate: number
}

export function AppTranscriptHudPanel({
  active,
  controlIds,
  effectiveTranscriptFeatureFilterMode,
  filteredTranscriptFeatures,
  genePanelState,
  handleLoadExactViewport,
  handlePinTranscript,
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
  hoveredTranscript,
  loadEnabled,
  pickTranscriptFeature,
  pinnedTranscript,
  selectedGenes,
  setPinnedTranscript,
  setTranscriptFeatureSearch,
  showTranscriptOverlay,
  transcriptCapabilityState,
  transcriptCopy,
  transcriptDensityColorScale,
  transcriptDensityScaleLabels,
  transcriptDensityScaleMax,
  transcriptDetailMode,
  transcriptExactPointLimit,
  transcriptFeatureSearch,
  transcriptGeneOnly,
  transcriptLayerState,
  transcriptMinQv,
  transcriptOpacity,
  transcriptPointColorMode,
  transcriptPointSize,
  visibleTranscriptEstimate,
}: AppTranscriptHudPanelProps) {
  return (
    <TranscriptHudPanel
      active={active}
      transcriptDetailInputId={controlIds.transcriptDetailInputId}
      transcriptDensityScaleInputId={controlIds.transcriptDensityScaleInputId}
      transcriptPointColorInputId={controlIds.transcriptPointColorInputId}
      transcriptPointBudgetInputId={controlIds.transcriptPointBudgetInputId}
      transcriptMinQvInputId={controlIds.transcriptMinQvInputId}
      transcriptFeatureFilterInputId={controlIds.transcriptFeatureFilterInputId}
      transcriptFeatureSearchInputId={controlIds.transcriptFeatureSearchInputId}
      transcriptOpacityInputId={controlIds.transcriptOpacityInputId}
      transcriptPointSizeInputId={controlIds.transcriptPointSizeInputId}
      transcriptCopy={transcriptCopy}
      loadEnabled={loadEnabled}
      featureSearchEnabled={genePanelState.status === 'ready'}
      showTranscriptOverlay={showTranscriptOverlay}
      transcriptDetailMode={transcriptDetailMode}
      transcriptExactPointLimit={transcriptExactPointLimit}
      effectiveTranscriptFeatureFilterMode={effectiveTranscriptFeatureFilterMode}
      selectedGenes={selectedGenes}
      transcriptFeatureSearch={transcriptFeatureSearch}
      filteredTranscriptFeatures={filteredTranscriptFeatures}
      transcriptDensityColorScale={transcriptDensityColorScale}
      transcriptDensityScaleMax={transcriptDensityScaleMax}
      transcriptDensityScaleLabels={transcriptDensityScaleLabels}
      transcriptPointColorMode={transcriptPointColorMode}
      transcriptMinQv={transcriptMinQv}
      transcriptGeneOnly={transcriptGeneOnly}
      transcriptOpacity={transcriptOpacity}
      transcriptPointSize={transcriptPointSize}
      transcriptCapabilityState={transcriptCapabilityState}
      transcriptLayerState={transcriptLayerState}
      visibleTranscriptEstimate={visibleTranscriptEstimate}
      hoveredTranscript={hoveredTranscript}
      pinnedTranscript={pinnedTranscript}
      onShowTranscriptOverlayChange={handleTranscriptOverlayChange}
      onTranscriptDetailModeChange={handleTranscriptDetailModeChange}
      onTranscriptExactPointLimitChange={handleTranscriptExactPointLimitChange}
      onTranscriptFeatureFilterModeChange={handleTranscriptFeatureFilterModeChange}
      onToggleSelectedFeature={handleToggleTranscriptSelectedFeature}
      onTranscriptFeatureSearchChange={setTranscriptFeatureSearch}
      onPickTranscriptFeature={pickTranscriptFeature}
      onTranscriptDensityColorScaleChange={handleTranscriptDensityColorScaleChange}
      onTranscriptPointColorModeChange={handleTranscriptPointColorModeChange}
      onTranscriptMinQvChange={handleTranscriptMinQvChange}
      onTranscriptGeneOnlyChange={handleTranscriptGeneOnlyChange}
      onTranscriptOpacityPercentChange={handleTranscriptOpacityPercentChange}
      onTranscriptPointSizeChange={handleTranscriptPointSizeChange}
      onPinTranscript={handlePinTranscript}
      onClearPinnedTranscript={() => {
        setPinnedTranscript(null)
      }}
      onLoadExactViewport={handleLoadExactViewport}
    />
  )
}
