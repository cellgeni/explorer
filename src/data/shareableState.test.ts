import { describe, expect, it } from 'vitest'
import {
  formatShareableState,
  parseShareableState,
  shareableViewStateKey,
  viewStateToShareable,
} from './shareableState'
import { micrometers } from './coords'

describe('shareableState', () => {
  it('round-trips an imported segmentation', () => {
    const hash = formatShareableState({
      datasetUrl: 'https://example.test/slide.ndpi',
      segmentationUrl: 'https://example.test/get?id=3',
      segmentationFormat: 'wkt',
      segmentationUnits: 'micrometers',
    })

    expect(hash).toContain('segmentation=https')
    expect(parseShareableState(hash)).toMatchObject({
      segmentationUrl: 'https://example.test/get?id=3',
      segmentationFormat: 'wkt',
      segmentationUnits: 'micrometers',
    })
    expect(
      parseShareableState(formatShareableState({ segmentationFormat: 'wkt' })),
    ).not.toHaveProperty('segmentationFormat')
  })

  it("round-trips the dataset's chosen reader, only with the dataset", () => {
    const hash = formatShareableState({
      datasetUrl: 'https://example.test/records/7/content',
      datasetReader: 'h5ad',
    })

    expect(hash).toContain('&reader=h5ad')
    expect(parseShareableState(hash)).toMatchObject({
      datasetUrl: 'https://example.test/records/7/content',
      datasetReader: 'h5ad',
    })
    expect(parseShareableState('?dataset=x&reader=image')).toMatchObject({
      datasetReader: 'image',
    })
    expect(
      parseShareableState(formatShareableState({ datasetReader: 'h5ad' })),
    ).not.toHaveProperty('datasetReader')
  })

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
      geneExpressionScaleRange: ',12.5',
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
      cellPointScale: 1.5,
      showCellBoundaries: false,
      showNucleusBoundaries: true,
      showHoverTooltips: false,
      showMinimap: false,
      showAxes: true,
      showLegend: false,
      showNavigation: false,
      showScaleBar: false,
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
    expect(state.geneExpressionScaleRange).toBe(',12.5')
    expect(state.cellMetadataTrackId).toBe('h5ad:n-genes')
    expect(state.coordinateUnit).toBe('px')
    expect(state.measurementUnit).toBe('um')
    expect(state.shouldLoadMorphology).toBe(true)
    expect(state.boundaryCellLimit).toBe(2500)
    expect(state.imageOpacity).toBe(0.45)
    expect(state.cellFillOpacity).toBe(0.7)
    expect(state.cellPointScale).toBe(1.5)
    expect(state.showCellBoundaries).toBe(false)
    expect(state.showNucleusBoundaries).toBe(true)
    expect(state.showHoverTooltips).toBe(false)
    expect(state.showMinimap).toBe(false)
    expect(state.showAxes).toBe(true)
    expect(state.showLegend).toBe(false)
    expect(state.showNavigation).toBe(false)
    expect(state.showScaleBar).toBe(false)
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

  it('round-trips a section of an AnnData table, and the table split', () => {
    const table = 'https://example.test/ef6/aligned.h5ad'
    const hash = formatShareableState({
      collectionUrl: `${table}#obs.section`,
      datasetUrl: `${table}#obs.section=section%2001`,
    })

    expect(hash).not.toMatch(/h5ad#/)
    expect(parseShareableState(hash)).toMatchObject({
      collectionUrl: `${table}#obs.section`,
      datasetUrl: `${table}#obs.section=section%2001`,
    })
  })

  it('round-trips the collection ahead of the dataset', () => {
    const hash = formatShareableState({
      collectionUrl: 'https://example.test/studies/injury/collection.json',
      datasetUrl: 'https://example.test/studies/injury/sham-a.zarr',
    })

    expect(hash).toBe(
      '#xv=2&collection=https%3A%2F%2Fexample.test%2Fstudies%2Finjury%2Fcollection.json&dataset=https%3A%2F%2Fexample.test%2Fstudies%2Finjury%2Fsham-a.zarr',
    )
    expect(parseShareableState(hash)).toEqual({
      linkVersion: 2,
      collectionUrl: 'https://example.test/studies/injury/collection.json',
      datasetUrl: 'https://example.test/studies/injury/sham-a.zarr',
    })
    expect(parseShareableState('?collection=https://example.test/c.json')).toEqual({
      collectionUrl: 'https://example.test/c.json',
    })
  })

  it("round-trips the collection bar's view after the collection", () => {
    const hash = formatShareableState({
      collectionUrl: 'https://example.test/c.json',
      collectionView: 'grid',
    })

    expect(hash).toBe(
      '#xv=2&collection=https%3A%2F%2Fexample.test%2Fc.json&collectionView=grid',
    )
    expect(parseShareableState(hash)).toEqual({
      linkVersion: 2,
      collectionUrl: 'https://example.test/c.json',
      collectionView: 'grid',
    })
  })

  it("round-trips the collection grid's preview width", () => {
    const hash = formatShareableState({
      collectionUrl: 'https://example.test/c.json',
      collectionView: 'grid',
      collectionPreviewSize: 320,
    })

    expect(hash).toBe(
      '#xv=2&collection=https%3A%2F%2Fexample.test%2Fc.json&collectionView=grid&collectionPreviewSize=320',
    )
    expect(parseShareableState(hash)).toEqual({
      linkVersion: 2,
      collectionUrl: 'https://example.test/c.json',
      collectionView: 'grid',
      collectionPreviewSize: 320,
    })
    expect(parseShareableState('#collectionPreviewSize=big')).toEqual({})
  })

  it('round-trips the sections shown side by side, in order', () => {
    const hash = formatShareableState({
      collectionUrl: 'https://example.test/c.json',
      datasetUrl: 'https://example.test/s1.zarr',
      compareUrls: ['https://example.test/s3.zarr', 'https://example.test/s2.zarr'],
    })

    expect(hash).toBe(
      '#xv=2&collection=https%3A%2F%2Fexample.test%2Fc.json&compare=https%3A%2F%2Fexample.test%2Fs3.zarr&compare=https%3A%2F%2Fexample.test%2Fs2.zarr&dataset=https%3A%2F%2Fexample.test%2Fs1.zarr',
    )
    expect(parseShareableState(hash).compareUrls).toEqual([
      'https://example.test/s3.zarr',
      'https://example.test/s2.zarr',
    ])
  })

  it('round-trips how each section beside follows the main view', () => {
    const hash = formatShareableState({
      compareUrls: [
        'https://example.test/s2.zarr',
        'https://example.test/s3.zarr',
        'https://example.test/s4.zarr',
        'https://example.test/s5.zarr',
      ],
      compareLinks: [
        { linked: true, values: [10.12345, -20, 0.5] },
        null,
        { linked: false },
        { linked: false, values: [100, -50, 2] },
      ],
    })

    expect(new URLSearchParams(hash.slice(1)).getAll('compareLink')).toEqual([
      '1,10.123,-20,0.5',
      '',
      '0',
      '0,100,-50,2',
    ])
    expect(parseShareableState(hash).compareLinks).toEqual([
      { linked: true, values: [10.123, -20, 0.5] },
      null,
      { linked: false },
      { linked: false, values: [100, -50, 2] },
    ])
    // What is not understood keeps its place, as the section's default.
    expect(
      parseShareableState('#compareLink=2&compareLink=1,x,0,0&compareLink=1')
        .compareLinks,
    ).toEqual([null, null, { linked: true }])
  })

  it('round-trips which sections beside draw their cell boundaries', () => {
    const hash = formatShareableState({
      compareUrls: ['https://example.test/s2.zarr', 'https://example.test/s3.zarr'],
      compareBoundaries: [false, true],
    })

    expect(new URLSearchParams(hash.slice(1)).getAll('compareBoundaries')).toEqual([
      '',
      '1',
    ])
    expect(parseShareableState(hash).compareBoundaries).toEqual([false, true])
    // None drawn writes nothing.
    expect(formatShareableState({ compareBoundaries: [false, false] })).not.toContain(
      'compareBoundaries',
    )
    expect(parseShareableState('#compareBoundaries=0').compareBoundaries).toBeUndefined()
  })

  it('round-trips the serial sections stacked in 3D', () => {
    const hash = formatShareableState({
      collectionUrl: 'https://example.test/c.json',
      sectionView: '3d',
      datasetUrl: 'https://example.test/s1.zarr',
    })

    expect(hash).toBe(
      '#xv=2&collection=https%3A%2F%2Fexample.test%2Fc.json&sectionView=3d&dataset=https%3A%2F%2Fexample.test%2Fs1.zarr',
    )
    expect(parseShareableState(hash).sectionView).toBe('3d')
  })

  it('round-trips the MERSCOPE stain and plane', () => {
    const hash = formatShareableState({ merscopeImage: 'Cellbound1_z3' })

    expect(hash).toContain('mimg=Cellbound1_z3')
    expect(parseShareableState(hash)).toEqual({
      linkVersion: 2,
      merscopeImage: 'Cellbound1_z3',
    })
    expect(parseShareableState('#mimg=none').merscopeImage).toBe('none')
  })

  it('round-trips the 3D view of a z-stack image', () => {
    const hash = formatShareableState({ imageView: '3d' })

    expect(hash).toContain('imageView=3d')
    expect(parseShareableState(hash)).toEqual({ linkVersion: 2, imageView: '3d' })
  })

  it('round-trips the 3D view of cells placed in 3D', () => {
    const hash = formatShareableState({ cellView: '3d' })

    expect(hash).toContain('cellView=3d')
    expect(parseShareableState(hash)).toEqual({ linkVersion: 2, cellView: '3d' })
  })

  it('round-trips the Atera image choice', () => {
    const hash = formatShareableState({ ateraImage: '3d' })

    expect(hash).toContain('aimg=3d')
    expect(parseShareableState(hash)).toEqual({ linkVersion: 2, ateraImage: '3d' })
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

  it('round-trips the time point beside the z plane and ignores invalid ones', () => {
    const hash = formatShareableState({ morphologyZPlane: 15, morphologyTimePoint: 0 })

    expect(hash).toContain('t=0')
    expect(parseShareableState(hash)).toEqual({
      linkVersion: 2,
      morphologyZPlane: 15,
      morphologyTimePoint: 0,
    })
    expect(parseShareableState('#t=-1').morphologyTimePoint).toBeUndefined()
    expect(parseShareableState('#t=2.5').morphologyTimePoint).toBeUndefined()
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

  it('writes and reads hidden annotation sets after the hidden classes', () => {
    const hash = formatShareableState({
      annotationGroupIds: ['h5ad:leiden'],
      hiddenAnnotationIds: ['analysis:leiden:0'],
      hiddenAnnotationSetIds: ['analysis:leiden', 'custom:labels-csv:CD4+, naive'],
    })

    expect(new URLSearchParams(hash.slice(1)).get('hiddenSets')).toBe(
      'analysis:leiden,custom:labels-csv:CD4+%2C naive',
    )
    expect(hash.indexOf('hiddenSets=')).toBeGreaterThan(hash.indexOf('hiddenClasses='))
    expect(parseShareableState(hash).hiddenAnnotationSetIds).toEqual([
      'analysis:leiden',
      'custom:labels-csv:CD4+, naive',
    ])
    expect(formatShareableState({ hiddenAnnotationSetIds: [' '] })).toBe('#xv=2')
    expect(parseShareableState('#hiddenSets=').hiddenAnnotationSetIds).toBeUndefined()
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

  it('keeps a gene, channel or set ID with a comma in one piece', () => {
    const state = {
      selectedGenes: ['1,3-bisphosphoglycerate', 'ATP', '100%'],
      morphologyEnabledChannelIds: ['Channel:0,1', 'Channel:2'],
      annotationGroupIds: ['analysis:a,b'],
      hiddenLayers: ['image'],
      panels: ['cells', 'plots'],
    }

    expect(parseShareableState(formatShareableState(state))).toMatchObject(state)
    // Links written before keep reading as they did.
    expect(parseShareableState('#genes=Actb,Gad1&channels=0,1')).toMatchObject({
      selectedGenes: ['Actb', 'Gad1'],
      morphologyEnabledChannelIds: ['0', '1'],
    })
  })

  it('writes and reads the classes shown in a mostly hidden set', () => {
    const hash = formatShareableState({
      hiddenAnnotationIds: ['custom:labels-csv:b'],
      shownAnnotationIds: ['analysis:leiden:3'],
    })

    expect(new URLSearchParams(hash.slice(1)).get('shownClasses')).toBe(
      'analysis:leiden:3',
    )
    expect(parseShareableState(hash)).toMatchObject({
      hiddenAnnotationIds: ['custom:labels-csv:b'],
      shownAnnotationIds: ['analysis:leiden:3'],
    })
    expect(formatShareableState({ shownAnnotationIds: [] })).toBe('#xv=2')
  })

  it('writes and reads the Plots panel’s plot', () => {
    const hash = formatShareableState({ panels: ['cells', 'plots'], plot: 'heatmap' })

    expect(hash).toBe('#xv=2&panel=cells%2Cplots&plot=heatmap')
    expect(parseShareableState(hash)).toMatchObject({
      panels: ['cells', 'plots'],
      plot: 'heatmap',
    })
  })

  it('writes and reads the saved gene sets after the genes', () => {
    const geneSets = 'Actb%2C Gad1|mean|Actb,Gad1;T cells|sum|CD3E'
    const hash = formatShareableState({ selectedGenes: ['Actb'], geneSets })

    expect(hash).toBe(
      '#xv=2&genes=Actb&geneSets=Actb%252C+Gad1%7Cmean%7CActb%2CGad1%3BT+cells%7Csum%7CCD3E',
    )
    expect(parseShareableState(hash)).toMatchObject({ selectedGenes: ['Actb'], geneSets })
    expect(formatShareableState({ geneSets: '' })).toBe('#xv=2')
  })
})
