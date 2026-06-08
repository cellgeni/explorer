import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type { ViewerTranscriptHoverDetail } from '../../components/ViewerCore'
import {
  normalizeTranscriptExactPointLimit,
  type TranscriptDetailMode,
  type TranscriptFeatureFilterMode,
} from '../../data/transcriptOverlay'
import type { ControlHudTab } from '../app-shell/appShellModel'
import type { DebugLogAppendOptions } from '../app-shell/appRuntimeModel'
import { percentToOpacity } from '../../rendering/layerOpacity'
import type {
  TranscriptDensityColorScale,
  TranscriptPointColorMode,
} from '../../rendering/deckLayers'
import {
  normalizeTranscriptMinQv,
  normalizeTranscriptPointSize,
} from './transcriptLayerModel'

interface MutableRef<T> {
  current: T
}

interface UseTranscriptControlsWorkflowOptions {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly geneOptions: readonly string[]
  readonly resetGeneExpressionSelectionState: () => void
  readonly setActiveControlHudTab: Dispatch<SetStateAction<ControlHudTab>>
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
  readonly setTranscriptFeatureSearch: Dispatch<SetStateAction<string>>
  readonly setTranscriptGeneOnly: Dispatch<SetStateAction<boolean>>
  readonly setTranscriptMinQv: Dispatch<SetStateAction<number>>
  readonly setTranscriptOpacity: Dispatch<SetStateAction<number>>
  readonly setTranscriptPointColorMode: Dispatch<SetStateAction<TranscriptPointColorMode>>
  readonly setTranscriptPointSize: Dispatch<SetStateAction<number>>
  readonly toggleGene: (gene: string) => void
  readonly transcriptViewportKeyRef: MutableRef<string | null>
}

interface UseTranscriptControlsWorkflowResult {
  readonly handleLoadExactViewport: (requestKey: string) => void
  readonly handlePinTranscript: (detail: ViewerTranscriptHoverDetail) => void
  readonly handleToggleTranscriptSelectedFeature: (gene: string) => void
  readonly handleTranscriptDensityColorScaleChange: (
    nextScale: TranscriptDensityColorScale,
  ) => void
  readonly handleTranscriptDetailModeChange: (nextMode: TranscriptDetailMode) => void
  readonly handleTranscriptExactPointLimitChange: (value: number) => void
  readonly handleTranscriptFeatureFilterModeChange: (
    nextMode: TranscriptFeatureFilterMode,
  ) => void
  readonly handleTranscriptGeneOnlyChange: (checked: boolean) => void
  readonly handleTranscriptMinQvChange: (value: number) => void
  readonly handleTranscriptOpacityPercentChange: (nextPercent: number) => void
  readonly handleTranscriptOverlayChange: (checked: boolean) => void
  readonly handleTranscriptPointColorModeChange: (
    nextMode: TranscriptPointColorMode,
  ) => void
  readonly handleTranscriptPointSizeChange: (value: number) => void
  readonly pickTranscriptFeature: (gene: string) => void
}

