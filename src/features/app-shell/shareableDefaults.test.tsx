import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { detectPerformanceBudget } from '../../data/performanceBudget'
import { DEFAULT_SHAREABLE_STATE } from './shareableDefaults'
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
})
