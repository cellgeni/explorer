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
  const { genes, layers, magicLens, morphology, runtime, transcripts } = result.current

  return {
    activeTab: runtime.activeControlHudTab,
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

    expect(trimmed).toEqual({ cellFillOpacity: 0.7 })
    expect(formatShareableState(trimmed)).toBe('#xv=2&cellFill=0.7')
    expect(initialSettings(parseShareableState(formatShareableState(trimmed)))).toEqual({
      ...DEFAULT_SHAREABLE_STATE,
      cellFillOpacity: 0.7,
    })
  })

  it('keeps a measure unit that differs from the mouse coordinate unit', () => {
    expect(
      withoutShareableDefaults({ coordinateUnit: 'px', measurementUnit: 'um' }),
    ).toEqual({ coordinateUnit: 'px', measurementUnit: 'um' })
    expect(
      withoutShareableDefaults({ coordinateUnit: 'px', measurementUnit: 'px' }),
    ).toEqual({ coordinateUnit: 'px' })
  })
})
