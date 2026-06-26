import { useEffect } from 'react'
import type { GeneExpressionBatch } from '../../datasets/xeniumDataset'
import { telemetryEvent, type TelemetryEvent } from '../../data/telemetry'
import type { DebugLogAppendOptions } from '../app-shell/appRuntimeModel'
import {
  formatGeneExpressionTiming,
  type GeneExpressionLoadErrorSummary,
  type GeneExpressionState,
} from './geneControlsModel'

interface GeneExpressionLayerTelemetryCallbackOptions {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly recordTelemetry: (event: TelemetryEvent) => void
}

interface GeneExpressionLayerTelemetryDataOptions<
  ErrorType extends GeneExpressionLoadErrorSummary,
> {
  readonly geneExpressionBatch: GeneExpressionBatch | null
  readonly geneExpressionState: GeneExpressionState<ErrorType>
}

interface GeneExpressionLayerTelemetryTimingOptions {
  readonly geneExpressionLayerDataDurationMs: number
  readonly geneExpressionRestyleDurationMs: number
}

interface GeneExpressionLayerTelemetryRefOptions {
  readonly timingKeyRef: { current: string | null }
}

interface UseGeneExpressionLayerTelemetryOptions<
  ErrorType extends GeneExpressionLoadErrorSummary,
> {
  readonly callbacks: GeneExpressionLayerTelemetryCallbackOptions
  readonly data: GeneExpressionLayerTelemetryDataOptions<ErrorType>
  readonly refs: GeneExpressionLayerTelemetryRefOptions
  readonly timings: GeneExpressionLayerTelemetryTimingOptions
}

export function useGeneExpressionLayerTelemetry<
  ErrorType extends GeneExpressionLoadErrorSummary,
>({
  callbacks: { appendDebugEvent, recordTelemetry },
  data: { geneExpressionBatch, geneExpressionState },
  refs: { timingKeyRef },
  timings: { geneExpressionLayerDataDurationMs, geneExpressionRestyleDurationMs },
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
