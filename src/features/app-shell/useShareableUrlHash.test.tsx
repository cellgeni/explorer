import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { micrometers } from '../../data/coords'
import { useShareableUrlHash } from './useShareableUrlHash'

function ShareableUrlHashProbe() {
  useShareableUrlHash({
    dataset: {
      annotationUrl: 'https://example.test/annotations/manual.csv',
      customImageOpacities: [0.35],
      customImageUrls: ['https://example.test/images/he.ome.tif'],
      datasetUrl: 'https://example.test/output',
    },
    genes: {
      geneExpressionColorScale: 'plasma',
      geneExpressionDetailMode: 'auto',
      geneExpressionScoreMode: 'sum',
      selectedGenes: ['Actb', 'Gad1'],
    },
    layers: {
      boundaryCellLimit: 2500,
      cellBoundaryOpacity: 0.35,
      cellFillOpacity: 0.7,
      coordinateUnit: 'px',
      imageOpacity: 0.45,
      measurementUnit: 'um',
      morphologyEnabledChannelIds: ['Channel:1'],
      observationColorMode: 'transcript-count',
      shouldLoadMorphology: true,
      showCellBoundaries: false,
      showNucleusBoundaries: true,
      showHoverTooltips: false,
    },
    magicLens: {
      magicLensActive: true,
      magicLensMinQv: 18,
      magicLensRadiusMicrometers: 120,
      magicLensScope: 'cursor',
    },
    transcripts: {
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
    },
    view: {
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
      shareableViewState: { target: [12.346, 78.912, 0], zoom: 1.235 },
    },
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
    expect(window.location.hash).toContain(
      'annotationUrl=https%3A%2F%2Fexample.test%2Fannotations%2Fmanual.csv',
    )
    expect(window.location.hash).toContain(
      'customImageUrl=https%3A%2F%2Fexample.test%2Fimages%2Fhe.ome.tif',
    )
    expect(window.location.hash).toContain('customImageOpacity=0.35')
    expect(window.location.hash).toContain('genes=Actb%2CGad1')
    expect(window.location.hash).toContain('tab=genes')
    expect(window.location.hash).toContain('imgOpacity=0.45')
    expect(window.location.hash).toContain('cellFill=0.7')
    expect(window.location.hash).toContain('cellBounds=0')
    expect(window.location.hash).toContain('nucleusBounds=1')
    expect(window.location.hash).toContain('hoverTips=0')
    expect(window.location.hash).toContain('cellBoundary=0.35')
    expect(window.location.hash).toContain('channels=Channel%3A1')
    expect(window.location.hash).toContain('lens=1')
    expect(window.location.hash).toContain('lensRadius=120')
    expect(window.location.hash).toContain('txFilter=selected')
  })
})
