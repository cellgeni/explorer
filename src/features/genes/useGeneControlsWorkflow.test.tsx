import { act, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { GeneExpressionBatch } from '../../datasets/xeniumDataset'
import type { GeneExpressionDetailMode } from '../../data/geneExpressionLod'
import type { ObservationColorMode } from '../../rendering/cellStyling'
import type {
  GeneExpressionColorScale,
  GeneExpressionScoreMode,
} from '../../rendering/deckLayers'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import type { GeneExpressionScaleDomain, GeneExpressionState } from './geneControlsModel'
import { useGeneControlsWorkflow } from './useGeneControlsWorkflow'

interface GeneControlsSnapshot {
  readonly debugMessages: readonly string[]
  readonly expressionAbortWasAborted: boolean
  readonly expressionRequestId: number
  readonly geneExpressionBatch: GeneExpressionBatch | null
  readonly geneExpressionColorScale: GeneExpressionColorScale
  readonly geneExpressionDetailMode: GeneExpressionDetailMode
  readonly geneExpressionScaleDomain: GeneExpressionScaleDomain
  readonly geneExpressionScoreMode: GeneExpressionScoreMode
  readonly geneExpressionState: GeneExpressionState<StructuredLoadError>
  readonly geneExpressionViewportKey: string | null
  readonly manualTranscriptExactRequestKey: string | null
  readonly observationColorMode: ObservationColorMode
  readonly selectedGenes: readonly string[]
  readonly transcriptViewportKey: string | null
}

let geneControlsApi: ReturnType<typeof useGeneControlsWorkflow>
let geneControlsSnapshot: GeneControlsSnapshot

function GeneControlsProbe() {
  const [geneExpressionBatch, setGeneExpressionBatch] =
    React.useState<GeneExpressionBatch | null>(null)
  const [geneExpressionColorScale, setGeneExpressionColorScale] =
    React.useState<GeneExpressionColorScale>('plasma')
  const [geneExpressionDetailMode, setGeneExpressionDetailMode] =
    React.useState<GeneExpressionDetailMode>('auto')
  const [geneExpressionScaleDomain, setGeneExpressionScaleDomain] =
    React.useState<GeneExpressionScaleDomain>({ key: 'active', max: 12 })
  const [geneExpressionScoreMode, setGeneExpressionScoreMode] =
    React.useState<GeneExpressionScoreMode>('sum')
  const [geneExpressionState, setGeneExpressionState] = React.useState<
    GeneExpressionState<StructuredLoadError>
  >({
    status: 'ready',
    url: 'https://example.test/output',
    genes: ['Actb'],
    mode: 'exact-region',
    cellCount: 1,
    visibleCellCount: 1,
  })
  const [manualTranscriptExactRequestKey, setManualTranscriptExactRequestKey] =
    React.useState<string | null>('manual-request')
  const [observationColorMode, setObservationColorMode] =
    React.useState<ObservationColorMode>('transcript-count')
  const [selectedGenes, setSelectedGenes] = React.useState<readonly string[]>(['Actb'])
  const [expressionAbortController] = React.useState(() => new AbortController())
  const geneExpressionAbortRef = React.useRef<AbortController | null>(
    expressionAbortController,
  )
  const geneExpressionRequestIdRef = React.useRef(3)
  const geneExpressionViewportKeyRef = React.useRef<string | null>('expression-view')
  const transcriptViewportKeyRef = React.useRef<string | null>('transcript-view')
  const debugMessagesRef = React.useRef<string[]>([])
  const resetGeneExpressionSelectionState = React.useCallback(() => {
    geneExpressionAbortRef.current?.abort()
    geneExpressionRequestIdRef.current += 1
    geneExpressionViewportKeyRef.current = null
    setGeneExpressionBatch(null)
    setGeneExpressionScaleDomain({ key: '', max: 0 })
    setGeneExpressionState({ status: 'idle' })
  }, [])

  const api = useGeneControlsWorkflow({
    callbacks: {
      appendDebugEvent: (message) => {
        debugMessagesRef.current.push(message)
      },
      rememberGeneExpressionScaleMax: vi.fn(),
      resetGeneExpressionSelectionState,
    },
    data: {
      geneExpressionBatch,
      geneExpressionScaleDatasetUrl: 'https://example.test/output',
      selectedGenes,
    },
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

  React.useEffect(() => {
    geneControlsApi = api
    geneControlsSnapshot = {
      debugMessages: debugMessagesRef.current,
      expressionAbortWasAborted: expressionAbortController.signal.aborted,
      expressionRequestId: geneExpressionRequestIdRef.current,
      geneExpressionBatch,
      geneExpressionColorScale,
      geneExpressionDetailMode,
      geneExpressionScaleDomain,
      geneExpressionScoreMode,
      geneExpressionState,
      geneExpressionViewportKey: geneExpressionViewportKeyRef.current,
      manualTranscriptExactRequestKey,
      observationColorMode,
      selectedGenes,
      transcriptViewportKey: transcriptViewportKeyRef.current,
    }
  })

  return null
}

describe('useGeneControlsWorkflow', () => {
  it('applies genes while clearing active expression selection state', () => {
    render(<GeneControlsProbe />)

    act(() => {
      geneControlsApi.applyGenes(['Actb', 'Gad1'], 'mean')
    })

    expect(geneControlsSnapshot.selectedGenes).toEqual(['Actb', 'Gad1'])
    expect(geneControlsSnapshot.observationColorMode).toBe('gene-expression')
    expect(geneControlsSnapshot.geneExpressionScoreMode).toBe('mean')
    expect(geneControlsSnapshot.manualTranscriptExactRequestKey).toBeNull()
    expect(geneControlsSnapshot.transcriptViewportKey).toBeNull()
    expect(geneControlsSnapshot.geneExpressionState).toEqual({ status: 'idle' })
    expect(geneControlsSnapshot.geneExpressionBatch).toBeNull()
    expect(geneControlsSnapshot.geneExpressionScaleDomain).toEqual({ key: '', max: 0 })
    expect(geneControlsSnapshot.geneExpressionViewportKey).toBeNull()
    expect(geneControlsSnapshot.expressionRequestId).toBe(4)
    expect(geneControlsSnapshot.expressionAbortWasAborted).toBe(true)
  })

  it('keeps the score mode when none is given', () => {
    render(<GeneControlsProbe />)

    act(() => {
      geneControlsApi.applyGenes(['Gad1'])
    })

    expect(geneControlsSnapshot.selectedGenes).toEqual(['Gad1'])
    expect(geneControlsSnapshot.geneExpressionScoreMode).toBe('sum')
  })

  it('logs and applies colour, scale and detail changes', () => {
    render(<GeneControlsProbe />)

    act(() => {
      geneControlsApi.handleGeneExpressionScoreModeChange('z-score')
      geneControlsApi.handleGeneExpressionColorScaleChange('viridis')
      geneControlsApi.handleGeneExpressionDetailModeChange('all-cells')
      geneControlsApi.handleObservationColorModeChange('cell-area')
    })

    expect(geneControlsSnapshot.geneExpressionScoreMode).toBe('z-score')
    // Without a batch the remembered scale resets.
    expect(geneControlsSnapshot.geneExpressionScaleDomain).toEqual({ key: '', max: 0 })
    expect(geneControlsSnapshot.geneExpressionColorScale).toBe('viridis')
    expect(geneControlsSnapshot.geneExpressionDetailMode).toBe('all-cells')
    expect(geneControlsSnapshot.observationColorMode).toBe('cell-area')
    expect(geneControlsSnapshot.debugMessages).toEqual([
      'Signature score: z-score',
      'Gene scale: viridis',
      'Expression detail: all-cells',
      'Cell color: cell-area',
    ])
  })
})
