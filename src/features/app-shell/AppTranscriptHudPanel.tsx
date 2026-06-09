import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
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
import { filterGeneOptions } from '../genes/geneControlsModel'
import { TranscriptHudPanel } from '../transcripts/TranscriptHudPanel'
import { useTranscriptControlsWorkflow } from '../transcripts/useTranscriptControlsWorkflow'
import type {
  TranscriptCapabilityState,
  TranscriptLayerState,
} from '../transcripts/transcriptLayerModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import type { DebugLogAppendOptions } from './appRuntimeModel'
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
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly controlIds: AppTranscriptControlIds
  readonly effectiveTranscriptFeatureFilterMode: TranscriptFeatureFilterMode
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
  readonly transcriptCapabilityState: TranscriptCapabilityState<StructuredLoadError>
  readonly transcriptCopy: string
  readonly transcriptDensityColorScale: TranscriptDensityColorScale
  readonly transcriptDensityScaleLabels: readonly [string, string, string]
  readonly transcriptDensityScaleMax: number | undefined
  readonly transcriptDetailMode: TranscriptDetailMode
  readonly transcriptExactPointLimit: number
  readonly transcriptGeneOnly: boolean
  readonly transcriptLayerState: TranscriptLayerState<StructuredLoadError>
  readonly transcriptMinQv: number
  readonly transcriptOpacity: number
  readonly transcriptPointColorMode: TranscriptPointColorMode
  readonly transcriptPointSize: number
  readonly transcriptViewportKeyRef: { current: string | null }
  readonly visibleTranscriptEstimate: number
}

export function AppTranscriptHudPanel({
  active,
  appendDebugEvent,
  controlIds,
  effectiveTranscriptFeatureFilterMode,
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
}: AppTranscriptHudPanelProps) {
  const [transcriptFeatureSearch, setTranscriptFeatureSearch] = useState('')
  const lastGenePanelLoadingUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (
      genePanelState.status !== 'loading' ||
      genePanelState.url === lastGenePanelLoadingUrlRef.current
    ) {
      return
    }

    lastGenePanelLoadingUrlRef.current = genePanelState.url
    setTranscriptFeatureSearch('')
  }, [genePanelState])

  const filteredTranscriptFeatures = useMemo(
    () =>
      filterGeneOptions(geneOptions, transcriptFeatureSearch, selectedGenes, {
        limit: 24,
      }),
    [geneOptions, selectedGenes, transcriptFeatureSearch],
  )

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
    appendDebugEvent,
    geneOptions,
    resetGeneExpressionSelectionState,
    setManualTranscriptExactRequestKey,
    setSelectedGenes,
    setShowTranscriptOverlay,
    setTranscriptDensityColorScale,
    setTranscriptDetailMode,
    setTranscriptExactPointLimit,
    setTranscriptFeatureFilterMode,
    setTranscriptFeatureSearch,
    setTranscriptGeneOnly,
    setTranscriptMinQv,
    setTranscriptOpacity,
    setTranscriptPointColorMode,
    setTranscriptPointSize,
    toggleGene,
    transcriptViewportKeyRef,
  })

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
