import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { detectPerformanceBudget } from '../../data/performanceBudget'
import {
  formatShareableState,
  parseShareableState,
  type ShareableState,
} from '../../data/shareableState'
import { formatGeneScaleRange } from '../genes/geneScaleRange'
import { parsePlotKind } from '../plots/plotsPanelModel'
import { parseCellView } from '../sections/cellsSectionModel'
import { parseImageView } from '../sections/imageSectionModel'
import { DEFAULT_SHAREABLE_STATE, withoutShareableDefaults } from './shareableDefaults'
import { useAppDomainState } from './useAppDomainState'

function initialSettings(initialShareableState: ShareableState = {}) {
  const { result } = renderHook(() =>
    useAppDomainState({
      initialShareableState,
      performanceBudget: detectPerformanceBudget(),
    }),
  )
  const { genes, layers, magicLens, morphology, tools, transcripts } = result.current

  return {
    tool: tools.activeTool,
    // App keeps the plot, as it reads it here.
    plot: parsePlotKind(initialShareableState.plot),
    // App keeps the image view too, and the load applies the link's.
    imageView: parseImageView(initialShareableState.imageView) ?? '2d',
    cellView: parseCellView(initialShareableState.cellView) ?? '2d',
    hiddenLayers: (['image', 'cells', 'annotations'] as const).filter(
      (layer) => !layers.layerVisibility[layer],
    ),
    selectedGenes: genes.selectedGenes,
    geneExpressionColorScale: genes.geneExpressionColorScale,
    geneExpressionScaleRange: formatGeneScaleRange(genes.geneExpressionScaleRange),
    geneExpressionScoreMode: genes.geneExpressionScoreMode,
    geneExpressionDetailMode: genes.geneExpressionDetailMode,
    observationColorMode: layers.observationColorMode,
    coordinateUnit: layers.coordinateUnit,
    measurementUnit: layers.measurementUnit,
    shouldLoadMorphology: morphology.shouldLoadMorphology,
    imageOpacity: layers.imageLayerOpacity,
    cellFillOpacity: layers.cellFillOpacity,
    cellPointScale: layers.cellPointScale,
    showCellBoundaries: layers.showCellBoundaries,
    showNucleusBoundaries: layers.showNucleusBoundaries,
    showHoverTooltips: layers.showHoverTooltips,
    showMinimap: layers.showMinimap,
    showAxes: layers.showAxes,
    showLegend: layers.showLegend,
    showNavigation: layers.showNavigation,
    showScaleBar: layers.showScaleBar,
    cellBoundaryOpacity: layers.cellBoundaryOpacity,
    transcriptOverlay: transcripts.showTranscriptOverlay,
    transcriptDetailMode: transcripts.transcriptDetailMode,
    transcriptMinQv: transcripts.transcriptMinQv,
    transcriptGeneOnly: transcripts.transcriptGeneOnly,
    transcriptFeatureFilterMode: transcripts.transcriptFeatureFilterMode,
    transcriptDensityColorScale: transcripts.transcriptDensityColorScale,
    transcriptPointColorMode: transcripts.transcriptPointColorMode,
    transcriptExactPointLimit: transcripts.transcriptExactPointLimit,
    transcriptOpacity: transcripts.transcriptOpacity,
    transcriptPointSize: transcripts.transcriptPointSize,
    magicLensScope: magicLens.magicLensScope,
    magicLensActive: magicLens.magicLensActive,
    magicLensRadiusMicrometers: magicLens.magicLensRadiusMicrometers,
  }
}

