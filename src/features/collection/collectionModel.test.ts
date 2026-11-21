import { describe, expect, it } from 'vitest'
import {
  collectionEntryLabel,
  collectionFirstOpening,
  collectionPreviewSizeForLink,
  collectionPreviewSizeFromLink,
  collectionSwitchOpening,
  collectionViewForLink,
  collectionViewFromLink,
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

describe('collectionViewFromLink', () => {
  it('reads the grid and names only, and the row otherwise', () => {
    expect(collectionViewFromLink({ collectionView: 'grid' })).toBe('grid')
    expect(collectionViewFromLink({ collectionView: 'names' })).toBe('names')
    expect(collectionViewFromLink({ collectionView: 'carousel' })).toBe('row')
    expect(collectionViewFromLink({})).toBe('row')
  })

  it('leaves the row, the default, out of the link', () => {
    expect(collectionViewForLink('row')).toBeUndefined()
    expect(collectionViewForLink('grid')).toBe('grid')
    expect(collectionViewForLink('names')).toBe('names')
  })
})

describe('collectionPreviewSizeFromLink', () => {
  it("reads the grid's preview width within the slider's range", () => {
    expect(collectionPreviewSizeFromLink({ collectionPreviewSize: 320 })).toBe(320)
    expect(collectionPreviewSizeFromLink({ collectionPreviewSize: 20 })).toBe(100)
    expect(collectionPreviewSizeFromLink({ collectionPreviewSize: 5000 })).toBe(600)
    expect(collectionPreviewSizeFromLink({})).toBe(150)
  })

  it('leaves the default width out of the link', () => {
    expect(collectionPreviewSizeForLink(150)).toBeUndefined()
    expect(collectionPreviewSizeForLink(320)).toBe(320)
  })
})

describe('collectionFirstOpening', () => {
  it('restores the defaults as a version 2 link, with genes colouring cells', () => {
    expect(
      collectionFirstOpening({
        genes: ['Aqp4'],
        geneColorScale: 'magma',
        geneRange: [0, 25],
      }),
    ).toEqual({
      linkState: {
        linkVersion: 2,
        selectedGenes: ['Aqp4'],
        geneExpressionColorScale: 'magma',
        geneExpressionScaleRange: '0,25',
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

const NOTHING_LOADED = {
  annotationGroupId: null,
  hiddenAnnotationIds: [],
  hiddenAnnotationSetIds: [],
  annotationColors: {},
  cellMetadataTrackId: null,
} as const

describe('collectionSwitchOpening', () => {
  it('keeps the genes and how cells are coloured', () => {
    expect(
      collectionSwitchOpening({
        ...NOTHING_LOADED,
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

  it('keeps the annotation set, its hidden classes and colours, whether it is hidden, and the metadata column', () => {
    expect(
      collectionSwitchOpening({
        selectedGenes: [],
        observationColorMode: 'annotations',
        geneExpressionScoreMode: 'sum',
        annotationGroupId: 'analysis:coarse_celltype',
        hiddenAnnotationIds: ['analysis:coarse_celltype:astrocytes'],
        hiddenAnnotationSetIds: ['analysis:coarse_celltype'],
        annotationColors: { 'analysis:coarse_celltype:neurons': '#123456' },
        cellMetadataTrackId: 'h5ad:cell_area',
      }),
    ).toEqual({
      linkState: {
        linkVersion: 2,
        selectedGenes: [],
        observationColorMode: 'annotations',
        geneExpressionScoreMode: 'sum',
        annotationGroupIds: ['analysis:coarse_celltype'],
        hiddenAnnotationIds: ['analysis:coarse_celltype:astrocytes'],
        hiddenAnnotationSetIds: ['analysis:coarse_celltype'],
        cellMetadataTrackId: 'h5ad:cell_area',
      },
      annotationColors: { 'analysis:coarse_celltype:neurons': '#123456' },
      ignored: [],
    })
  })
})
