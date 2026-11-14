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
      cellMetadataTrackId: 'h5ad:n-genes',
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
      morphologyZPlane: 7,
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
    expect(state.cellMetadataTrackId).toBe('h5ad:n-genes')
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
    expect(state.morphologyZPlane).toBe(7)
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
  })

  it('round-trips all morphology channels disabled', () => {
    const hash = formatShareableState({
      morphologyEnabledChannelIds: [],
    })

    expect(hash).toContain('channels=')
    expect(parseShareableState(hash).morphologyEnabledChannelIds).toEqual([])
  })

  it('round-trips the Visium image, library, and off-tissue choice', () => {
    const hash = formatShareableState({
      visiumImage: 'lowres',
      visiumLibrary: 'V1_Mouse Brain',
      visiumOffTissue: true,
    })

    expect(hash).toContain('vimg=lowres')
    expect(hash).toContain('vlib=V1_Mouse+Brain')
    expect(hash).toContain('voff=1')
    expect(parseShareableState(hash)).toEqual({
      linkVersion: 2,
      visiumImage: 'lowres',
      visiumLibrary: 'V1_Mouse Brain',
      visiumOffTissue: true,
    })
    expect(parseShareableState('#voff=0').visiumOffTissue).toBe(false)
  })

  it('round-trips the SpatialData table, coordinate system, image, and scale', () => {
    const hash = formatShareableState({
      spatialDataTable: 'square_008um',
      spatialDataCoordinateSystem: 'global',
      spatialDataImage: 'hires_image',
      spatialDataMicrometersPerUnit: 0.2737,
    })

    expect(hash).toContain('sdTable=square_008um')
    expect(parseShareableState(hash)).toEqual({
      linkVersion: 2,
      spatialDataTable: 'square_008um',
      spatialDataCoordinateSystem: 'global',
      spatialDataImage: 'hires_image',
      spatialDataMicrometersPerUnit: 0.2737,
    })
  })

  it('round-trips the first z plane and ignores invalid ones', () => {
    expect(parseShareableState(formatShareableState({ morphologyZPlane: 0 }))).toEqual({
      linkVersion: 2,
      morphologyZPlane: 0,
    })
    expect(parseShareableState('#z=-1').morphologyZPlane).toBeUndefined()
    expect(parseShareableState('#z=1.5').morphologyZPlane).toBeUndefined()
  })

  it('keeps a compact key for rounded view state comparisons', () => {
    const state = viewStateToShareable({
      target: [1.12349, 2.56789, 0],
      zoom: -1.22222,
    })

    expect(shareableViewStateKey(state)).toBe('1.123:2.568:0:-1.222')
  })

  it('still reads version 1 links, which wrote every field', () => {
    const state = parseShareableState(
      '#xv=1&dataset=https%3A%2F%2Fexample.test%2Fxenium&genes=SNAP25&cellColor=transcript-count&tab=dataset&nucleusBounds=1&txFilter=selected',
    )

    expect(state).toEqual({
      linkVersion: 1,
      datasetUrl: 'https://example.test/xenium',
      selectedGenes: ['SNAP25'],
      observationColorMode: 'transcript-count',
      activeTab: 'dataset',
      showNucleusBoundaries: true,
      transcriptFeatureFilterMode: 'selected',
    })
  })

  it('writes and reads the annotation sets as groups', () => {
    const hash = formatShareableState({
      annotationGroupIds: ['analysis:0', 'h5ad:leiden'],
    })

    expect(hash).toBe('#xv=2&groups=analysis%3A0%2Ch5ad%3Aleiden')
    expect(parseShareableState(hash).annotationGroupIds).toEqual([
      'analysis:0',
      'h5ad:leiden',
    ])
  })

  it('writes and reads hidden annotation classes, leaving none out', () => {
    const hash = formatShareableState({
      annotationGroupIds: ['h5ad:leiden'],
      hiddenAnnotationIds: ['analysis:leiden:0', 'custom:labels-csv:t-cell'],
    })

    expect(hash).toBe(
      '#xv=2&groups=h5ad%3Aleiden&hiddenClasses=analysis%3Aleiden%3A0%2Ccustom%3Alabels-csv%3At-cell',
    )
    expect(parseShareableState(hash).hiddenAnnotationIds).toEqual([
      'analysis:leiden:0',
      'custom:labels-csv:t-cell',
    ])
    // No hidden classes, no parameter: older links stay the same.
    expect(formatShareableState({ annotationGroupIds: ['h5ad:leiden'] })).toBe(
      formatShareableState({
        annotationGroupIds: ['h5ad:leiden'],
        hiddenAnnotationIds: [],
      }),
    )
    expect(formatShareableState({ hiddenAnnotationIds: [] })).toBe('#xv=2')
    expect(parseShareableState('#xv=2&groups=h5ad%3Aleiden')).not.toHaveProperty(
      'hiddenAnnotationIds',
    )
    expect(parseShareableState('#hiddenClasses=').hiddenAnnotationIds).toBeUndefined()
  })

  it('escapes commas and percent signs in hidden class IDs', () => {
    const ids = ['analysis:CD4+, naive:1', 'custom:100%:a b', 'roi:1:%2C']
    const hash = formatShareableState({ hiddenAnnotationIds: ids })

    expect(new URLSearchParams(hash.slice(1)).get('hiddenClasses')).toBe(
      'analysis:CD4+%2C naive:1,custom:100%25:a b,roi:1:%252C',
    )
    expect(parseShareableState(hash).hiddenAnnotationIds).toEqual(ids)
    // A stray % in a hand-written link is kept.
    expect(
      parseShareableState('#hiddenClasses=a%252Cb,100%').hiddenAnnotationIds,
    ).toEqual(['a,b', '100%'])
  })
})
