import { describe, expect, it } from 'vitest'
import { defaultAppDependencies } from './appDependencies'

describe('defaultAppDependencies', () => {
  it('wires every app dependency slot to a callable default', () => {
    expect(Object.keys(defaultAppDependencies).sort()).toEqual(
      [
        'computeAutoChannelContrast',
        'loadAnalysisEmbeddings',
        'loadAnnotationGroups',
        'loadAnnotations',
        'loadBoundaryElements',
        'loadCellTranscriptDistribution',
        'loadCustomMorphologyLayer',
        'loadDatasetOverview',
        'loadGeneExpression',
        'loadGenePanel',
        'loadMorphologyImage',
        'loadRoiCells',
        'loadRoiGeneStats',
        'loadRoiTranscripts',
        'loadTranscriptAggregates',
        'loadTranscriptCapabilities',
        'loadTranscriptViewport',
        'runDatasetDiagnostics',
        'warmDatasetForRoi',
      ].sort(),
    )

    for (const dependency of Object.values(defaultAppDependencies)) {
      expect(dependency).toEqual(expect.any(Function))
    }
  })
})
