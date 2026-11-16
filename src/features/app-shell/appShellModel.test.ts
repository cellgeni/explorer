import { describe, expect, it } from 'vitest'
import {
  isObservationColorMode,
  manifestObservationColorMode,
  parseObservationColorMode,
  parseViewerCoordinateUnit,
  readDebugModeFromLocation,
  readShareableStateFromLocation,
  sharedObservationColorMode,
} from './appShellModel'

describe('appShellModel', () => {
  it('parses known controls and rejects unknown values', () => {
    expect(parseViewerCoordinateUnit('um')).toBe('um')
    expect(parseViewerCoordinateUnit('px')).toBe('px')
    expect(parseViewerCoordinateUnit('meters')).toBeUndefined()
    expect(isObservationColorMode('annotations')).toBe(true)
    expect(isObservationColorMode('metadata')).toBe(true)
    expect(parseObservationColorMode('cell-area')).toBe('cell-area')
    expect(parseObservationColorMode('quality')).toBeUndefined()
  })

  it('reads shareable state from both search and hash with hash taking precedence', () => {
    window.history.pushState(
      null,
      '',
      '/?dataset=https%3A%2F%2Fquery.example&genes=Actb,Gad1#dataset=https%3A%2F%2Fhash.example&tab=genes&coord=px',
    )

    expect(readShareableStateFromLocation()).toMatchObject({
      datasetUrl: 'https://hash.example',
      selectedGenes: ['Actb', 'Gad1'],
      activeTab: 'genes',
      coordinateUnit: 'px',
    })
  })

  it('reads a version 2 hash as the whole link', () => {
    // A link copied before the query string's values were dropped: the
    // compare panel was closed, so the hash leaves it out.
    window.history.pushState(
      null,
      '',
      '/?dataset=https%3A%2F%2Fexample.test%2Fa&compare=https%3A%2F%2Fexample.test%2Fb&genes=Actb#xv=2&collection=https%3A%2F%2Fexample.test%2Fc.json&dataset=https%3A%2F%2Fexample.test%2Fa',
    )

    const state = readShareableStateFromLocation()
    expect(state).toMatchObject({
      linkVersion: 2,
      collectionUrl: 'https://example.test/c.json',
      datasetUrl: 'https://example.test/a',
    })
    expect(state.compareUrls).toBeUndefined()
    expect(state.selectedGenes).toBeUndefined()
  })

  it('reads the gene expression colour mode', () => {
    expect(isObservationColorMode('gene-expression')).toBe(true)
    expect(parseObservationColorMode('gene-expression')).toBe('gene-expression')
  })

  it('opens links with genes in gene expression, as they looked before the mode', () => {
    expect(
      sharedObservationColorMode({
        observationColorMode: 'annotations',
        selectedGenes: ['SNAP25'],
      }),
    ).toBe('gene-expression')
    expect(
      sharedObservationColorMode({
        observationColorMode: 'annotations',
        selectedGenes: [],
      }),
    ).toBe('annotations')
    expect(sharedObservationColorMode({ observationColorMode: 'nope' })).toBeUndefined()
    // Version 2 links name the mode whenever it is not the default.
    expect(
      sharedObservationColorMode({
        linkVersion: 2,
        observationColorMode: 'annotations',
        selectedGenes: ['SNAP25'],
      }),
    ).toBe('annotations')
    expect(
      sharedObservationColorMode({ linkVersion: 2, selectedGenes: ['SNAP25'] }),
    ).toBeUndefined()
  })

  it('lets a manifest colour by another mode while it selects genes', () => {
    expect(
      manifestObservationColorMode({
        observationColorMode: 'annotations',
        selectedGenes: ['SNAP25'],
      }),
    ).toBe('annotations')
    expect(manifestObservationColorMode({ selectedGenes: ['SNAP25'] })).toBe(
      'gene-expression',
    )
    expect(manifestObservationColorMode({})).toBeUndefined()
  })

  it('turns on debug mode from ?debug=1 or #debug=1', () => {
    const original = window.location.href

    try {
      window.history.replaceState(null, '', '/?debug=1')
      expect(readDebugModeFromLocation()).toBe(true)
      window.history.replaceState(null, '', '/#genes=SNAP25&debug=1')
      expect(readDebugModeFromLocation()).toBe(true)
      window.history.replaceState(null, '', '/?debug=0')
      expect(readDebugModeFromLocation()).toBe(false)
    } finally {
      window.history.replaceState(null, '', original)
    }
  })
})
