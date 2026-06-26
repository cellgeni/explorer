import { describe, expect, it } from 'vitest'
import {
  formatShareableState,
  parseShareableState,
  shareableViewStateKey,
  viewStateToShareable,
} from './shareableState'
import { micrometers } from './coords'

describe('shareableState', () => {
  it('round-trips dataset, genes, view, ROI, and controls', () => {
    const hash = formatShareableState({
      datasetUrl: 'https://example.test/output',
      annotationUrl: 'https://example.test/annotations/manual.csv',
      customImageUrls: [
        'https://example.test/images/he.ome.tif',
        'https://example.test/images/if.ome.tif',
      ],
      customImageOpacities: [0.35, 0.8],
      selectedGenes: ['Actb', 'Gad1'],
      viewState: { target: [12.3456, 78.9123, 0], zoom: 1.23456 },
      roiSelection: {
        kind: 'box',
        bbox: {
          minX: micrometers(1),
          minY: micrometers(2),
          maxX: micrometers(3),
          maxY: micrometers(4),
        },
      },
      activeTab: 'genes',
      geneExpressionColorScale: 'plasma',
      geneExpressionScoreMode: 'sum',
      geneExpressionDetailMode: 'auto',
      observationColorMode: 'transcript-count',
      coordinateUnit: 'px',
      measurementUnit: 'um',
      shouldLoadMorphology: true,
      boundaryCellLimit: 2500,
      imageOpacity: 0.45,
      cellFillOpacity: 0.7,
      showCellBoundaries: false,
      showNucleusBoundaries: true,
      showHoverTooltips: false,
      cellBoundaryOpacity: 0.35,
      morphologyEnabledChannelIds: ['Channel:1', 'Channel:3'],
      transcriptOverlay: true,
      transcriptDetailMode: 'exact',
      transcriptMinQv: 25,
      transcriptGeneOnly: true,
      transcriptFeatureFilterMode: 'selected',
      transcriptDensityColorScale: 'viridis',
      transcriptPointColorMode: 'quality',
      transcriptExactPointLimit: 75_000,
      transcriptOpacity: 0.75,
      transcriptPointSize: 3,
      magicLensScope: 'cursor',
      magicLensActive: true,
      magicLensRadiusMicrometers: 120,
      magicLensMinQv: 18,
    })

    const state = parseShareableState(hash)

    expect(state.datasetUrl).toBe('https://example.test/output')
    expect(state.annotationUrl).toBe('https://example.test/annotations/manual.csv')
    expect(state.customImageUrls).toEqual([
      'https://example.test/images/he.ome.tif',
      'https://example.test/images/if.ome.tif',
    ])
    expect(state.customImageOpacities).toEqual([0.35, 0.8])
    expect(state.selectedGenes).toEqual(['Actb', 'Gad1'])
    expect(state.viewState).toEqual({ target: [12.346, 78.912, 0], zoom: 1.235 })
    expect(state.roiSelection?.kind).toBe('box')
    expect(state.activeTab).toBe('genes')
    expect(state.geneExpressionColorScale).toBe('plasma')
    expect(state.coordinateUnit).toBe('px')
    expect(state.measurementUnit).toBe('um')
    expect(state.shouldLoadMorphology).toBe(true)
    expect(state.boundaryCellLimit).toBe(2500)
    expect(state.imageOpacity).toBe(0.45)
    expect(state.cellFillOpacity).toBe(0.7)
    expect(state.showCellBoundaries).toBe(false)
    expect(state.showNucleusBoundaries).toBe(true)
    expect(state.showHoverTooltips).toBe(false)
    expect(state.cellBoundaryOpacity).toBe(0.35)
    expect(state.morphologyEnabledChannelIds).toEqual(['Channel:1', 'Channel:3'])
    expect(state.transcriptOverlay).toBe(true)
    expect(state.transcriptDetailMode).toBe('exact')
    expect(state.transcriptMinQv).toBe(25)
    expect(state.transcriptGeneOnly).toBe(true)
    expect(state.transcriptFeatureFilterMode).toBe('selected')
    expect(state.transcriptDensityColorScale).toBe('viridis')
    expect(state.transcriptPointColorMode).toBe('quality')
    expect(state.transcriptExactPointLimit).toBe(75_000)
    expect(state.transcriptOpacity).toBe(0.75)
    expect(state.transcriptPointSize).toBe(3)
    expect(state.magicLensScope).toBe('cursor')
    expect(state.magicLensActive).toBe(true)
    expect(state.magicLensRadiusMicrometers).toBe(120)
    expect(state.magicLensMinQv).toBe(18)
  })

  it('round-trips all morphology channels disabled', () => {
    const hash = formatShareableState({
      morphologyEnabledChannelIds: [],
    })

    expect(hash).toContain('channels=')
    expect(parseShareableState(hash).morphologyEnabledChannelIds).toEqual([])
  })

  it('keeps a compact key for rounded view state comparisons', () => {
    const state = viewStateToShareable({
      target: [1.12349, 2.56789, 0],
      zoom: -1.22222,
    })

    expect(shareableViewStateKey(state)).toBe('1.123:2.568:0:-1.222')
  })
})
