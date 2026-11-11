import { describe, expect, it } from 'vitest'
import {
  isObservationColorMode,
  manifestObservationColorMode,
  parseControlHudTab,
  parseObservationColorMode,
  parseViewerCoordinateUnit,
  readDebugModeFromLocation,
  readShellVersionFromLocation,
  readShareableStateFromLocation,
  sharedObservationColorMode,
} from './appShellModel'

describe('appShellModel', () => {
  it('parses known controls and rejects unknown values', () => {
    expect(parseControlHudTab('genes')).toBe('genes')
    expect(parseControlHudTab('missing')).toBeUndefined()
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

  it('shows the new shell only with shell=2', () => {
    const original = window.location.href

    try {
      window.history.replaceState(null, '', '/?shell=2')
      expect(readShellVersionFromLocation()).toBe(2)
      window.history.replaceState(null, '', '/#dataset=x&shell=2')
      expect(readShellVersionFromLocation()).toBe(2)
      window.history.replaceState(null, '', '/?shell=3')
      expect(readShellVersionFromLocation()).toBe(1)
      window.history.replaceState(null, '', '/')
      expect(readShellVersionFromLocation()).toBe(1)
    } finally {
      window.history.replaceState(null, '', original)
    }
  })
})
