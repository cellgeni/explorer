import { describe, expect, it } from 'vitest'
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
  plotNonFiniteNotes,
  plotReadDecision,
  datasetSetOptionId,
  plotDatasetSets,
  plotSetOptions,
  plotsPanelGroups,
  resolvePlotSetId,
  SELECTIONS_SET_ID,
  type PlotDatasetSet,
  type PlotSavedSelection,
  type PlotSetSources,
} from './plotsPanelModel'
import type { Annotation } from '../../data/annotation'

const annotations: readonly Annotation<string>[] = [
  { id: 'roi:1:roi-1', label: 'ROI 1', cellIds: ['a'] },
  { id: 'analysis:cluster:a', label: 'cluster: A', cellIds: ['a', 'b'] },
  { id: 'analysis:cluster:b', label: 'cluster: B', cellIds: ['c'] },
  { id: 'analysis:cluster:c', label: 'cluster: C', cellIds: ['d'] },
  { id: 'custom:labels-csv:type:t', label: 'type: T', cellIds: ['a'] },
]
function sources(overrides: Partial<PlotSetSources> = {}): PlotSetSources {
  return {
    annotations,
    savedSelectionCount: 0,
    datasetSets: [],
    datasetSet: null,
    ...overrides,
  }
}

const styles = annotations.map((annotation, index) => ({
  ...annotation,
  color: `#00000${index}`,
}))

