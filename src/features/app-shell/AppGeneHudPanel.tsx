import type { Dispatch, SetStateAction } from 'react'
import type { GeneExpressionDetailMode } from '../../data/geneExpressionLod'
import type { ObservationColorMode } from '../../rendering/cellStyling'
import type {
  GeneExpressionColorScale,
  GeneExpressionScoreMode,
} from '../../rendering/deckLayers'
import { GeneHudPanel } from '../genes/GeneHudPanel'
import type {
  GeneExpressionState,
  GenePanelState,
  SavedGeneSet,
} from '../genes/geneControlsModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
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
>

export interface AppGeneHudPanelProps {
  readonly active: boolean
  readonly analysisHeaderCopy: string
  readonly applyGeneSetSymbols: () => void
  readonly applySavedGeneSet: (geneSet: SavedGeneSet) => void
  readonly controlIds: AppGeneControlIds
  readonly filteredGenes: readonly string[]
  readonly geneExpressionColorScale: GeneExpressionColorScale
  readonly geneExpressionCopy: string
  readonly geneExpressionDetailMode: GeneExpressionDetailMode
  readonly geneExpressionScaleMax: number
  readonly geneExpressionScoreMode: GeneExpressionScoreMode
  readonly geneExpressionState: GeneExpressionState<StructuredLoadError>
  readonly genePanelState: GenePanelState<StructuredLoadError>
  readonly geneSearch: string
  readonly geneSetName: string
  readonly geneSetSymbols: string
  readonly handleGeneExpressionColorScaleChange: (scale: GeneExpressionColorScale) => void
  readonly handleGeneExpressionDetailModeChange: (mode: GeneExpressionDetailMode) => void
  readonly handleGeneExpressionScoreModeChange: (mode: GeneExpressionScoreMode) => void
  readonly handleObservationColorModeChange: (mode: ObservationColorMode) => void
  readonly hasAnnotationColors: boolean
  readonly observationColorMode: ObservationColorMode
  readonly removeSavedGeneSet: (id: string) => void
  readonly savedGeneSets: readonly SavedGeneSet[]
  readonly saveSelectedGeneSet: () => void
  readonly selectedGenes: readonly string[]
  readonly setGeneSearch: Dispatch<SetStateAction<string>>
  readonly setGeneSetName: Dispatch<SetStateAction<string>>
  readonly setGeneSetSymbols: Dispatch<SetStateAction<string>>
  readonly toggleGene: (gene: string) => void
}

export function AppGeneHudPanel({
  active,
  analysisHeaderCopy,
  applyGeneSetSymbols,
  applySavedGeneSet,
  controlIds,
  filteredGenes,
  geneExpressionColorScale,
  geneExpressionCopy,
  geneExpressionDetailMode,
  geneExpressionScaleMax,
  geneExpressionScoreMode,
  geneExpressionState,
  genePanelState,
  geneSearch,
  geneSetName,
  geneSetSymbols,
  handleGeneExpressionColorScaleChange,
  handleGeneExpressionDetailModeChange,
  handleGeneExpressionScoreModeChange,
  handleObservationColorModeChange,
  hasAnnotationColors,
  observationColorMode,
  removeSavedGeneSet,
  savedGeneSets,
  saveSelectedGeneSet,
  selectedGenes,
  setGeneSearch,
  setGeneSetName,
  setGeneSetSymbols,
  toggleGene,
}: AppGeneHudPanelProps) {
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
    />
  )
}
