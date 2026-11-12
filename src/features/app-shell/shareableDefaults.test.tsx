import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { detectPerformanceBudget } from '../../data/performanceBudget'
import { formatShareableState, parseShareableState } from '../../data/shareableState'
import { DEFAULT_SHAREABLE_STATE, withoutShareableDefaults } from './shareableDefaults'
import { useAppDomainState } from './useAppDomainState'

function initialSettings(initialShareableState = {}) {
  const { result } = renderHook(() =>
    useAppDomainState({
      initialShareableState,
      performanceBudget: detectPerformanceBudget(),
    }),
  )
  const { genes, layers, magicLens, morphology, tools, transcripts } = result.current

  return {
    tool: tools.activeTool,
    hiddenLayers: (['image', 'cells', 'annotations'] as const).filter(
      (layer) => !layers.layerVisibility[layer],
    ),
    selectedGenes: genes.selectedGenes,
    geneExpressionColorScale: genes.geneExpressionColorScale,
    geneExpressionScoreMode: genes.geneExpressionScoreMode,
    geneExpressionDetailMode: genes.geneExpressionDetailMode,
    observationColorMode: layers.observationColorMode,
    coordinateUnit: layers.coordinateUnit,
    measurementUnit: layers.measurementUnit,
    shouldLoadMorphology: morphology.shouldLoadMorphology,
    imageOpacity: layers.imageLayerOpacity,
    cellFillOpacity: layers.cellFillOpacity,
    showCellBoundaries: layers.showCellBoundaries,
    showNucleusBoundaries: layers.showNucleusBoundaries,
    showHoverTooltips: layers.showHoverTooltips,
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
    magicLensMinQv: magicLens.magicLensMinQv,
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
})
