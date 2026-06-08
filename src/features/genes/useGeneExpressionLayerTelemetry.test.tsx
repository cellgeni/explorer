import { render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { asCellId } from '../../data/cellid'
import { micrometers } from '../../data/coords'
import type { GeneExpressionBatch } from '../../datasets/xeniumDataset'
import type { TelemetryEvent } from '../../data/telemetry'
import type { GeneExpressionState } from './geneControlsModel'
import { useGeneExpressionLayerTelemetry } from './useGeneExpressionLayerTelemetry'

const batch: GeneExpressionBatch = {
  cells: [
    {
      id: asCellId('aaaaaaaa-1'),
      position: { x: micrometers(1), y: micrometers(2) },
      count: 4,
    },
  ],
  genes: ['Actb'],
  maxCount: 4,
  timing: {
    matrixReadMs: 2,
    scoreCellsMs: 3,
    totalMs: 6,
    viewportCellsMs: 1,
  },
}

const readyState: GeneExpressionState = {
  status: 'ready',
  url: 'https://example.test/output',
  genes: ['Actb'],
  mode: 'exact',
  cellCount: 1,
  visibleCellCount: 2,
}

function Probe({
  recordTelemetry,
}: {
  readonly recordTelemetry: (event: TelemetryEvent) => void
}) {
  const timingKeyRef = React.useRef<string | null>(null)

  useGeneExpressionLayerTelemetry({
    appendDebugEvent: vi.fn(),
    geneExpressionBatch: batch,
    geneExpressionLayerDataDurationMs: 12,
    geneExpressionRestyleDurationMs: 7,
    geneExpressionState: readyState,
    recordTelemetry,
    timingKeyRef,
  })

  return null
}

describe('useGeneExpressionLayerTelemetry', () => {
  it('records layer-data telemetry once for unchanged timing input', () => {
    const recordTelemetry = vi.fn()
    const { rerender } = render(<Probe recordTelemetry={recordTelemetry} />)

    rerender(<Probe recordTelemetry={recordTelemetry} />)

    expect(recordTelemetry).toHaveBeenCalledTimes(1)
    expect(recordTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'gene-expression.layer-data',
        outcome: 'info',
        detail: expect.stringContaining('layer 12 ms'),
      }),
    )
  })
})
