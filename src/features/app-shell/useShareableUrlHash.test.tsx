import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { micrometers } from '../../data/coords'
import { useShareableUrlHash } from './useShareableUrlHash'

function ShareableUrlHashProbe() {
  useShareableUrlHash({
    activeControlHudTab: 'genes',
    activeRoiSelection: {
      kind: 'box',
      bbox: {
        minX: micrometers(1),
        minY: micrometers(2),
        maxX: micrometers(3),
        maxY: micrometers(4),
      },
    },
    boundaryCellLimit: 2500,
    coordinateUnit: 'px',
    datasetUrl: 'https://example.test/output',
    geneExpressionColorScale: 'plasma',
    geneExpressionDetailMode: 'auto',
    geneExpressionScoreMode: 'sum',
    imageOpacity: 0.45,
    cellFillOpacity: 0.7,
    cellBoundaryOpacity: 0.35,
    morphologyEnabledChannelIds: ['Channel:1'],
    magicLensActive: true,
    magicLensMinQv: 18,
    magicLensRadiusMicrometers: 120,
    magicLensScope: 'cursor',
    measurementUnit: 'um',
    observationColorMode: 'transcript-count',
    selectedGenes: ['Actb', 'Gad1'],
    shareableViewState: { target: [12.346, 78.912, 0], zoom: 1.235 },
    shouldLoadMorphology: true,
    showTranscriptOverlay: true,
    transcriptDensityColorScale: 'viridis',
    transcriptDetailMode: 'exact',
    transcriptExactPointLimit: 75_000,
    transcriptFeatureFilterMode: 'selected',
    transcriptGeneOnly: true,
    transcriptMinQv: 25,
    transcriptOpacity: 0.75,
    transcriptPointColorMode: 'quality',
    transcriptPointSize: 3,
  })

  return null
}

describe('useShareableUrlHash', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.history.replaceState(null, '', '/')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces shareable control state into the location hash', () => {
    render(<ShareableUrlHashProbe />)

    expect(window.location.hash).toBe('')

    act(() => {
      vi.advanceTimersByTime(160)
    })

    expect(window.location.hash).toContain('dataset=https%3A%2F%2Fexample.test%2Foutput')
    expect(window.location.hash).toContain('genes=Actb%2CGad1')
    expect(window.location.hash).toContain('tab=genes')
    expect(window.location.hash).toContain('imgOpacity=0.45')
    expect(window.location.hash).toContain('cellFill=0.7')
    expect(window.location.hash).toContain('cellBoundary=0.35')
    expect(window.location.hash).toContain('channels=Channel%3A1')
    expect(window.location.hash).toContain('lens=1')
    expect(window.location.hash).toContain('lensRadius=120')
    expect(window.location.hash).toContain('txFilter=selected')
  })
})
