import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type { GeneExpressionDetailMode } from '../../data/geneExpressionLod'
import type { GeneExpressionBatch } from '../../datasets/xeniumDataset'
import type { ObservationColorMode } from '../../rendering/cellStyling'
import type {
  GeneExpressionColorScale,
  GeneExpressionScoreMode,
} from '../../rendering/deckLayers'
import type { AppendDebugEvent } from '../app-shell/appRuntimeModel'
import {
  geneExpressionScaleKeyFor,
  type GeneExpressionScaleDomain,
} from './geneControlsModel'

interface MutableRef<T> {
  current: T
}

interface GeneControlsCallbackOptions {
  readonly appendDebugEvent: AppendDebugEvent
  readonly rememberGeneExpressionScaleMax: (
    key: string,
    batch: GeneExpressionBatch,
    scoreMode: GeneExpressionScoreMode,
  ) => void
  readonly resetGeneExpressionSelectionState: () => void
}

interface GeneControlsDataOptions {
  readonly geneExpressionBatch: GeneExpressionBatch | null
  readonly geneExpressionScaleDatasetUrl: string
  readonly selectedGenes: readonly string[]
}

interface GeneControlsRefOptions {
  readonly transcriptViewportKeyRef: MutableRef<string | null>
}

interface GeneControlsSetterOptions {
  readonly setGeneExpressionColorScale: Dispatch<SetStateAction<GeneExpressionColorScale>>
  readonly setGeneExpressionDetailMode: Dispatch<SetStateAction<GeneExpressionDetailMode>>
  readonly setGeneExpressionScaleDomain: Dispatch<
    SetStateAction<GeneExpressionScaleDomain>
  >
  readonly setGeneExpressionScoreMode: Dispatch<SetStateAction<GeneExpressionScoreMode>>
  readonly setManualTranscriptExactRequestKey: Dispatch<SetStateAction<string | null>>
  readonly setObservationColorMode: Dispatch<SetStateAction<ObservationColorMode>>
  readonly setSelectedGenes: Dispatch<SetStateAction<readonly string[]>>
}

interface UseGeneControlsWorkflowOptions {
  readonly callbacks: GeneControlsCallbackOptions
  readonly data: GeneControlsDataOptions
  readonly refs: GeneControlsRefOptions
  readonly setters: GeneControlsSetterOptions
}

interface UseGeneControlsWorkflowResult {
  // Replaces the selection and colours cells by it, with the set's score mode
  // when one is given (typed symbols and saved gene sets).
  readonly applyGenes: (
    genes: readonly string[],
    scoreMode?: GeneExpressionScoreMode | undefined,
  ) => void
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
}

// The gene controls that change app state. The gene search and gene set
// drafts stay in the gene picker (useGeneSetControls).
export function useGeneControlsWorkflow({
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
}: UseGeneControlsWorkflowOptions): UseGeneControlsWorkflowResult {
  const applyGenes = useCallback(
    (genes: readonly string[], scoreMode?: GeneExpressionScoreMode) => {
      resetGeneExpressionSelectionState()
      transcriptViewportKeyRef.current = null
      setManualTranscriptExactRequestKey(null)
      setSelectedGenes(genes)
      setObservationColorMode('gene-expression')

      if (scoreMode !== undefined) {
        setGeneExpressionScoreMode(scoreMode)
      }
    },
    [
      resetGeneExpressionSelectionState,
      setGeneExpressionScoreMode,
      setManualTranscriptExactRequestKey,
      setObservationColorMode,
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

  return {
    applyGenes,
    handleGeneExpressionColorScaleChange,
    handleGeneExpressionDetailModeChange,
    handleGeneExpressionScoreModeChange,
    handleObservationColorModeChange,
  }
}
