import { describe, expect, it } from 'vitest'
import type { Annotation } from '../../datasets/spatialDataset'
import {
  defaultPlotSetId,
  PLOT_MAX_GENES,
  plotGroupsInput,
  plotSetOptions,
  plotsPanelGroups,
} from './plotsPanelModel'

const annotations: readonly Annotation<string>[] = [
  { id: 'roi:1:roi-1', label: 'ROI 1', cellIds: ['a'] },
  { id: 'analysis:cluster:a', label: 'cluster: A', cellIds: ['a', 'b'] },
  { id: 'analysis:cluster:b', label: 'cluster: B', cellIds: ['c'] },
  { id: 'analysis:cluster:c', label: 'cluster: C', cellIds: ['d'] },
  { id: 'custom:labels-csv:type:t', label: 'type: T', cellIds: ['a'] },
]
const styles = annotations.map((annotation, index) => ({
  ...annotation,
  color: `#00000${index}`,
}))

describe('Plots panel groups (plan 22-D1 to 22-D3)', () => {
  it('lists sets as the Clusters lists group them, defaulting to the dataset’s', () => {
    expect(plotSetOptions(annotations)).toEqual([
      { id: 'loaded-annotations', label: 'Loaded annotations', classCount: 1 },
      { id: 'analysis:cluster', label: 'cluster', classCount: 3 },
      { id: 'custom:labels-csv:type', label: 'type', classCount: 1 },
    ])
    // Save ROI puts its class first; the dataset's set is still the default.
    expect(defaultPlotSetId(annotations)).toBe('analysis:cluster')
    expect(defaultPlotSetId([])).toBeNull()
  })

  it('keeps the legend’s order and colours, leaving hidden classes out', () => {
    const panel = plotsPanelGroups({
      annotations,
      visibleClasses: styles.filter((style) => style.id !== 'analysis:cluster:b'),
      setId: null,
      selection: null,
      selectedGenes: ['Gad1', 'Actb'],
    })

    expect(panel.setLabel).toBe('cluster')
    expect(panel.groups.map((group) => [group.label, group.color])).toEqual([
      ['A', '#000001'],
      ['C', '#000003'],
    ])
    expect(panel.hiddenClassCount).toBe(1)
    expect(panel.genes).toEqual(['Gad1', 'Actb'])
  })

  it('puts the selection first and caps classes and genes', () => {
    const genes = Array.from({ length: PLOT_MAX_GENES + 3 }, (_, index) => `G${index}`)
    const panel = plotsPanelGroups({
      annotations,
      visibleClasses: styles,
      setId: 'analysis:cluster',
      selection: {
        name: 'ROI 2',
        color: '#f0c84b',
        cellIds: ['b', 'c'],
        hitCellLimit: true,
      },
      selectedGenes: [...genes, 'G0'],
      maxClasses: 2,
    })

    expect(panel.groups.map((group) => group.label)).toEqual(['ROI 2', 'A', 'B'])
    expect(panel.omittedClassCount).toBe(1)
    expect(panel.genes).toHaveLength(PLOT_MAX_GENES)
    expect(panel.omittedGeneCount).toBe(3)
    expect(panel.selectionHitCellLimit).toBe(true)
    expect(plotGroupsInput(panel.groups)).toEqual({
      selection: ['b', 'c'],
      classes: [['a', 'b'], ['c']],
    })
  })

  it('falls back to the default set when the chosen one is gone', () => {
    const panel = plotsPanelGroups({
      annotations,
      visibleClasses: styles,
      setId: 'custom:gone:set',
      selection: null,
      selectedGenes: [],
    })

    expect(panel.setId).toBe('analysis:cluster')
  })
})
