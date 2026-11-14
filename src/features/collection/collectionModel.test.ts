import { describe, expect, it } from 'vitest'
import {
  collectionEntryLabel,
  collectionFirstOpening,
  collectionSwitchOpening,
} from './collectionModel'

describe('collectionEntryLabel', () => {
  it('uses the name, or the last meaningful part of the path', () => {
    expect(
      collectionEntryLabel({
        path: 'a.zarr',
        url: 'https://x.test/a.zarr',
        name: 'Sham A',
      }),
    ).toBe('Sham A')
    expect(
      collectionEntryLabel({
        path: 'runs/sham-b/outs',
        url: 'https://x.test/runs/sham-b/outs',
      }),
    ).toBe('sham-b')
  })
})

describe('collectionFirstOpening', () => {
  it('restores the defaults as a version 2 link, with genes colouring cells', () => {
    expect(collectionFirstOpening({ genes: ['Aqp4'], geneColorScale: 'magma' })).toEqual({
      linkState: {
        linkVersion: 2,
        selectedGenes: ['Aqp4'],
        geneExpressionColorScale: 'magma',
        observationColorMode: 'gene-expression',
      },
      ignored: [],
    })
    expect(collectionFirstOpening(undefined)).toEqual({
      linkState: { linkVersion: 2 },
      ignored: [],
    })
  })

  it('drops values the controls do not have', () => {
    expect(collectionFirstOpening({ colorCellsBy: 'cluster' })).toEqual({
      linkState: { linkVersion: 2 },
      ignored: ['defaults.colorCellsBy "cluster" is not a known value'],
    })
  })
})

describe('collectionSwitchOpening', () => {
  it('keeps genes and colour modes that mean the same in every dataset', () => {
    expect(
      collectionSwitchOpening({
        selectedGenes: ['Aqp4', 'Gfap'],
        observationColorMode: 'gene-expression',
        geneExpressionScoreMode: 'mean',
      }).linkState,
    ).toEqual({
      linkVersion: 2,
      selectedGenes: ['Aqp4', 'Gfap'],
      observationColorMode: 'gene-expression',
      geneExpressionScoreMode: 'mean',
    })
  })

  it('leaves annotation colouring and an empty gene list to the next dataset', () => {
    expect(
      collectionSwitchOpening({
        selectedGenes: [],
        observationColorMode: 'annotations',
        geneExpressionScoreMode: 'sum',
      }).linkState,
    ).toEqual({ linkVersion: 2, selectedGenes: [], geneExpressionScoreMode: 'sum' })
  })
})
