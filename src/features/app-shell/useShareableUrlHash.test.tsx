import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { micrometers } from '../../data/coords'
import { useShareableUrlHash } from './useShareableUrlHash'

function ShareableUrlHashProbe({
  datasetUrl = 'https://example.test/output',
  hiddenAnnotationIds,
  selectedGenes = ['Actb', 'Gad1'],
  onHistoryDatasetChange,
  onShareUrl,
}: {
  readonly datasetUrl?: string
  readonly hiddenAnnotationIds?: readonly string[]
  readonly selectedGenes?: readonly string[]
  readonly onHistoryDatasetChange?: () => void
  readonly onShareUrl?: (shareUrl: () => string) => void
}) {
  const shareUrl = useShareableUrlHash({
    ...(onHistoryDatasetChange === undefined ? {} : { onHistoryDatasetChange }),
    dataset: {
      annotationUrl: 'https://example.test/annotations/manual.csv',
      customImageOpacities: [0.35],
      customImageUrls: ['https://example.test/images/he.ome.tif'],
      datasetUrl,
      hiddenAnnotationIds,
    },
    genes: {
      geneExpressionColorScale: 'plasma',
      geneExpressionDetailMode: 'auto',
      geneExpressionScoreMode: 'sum',
      selectedGenes,
    },
    layers: {
      boundaryCellLimit: 2500,
      cellBoundaryOpacity: 0.35,
      cellFillOpacity: 0.7,
      cellMetadataTrackId: null,
      coordinateUnit: 'px',
      imageOpacity: 0.45,
      measurementUnit: 'um',
      morphologyEnabledChannelIds: ['Channel:1'],
      morphologyZPlane: 6,
      observationColorMode: 'transcript-count',
      shouldLoadMorphology: true,
      showCellBoundaries: false,
      showNucleusBoundaries: true,
      showHoverTooltips: false,
    },
    magicLens: {
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
      panels: undefined,
      card: 'cell:cell-7',
      tool: 'magic-lens',
      hiddenLayers: [],
    },
  })
  useEffect(() => {
    onShareUrl?.(shareUrl)
  }, [onShareUrl, shareUrl])

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
    expect(window.location.hash).not.toMatch(/[#&]tab=/)
    expect(window.location.hash).toContain('imgOpacity=0.45')
    expect(window.location.hash).toContain('cellFill=0.7')
    expect(window.location.hash).toContain('cellBounds=0')
    // Version 2 links leave defaults out, but keep the boundary toggles,
    // whose default depends on the platform.
    expect(window.location.hash).toMatch(/^#xv=2&/)
    expect(window.location.hash).toContain('nucleusBounds=1')
    expect(window.location.hash).not.toContain('transcriptOpacity')
    expect(window.location.hash).toContain('hoverTips=0')
    expect(window.location.hash).toContain('cellBoundary=0.35')
    expect(window.location.hash).toContain('channels=Channel%3A1')
    expect(window.location.hash).toMatch(/[#&]z=6(&|$)/)
    expect(window.location.hash).toContain('tool=magic-lens')
    expect(window.location.hash).not.toMatch(/[#&]lens=/)
    expect(window.location.hash).toContain('card=cell%3Acell-7')
    expect(window.location.hash).not.toContain('panel=')
    expect(window.location.hash).not.toContain('hidden=')
    expect(window.location.hash).toContain('lensRadius=120')
    // Selected genes is the default transcript filter.
    expect(window.location.hash).not.toContain('txFilter')
    expect(window.location.hash).not.toContain('cellTrack')
  })

  it('writes hidden annotation classes while any are hidden', () => {
    const { rerender } = render(
      <ShareableUrlHashProbe hiddenAnnotationIds={['analysis:leiden:3']} />,
    )
    act(() => {
      vi.advanceTimersByTime(160)
    })

    expect(window.location.hash).toContain('hiddenClasses=analysis%3Aleiden%3A3')

    rerender(<ShareableUrlHashProbe hiddenAnnotationIds={[]} />)
    act(() => {
      vi.advanceTimersByTime(160)
    })

    expect(window.location.hash).not.toContain('hiddenClasses=')
  })

  it('gives the link for the current state before the address has it', () => {
    const latest: { shareUrl?: () => string } = {}
    const onShareUrl = (next: () => string) => {
      latest.shareUrl = next
    }
    const { rerender } = render(<ShareableUrlHashProbe onShareUrl={onShareUrl} />)
    act(() => {
      vi.advanceTimersByTime(160)
    })

    rerender(<ShareableUrlHashProbe onShareUrl={onShareUrl} selectedGenes={['Sox2']} />)

    // Copy Link right after a change: the address is still behind.
    expect(window.location.hash).toContain('genes=Actb%2CGad1')
    expect(latest.shareUrl?.()).toBe(
      `${window.location.origin}/${window.location.hash.replace('genes=Actb%2CGad1', 'genes=Sox2')}`,
    )
  })

  it('adds a history entry when another dataset opens (15.3-C)', () => {
    const startLength = window.history.length
    const { rerender } = render(<ShareableUrlHashProbe datasetUrl="" />)
    act(() => {
      vi.advanceTimersByTime(160)
    })
    // The start screen: no dataset, so the entry is replaced.
    expect(window.history.length).toBe(startLength)

    rerender(<ShareableUrlHashProbe datasetUrl="https://example.test/a" />)
    act(() => {
      vi.advanceTimersByTime(160)
    })
    expect(window.history.length).toBe(startLength + 1)
    expect(window.location.hash).toContain('dataset=https%3A%2F%2Fexample.test%2Fa')

    // Other changes replace the entry.
    rerender(
      <ShareableUrlHashProbe
        datasetUrl="https://example.test/a"
        selectedGenes={['Sox2']}
      />,
    )
    act(() => {
      vi.advanceTimersByTime(160)
    })
    expect(window.history.length).toBe(startLength + 1)
    expect(window.location.hash).toContain('genes=Sox2')

    rerender(<ShareableUrlHashProbe datasetUrl="https://example.test/b" />)
    act(() => {
      vi.advanceTimersByTime(160)
    })
    expect(window.history.length).toBe(startLength + 2)
  })

  it('keeps the entry for the dataset a link opened', () => {
    window.history.replaceState(null, '', '/?dataset=https%3A%2F%2Fexample.test%2Fa')
    const startLength = window.history.length
    render(<ShareableUrlHashProbe datasetUrl="https://example.test/a" />)
    act(() => {
      vi.advanceTimersByTime(160)
    })

    expect(window.history.length).toBe(startLength)
    expect(window.location.search).toBe('?dataset=https%3A%2F%2Fexample.test%2Fa')
  })

  it('reloads when Back reaches another dataset, and writes nothing more', () => {
    const onHistoryDatasetChange = vi.fn()
    const { rerender } = render(
      <ShareableUrlHashProbe
        datasetUrl="https://example.test/b"
        onHistoryDatasetChange={onHistoryDatasetChange}
      />,
    )
    act(() => {
      vi.advanceTimersByTime(160)
    })

    // Back to the same dataset's entry: nothing to do.
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(onHistoryDatasetChange).not.toHaveBeenCalled()

    window.history.replaceState(null, '', '/#xv=2&dataset=https%3A%2F%2Fexample.test%2Fa')
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(onHistoryDatasetChange).toHaveBeenCalledTimes(1)

    rerender(
      <ShareableUrlHashProbe
        datasetUrl="https://example.test/b"
        selectedGenes={['Sox2']}
        onHistoryDatasetChange={onHistoryDatasetChange}
      />,
    )
    act(() => {
      vi.advanceTimersByTime(160)
    })
    expect(window.location.hash).toBe('#xv=2&dataset=https%3A%2F%2Fexample.test%2Fa')
  })
})