describe('DEFAULT_SHAREABLE_STATE', () => {
  it('matches the settings the app starts with when the link sets nothing', () => {
    expect(initialSettings()).toEqual(DEFAULT_SHAREABLE_STATE)
  })

  it('survives the app normalising it when a link spells every default out', () => {
    expect(initialSettings(DEFAULT_SHAREABLE_STATE)).toEqual(DEFAULT_SHAREABLE_STATE)
  })

  it('leaves defaults out of a link, which then opens with the same settings', () => {
    const settings = { ...DEFAULT_SHAREABLE_STATE, cellFillOpacity: 0.7 }
    const trimmed = withoutShareableDefaults(settings)

    expect(trimmed).toEqual({
      cellFillOpacity: 0.7,
      showCellBoundaries: true,
      showNucleusBoundaries: true,
    })
    expect(formatShareableState(trimmed)).toBe(
      '#xv=2&cellFill=0.7&cellBounds=1&nucleusBounds=1',
    )
    expect(initialSettings(parseShareableState(formatShareableState(trimmed)))).toEqual({
      ...DEFAULT_SHAREABLE_STATE,
      cellFillOpacity: 0.7,
    })
  })

  it('opens a link with the canvas overlays it turned off or on', () => {
    const settings = {
      ...DEFAULT_SHAREABLE_STATE,
      showMinimap: false,
      showAxes: true,
      showLegend: false,
      showNavigation: false,
      showScaleBar: false,
    }
    const link = formatShareableState(withoutShareableDefaults(settings))

    expect(link).toBe(
      '#xv=2&cellBounds=1&nucleusBounds=1&minimap=0&axes=1&legend=0&navButtons=0&scaleBar=0',
    )
    expect(initialSettings(parseShareableState(link))).toEqual(settings)
  })

  it('keeps the boundary toggles, whose default depends on the platform', () => {
    // Xenium opens with nucleus outlines off unless the link turns them on.
    expect(
      withoutShareableDefaults({ showCellBoundaries: true, showNucleusBoundaries: true }),
    ).toEqual({ showCellBoundaries: true, showNucleusBoundaries: true })
  })

  it('keeps a measure unit that differs from the mouse coordinate unit', () => {
    expect(
      withoutShareableDefaults({ coordinateUnit: 'px', measurementUnit: 'um' }),
    ).toEqual({ coordinateUnit: 'px', measurementUnit: 'um' })
    expect(
      withoutShareableDefaults({ coordinateUnit: 'px', measurementUnit: 'px' }),
    ).toEqual({ coordinateUnit: 'px' })
  })

  it('leaves out the manifest’s defaults and keeps an app default the user went back to', () => {
    const manifest = { imageOpacity: 0.5, selectedGenes: ['Snap25'] }

    // The user kept the manifest's image opacity and removed its gene.
    expect(
      withoutShareableDefaults(
        { imageOpacity: 0.5, selectedGenes: [], cellFillOpacity: 0.7 },
        manifest,
      ),
    ).toEqual({ selectedGenes: [], cellFillOpacity: 0.7 })
    // Back at the app's opacity: written, or the manifest's 0.5 would return.
    expect(withoutShareableDefaults({ imageOpacity: 1 }, manifest)).toEqual({
      imageOpacity: 1,
    })
  })

  it('writes the 2D view only to undo a manifest’s 3D view', () => {
    expect(withoutShareableDefaults({ cellView: '2d' })).toEqual({})
    expect(withoutShareableDefaults({ cellView: '2d' }, { cellView: '3d' })).toEqual({
      cellView: '2d',
    })
    expect(withoutShareableDefaults({ imageView: '2d' })).toEqual({})
    expect(withoutShareableDefaults({ imageView: '3d' })).toEqual({ imageView: '3d' })
    expect(withoutShareableDefaults({ imageView: '3d' }, { imageView: '3d' })).toEqual({})
    expect(withoutShareableDefaults({ imageView: '2d' }, { imageView: '3d' })).toEqual({
      imageView: '2d',
    })
  })

  it('writes an Auto gene range only to undo the manifest’s range', () => {
    const manifest = { geneExpressionScaleRange: '0,40' }

    expect(withoutShareableDefaults({ geneExpressionScaleRange: ',' })).toEqual({})
    expect(
      withoutShareableDefaults({ geneExpressionScaleRange: '0,40' }, manifest),
    ).toEqual({})
    expect(withoutShareableDefaults({ geneExpressionScaleRange: ',' }, manifest)).toEqual(
      {
        geneExpressionScaleRange: ',',
      },
    )
    expect(
      formatShareableState(
        withoutShareableDefaults({ geneExpressionScaleRange: ',' }, manifest),
      ),
    ).toBe('#xv=2&geneRange=%2C')
  })
})
