import { describe, expect, it } from 'vitest'
import type { Annotation } from '../../datasets/spatialDataset'
import { PLOT_DENSITY_MAX_GROUPS } from './plotStats'
import {
  defaultPlotSetId,
  formatReadSize,
  HEATMAP_MAX_CLASSES,
  parsePlotKind,
  plotKindInfo,
  VIOLIN_MAX_CLASSES,
  PLOT_MAX_GENES,
  PLOT_READ_MAX_BYTES,
  PLOT_READ_PROMPT_BYTES,
  plotGenesPhrase,
  plotGroupsInput,
  plotReadDecision,
  plotSetOptions,
  plotsPanelGroups,
  resolvePlotSetId,
  SELECTIONS_SET_ID,
  type PlotSavedSelection,
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

describe('Group by › Selections', () => {
  const ready = (cellIds: readonly string[], hitCellLimit = false) =>
    ({ status: 'ready', cellIds, hitCellLimit }) as const
  const saved: readonly PlotSavedSelection[] = [
    {
      id: 's1',
      name: 'ROI 1',
      color: '#f0c84b',
      visible: true,
      cells: ready(['a', 'b']),
    },
    {
      id: 's2',
      name: 'ROI 2',
      color: '#4bc8f0',
      visible: true,
      cells: ready(['b', 'c'], true),
    },
    { id: 's3', name: 'ROI 3', color: '#f04bc8', visible: false, cells: ready(['d']) },
    {
      id: 's4',
      name: 'ROI 4',
      color: '#4bf06e',
      visible: true,
      cells: { status: 'error', message: 'Range requests are not supported.' },
    },
  ]

  it('lists the saved selections as a set, the default without a loaded one', () => {
    expect(plotSetOptions(annotations, 4).at(-1)).toEqual({
      id: SELECTIONS_SET_ID,
      label: 'Selections',
      classCount: 4,
    })
    expect(plotSetOptions([], 0)).toEqual([])
    expect(resolvePlotSetId([], 4, null)).toBe(SELECTIONS_SET_ID)
    expect(resolvePlotSetId(annotations, 4, null)).toBe('analysis:cluster')
    expect(resolvePlotSetId(annotations, 4, SELECTIONS_SET_ID)).toBe(SELECTIONS_SET_ID)
    // Deleting the last selection falls back to the dataset's set.
    expect(resolvePlotSetId(annotations, 0, SELECTIONS_SET_ID)).toBe('analysis:cluster')
  })

  it('makes each shown selection a group, overlaps and all', () => {
    const panel = plotsPanelGroups({
      annotations: [],
      visibleClasses: [],
      setId: null,
      // The active selection is already a row; it is not added again.
      selection: {
        name: 'ROI 1',
        color: '#f0c84b',
        cellIds: ['a', 'b'],
        hitCellLimit: false,
      },
      savedSelections: saved,
      selectedGenes: ['Gad1'],
    })

    expect(panel.setId).toBe(SELECTIONS_SET_ID)
    expect(panel.setLabel).toBe('Selections')
    expect(panel.groups.map((group) => [group.label, group.color, group.kind])).toEqual([
      ['ROI 1', '#f0c84b', 'class'],
      ['ROI 2', '#4bc8f0', 'class'],
    ])
    expect(plotGroupsInput(panel.groups)).toEqual({
      selection: null,
      classes: [
        ['a', 'b'],
        ['b', 'c'],
      ],
    })
    expect(panel.groupNoun).toBe('selection')
    expect(panel.hiddenClassCount).toBe(1)
    expect(panel.limitedSelections).toEqual(['ROI 2'])
    expect(panel.selectionErrors).toEqual(['ROI 4: Range requests are not supported.'])
  })

  it('waits for every shown selection’s cells before grouping', () => {
    const panel = plotsPanelGroups({
      annotations: [],
      visibleClasses: [],
      setId: SELECTIONS_SET_ID,
      selection: null,
      savedSelections: [
        ...saved,
        {
          id: 's5',
          name: 'ROI 5',
          color: '#000000',
          visible: true,
          cells: { status: 'loading' },
        },
      ],
      selectedGenes: ['Gad1'],
    })

    expect(panel.pendingSelectionCount).toBe(1)
    expect(panel.groups).toEqual([])
  })
})

describe('Plot kinds (plan 22-D2, 22-D8)', () => {
  it('reads plot= and falls back to the dot plot', () => {
    expect(parsePlotKind('violin')).toBe('violin')
    expect(parsePlotKind('heatmap')).toBe('heatmap')
    expect(parsePlotKind('scatter')).toBe('dot')
    expect(parsePlotKind(undefined)).toBe('dot')
  })

  it('shows hundreds of classes in the heatmap, and violins with densities', () => {
    expect(plotKindInfo('heatmap').maxClasses).toBe(HEATMAP_MAX_CLASSES)
    // The violin's classes and the selection all get densities.
    expect(VIOLIN_MAX_CLASSES + 1).toBeLessThanOrEqual(PLOT_DENSITY_MAX_GROUPS)
    expect(plotKindInfo('violin').fileName).toBe('violin')
  })
})

describe('Plots read budget (plan 22-D7)', () => {
  const MiB = 1024 * 1024

  it('reads up to 32 MiB at once, asks up to 256 MiB, and refuses more', () => {
    expect(plotReadDecision(0, 0)).toBe('read')
    expect(plotReadDecision(PLOT_READ_PROMPT_BYTES, 0)).toBe('read')
    expect(plotReadDecision(PLOT_READ_PROMPT_BYTES + 1, 0)).toBe('ask')
    expect(plotReadDecision(PLOT_READ_MAX_BYTES, 0)).toBe('ask')
    expect(plotReadDecision(PLOT_READ_MAX_BYTES + 1, 0)).toBe('refuse')
  })

  it('does not ask again for a read no larger than one allowed', () => {
    expect(plotReadDecision(100 * MiB, 120 * MiB)).toBe('read')
    expect(plotReadDecision(130 * MiB, 120 * MiB)).toBe('ask')
    expect(plotReadDecision(300 * MiB, 300 * MiB)).toBe('refuse')
  })

  it('says sizes in binary units, and names up to two genes', () => {
    expect(formatReadSize(1000)).toBe('under 0.1 MiB')
    expect(formatReadSize(5.25 * MiB)).toBe('5.3 MiB')
    expect(formatReadSize(180 * MiB)).toBe('180 MiB')
    expect(formatReadSize(1536 * MiB)).toBe('1.5 GiB')
    expect(plotGenesPhrase(['Gad1'])).toBe('Gad1')
    expect(plotGenesPhrase(['Gad1', 'Sst'])).toBe('Gad1 and Sst')
    expect(plotGenesPhrase(['Gad1', 'Sst', 'Vip'])).toBe('3 genes')
  })
})
