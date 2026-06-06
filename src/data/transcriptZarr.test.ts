import { describe, expect, it } from 'vitest'
import {
  chooseTranscriptGridLevel,
  transcriptDensityLevelForBbox,
  transcriptGroupsFromPoints,
  transcriptZarrGridLevelBins,
  transcriptZarrTileKeysForViewport,
  type TranscriptGridLevelMetadata,
} from './transcriptZarr'
import { micrometers } from './coords'
import type { TranscriptPoint } from './transcriptOverlay'

describe('transcriptZarr', () => {
  it('selects level-zero transcript grid tiles intersecting a viewport', () => {
    const availableKeys = new Set(['0,5', '1,5', '2,5', '1,6'])

    expect(
      transcriptZarrTileKeysForViewport(
        {
          minX: micrometers(240),
          maxX: micrometers(510),
          minY: micrometers(1_260),
          maxY: micrometers(1_520),
        },
        250,
        availableKeys,
      ),
    ).toEqual(['0,5', '1,5', '2,5', '1,6'])
  })

  it('builds bounded feature and FOV summaries from rendered transcript points', () => {
    const points: readonly TranscriptPoint[] = [
      transcriptPoint('a', 'Actb', 'AA1', 30),
      transcriptPoint('b', 'Actb', 'AA1', 40),
      transcriptPoint('c', 'Gad1', 'AA2', 20),
    ]

    expect(transcriptGroupsFromPoints(points, 1)).toEqual([
      {
        featureName: 'Actb',
        fovName: 'AA1',
        count: 2,
        meanQv: 35,
      },
    ])
  })

  it('selects the finest aggregate grid level within the bin budget', () => {
    const levels: readonly TranscriptGridLevelMetadata[] = [
      gridLevel(0, 250, ['0,0', '1,0', '2,0', '3,0'], [10, 20, 30, 40]),
      gridLevel(1, 500, ['0,0', '1,0'], [60, 70]),
      gridLevel(2, 1_000, ['0,0'], [130]),
    ]

    expect(
      chooseTranscriptGridLevel(
        levels,
        {
          minX: micrometers(0),
          minY: micrometers(0),
          maxX: micrometers(1_000),
          maxY: micrometers(250),
        },
        2,
      ).level,
    ).toBe(1)
  })

  it('converts native grid counts into stable aggregate bins', () => {
    const bins = transcriptZarrGridLevelBins(
      gridLevel(1, 500, ['0,0', '1,0', '9,9'], [60, 70, 80]),
      {
        minX: micrometers(0),
        minY: micrometers(0),
        maxX: micrometers(900),
        maxY: micrometers(500),
      },
    )

    expect(bins).toEqual([
      expect.objectContaining({
        id: 'native-zarr-grid:1:0:0',
        source: 'native-zarr',
        binX: 0,
        binY: 0,
        count: 60,
        binSizeMicrometers: 500,
      }),
      expect.objectContaining({
        id: 'native-zarr-grid:1:1:0',
        source: 'native-zarr',
        binX: 1,
        binY: 0,
        count: 70,
        binSizeMicrometers: 500,
      }),
    ])
  })

  it('chooses coarser density bins for broad transcript viewports', () => {
    expect(
      transcriptDensityLevelForBbox(
        {
          minX: micrometers(0),
          minY: micrometers(0),
          maxX: micrometers(20_000),
          maxY: micrometers(20_000),
        },
        'density',
        700,
      ),
    ).toEqual({ level: 2, tileSizeMicrometers: 1_000 })
  })
})

function transcriptPoint(
  id: string,
  featureName: string,
  fovName: string,
  qv: number,
): TranscriptPoint {
  return {
    id,
    cellId: null,
    featureName,
    fovName,
    position: {
      x: micrometers(1),
      y: micrometers(2),
    },
    qv,
    isGene: true,
  }
}

function gridLevel(
  level: number,
  tileSizeMicrometers: number,
  gridKeys: readonly string[],
  transcriptCounts: readonly number[],
): TranscriptGridLevelMetadata {
  return {
    level,
    tileSizeMicrometers,
    gridKeys,
    transcriptCounts,
  }
}
