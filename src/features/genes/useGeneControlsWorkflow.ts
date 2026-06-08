import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type { GeneExpressionDetailMode } from '../../data/geneExpressionLod'
import type { GeneExpressionBatch } from '../../datasets/xeniumDataset'
import type { ObservationColorMode } from '../../rendering/cellStyling'
import type {
  GeneExpressionColorScale,
  GeneExpressionScoreMode,
} from '../../rendering/deckLayers'
import {
  abortActiveRequest,
  type DebugLogAppendOptions,
} from '../app-shell/appRuntimeModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import {
  defaultGeneSetName,
  geneExpressionScaleKeyFor,
  parseGeneSetSymbols,
  type GeneExpressionScaleDomain,
  type GeneExpressionState,
  type SavedGeneSet,
} from './geneControlsModel'

interface MutableRef<T> {
  current: T
}

interface UseGeneControlsWorkflowOptions {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly geneExpressionAbortRef: MutableRef<AbortController | null>
  readonly geneExpressionBatch: GeneExpressionBatch | null
  readonly geneExpressionRequestIdRef: MutableRef<number>
  readonly geneExpressionScaleDatasetUrl: string
  readonly geneExpressionScoreMode: GeneExpressionScoreMode
  readonly geneExpressionViewportKeyRef: MutableRef<string | null>
  readonly geneOptions: readonly string[]
  readonly geneSetIdRef: MutableRef<number>
  readonly geneSetName: string
  readonly geneSetSymbols: string
  readonly rememberGeneExpressionScaleMax: (
    key: string,
    batch: GeneExpressionBatch,
    scoreMode: GeneExpressionScoreMode,
  ) => void
  readonly savedGeneSets: readonly SavedGeneSet[]
  readonly selectedGenes: readonly string[]
  readonly setGeneExpressionBatch: Dispatch<SetStateAction<GeneExpressionBatch | null>>
  readonly setGeneExpressionColorScale: Dispatch<SetStateAction<GeneExpressionColorScale>>
  readonly setGeneExpressionDetailMode: Dispatch<SetStateAction<GeneExpressionDetailMode>>
  readonly setGeneExpressionScaleDomain: Dispatch<
    SetStateAction<GeneExpressionScaleDomain>
  >
  readonly setGeneExpressionScoreMode: Dispatch<SetStateAction<GeneExpressionScoreMode>>
  readonly setGeneExpressionState: Dispatch<
    SetStateAction<GeneExpressionState<StructuredLoadError>>
  >
  readonly setGeneSearch: Dispatch<SetStateAction<string>>
  readonly setGeneSetName: Dispatch<SetStateAction<string>>
  readonly setManualTranscriptExactRequestKey: Dispatch<SetStateAction<string | null>>
  readonly setObservationColorMode: Dispatch<SetStateAction<ObservationColorMode>>
  readonly setSavedGeneSets: Dispatch<SetStateAction<readonly SavedGeneSet[]>>
  readonly setSelectedGenes: Dispatch<SetStateAction<readonly string[]>>
  readonly transcriptViewportKeyRef: MutableRef<string | null>
}

interface UseGeneControlsWorkflowResult {
  readonly applyGeneSetSymbols: () => void
  readonly applySavedGeneSet: (geneSet: SavedGeneSet) => void
  readonly handleGeneExpressionColorScaleChange: (
    nextScale: GeneExpressionColorScale,
  ) => void
  readonly handleGeneExpressionDetailModeChange: (
    nextMode: GeneExpressionDetailMode,
  ) => void
  readonly handleGeneExpressionScoreModeChange: (
    nextScoreMode: GeneExpressionScoreMode,
  ) => void
  readonly handleObservationColorModeChange: (nextMode: ObservationColorMode) => void
  readonly removeSavedGeneSet: (id: string) => void
  readonly resetGeneExpressionSelectionState: () => void
  readonly saveSelectedGeneSet: () => void
  readonly toggleGene: (gene: string) => void
}

