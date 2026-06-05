import { describe, expect, it } from 'vitest'
import {
  transcriptGroupsFromPoints,
  transcriptZarrTileKeysForViewport,
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
