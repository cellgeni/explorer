import { describe, expect, it, vi } from 'vitest'
import { defaultAppDependencies, resolveAppDependencies } from './appDependencies'

describe('defaultAppDependencies', () => {
  it('wires every app dependency slot to a callable default', () => {
    expect(Object.keys(defaultAppDependencies).sort()).toEqual(
      [
        'analysis',
        'annotations',
        'dataset',
        'diagnostics',
        'genes',
        'morphology',
        'roi',
        'spatialElements',
        'transcripts',
      ].sort(),
    )

    for (const group of Object.values(defaultAppDependencies)) {
      for (const dependency of Object.values(group)) {
        expect(dependency).toEqual(expect.any(Function))
      }
    }
  })

  it('applies targeted dependency overrides by group', () => {
    const loadDatasetOverview = vi.fn()
    const loadGeneExpression = vi.fn()
    const dependencies = resolveAppDependencies({
      dataset: { loadDatasetOverview },
      genes: { loadGeneExpression },
    })

    expect(dependencies.dataset.loadDatasetOverview).toBe(loadDatasetOverview)
    expect(dependencies.genes.loadGeneExpression).toBe(loadGeneExpression)
    expect(dependencies.dataset.loadGenePanel).toBe(
      defaultAppDependencies.dataset.loadGenePanel,
    )
    expect(dependencies.roi.loadRoiCells).toBe(defaultAppDependencies.roi.loadRoiCells)
  })
})
