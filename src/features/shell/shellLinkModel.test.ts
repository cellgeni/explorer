import { describe, expect, it } from 'vitest'
import { formatShareableState, parseShareableState } from '../../data/shareableState'
import {
  DEFAULT_SHELL_PANELS,
  defaultExpandedSections,
  cardForLink,
  cardFromLink,
  hiddenLayersForLink,
  layerVisibilityFromLink,
  mapControlHudTab,
  panelsForLink,
  panelsFromLink,
  toolFromLink,
  withShellLink,
} from './shellLinkModel'

describe('version 1 tabs in the new shell', () => {
  it('maps each tab to a panel, tool or card', () => {
    expect(
      Object.fromEntries(
        [
          'dataset',
          'layers',
          'genes',
          'transcripts',
          'annotations',
          'roi',
          'cell',
          'magic-lens',
        ].map((tab) => [tab, mapControlHudTab(tab)]),
      ),
    ).toEqual({
      dataset: { panels: ['info'] },
      layers: { panels: ['image'] },
      genes: { panels: ['cells'] },
      transcripts: { panels: ['transcripts'] },
      annotations: { panels: ['cells'] },
      roi: { tool: 'box' },
      cell: { panels: ['cells', 'embedding'], card: 'cell' },
      'magic-lens': { tool: 'magic-lens' },
    })
    expect(mapControlHudTab('unknown')).toEqual({})
  })

  it('fills only what the link leaves out', () => {
    expect(withShellLink({ linkVersion: 2, activeTab: 'roi' })).toMatchObject({
      tool: 'box',
    })
    expect(
      withShellLink({ linkVersion: 2, activeTab: 'genes', panels: ['transcripts'] })
        .panels,
    ).toEqual(['transcripts'])
    expect(withShellLink({ linkVersion: 2, activeTab: 'dataset' }).panels).toEqual([
      'info',
    ])
  })

  it('opens nothing for a version 1 link left on the Dataset tab, which every one was', () => {
    expect(withShellLink({ activeTab: 'dataset' }).panels).toBeUndefined()
    expect(withShellLink({ linkVersion: 1 }).panels).toBeUndefined()
    expect(withShellLink({ activeTab: 'layers' }).panels).toEqual(['image'])
  })
})

describe('panels in the link', () => {
  it('reads exactly the sections, drawer and embedding a link names', () => {
    expect(panelsFromLink({})).toBe(DEFAULT_SHELL_PANELS)
    expect(panelsFromLink({ panels: ['image', 'info'] })).toEqual({
      expanded: ['image'],
      infoOpen: true,
      embeddingOpen: false,
    })
    // The drawer alone: every section closed (15.5-B).
    expect(panelsFromLink({ panels: ['info'] })).toEqual({
      expanded: [],
      infoOpen: true,
      embeddingOpen: false,
    })
    expect(panelsFromLink({ panels: [] }).expanded).toEqual([])
  })

  it('writes nothing at the default, and the default sections beside the drawer', () => {
    const cells = defaultExpandedSections(true)

    expect(cells).toEqual(['cells'])
    expect(defaultExpandedSections(false)).toEqual(['image'])
    expect(panelsForLink(DEFAULT_SHELL_PANELS, cells)).toBeUndefined()
    expect(
      panelsForLink({ expanded: null, infoOpen: true, embeddingOpen: false }, cells),
    ).toEqual(['cells', 'info'])
    expect(
      panelsForLink(
        { expanded: ['cells', 'transcripts'], infoOpen: false, embeddingOpen: true },
        cells,
      ),
    ).toEqual(['cells', 'transcripts', 'embedding'])
    expect(
      panelsForLink({ expanded: [], infoOpen: false, embeddingOpen: false }, cells),
    ).toEqual([])
  })

  it('round-trips through the link', () => {
    for (const panels of [
      { expanded: ['image' as const], infoOpen: true, embeddingOpen: false },
      { expanded: [], infoOpen: true, embeddingOpen: false },
    ]) {
      const hash = formatShareableState({
        panels: panelsForLink(panels, ['cells']) ?? [],
      })
      expect(panelsFromLink(parseShareableState(hash))).toEqual(panels)
    }
    expect(
      formatShareableState({
        panels:
          panelsForLink({ expanded: [], infoOpen: true, embeddingOpen: false }, [
            'cells',
          ]) ?? [],
      }),
    ).toBe('#xv=2&panel=info')
    expect(panelsFromLink(parseShareableState('#xv=2&panel='))).toEqual({
      expanded: [],
      infoOpen: false,
      embeddingOpen: false,
    })
  })
})

describe('tool, card and hidden layers in the link', () => {
  it('reads tool=, then a version 1 lens=1', () => {
    expect(toolFromLink({ tool: 'measure' })).toBe('measure')
    expect(toolFromLink({ tool: 'paint' })).toBe('pan')
    expect(toolFromLink({ magicLensActive: true })).toBe('magic-lens')
    expect(toolFromLink(parseShareableState('#tool=lasso'))).toBe('lasso')
  })

  it('restores a selected cell, bin or boundary', () => {
    expect(cardForLink({ cellId: 'cell-7' })).toBe('cell:cell-7')
    expect(cardForLink({ binId: 'BC-1', cellId: undefined })).toBe('bin:BC-1')
    expect(cardForLink({ boundaryId: 'seg-3', binId: 'BC-1' })).toBe('boundary:seg-3')
    expect(cardForLink({})).toBeUndefined()
    expect(cardFromLink(parseShareableState('#card=cell%3Acell-7'))).toEqual({
      kind: 'cell',
      id: 'cell-7',
    })
    // Ids may hold colons.
    expect(cardFromLink({ card: 'bin:s_016um:00012' })).toEqual({
      kind: 'bin',
      id: 's_016um:00012',
    })
    expect(cardFromLink({ card: 'boundary:seg-3' })?.kind).toBe('boundary')
    expect(cardFromLink({ card: 'cell' })).toBeNull()
    expect(cardFromLink({ card: 'cell:' })).toBeNull()
    expect(cardFromLink({ card: 'spot:1' })).toBeNull()
  })

  it('hides layers', () => {
    const visibility = layerVisibilityFromLink(parseShareableState('#hidden=cells,image'))

    expect(visibility).toEqual({ image: false, cells: false, annotations: true })
    expect(hiddenLayersForLink(visibility)).toEqual(['image', 'cells'])
    expect(formatShareableState({ hiddenLayers: [] })).toBe('#xv=2')
  })
})
