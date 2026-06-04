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
      shouldLoadMorphology: true,
      boundaryCellLimit: 2500,
    })

    const state = parseShareableState(hash)

    expect(state.datasetUrl).toBe('https://example.test/output')
    expect(state.selectedGenes).toEqual(['Actb', 'Gad1'])
    expect(state.viewState).toEqual({ target: [12.346, 78.912, 0], zoom: 1.235 })
    expect(state.roiSelection?.kind).toBe('box')
    expect(state.activeTab).toBe('genes')
    expect(state.geneExpressionColorScale).toBe('plasma')
    expect(state.coordinateUnit).toBe('px')
    expect(state.shouldLoadMorphology).toBe(true)
    expect(state.boundaryCellLimit).toBe(2500)
  })

  it('keeps a compact key for rounded view state comparisons', () => {
    const state = viewStateToShareable({
      target: [1.12349, 2.56789, 0],
      zoom: -1.22222,
    })

    expect(shareableViewStateKey(state)).toBe('1.123:2.568:0:-1.222')
  })
})
