import { describe, expect, it } from 'vitest'
import {
  isObservationColorMode,
  parseControlHudTab,
  parseObservationColorMode,
  parseViewerCoordinateUnit,
  readShareableStateFromLocation,
} from './appShellModel'

describe('appShellModel', () => {
  it('parses known controls and rejects unknown values', () => {
    expect(parseControlHudTab('genes')).toBe('genes')
    expect(parseControlHudTab('missing')).toBeUndefined()
    expect(parseViewerCoordinateUnit('um')).toBe('um')
    expect(parseViewerCoordinateUnit('px')).toBe('px')
    expect(parseViewerCoordinateUnit('meters')).toBeUndefined()
    expect(isObservationColorMode('annotations')).toBe(true)
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
})
