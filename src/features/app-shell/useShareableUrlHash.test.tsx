import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { micrometers } from '../../data/coords'
import { readShareableStateFromLocation } from './appShellModel'
import { useShareableUrlHash } from './useShareableUrlHash'

function ShareableUrlHashProbe({
  boundaryCellLimit = 2500,
  collectionUrl,
  datasetUrl = 'https://example.test/output',
  geneSets,
  hiddenAnnotationIds,
  linkOpening,
  selectedGenes = ['Actb', 'Gad1'],
  onHistoryDatasetChange,
  onShareUrl,
}: {
  readonly boundaryCellLimit?: number
  readonly collectionUrl?: string
  readonly datasetUrl?: string
  readonly geneSets?: string
  readonly hiddenAnnotationIds?: readonly string[]
  readonly linkOpening?: boolean
  readonly selectedGenes?: readonly string[]
  readonly onHistoryDatasetChange?: () => void
  readonly onShareUrl?: (shareUrl: () => string) => void
}) {
  const shareUrl = useShareableUrlHash({
    ...(onHistoryDatasetChange === undefined ? {} : { onHistoryDatasetChange }),
    ...(linkOpening === undefined ? {} : { linkOpening }),
    dataset: {
      annotationUrl: 'https://example.test/annotations/manual.csv',
      customImageOpacities: [0.35],
      customImageUrls: ['https://example.test/images/he.ome.tif'],
      collectionUrl,
      datasetUrl,
      hiddenAnnotationIds,
    },
    genes: {
      geneExpressionColorScale: 'plasma',
      geneExpressionDetailMode: 'auto',
      geneExpressionScaleRange: undefined,
      geneExpressionScoreMode: 'sum',
      geneSets,
      selectedGenes,
    },
    layers: {
      boundaryCellLimit,
      deviceBoundaryCellLimit: 50_000,
      cellBoundaryOpacity: 0.35,
      cellFillOpacity: 0.7,
      cellPointScale: 1,
      cellMetadataTrackId: null,
      coordinateUnit: 'px',
      imageOpacity: 0.45,
      measurementUnit: 'um',
      morphologyEnabledChannelIds: ['Channel:1'],
      morphologyZPlane: 6,
      imageView: undefined,
      cellView: undefined,
      observationColorMode: 'transcript-count',
      shouldLoadMorphology: true,
      showCellBoundaries: false,
      showNucleusBoundaries: true,
      showHoverTooltips: false,
      showMinimap: true,
      showAxes: true,
      showLegend: false,
      showNavigation: true,
      showScaleBar: false,
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
      plot: 'violin',
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
    expect(window.location.hash).toContain('axes=1')
    expect(window.location.hash).toContain('legend=0')
    expect(window.location.hash).toContain('scaleBar=0')
    expect(window.location.hash).not.toMatch(/[#&](minimap|navButtons)=/)
    expect(window.location.hash).toContain('cellBoundary=0.35')
    expect(window.location.hash).toContain('channels=Channel%3A1')
    expect(window.location.hash).toMatch(/[#&]z=6(&|$)/)
    expect(window.location.hash).toContain('tool=magic-lens')
    expect(window.location.hash).toContain('plot=violin')
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

  it('writes the saved gene sets while there are any', () => {
    const { rerender } = render(
      <ShareableUrlHashProbe geneSets="Interneuron set|mean|Actb,Gad1" />,
    )
    act(() => {
      vi.advanceTimersByTime(160)
    })

    expect(window.location.hash).toContain(
      'geneSets=Interneuron+set%7Cmean%7CActb%2CGad1',
    )
    expect(readShareableStateFromLocation().geneSets).toBe(
      'Interneuron set|mean|Actb,Gad1',
    )

    rerender(<ShareableUrlHashProbe />)
    act(() => {
      vi.advanceTimersByTime(160)
    })

    expect(window.location.hash).not.toContain('geneSets=')
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

  it("leaves out the device's own Boundary limit, so each reader keeps theirs", () => {
    const { rerender } = render(<ShareableUrlHashProbe boundaryCellLimit={50_000} />)
    act(() => {
      vi.advanceTimersByTime(160)
    })

    expect(window.location.hash).not.toContain('boundaryLimit=')

    rerender(<ShareableUrlHashProbe boundaryCellLimit={2500} />)
    act(() => {
      vi.advanceTimersByTime(160)
    })

    expect(window.location.hash).toContain('boundaryLimit=2500')
  })

  it('keeps the link in the address while its dataset opens', () => {
    const link =
      '#xv=2&dataset=https%3A%2F%2Fexample.test%2Foutput&card=cell%3Aaaaa&roi=box%3A0%2C0%2C9%2C9'
    window.history.replaceState(null, '', `/${link}`)
    const latest: { shareUrl?: () => string } = {}
    const onShareUrl = (next: () => string) => {
      latest.shareUrl = next
    }
    const { rerender } = render(
      <ShareableUrlHashProbe linkOpening onShareUrl={onShareUrl} />,
    )
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    // The load applies the card and ROI later; until then the address and
    // Copy Link keep them.
    expect(window.location.hash).toBe(link)
    expect(latest.shareUrl?.()).toBe(`${window.location.origin}/${link}`)

    rerender(<ShareableUrlHashProbe linkOpening={false} onShareUrl={onShareUrl} />)
    act(() => {
      vi.advanceTimersByTime(160)
    })

    expect(window.location.hash).toContain('card=cell%3Acell-7')
    expect(latest.shareUrl?.()).toBe(`${window.location.origin}/${window.location.hash}`)
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

  it('writes the collection, and drops a query string copy once it has', () => {
    window.history.replaceState(
      null,
      '',
      '/?collection=https%3A%2F%2Fexample.test%2Fc.json&debug=1',
    )
    const latest: { shareUrl?: () => string } = {}
    const { rerender } = render(
      <ShareableUrlHashProbe
        collectionUrl="https://example.test/c.json"
        datasetUrl="https://example.test/a"
        onShareUrl={(next) => {
          latest.shareUrl = next
        }}
      />,
    )
    act(() => {
      vi.advanceTimersByTime(160)
    })

    expect(window.location.search).toBe('?debug=1')
    expect(window.location.hash).toMatch(
      /^#xv=2&collection=https%3A%2F%2Fexample.test%2Fc.json&dataset=/,
    )
    expect(latest.shareUrl?.()).toBe(
      `${window.location.origin}/?debug=1${window.location.hash}`,
    )

    // Closing the collection leaves it out, and a reload keeps it closed.
    rerender(<ShareableUrlHashProbe datasetUrl="https://example.test/a" />)
    act(() => {
      vi.advanceTimersByTime(160)
    })

    expect(window.location.href).not.toContain('collection=')
  })

  it('keeps the entry for the dataset a link opened', () => {
    window.history.replaceState(null, '', '/?dataset=https%3A%2F%2Fexample.test%2Fa')
    const startLength = window.history.length
    render(<ShareableUrlHashProbe datasetUrl="https://example.test/a" />)
    act(() => {
      vi.advanceTimersByTime(160)
    })

    expect(window.history.length).toBe(startLength)
    // The hash names the dataset now.
    expect(window.location.search).toBe('')
    expect(window.location.hash).toContain('dataset=https%3A%2F%2Fexample.test%2Fa')
  })

  it("drops the query string's link values once the hash is written", () => {
    window.history.replaceState(
      null,
      '',
      '/?dataset=https%3A%2F%2Fexample.test%2Fa&genes=Sox2&compare=https%3A%2F%2Fexample.test%2Fb&utm_source=mail&debug=1',
    )
    const latest: { shareUrl?: () => string } = {}
    const { rerender } = render(
      <ShareableUrlHashProbe
        datasetUrl="https://example.test/a"
        selectedGenes={['Sox2']}
        onShareUrl={(next) => {
          latest.shareUrl = next
        }}
      />,
    )
    act(() => {
      vi.advanceTimersByTime(160)
    })

    // Keys a link does not set stay.
    expect(window.location.search).toBe('?utm_source=mail&debug=1')
    expect(latest.shareUrl?.()).toBe(
      `${window.location.origin}/?utm_source=mail&debug=1${window.location.hash}`,
    )

    // Removing the genes leaves them out, and a reload keeps them removed.
    rerender(
      <ShareableUrlHashProbe datasetUrl="https://example.test/a" selectedGenes={[]} />,
    )
    act(() => {
      vi.advanceTimersByTime(160)
    })

    expect(readShareableStateFromLocation().selectedGenes).toBeUndefined()
  })

  it('replaces a collection link with the dataset it opens, so Back leaves the page', () => {
    window.history.replaceState(null, '', '/previous-page')
    window.history.pushState(null, '', '/?collection=https%3A%2F%2Fexample.test%2Fc.json')
    const startLength = window.history.length
    const { rerender } = render(
      <ShareableUrlHashProbe collectionUrl="https://example.test/c.json" datasetUrl="" />,
    )
    act(() => {
      vi.advanceTimersByTime(160)
    })

    // The collection opens its first dataset: that is the link's own dataset.
    rerender(
      <ShareableUrlHashProbe
        collectionUrl="https://example.test/c.json"
        datasetUrl="https://example.test/a"
      />,
    )
    act(() => {
      vi.advanceTimersByTime(160)
    })
    expect(window.history.length).toBe(startLength)
    expect(window.location.hash).toContain('dataset=https%3A%2F%2Fexample.test%2Fa')

    // Another of its datasets adds an entry, as any other dataset does.
    rerender(
      <ShareableUrlHashProbe
        collectionUrl="https://example.test/c.json"
        datasetUrl="https://example.test/b"
      />,
    )
    act(() => {
      vi.advanceTimersByTime(160)
    })
    expect(window.history.length).toBe(startLength + 1)
  })

  it.each(['popstate', 'hashchange'] as const)(
    'reloads for a link pasted for the open dataset (%s)',
    (eventName) => {
      const onHistoryDatasetChange = vi.fn()
      const { rerender } = render(
        <ShareableUrlHashProbe
          datasetUrl="https://example.test/a"
          selectedGenes={['Actb']}
          onHistoryDatasetChange={onHistoryDatasetChange}
        />,
      )
      act(() => {
        vi.advanceTimersByTime(160)
      })

      // A colleague's link: the same dataset, another gene.
      window.history.pushState(
        null,
        '',
        '/#xv=2&dataset=https%3A%2F%2Fexample.test%2Fa&genes=Gad1',
      )
      act(() => {
        window.dispatchEvent(new Event(eventName))
      })
      expect(onHistoryDatasetChange).toHaveBeenCalledTimes(1)

      // The pasted link stays for the reload to read.
      rerender(
        <ShareableUrlHashProbe
          datasetUrl="https://example.test/a"
          selectedGenes={['Sox2']}
          onHistoryDatasetChange={onHistoryDatasetChange}
        />,
      )
      act(() => {
        vi.advanceTimersByTime(160)
      })
      expect(window.location.hash).toContain('genes=Gad1')
    },
  )

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
