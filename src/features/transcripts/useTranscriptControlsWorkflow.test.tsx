import { act, render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it } from 'vitest'
import type {
  TranscriptDetailMode,
  TranscriptFeatureFilterMode,
} from '../../data/transcriptOverlay'
import type {
  TranscriptDensityColorScale,
  TranscriptPointColorMode,
} from '../../rendering/deckLayers'
import { useTranscriptControlsWorkflow } from './useTranscriptControlsWorkflow'

interface TranscriptControlsSnapshot {
  readonly debugMessages: readonly string[]
  readonly manualTranscriptExactRequestKey: string | null
  readonly resetGeneExpressionCount: number
  readonly selectedGenes: readonly string[]
  readonly transcriptExactPointLimit: number
  readonly transcriptFeatureFilterMode: TranscriptFeatureFilterMode
  readonly transcriptFeatureSearch: string
  readonly transcriptMinQv: number
  readonly transcriptOpacity: number
  readonly transcriptPointSize: number
  readonly transcriptViewportKey: string | null
  readonly readTranscriptViewportKey: () => string | null
  readonly toggledGenes: readonly string[]
}

let transcriptControlsApi: ReturnType<typeof useTranscriptControlsWorkflow>
let transcriptControlsSnapshot: TranscriptControlsSnapshot

interface TranscriptControlsProbeProps {
  readonly onReady: (
    api: ReturnType<typeof useTranscriptControlsWorkflow>,
    snapshot: TranscriptControlsSnapshot,
  ) => void
}

function TranscriptControlsProbe({ onReady }: TranscriptControlsProbeProps) {
  const [manualTranscriptExactRequestKey, setManualTranscriptExactRequestKey] =
    React.useState<string | null>('manual-request')
  const [selectedGenes, setSelectedGenes] = React.useState<readonly string[]>([])
  const [showTranscriptOverlay, setShowTranscriptOverlay] = React.useState(false)
  const [transcriptDensityColorScale, setTranscriptDensityColorScale] =
    React.useState<TranscriptDensityColorScale>('thermal')
  const [transcriptDetailMode, setTranscriptDetailMode] =
    React.useState<TranscriptDetailMode>('auto')
  const [transcriptExactPointLimit, setTranscriptExactPointLimit] =
    React.useState(100_000)
  const [transcriptFeatureFilterMode, setTranscriptFeatureFilterMode] =
    React.useState<TranscriptFeatureFilterMode>('all')
  const [transcriptFeatureSearch, setTranscriptFeatureSearch] = React.useState('ga')
  const [transcriptGeneOnly, setTranscriptGeneOnly] = React.useState(true)
  const [transcriptMinQv, setTranscriptMinQv] = React.useState(20)
  const [transcriptOpacity, setTranscriptOpacity] = React.useState(0.85)
  const [transcriptPointColorMode, setTranscriptPointColorMode] =
    React.useState<TranscriptPointColorMode>('feature')
  const [transcriptPointSize, setTranscriptPointSize] = React.useState(2)
  const transcriptViewportKeyRef = React.useRef<string | null>('viewport-key')
  const debugMessagesRef = React.useRef<string[]>([])
  const resetGeneExpressionCountRef = React.useRef(0)
  const toggledGenesRef = React.useRef<string[]>([])

  const api = useTranscriptControlsWorkflow({
    callbacks: {
      appendDebugEvent: (message) => {
        debugMessagesRef.current.push(message)
      },
      resetGeneExpressionSelectionState: () => {
        resetGeneExpressionCountRef.current += 1
      },
      toggleGene: (gene) => {
        toggledGenesRef.current.push(gene)
      },
    },
    data: {
      geneOptions: ['Actb', 'Gad1', 'Slc17a7'],
    },
    refs: {
      transcriptViewportKeyRef,
    },
    setters: {
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
    },
  })

  React.useEffect(() => {
    onReady(api, {
      debugMessages: debugMessagesRef.current,
      manualTranscriptExactRequestKey,
      resetGeneExpressionCount: resetGeneExpressionCountRef.current,
      selectedGenes,
      transcriptExactPointLimit,
      transcriptFeatureFilterMode,
      transcriptFeatureSearch,
      transcriptMinQv,
      transcriptOpacity,
      transcriptPointSize,
      transcriptViewportKey: transcriptViewportKeyRef.current,
      readTranscriptViewportKey: () => transcriptViewportKeyRef.current,
      toggledGenes: toggledGenesRef.current,
    })
  })

  void showTranscriptOverlay
  void transcriptDensityColorScale
  void transcriptDetailMode
  void transcriptGeneOnly
  void transcriptPointColorMode

  return null
}

describe('useTranscriptControlsWorkflow', () => {
  it('normalizes exact point budget and resets pending viewport requests', () => {
    render(
      <TranscriptControlsProbe
        onReady={(nextApi, nextSnapshot) => {
          transcriptControlsApi = nextApi
          transcriptControlsSnapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      transcriptControlsApi.handleTranscriptExactPointLimitChange(0)
    })

    expect(transcriptControlsSnapshot.transcriptExactPointLimit).toBe(1)
    expect(transcriptControlsSnapshot.manualTranscriptExactRequestKey).toBeNull()
    expect(transcriptControlsSnapshot.transcriptViewportKey).toBeNull()
    expect(transcriptControlsSnapshot.debugMessages).toContain(
      'Transcript exact budget: 1',
    )
  })

  it('picks transcript features', () => {
    render(
      <TranscriptControlsProbe
        onReady={(nextApi, nextSnapshot) => {
          transcriptControlsApi = nextApi
          transcriptControlsSnapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      transcriptControlsApi.pickTranscriptFeature('Gad1')
    })

    expect(transcriptControlsSnapshot.selectedGenes).toEqual(['Gad1'])
    expect(transcriptControlsSnapshot.transcriptFeatureFilterMode).toBe('selected')
    expect(transcriptControlsSnapshot.transcriptFeatureSearch).toBe('')
    expect(transcriptControlsSnapshot.resetGeneExpressionCount).toBe(1)
    expect(transcriptControlsSnapshot.manualTranscriptExactRequestKey).toBeNull()
  })

  it('delegates chip toggles to the gene workflow while invalidating transcript data', () => {
    render(
      <TranscriptControlsProbe
        onReady={(nextApi, nextSnapshot) => {
          transcriptControlsApi = nextApi
          transcriptControlsSnapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      transcriptControlsApi.handleToggleTranscriptSelectedFeature('Actb')
    })

    expect(transcriptControlsSnapshot.toggledGenes).toEqual(['Actb'])
    expect(transcriptControlsSnapshot.readTranscriptViewportKey()).toBeNull()
  })
})
