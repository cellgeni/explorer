import { useEffect } from 'react'
import type { GeneExpressionBatch } from '../../datasets/xeniumDataset'
import { telemetryEvent, type TelemetryEvent } from '../../data/telemetry'
import type { DebugLogAppendOptions } from '../app-shell/appRuntimeModel'
import {
  formatGeneExpressionTiming,
  type GeneExpressionLoadErrorSummary,
  type GeneExpressionState,
} from './geneControlsModel'

interface UseGeneExpressionLayerTelemetryOptions<
  ErrorType extends GeneExpressionLoadErrorSummary,
> {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly geneExpressionBatch: GeneExpressionBatch | null
  readonly geneExpressionLayerDataDurationMs: number
  readonly geneExpressionRestyleDurationMs: number
  readonly geneExpressionState: GeneExpressionState<ErrorType>
  readonly recordTelemetry: (event: TelemetryEvent) => void
  readonly timingKeyRef: { current: string | null }
}

export function useGeneExpressionLayerTelemetry<
  ErrorType extends GeneExpressionLoadErrorSummary,
>({
  appendDebugEvent,
  geneExpressionBatch,
  geneExpressionLayerDataDurationMs,
  geneExpressionRestyleDurationMs,
  geneExpressionState,
  recordTelemetry,
  timingKeyRef,
}: UseGeneExpressionLayerTelemetryOptions<ErrorType>): void {
  useEffect(() => {
    if (geneExpressionBatch === null || geneExpressionState.status !== 'ready') {
      timingKeyRef.current = null
      return
    }

    const timingKey = [
      geneExpressionState.url,
      geneExpressionState.mode,
      geneExpressionState.visibleCellCount,
      geneExpressionState.cellCount,
      geneExpressionState.genes.join('|'),
      geneExpressionLayerDataDurationMs,
      geneExpressionRestyleDurationMs,
    ].join(':')

    if (timingKey === timingKeyRef.current) {
      return
    }

    timingKeyRef.current = timingKey
    const detail = [
      `layer ${Math.round(geneExpressionLayerDataDurationMs)} ms`,
      `restyle ${Math.round(geneExpressionRestyleDurationMs)} ms`,
      formatGeneExpressionTiming(geneExpressionBatch.timing),
    ].join(', ')

    recordTelemetry(
      telemetryEvent('gene-expression.layer-data', 'info', {
        detail,
      }),
    )
    appendDebugEvent(
      `Expression layer data ready: ${geneExpressionState.cellCount.toLocaleString()} cells (${detail})`,
      { coalesceKey: 'gene-expression-layer-data' },
    )
  }, [
    appendDebugEvent,
    geneExpressionBatch,
    geneExpressionLayerDataDurationMs,
    geneExpressionRestyleDurationMs,
    geneExpressionState,
    recordTelemetry,
    timingKeyRef,
  ])
}
