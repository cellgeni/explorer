import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { TranscriptAggregateDatum } from '../rendering/deckLayers'
import { transcriptAggregateTitle } from './viewerHoverModel'
import { TranscriptHoverTooltip } from './viewerHoverTooltips'

const square: TranscriptAggregateDatum = {
  id: 'native-zarr-density:2:1:1',
  position: [60, -60, 0],
  source: 'native-zarr',
  glyphType: 'density',
  level: 2,
  binX: 1,
  binY: 1,
  count: 12,
  radiusMicrometers: 16,
  binSizeMicrometers: 40,
  fillColor: [255, 0, 0, 255],
}

describe('transcript density hover', () => {
  it('says what a square counts', () => {
    expect(transcriptAggregateTitle(square)).toBe('All transcripts')
    expect(transcriptAggregateTitle({ ...square, source: 'cell-summary' })).toBe(
      'Transcripts in cells',
    )
    expect(
      transcriptAggregateTitle({
        ...square,
        selectedGeneCount: 12,
        topFeatures: [{ featureName: 'SNAP25', count: 12 }],
      }),
    ).toBe('SNAP25 transcripts')
    expect(
      transcriptAggregateTitle({
        ...square,
        selectedGeneCount: 12,
        topFeatures: [
          { featureName: 'SNAP25', count: 9 },
          { featureName: 'AQP4', count: 3 },
        ],
      }),
    ).toBe('Selected-gene transcripts')
  })

  it('lists each selected gene when a square counts several', () => {
    render(
      <TranscriptHoverTooltip
        detail={{
          aggregate: {
            ...square,
            selectedGeneCount: 12,
            topFeatures: [
              { featureName: 'SNAP25', count: 9 },
              { featureName: 'AQP4', count: 3 },
            ],
          },
          screen: { x: 10, y: 10 },
        }}
      />,
    )

    const rows = [...document.querySelectorAll('.transcript-hover-tooltip dl > div')].map(
      (row) => row.textContent,
    )
    expect(screen.getByText('Selected-gene transcripts')).toBeInTheDocument()
    expect(rows.slice(0, 3)).toEqual(['Count12', 'SNAP259', 'AQP43'])
  })
})
