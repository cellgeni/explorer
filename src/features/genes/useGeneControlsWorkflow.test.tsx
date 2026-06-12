import { act, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { GeneExpressionBatch } from '../../datasets/xeniumDataset'
import type { GeneExpressionDetailMode } from '../../data/geneExpressionLod'
import type { ObservationColorMode } from '../../rendering/cellStyling'
import type { GeneExpressionColorScale } from '../../rendering/deckLayers'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import type {
  GeneExpressionScaleDomain,
  GeneExpressionState,
  SavedGeneSet,
} from './geneControlsModel'
import { useGeneControlsWorkflow } from './useGeneControlsWorkflow'

interface GeneControlsSnapshot {
  readonly debugMessages: readonly string[]
  readonly expressionAbortWasAborted: boolean
  readonly expressionRequestId: number
  readonly geneExpressionBatch: GeneExpressionBatch | null
  readonly geneExpressionColorScale: GeneExpressionColorScale
  readonly geneExpressionScaleDomain: GeneExpressionScaleDomain
  readonly geneExpressionState: GeneExpressionState<StructuredLoadError>
  readonly geneExpressionViewportKey: string | null
  readonly geneSearch: string
  readonly geneSetName: string
  readonly manualTranscriptExactRequestKey: string | null
  readonly savedGeneSets: readonly SavedGeneSet[]
  readonly selectedGenes: readonly string[]
  readonly transcriptViewportKey: string | null
}

interface GeneControlsProbeProps {
  readonly geneSetName?: string
  readonly geneSetSymbols?: string
  readonly initialSelectedGenes?: readonly string[]
  readonly onReady: (
    api: ReturnType<typeof useGeneControlsWorkflow>,
    snapshot: GeneControlsSnapshot,
  ) => void
}

let geneControlsApi: ReturnType<typeof useGeneControlsWorkflow>
let geneControlsSnapshot: GeneControlsSnapshot

function GeneControlsProbe({
  geneSetName: initialGeneSetName = '',
  geneSetSymbols = '',
  initialSelectedGenes = ['Actb'],
  onReady,
}: GeneControlsProbeProps) {
  const [geneExpressionBatch, setGeneExpressionBatch] =
    React.useState<GeneExpressionBatch | null>(null)
  const [geneExpressionColorScale, setGeneExpressionColorScale] =
    React.useState<GeneExpressionColorScale>('plasma')
  const [geneExpressionDetailMode, setGeneExpressionDetailMode] =
    React.useState<GeneExpressionDetailMode>('auto')
  const [geneExpressionScaleDomain, setGeneExpressionScaleDomain] =
    React.useState<GeneExpressionScaleDomain>({ key: 'active', max: 12 })
  const [geneExpressionScoreMode, setGeneExpressionScoreMode] = React.useState<
    'sum' | 'mean' | 'z-score'
  >('sum')
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
  const [geneSearch, setGeneSearch] = React.useState('ac')
  const [geneSetName, setGeneSetName] = React.useState(initialGeneSetName)
  const [manualTranscriptExactRequestKey, setManualTranscriptExactRequestKey] =
    React.useState<string | null>('manual-request')
  const [observationColorMode, setObservationColorMode] =
    React.useState<ObservationColorMode>('transcript-count')
  const [savedGeneSets, setSavedGeneSets] = React.useState<readonly SavedGeneSet[]>([])
  const [selectedGenes, setSelectedGenes] =
    React.useState<readonly string[]>(initialSelectedGenes)
  const [expressionAbortController] = React.useState(() => new AbortController())
  const geneExpressionAbortRef = React.useRef<AbortController | null>(
    expressionAbortController,
  )
  const geneExpressionRequestIdRef = React.useRef(3)
  const geneExpressionViewportKeyRef = React.useRef<string | null>('expression-view')
  const geneSetIdRef = React.useRef(0)
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
  const toggleGene = React.useCallback(
    (gene: string) => {
      const isSelected = selectedGenes.includes(gene)

      debugMessagesRef.current.push(
        isSelected ? `Cleared gene ${gene}` : `Highlight gene ${gene}`,
      )
      resetGeneExpressionSelectionState()
      setManualTranscriptExactRequestKey(null)
      setSelectedGenes((current) =>
        isSelected
          ? current.filter((selectedGene) => selectedGene !== gene)
          : [...current, gene].sort((a, b) => a.localeCompare(b)),
      )
    },
    [resetGeneExpressionSelectionState, selectedGenes],
  )

  const api = useGeneControlsWorkflow({
    appendDebugEvent: (message) => {
      debugMessagesRef.current.push(message)
    },
    geneExpressionBatch,
    geneExpressionScaleDatasetUrl: 'https://example.test/output',
    geneExpressionScoreMode,
    geneOptions: ['Actb', 'Gad1', 'Slc17a7'],
    geneSetIdRef,
    geneSetName,
    geneSetSymbols,
    rememberGeneExpressionScaleMax: vi.fn(),
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

  React.useEffect(() => {
    onReady(api, {
      debugMessages: debugMessagesRef.current,
      expressionAbortWasAborted: expressionAbortController.signal.aborted,
      expressionRequestId: geneExpressionRequestIdRef.current,
      geneExpressionBatch,
      geneExpressionColorScale,
      geneExpressionScaleDomain,
      geneExpressionState,
      geneExpressionViewportKey: geneExpressionViewportKeyRef.current,
      geneSearch,
      geneSetName,
      manualTranscriptExactRequestKey,
      savedGeneSets,
      selectedGenes,
      transcriptViewportKey: transcriptViewportKeyRef.current,
    })
  })

  void geneExpressionDetailMode
  void observationColorMode

  return null
}

describe('useGeneControlsWorkflow', () => {
  it('toggles genes while clearing active expression selection state', () => {
    render(
      <GeneControlsProbe
        onReady={(nextApi, nextSnapshot) => {
          geneControlsApi = nextApi
          geneControlsSnapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      geneControlsApi.toggleGene('Actb')
    })

    expect(geneControlsSnapshot.selectedGenes).toEqual([])
    expect(geneControlsSnapshot.manualTranscriptExactRequestKey).toBeNull()
    expect(geneControlsSnapshot.geneExpressionState).toEqual({ status: 'idle' })
    expect(geneControlsSnapshot.geneExpressionBatch).toBeNull()
    expect(geneControlsSnapshot.geneExpressionScaleDomain).toEqual({ key: '', max: 0 })
    expect(geneControlsSnapshot.geneExpressionViewportKey).toBeNull()
    expect(geneControlsSnapshot.expressionRequestId).toBe(4)
    expect(geneControlsSnapshot.expressionAbortWasAborted).toBe(true)
    expect(geneControlsSnapshot.debugMessages).toContain('Cleared gene Actb')
  })

  it('applies typed gene symbols and saves selected gene sets', () => {
    render(
      <GeneControlsProbe
        geneSetName="Inhibitory"
        geneSetSymbols="gad1, ACTB, missing"
        initialSelectedGenes={[]}
        onReady={(nextApi, nextSnapshot) => {
          geneControlsApi = nextApi
          geneControlsSnapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      geneControlsApi.applyGeneSetSymbols()
    })

    expect(geneControlsSnapshot.selectedGenes).toEqual(['Actb', 'Gad1'])
    expect(geneControlsSnapshot.geneSearch).toBe('')
    expect(geneControlsSnapshot.manualTranscriptExactRequestKey).toBeNull()
    expect(geneControlsSnapshot.transcriptViewportKey).toBeNull()

    act(() => {
      geneControlsApi.saveSelectedGeneSet()
    })

    expect(geneControlsSnapshot.savedGeneSets).toEqual([
      {
        id: 'gene-set-1',
        name: 'Inhibitory',
        genes: ['Actb', 'Gad1'],
        scoreMode: 'sum',
      },
    ])
    expect(geneControlsSnapshot.geneSetName).toBe('')
  })
})
