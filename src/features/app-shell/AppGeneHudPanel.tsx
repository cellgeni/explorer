import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { GeneExpressionDetailMode } from '../../data/geneExpressionLod'
import type { ContinuousCellMetadataTrack } from '../../data/customAnnotations'
import type { GeneExpressionBatch } from '../../datasets/xeniumDataset'
import type { ObservationColorMode } from '../../rendering/cellStyling'
import type {
  GeneExpressionColorScale,
  GeneExpressionScoreMode,
} from '../../rendering/deckLayers'
import { GeneHudPanel } from '../genes/GeneHudPanel'
import { useGeneControlsWorkflow } from '../genes/useGeneControlsWorkflow'
import type {
  GeneExpressionScaleDomain,
  GeneExpressionState,
  GenePanelState,
  SavedGeneSet,
} from '../genes/geneControlsModel'
import { filterGeneOptions } from '../genes/geneControlsModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import type { DebugLogAppendOptions } from './appRuntimeModel'
import type { AppControlIds } from './useAppControlIds'

type AppGeneControlIds = Pick<
  AppControlIds,
  | 'geneSearchInputId'
  | 'geneSetSymbolsInputId'
  | 'geneSetNameInputId'
  | 'geneSetScoreInputId'
  | 'geneScaleInputId'
  | 'geneExpressionDetailInputId'
  | 'observationModeInputId'
  | 'cellMetadataTrackInputId'
>

export interface AppGeneHudPanelProps {
  readonly active: boolean
  readonly analysisHeaderCopy: string
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly controlIds: AppGeneControlIds
  readonly geneExpressionColorScale: GeneExpressionColorScale
  readonly geneExpressionBatch: GeneExpressionBatch | null
  readonly geneExpressionCopy: string
  readonly geneExpressionDetailMode: GeneExpressionDetailMode
  readonly geneExpressionScaleMax: number
  readonly geneExpressionScaleDatasetUrl: string
  readonly geneExpressionScoreMode: GeneExpressionScoreMode
  readonly geneExpressionState: GeneExpressionState<StructuredLoadError>
  readonly genePanelState: GenePanelState<StructuredLoadError>
  readonly geneOptions: readonly string[]
  readonly hasAnnotationColors: boolean
  readonly cellMetadataTracks: readonly ContinuousCellMetadataTrack[]
  readonly selectedCellMetadataTrackId: string | null
  readonly observationColorMode: ObservationColorMode
  readonly rememberGeneExpressionScaleMax: (
    key: string,
    batch: GeneExpressionBatch,
    scoreMode: GeneExpressionScoreMode,
  ) => void
  readonly resetGeneExpressionSelectionState: () => void
  readonly selectedGenes: readonly string[]
  readonly setGeneExpressionColorScale: Dispatch<SetStateAction<GeneExpressionColorScale>>
  readonly setGeneExpressionDetailMode: Dispatch<SetStateAction<GeneExpressionDetailMode>>
  readonly setGeneExpressionScaleDomain: Dispatch<
    SetStateAction<GeneExpressionScaleDomain>
  >
  readonly setGeneExpressionScoreMode: Dispatch<SetStateAction<GeneExpressionScoreMode>>
  readonly setManualTranscriptExactRequestKey: Dispatch<SetStateAction<string | null>>
  readonly setSelectedCellMetadataTrackId: Dispatch<SetStateAction<string | null>>
  readonly setObservationColorMode: Dispatch<SetStateAction<ObservationColorMode>>
  readonly setSelectedGenes: Dispatch<SetStateAction<readonly string[]>>
  readonly toggleGene: (gene: string) => void
  readonly transcriptViewportKeyRef: { current: string | null }
}