describe('Plots panel groups (plan 22-D1 to 22-D3)', () => {
  it('lists sets as the Clusters lists group them, defaulting to the dataset’s', () => {
    expect(plotSetOptions(sources())).toEqual([
      {
        id: 'loaded-annotations',
        label: 'Loaded annotations',
        classCount: 1,
        kind: 'loaded',
      },
      { id: 'analysis:cluster', label: 'cluster', classCount: 3, kind: 'loaded' },
      { id: 'custom:labels-csv:type', label: 'type', classCount: 1, kind: 'loaded' },
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
    const four = sources({ savedSelectionCount: 4 })
    expect(plotSetOptions(four).at(-1)).toEqual({
      id: SELECTIONS_SET_ID,
      label: 'Selections',
      classCount: 4,
      kind: 'selections',
    })
    expect(plotSetOptions(sources({ annotations: [] }))).toEqual([])
    expect(resolvePlotSetId({ ...four, annotations: [] }, null)).toBe(SELECTIONS_SET_ID)
    expect(resolvePlotSetId(four, null)).toBe('analysis:cluster')
    expect(resolvePlotSetId(four, SELECTIONS_SET_ID)).toBe(SELECTIONS_SET_ID)
    // Deleting the last selection falls back to the dataset's set.
    expect(resolvePlotSetId(sources(), SELECTIONS_SET_ID)).toBe('analysis:cluster')
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

describe('Group by › a set Clusters has not loaded', () => {
  const groups = [
    { id: 'obs:leiden', label: 'leiden', groupingName: 'leiden', groupCount: 3 },
    { id: 'obs:sample', label: 'sample', groupingName: 'sample', groupCount: 2 },
  ]
  const datasetSets: readonly PlotDatasetSet[] = plotDatasetSets(groups, undefined)
  const leiden: readonly Annotation<string>[] = [
    {
      id: 'analysis:leiden:0',
      label: 'leiden: 0',
      cellIds: ['a', 'b'],
      color: '#1f77b4',
    },
    { id: 'analysis:leiden:1', label: 'leiden: 1', cellIds: ['c'] },
    { id: 'analysis:leiden:2', label: 'leiden: 2', cellIds: ['d'] },
  ]

  it('lists the dataset’s sets Clusters has not loaded', () => {
    expect(datasetSets).toEqual([
      { groupId: 'obs:leiden', label: 'leiden', classCount: 3 },
      { groupId: 'obs:sample', label: 'sample', classCount: 2 },
    ])
    expect(plotDatasetSets(groups, 'obs:leiden').map((set) => set.groupId)).toEqual([
      'obs:sample',
    ])
    expect(plotDatasetSets(groups, 'all')).toEqual([])
    expect(
      plotSetOptions(sources({ datasetSets, savedSelectionCount: 1 })).map(
        (option) => option.kind,
      ),
    ).toEqual(['loaded', 'loaded', 'loaded', 'dataset', 'dataset', 'selections'])
  })

  it('defaults to graphclust, else the first set that groups the cells', () => {
    expect(resolvePlotSetId(sources({ annotations: [], datasetSets }), null)).toBe(
      datasetSetOptionId('obs:leiden'),
    )
    // One class compares nothing; thousands are cell IDs.
    expect(
      resolvePlotSetId(
        sources({
          annotations: [],
          datasetSets: [
            { groupId: 'obs:donor', label: 'donor', classCount: 1 },
            { groupId: 'obs:barcode', label: 'barcode', classCount: 4992 },
            ...datasetSets,
          ],
        }),
        null,
      ),
    ).toBe(datasetSetOptionId('obs:leiden'))
    expect(
      resolvePlotSetId(
        sources({
          annotations: [],
          datasetSets: [
            ...datasetSets,
            { groupId: 'graphclust', label: 'graphclust', classCount: 9 },
          ],
        }),
        null,
      ),
    ).toBe(datasetSetOptionId('graphclust'))
  })

  it('waits for the classes, then plots every one in its stored or palette colour', () => {
    const input = {
      annotations: [],
      visibleClasses: [],
      setId: datasetSetOptionId('obs:leiden'),
      selection: { name: 'ROI 1', color: '#f0c84b', cellIds: ['a'], hitCellLimit: false },
      datasetSets,
      selectedGenes: ['Gad1'],
      maxClasses: 2,
    }
    const pending = plotsPanelGroups({
      ...input,
      datasetSet: { groupId: 'obs:leiden', status: 'loading' },
    })

    expect(pending.pendingDatasetSet).toBe(true)
    expect(pending.groups.filter((group) => group.kind === 'class')).toEqual([])

    const ready = plotsPanelGroups({
      ...input,
      datasetSet: {
        groupId: 'obs:leiden',
        status: 'ready',
        annotations: leiden,
        colors: { 'analysis:leiden:0': '#1f77b4', 'analysis:leiden:1': '#ff7f0e' },
      },
    })

    expect(ready.setLabel).toBe('leiden')
    expect(ready.setKind).toBe('dataset')
    expect(ready.groups.map((group) => [group.label, group.color, group.kind])).toEqual([
      ['ROI 1', '#f0c84b', 'selection'],
      ['0', '#1f77b4', 'class'],
      ['1', '#ff7f0e', 'class'],
    ])
    expect(ready.omittedClassCount).toBe(1)
    expect(ready.hiddenClassCount).toBe(0)

    const failed = plotsPanelGroups({
      ...input,
      datasetSet: { groupId: 'obs:leiden', status: 'error', message: 'Not found.' },
    })
    expect(failed.datasetSetError).toBe('Not found.')
  })

  it('follows the set once Clusters loads it', () => {
    const datasetSet = {
      groupId: 'obs:leiden',
      status: 'ready' as const,
      annotations: leiden,
      colors: {},
    }

    expect(
      resolvePlotSetId(
        sources({
          annotations: [...annotations, ...leiden],
          datasetSets: plotDatasetSets(groups, 'obs:leiden'),
          datasetSet,
        }),
        datasetSetOptionId('obs:leiden'),
      ),
    ).toBe('analysis:leiden')
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

describe('plotNonFiniteNotes', () => {
  it('names each gene with stored NaN or infinite values', () => {
    expect(
      plotNonFiniteNotes(
        [
          { gene: 'Actb', nonFinite: 0 },
          { gene: 'N', nonFinite: 1 },
          { gene: 'M', nonFinite: 1200 },
        ],
        'cells',
      ),
    ).toEqual([
      "1 non-finite value skipped in N: its cell is left out of N's numbers.",
      "1,200 non-finite values skipped in M: their cells are left out of M's numbers.",
    ])
  })
})