export function useTranscriptControlsWorkflow({
  appendDebugEvent,
  geneOptions,
  resetGeneExpressionSelectionState,
  setActiveControlHudTab,
  setManualTranscriptExactRequestKey,
  setPinnedTranscript,
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
}: UseTranscriptControlsWorkflowOptions): UseTranscriptControlsWorkflowResult {
  const resetTranscriptViewportRequest = useCallback(() => {
    transcriptViewportKeyRef.current = null
    setManualTranscriptExactRequestKey(null)
  }, [setManualTranscriptExactRequestKey, transcriptViewportKeyRef])

  const handleLoadExactViewport = useCallback(
    (requestKey: string) => {
      setManualTranscriptExactRequestKey(requestKey)
      transcriptViewportKeyRef.current = null
      appendDebugEvent('Transcript exact viewport manually approved', {
        coalesceKey: 'transcript-query',
      })
    },
    [appendDebugEvent, setManualTranscriptExactRequestKey, transcriptViewportKeyRef],
  )

  const handlePinTranscript = useCallback(
    (detail: ViewerTranscriptHoverDetail) => {
      setPinnedTranscript(detail)
      setActiveControlHudTab('transcripts')
      appendDebugEvent(
        detail.transcript === undefined
          ? 'Pinned transcript density bin'
          : `Pinned transcript ${detail.transcript.transcriptId ?? detail.transcript.id}`,
        { coalesceKey: 'transcript-pin' },
      )
    },
    [appendDebugEvent, setActiveControlHudTab, setPinnedTranscript],
  )

  const handleTranscriptOverlayChange = useCallback(
    (checked: boolean) => {
      setShowTranscriptOverlay(checked)
      appendDebugEvent(
        checked ? 'Transcript overlay enabled' : 'Transcript overlay disabled',
        { coalesceKey: 'transcript-overlay-toggle' },
      )
    },
    [appendDebugEvent, setShowTranscriptOverlay],
  )

  const handleTranscriptDetailModeChange = useCallback(
    (nextMode: TranscriptDetailMode) => {
      setTranscriptDetailMode(nextMode)
      resetTranscriptViewportRequest()
      appendDebugEvent(`Transcript detail: ${nextMode}`, {
        coalesceKey: 'transcript-detail',
      })
    },
    [appendDebugEvent, resetTranscriptViewportRequest, setTranscriptDetailMode],
  )

  const handleTranscriptExactPointLimitChange = useCallback(
    (value: number) => {
      const nextLimit = normalizeTranscriptExactPointLimit(value)

      setTranscriptExactPointLimit(nextLimit)
      resetTranscriptViewportRequest()
      appendDebugEvent(`Transcript exact budget: ${nextLimit.toLocaleString()}`, {
        coalesceKey: 'transcript-exact-budget',
      })
    },
    [appendDebugEvent, resetTranscriptViewportRequest, setTranscriptExactPointLimit],
  )

  const handleTranscriptFeatureFilterModeChange = useCallback(
    (nextMode: TranscriptFeatureFilterMode) => {
      setTranscriptFeatureFilterMode(nextMode)
      resetTranscriptViewportRequest()
      appendDebugEvent(`Transcript feature filter: ${nextMode}`, {
        coalesceKey: 'transcript-feature-filter',
      })
    },
    [appendDebugEvent, resetTranscriptViewportRequest, setTranscriptFeatureFilterMode],
  )

  const handleToggleTranscriptSelectedFeature = useCallback(
    (gene: string) => {
      toggleGene(gene)
      transcriptViewportKeyRef.current = null
    },
    [toggleGene, transcriptViewportKeyRef],
  )

  const handleTranscriptDensityColorScaleChange = useCallback(
    (nextScale: TranscriptDensityColorScale) => {
      setTranscriptDensityColorScale(nextScale)
      appendDebugEvent(`Transcript density color: ${nextScale}`, {
        coalesceKey: 'transcript-density-color',
      })
    },
    [appendDebugEvent, setTranscriptDensityColorScale],
  )

  const handleTranscriptPointColorModeChange = useCallback(
    (nextMode: TranscriptPointColorMode) => {
      setTranscriptPointColorMode(nextMode)
      appendDebugEvent(`Transcript point color: ${nextMode}`, {
        coalesceKey: 'transcript-point-color',
      })
    },
    [appendDebugEvent, setTranscriptPointColorMode],
  )

  const handleTranscriptMinQvChange = useCallback(
    (value: number) => {
      const nextMinQv = normalizeTranscriptMinQv(value)

      setTranscriptMinQv(nextMinQv)
      resetTranscriptViewportRequest()
      appendDebugEvent(`Transcript min QV: ${nextMinQv}`, {
        coalesceKey: 'transcript-min-qv',
      })
    },
    [appendDebugEvent, resetTranscriptViewportRequest, setTranscriptMinQv],
  )

  const handleTranscriptGeneOnlyChange = useCallback(
    (checked: boolean) => {
      setTranscriptGeneOnly(checked)
      resetTranscriptViewportRequest()
      appendDebugEvent(
        checked
          ? 'Transcript gene-only filter enabled'
          : 'Transcript gene-only filter disabled',
        { coalesceKey: 'transcript-gene-only' },
      )
    },
    [appendDebugEvent, resetTranscriptViewportRequest, setTranscriptGeneOnly],
  )

  const handleTranscriptOpacityPercentChange = useCallback(
    (nextPercent: number) => {
      setTranscriptOpacity(percentToOpacity(nextPercent))
      appendDebugEvent(`Transcript opacity: ${nextPercent}%`, {
        coalesceKey: 'transcript-opacity',
      })
    },
    [appendDebugEvent, setTranscriptOpacity],
  )

  const handleTranscriptPointSizeChange = useCallback(
    (value: number) => {
      const nextSize = normalizeTranscriptPointSize(value)

      setTranscriptPointSize(nextSize)
      appendDebugEvent(`Transcript point size: ${nextSize}px`, {
        coalesceKey: 'transcript-point-size',
      })
    },
    [appendDebugEvent, setTranscriptPointSize],
  )

  const pickTranscriptFeature = useCallback(
    (gene: string) => {
      if (!geneOptions.includes(gene)) {
        return
      }

      appendDebugEvent(`Transcript feature filter added ${gene}`, {
        coalesceKey: 'transcript-feature-picker',
      })
      resetGeneExpressionSelectionState()
      transcriptViewportKeyRef.current = null
      setManualTranscriptExactRequestKey(null)
      setTranscriptFeatureFilterMode('selected')
      setSelectedGenes((current) =>
        current.includes(gene)
          ? current
          : [...current, gene].sort((a, b) => a.localeCompare(b)),
      )
      setTranscriptFeatureSearch('')
    },
    [
      appendDebugEvent,
      geneOptions,
      resetGeneExpressionSelectionState,
      setManualTranscriptExactRequestKey,
      setSelectedGenes,
      setTranscriptFeatureFilterMode,
      setTranscriptFeatureSearch,
      transcriptViewportKeyRef,
    ],
  )

  return {
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
    pickTranscriptFeature,
  }
}
