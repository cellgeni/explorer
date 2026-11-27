import { describe, expect, it } from 'vitest'
import type { MorphologyImageChannel } from '../../data/morphologyImage'
import type { DatasetManifest } from '../../datasets/datasetManifest'
import {
  datasetManifestAbout,
  manifestDefaultsNotShared,
  manifestDefaultsToShareableState,
  imageDatasetChannelIds,
  resolveMorphologyChannelSelection,
} from './datasetManifestModel'

describe('manifestDefaultsToShareableState', () => {
  it('maps manifest defaults onto share-URL fields', () => {
    expect(
      manifestDefaultsToShareableState({
        genes: ['EPCAM'],
        colorCellsBy: 'annotations',
        geneColorScale: 'viridis',
        geneRange: [-1.5, null],
        geneScoreMode: 'mean',
        cellBoundaries: false,
        nucleusBoundaries: true,
        channels: ['DAPI'],
        imageOpacity: 0.5,
        cellFillOpacity: 0.25,
        cellBoundaryOpacity: 0.75,
        cellPointScale: 10,
        transcripts: true,
        imageView: '3d',
        cellView: '3d',
      }),
    ).toEqual({
      state: {
        selectedGenes: ['EPCAM'],
        observationColorMode: 'annotations',
        geneExpressionColorScale: 'viridis',
        // As a link writes it: `geneRange=-1.5,`.
        geneExpressionScaleRange: '-1.5,',
        geneExpressionScoreMode: 'mean',
        showCellBoundaries: false,
        showNucleusBoundaries: true,
        morphologyEnabledChannelIds: ['DAPI'],
        imageOpacity: 0.5,
        cellFillOpacity: 0.25,
        cellBoundaryOpacity: 0.75,
        // Snapped to the nearest slider step.
        cellPointScale: 12,
        transcriptOverlay: true,
        imageView: '3d',
        cellView: '3d',
      },
      ignored: [],
    })
  })

  it('maps a percentile top as a link writes it', () => {
    expect(manifestDefaultsToShareableState({ geneRange: [null, 'p95'] }).state).toEqual({
      geneExpressionScaleRange: ',p95',
    })
    expect(manifestDefaultsToShareableState({ geneRange: [0, 'p99.5'] }).state).toEqual({
      geneExpressionScaleRange: '0,p99.5',
    })
  })

  it('opens in gene expression when genes come without colorCellsBy', () => {
    expect(manifestDefaultsToShareableState({ genes: ['COL1A1'] }).state).toEqual({
      selectedGenes: ['COL1A1'],
      observationColorMode: 'gene-expression',
    })
    expect(manifestDefaultsToShareableState({ genes: [] }).state).toEqual({
      selectedGenes: [],
    })
  })

  it('drops values the controls do not offer', () => {
    expect(
      manifestDefaultsToShareableState({
        colorCellsBy: 'cluster',
        geneScoreMode: 'median',
        imageView: '4d',
        cellView: 'volume',
        cellBoundaries: true,
      }),
    ).toEqual({
      state: { showCellBoundaries: true },
      ignored: [
        'defaults.colorCellsBy "cluster" is not a known value',
        'defaults.geneScoreMode "median" is not a known value',
        'defaults.imageView "4d" is not a known value',
        'defaults.cellView "volume" is not a known value',
      ],
    })
    expect(manifestDefaultsToShareableState(undefined)).toEqual({
      state: {},
      ignored: [],
    })
  })

  it('lists custom image layers as a link does, opacities only when one is not 1', () => {
    const image = (url: string, opacity?: number) => ({
      path: url,
      url,
      ...(opacity === undefined ? {} : { opacity }),
    })

    expect(
      manifestDefaultsToShareableState({
        customImages: [
          image('https://example.test/HE.ome.tif'),
          image('https://example.test/if.zarr', 0.6),
        ],
      }),
    ).toEqual({
      state: {
        customImageUrls: [
          'https://example.test/HE.ome.tif',
          'https://example.test/if.zarr',
        ],
        customImageOpacities: [1, 0.6],
      },
      ignored: [],
    })
    expect(
      manifestDefaultsToShareableState({
        customImages: [image('https://example.test/he.ome.tif', 1)],
      }).state,
    ).toEqual({ customImageUrls: ['https://example.test/he.ome.tif'] })
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

describe('imageDatasetChannelIds', () => {
  const eight = Array.from({ length: 8 }, (_, index) =>
    channel(`Channel:0:${index}`, `Marker ${index}`),
  )

  it('opens the first six channels when nothing lists any, link or not', () => {
    expect(imageDatasetChannelIds(eight, undefined)).toEqual(
      eight.slice(0, 6).map((entry) => entry.info.id),
    )
  })

  it('opens the channels a link lists, and none for an empty list', () => {
    expect(imageDatasetChannelIds(eight, ['Channel:0:7'])).toEqual(['Channel:0:7'])
    expect(imageDatasetChannelIds(eight, [])).toEqual([])
  })
})

function channel(id: string, name: string): MorphologyImageChannel {
  return {
    info: { id, index: 0, name, color: [255, 255, 255], contrast: { min: 0, max: 1 } },
    loader: {} as MorphologyImageChannel['loader'],
  }
}

describe('datasetManifestAbout', () => {
  const manifest = {
    url: 'https://example.test/run/explorer.json',
    rootUrl: 'https://example.test/run',
    platform: 'xenium',
    files: {},
  } satisfies DatasetManifest

  it('returns nothing without a manifest or anything to show', () => {
    expect(datasetManifestAbout(undefined)).toBeNull()
    expect(datasetManifestAbout(manifest)).toBeNull()
    expect(datasetManifestAbout({ ...manifest, source: {} })).toBeNull()
  })

  it('keeps the name, description, and source', () => {
    expect(
      datasetManifestAbout({
        ...manifest,
        name: 'Run 1',
        source: { repository: 'BioImage Archive', license: 'CC0' },
      }),
    ).toEqual({
      name: 'Run 1',
      source: { repository: 'BioImage Archive', license: 'CC0' },
    })
    expect(datasetManifestAbout({ ...manifest, description: 'Skin' })).toEqual({
      description: 'Skin',
    })
  })
})