export function useGeneControlsWorkflow({
  appendDebugEvent,
  geneExpressionAbortRef,
  geneExpressionBatch,
  geneExpressionRequestIdRef,
  geneExpressionScaleDatasetUrl,
  geneExpressionScoreMode,
  geneExpressionViewportKeyRef,
  geneOptions,
  geneSetIdRef,
  geneSetName,
  geneSetSymbols,
  rememberGeneExpressionScaleMax,
  savedGeneSets,
  selectedGenes,
  setGeneExpressionBatch,
  setGeneExpressionColorScale,
  setGeneExpressionDetailMode,
  setGeneExpressionScaleDomain,
  setGeneExpressionScoreMode,
  setGeneExpressionState,
  setGeneSearch,
  setGeneSetName,
  setManualTranscriptExactRequestKey,
  setObservationColorMode,
  setSavedGeneSets,
  setSelectedGenes,
  transcriptViewportKeyRef,
}: UseGeneControlsWorkflowOptions): UseGeneControlsWorkflowResult {
  const resetGeneExpressionSelectionState = useCallback(() => {
    abortActiveRequest(geneExpressionAbortRef)
    geneExpressionRequestIdRef.current += 1
    geneExpressionViewportKeyRef.current = null
    setGeneExpressionBatch(null)
    setGeneExpressionScaleDomain({ key: '', max: 0 })
    setGeneExpressionState({ status: 'idle' })
  }, [
    geneExpressionAbortRef,
    geneExpressionRequestIdRef,
    geneExpressionViewportKeyRef,
    setGeneExpressionBatch,
    setGeneExpressionScaleDomain,
    setGeneExpressionState,
  ])

  const toggleGene = useCallback(
    (gene: string) => {
      const isSelected = selectedGenes.includes(gene)
      appendDebugEvent(isSelected ? `Cleared gene ${gene}` : `Highlight gene ${gene}`)
      resetGeneExpressionSelectionState()
      setManualTranscriptExactRequestKey(null)
      setSelectedGenes((current) =>
        isSelected
          ? current.filter((selectedGene) => selectedGene !== gene)
          : [...current, gene].sort((a, b) => a.localeCompare(b)),
      )
    },
    [
      appendDebugEvent,
      resetGeneExpressionSelectionState,
      selectedGenes,
      setManualTranscriptExactRequestKey,
      setSelectedGenes,
    ],
  )

  const applyGeneSetSymbols = useCallback(() => {
    const genes = parseGeneSetSymbols(geneSetSymbols, geneOptions)

    if (genes.length === 0) {
      return
    }

    appendDebugEvent(`Applied symbols: ${genes.length.toLocaleString()} genes`)
    setSelectedGenes(genes)
    resetGeneExpressionSelectionState()
    transcriptViewportKeyRef.current = null
    setManualTranscriptExactRequestKey(null)
    setGeneSearch('')
  }, [
    appendDebugEvent,
    geneOptions,
    geneSetSymbols,
    resetGeneExpressionSelectionState,
    setGeneSearch,
    setManualTranscriptExactRequestKey,
    setSelectedGenes,
    transcriptViewportKeyRef,
  ])

  const saveSelectedGeneSet = useCallback(() => {
    if (selectedGenes.length === 0) {
      return
    }

    const name = geneSetName.trim() || defaultGeneSetName(selectedGenes)
    const normalizedName = name.toLowerCase()
    const savedSet: SavedGeneSet = {
      id: `gene-set-${geneSetIdRef.current + 1}`,
      name,
      genes: selectedGenes,
      scoreMode: geneExpressionScoreMode,
    }

    geneSetIdRef.current += 1
    appendDebugEvent(`Saved gene set ${name}`)
    setSavedGeneSets((current) => [
      savedSet,
      ...current.filter((geneSet) => geneSet.name.toLowerCase() !== normalizedName),
    ])
    setGeneSetName('')
  }, [
    appendDebugEvent,
    geneExpressionScoreMode,
    geneSetIdRef,
    geneSetName,
    selectedGenes,
    setGeneSetName,
    setSavedGeneSets,
  ])

  const applySavedGeneSet = useCallback(
    (geneSet: SavedGeneSet) => {
      appendDebugEvent(`Applied gene set ${geneSet.name}`)
      resetGeneExpressionSelectionState()
      transcriptViewportKeyRef.current = null
      setManualTranscriptExactRequestKey(null)
      setSelectedGenes(geneSet.genes)
      setGeneExpressionScoreMode(geneSet.scoreMode)
      setGeneSearch('')
    },
    [
      appendDebugEvent,
      resetGeneExpressionSelectionState,
      setGeneExpressionScoreMode,
      setGeneSearch,
      setManualTranscriptExactRequestKey,
      setSelectedGenes,
      transcriptViewportKeyRef,
    ],
  )

  const handleGeneExpressionScoreModeChange = useCallback(
    (nextScoreMode: GeneExpressionScoreMode) => {
      appendDebugEvent(`Signature score: ${nextScoreMode}`)
      setGeneExpressionScoreMode(nextScoreMode)

      if (geneExpressionBatch === null) {
        setGeneExpressionScaleDomain({ key: '', max: 0 })
        return
      }

      rememberGeneExpressionScaleMax(
        geneExpressionScaleKeyFor(
          geneExpressionScaleDatasetUrl,
          nextScoreMode,
          selectedGenes,
        ),
        geneExpressionBatch,
        nextScoreMode,
      )
    },
    [
      appendDebugEvent,
      geneExpressionBatch,
      geneExpressionScaleDatasetUrl,
      rememberGeneExpressionScaleMax,
      selectedGenes,
      setGeneExpressionScaleDomain,
      setGeneExpressionScoreMode,
    ],
  )

  const handleGeneExpressionColorScaleChange = useCallback(
    (nextScale: GeneExpressionColorScale) => {
      setGeneExpressionColorScale(nextScale)
      appendDebugEvent(`Gene scale: ${nextScale}`)
    },
    [appendDebugEvent, setGeneExpressionColorScale],
  )

  const handleGeneExpressionDetailModeChange = useCallback(
    (nextMode: GeneExpressionDetailMode) => {
      setGeneExpressionDetailMode(nextMode)
      appendDebugEvent(`Expression detail: ${nextMode}`)
    },
    [appendDebugEvent, setGeneExpressionDetailMode],
  )

  const handleObservationColorModeChange = useCallback(
    (nextMode: ObservationColorMode) => {
      setObservationColorMode(nextMode)
      appendDebugEvent(`Cell color: ${nextMode}`)
    },
    [appendDebugEvent, setObservationColorMode],
  )

  const removeSavedGeneSet = useCallback(
    (id: string) => {
      const removedSet = savedGeneSets.find((geneSet) => geneSet.id === id)

      if (removedSet !== undefined) {
        appendDebugEvent(`Removed gene set ${removedSet.name}`)
      }

      setSavedGeneSets((current) => current.filter((geneSet) => geneSet.id !== id))
    },
    [appendDebugEvent, savedGeneSets, setSavedGeneSets],
  )

  return {
    applyGeneSetSymbols,
    applySavedGeneSet,
    handleGeneExpressionColorScaleChange,
    handleGeneExpressionDetailModeChange,
    handleGeneExpressionScoreModeChange,
    handleObservationColorModeChange,
    removeSavedGeneSet,
    resetGeneExpressionSelectionState,
    saveSelectedGeneSet,
    toggleGene,
  }
}