export function AppGeneHudPanel({
  active,
  analysisHeaderCopy,
  appendDebugEvent,
  controlIds,
  geneExpressionColorScale,
  geneExpressionBatch,
  geneExpressionCopy,
  geneExpressionDetailMode,
  geneExpressionScaleMax,
  geneExpressionScaleDatasetUrl,
  geneExpressionScoreMode,
  geneExpressionState,
  genePanelState,
  geneOptions,
  hasAnnotationColors,
  cellMetadataTracks,
  selectedCellMetadataTrackId,
  observationColorMode,
  rememberGeneExpressionScaleMax,
  resetGeneExpressionSelectionState,
  selectedGenes,
  setGeneExpressionColorScale,
  setGeneExpressionDetailMode,
  setGeneExpressionScaleDomain,
  setGeneExpressionScoreMode,
  setManualTranscriptExactRequestKey,
  setSelectedCellMetadataTrackId,
  setObservationColorMode,
  setSelectedGenes,
  toggleGene,
  transcriptViewportKeyRef,
}: AppGeneHudPanelProps) {
  const [geneSearch, setGeneSearch] = useState('')
  const [geneSetSymbols, setGeneSetSymbols] = useState('')
  const [geneSetName, setGeneSetName] = useState('')
  const [savedGeneSets, setSavedGeneSets] = useState<readonly SavedGeneSet[]>([])
  const geneSetIdRef = useRef(0)
  const lastGenePanelLoadingUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (
      genePanelState.status !== 'loading' ||
      genePanelState.url === lastGenePanelLoadingUrlRef.current
    ) {
      return
    }

    lastGenePanelLoadingUrlRef.current = genePanelState.url
    geneSetIdRef.current = 0
    setGeneSearch('')
    setGeneSetSymbols('')
    setGeneSetName('')
    setSavedGeneSets([])
  }, [genePanelState])

  const filteredGenes = useMemo(
    () => filterGeneOptions(geneOptions, geneSearch, selectedGenes),
    [geneOptions, geneSearch, selectedGenes],
  )

  const {
    applyGeneSetSymbols,
    applySavedGeneSet,
    handleGeneExpressionColorScaleChange,
    handleGeneExpressionDetailModeChange,
    handleGeneExpressionScoreModeChange,
    handleObservationColorModeChange,
    removeSavedGeneSet,
    saveSelectedGeneSet,
  } = useGeneControlsWorkflow({
    appendDebugEvent,
    geneExpressionBatch,
    geneExpressionScaleDatasetUrl,
    geneExpressionScoreMode,
    geneOptions,
    geneSetIdRef,
    geneSetName,
    geneSetSymbols,
    rememberGeneExpressionScaleMax,
    savedGeneSets,
    selectedGenes,
    setGeneExpressionColorScale,
    setGeneExpressionDetailMode,
    setGeneExpressionScaleDomain,
    setGeneExpressionScoreMode,
    setGeneSearch,
    setGeneSetName,
    setManualTranscriptExactRequestKey,
    setObservationColorMode,
    setSavedGeneSets,
    setSelectedGenes,
    transcriptViewportKeyRef,
    resetGeneExpressionSelectionState,
    toggleGene,
  })

  return (
    <GeneHudPanel
      active={active}
      geneSearchInputId={controlIds.geneSearchInputId}
      geneSetSymbolsInputId={controlIds.geneSetSymbolsInputId}
      geneSetNameInputId={controlIds.geneSetNameInputId}
      geneSetScoreInputId={controlIds.geneSetScoreInputId}
      geneScaleInputId={controlIds.geneScaleInputId}
      geneExpressionDetailInputId={controlIds.geneExpressionDetailInputId}
      observationModeInputId={controlIds.observationModeInputId}
      cellMetadataTrackInputId={controlIds.cellMetadataTrackInputId}
      analysisHeaderCopy={analysisHeaderCopy}
      geneExpressionCopy={geneExpressionCopy}
      genePanelState={genePanelState}
      geneExpressionState={geneExpressionState}
      geneSearch={geneSearch}
      geneSetSymbols={geneSetSymbols}
      geneSetName={geneSetName}
      geneExpressionScoreMode={geneExpressionScoreMode}
      savedGeneSets={savedGeneSets}
      selectedGenes={selectedGenes}
      filteredGenes={filteredGenes}
      geneExpressionColorScale={geneExpressionColorScale}
      geneExpressionScaleMax={geneExpressionScaleMax}
      geneExpressionDetailMode={geneExpressionDetailMode}
      observationColorMode={observationColorMode}
      hasAnnotationColors={hasAnnotationColors}
      cellMetadataTracks={cellMetadataTracks}
      selectedCellMetadataTrackId={selectedCellMetadataTrackId}
      onGeneSearchChange={setGeneSearch}
      onToggleGene={toggleGene}
      onGeneSetSymbolsChange={setGeneSetSymbols}
      onApplyGeneSetSymbols={applyGeneSetSymbols}
      onSaveSelectedGeneSet={saveSelectedGeneSet}
      onGeneSetNameChange={setGeneSetName}
      onGeneExpressionScoreModeChange={handleGeneExpressionScoreModeChange}
      onApplySavedGeneSet={applySavedGeneSet}
      onRemoveSavedGeneSet={removeSavedGeneSet}
      onGeneExpressionColorScaleChange={handleGeneExpressionColorScaleChange}
      onGeneExpressionDetailModeChange={handleGeneExpressionDetailModeChange}
      onObservationColorModeChange={handleObservationColorModeChange}
      onCellMetadataTrackChange={setSelectedCellMetadataTrackId}
    />
  )
}
