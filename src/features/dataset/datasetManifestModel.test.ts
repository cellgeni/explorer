import { describe, expect, it } from 'vitest'
import type { MorphologyImageChannel } from '../../data/morphologyImage'
import {
  manifestDefaultsNotShared,
  manifestDefaultsToShareableState,
  resolveMorphologyChannelSelection,
} from './datasetManifestModel'

describe('manifestDefaultsToShareableState', () => {
  it('maps manifest defaults onto share-URL fields', () => {
    expect(
      manifestDefaultsToShareableState({
        genes: ['EPCAM'],
        colorCellsBy: 'annotations',
        geneColorScale: 'viridis',
        geneScoreMode: 'mean',
        cellBoundaries: false,
        nucleusBoundaries: true,
        channels: ['DAPI'],
        imageOpacity: 0.5,
        cellFillOpacity: 0.25,
        cellBoundaryOpacity: 0.75,
        transcripts: true,
      }),
    ).toEqual({
      state: {
        selectedGenes: ['EPCAM'],
        observationColorMode: 'annotations',
        geneExpressionColorScale: 'viridis',
        geneExpressionScoreMode: 'mean',
        showCellBoundaries: false,
        showNucleusBoundaries: true,
        morphologyEnabledChannelIds: ['DAPI'],
        imageOpacity: 0.5,
        cellFillOpacity: 0.25,
        cellBoundaryOpacity: 0.75,
        transcriptOverlay: true,
      },
      ignored: [],
    })
  })

  it('drops values the controls do not offer', () => {
    expect(
      manifestDefaultsToShareableState({
        colorCellsBy: 'cluster',
        geneScoreMode: 'median',
        cellBoundaries: true,
      }),
    ).toEqual({
      state: { showCellBoundaries: true },
      ignored: [
        'defaults.colorCellsBy "cluster" is not a known value',
        'defaults.geneScoreMode "median" is not a known value',
      ],
    })
    expect(manifestDefaultsToShareableState(undefined)).toEqual({
      state: {},
      ignored: [],
    })
  })

  it('keeps only the defaults a shared link leaves unset', () => {
    expect(
      manifestDefaultsNotShared(
        { selectedGenes: ['EPCAM'], imageOpacity: 0.5 },
        { datasetUrl: 'https://example.test/x', selectedGenes: ['ACTB'] },
      ),
    ).toEqual({ imageOpacity: 0.5 })
    expect(manifestDefaultsNotShared({ imageOpacity: 0.5 }, null)).toEqual({
      imageOpacity: 0.5,
    })
  })
})

describe('resolveMorphologyChannelSelection', () => {
  const channels = [
    channel('Channel:0:0', 'DAPI'),
    channel('Channel:0:1', 'ATP1A1/CD45/E-Cadherin'),
    channel('Channel:0:2', '18S'),
  ]

  it('matches channel IDs and case-insensitive names', () => {
    expect(
      resolveMorphologyChannelSelection(channels, ['dapi', 'Channel:0:2'], undefined),
    ).toEqual(['Channel:0:0', 'Channel:0:2'])
  })

  it('falls back when nothing matches but keeps an explicit empty selection', () => {
    expect(resolveMorphologyChannelSelection(channels, ['GFP'], ['Channel:0:0'])).toEqual(
      ['Channel:0:0'],
    )
    expect(resolveMorphologyChannelSelection(channels, [], ['Channel:0:0'])).toEqual([])
  })
})

function channel(id: string, name: string): MorphologyImageChannel {
  return {
    info: { id, index: 0, name, color: [255, 255, 255], contrast: { min: 0, max: 1 } },
    loader: {} as MorphologyImageChannel['loader'],
  }
}
