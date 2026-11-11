import { describe, expect, it } from 'vitest'
import { formatShareableState, parseShareableState } from '../../data/shareableState'
import {
  DEFAULT_SHELL_PANELS,
  cardForLink,
  cellIdFromLink,
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
      cell: { panels: ['embedding'], card: 'cell' },
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
  it('reads sections, the drawer and the embedding, keeping the default where none are named', () => {
    expect(panelsFromLink({})).toBe(DEFAULT_SHELL_PANELS)
    expect(panelsFromLink({ panels: ['image', 'info'] })).toEqual({
      expanded: ['image'],
      infoOpen: true,
      embeddingOpen: false,
    })
    expect(panelsFromLink({ panels: ['embedding'] }).expanded).toBeNull()
    expect(panelsFromLink({ panels: [] }).expanded).toEqual([])
  })

  it('writes nothing at the default and every open panel otherwise', () => {
    expect(panelsForLink(DEFAULT_SHELL_PANELS)).toBeUndefined()
    expect(
      panelsForLink({
        expanded: ['cells', 'transcripts'],
        infoOpen: false,
        embeddingOpen: true,
      }),
    ).toEqual(['cells', 'transcripts', 'embedding'])
    expect(
      panelsForLink({ expanded: [], infoOpen: false, embeddingOpen: false }),
    ).toEqual([])
  })

  it('round-trips through the link', () => {
    const panels = { expanded: ['image' as const], infoOpen: true, embeddingOpen: false }
    const hash = formatShareableState({ panels: panelsForLink(panels) ?? [] })

    expect(hash).toBe('#xv=2&panel=image%2Cinfo')
    expect(panelsFromLink(parseShareableState(hash))).toEqual(panels)
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

  it('restores a selected cell', () => {
    expect(cardForLink('cell-7')).toBe('cell:cell-7')
    expect(cardForLink(null)).toBeUndefined()
    expect(cellIdFromLink(parseShareableState('#card=cell%3Acell-7'))).toBe('cell-7')
    expect(cellIdFromLink({ card: 'cell' })).toBeNull()
  })

  it('hides layers', () => {
    const visibility = layerVisibilityFromLink(parseShareableState('#hidden=cells,image'))

    expect(visibility).toEqual({ image: false, cells: false, annotations: true })
    expect(hiddenLayersForLink(visibility)).toEqual(['image', 'cells'])
    expect(formatShareableState({ hiddenLayers: [] })).toBe('#xv=2')
  })
})
