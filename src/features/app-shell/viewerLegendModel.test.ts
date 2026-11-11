import { describe, expect, it } from 'vitest'
import {
  geneListLabel,
  transcriptDensityDetail,
  viewerLegendSections,
  type ViewerLegendInput,
} from './viewerLegendModel'

function input(overrides: Partial<ViewerLegendInput> = {}): ViewerLegendInput {
  return {
    colorMode: 'transcript-count',
    genes: {
      names: [],
      scoreMode: 'sum',
      colorScale: 'plasma',
      scaleMax: 0,
      loading: false,
    },
    annotations: null,
    metadataTrack: null,
    cellAreaMax: null,
    transcripts: { density: null, pointColorMode: null },
    ...overrides,
  }
}

describe('viewerLegendSections', () => {
  it('shows nothing for the plain transcript count view', () => {
    expect(viewerLegendSections(input())).toEqual([])
  })

  it('names the genes and how they combine', () => {
    const genes = { ...input().genes, scaleMax: 11, names: ['SNAP25'] }
    expect(viewerLegendSections(input({ colorMode: 'gene-expression', genes }))).toEqual([
      expect.objectContaining({
        kind: 'continuous',
        title: 'SNAP25',
        detail: 'Expression per cell',
        min: '0',
        max: '11',
      }),
    ])

    const [combined] = viewerLegendSections(
      input({
        colorMode: 'gene-expression',
        genes: { ...genes, names: ['A', 'B', 'C', 'D'], scoreMode: 'mean' },
      }),
    )
    expect(combined).toMatchObject({
      title: 'A, B, C +1',
      detail: 'Mean of 4 genes per cell',
    })
  })

  it('lists categories without the set prefix and with their visibility', () => {
    const [section] = viewerLegendSections(
      input({
        colorMode: 'annotations',
        annotations: {
          setLabel: 'graphclust',
          items: [
            { id: 'a', label: 'graphclust: Cluster 1', color: '#ff0000', count: 10 },
            { id: 'b', label: 'graphclust: Cluster 2', color: '#00ff00', count: 5 },
          ],
          hiddenIds: new Set(['b']),
        },
      }),
    )

    expect(section).toEqual({
      kind: 'categories',
      id: 'cells',
      title: 'graphclust',
      items: [
        { id: 'a', label: 'Cluster 1', color: '#ff0000', count: 10, visible: true },
        { id: 'b', label: 'Cluster 2', color: '#00ff00', count: 5, visible: false },
      ],
    })
  })

  it('shows metadata and area ranges, and transcript density after the cells', () => {
    const sections = viewerLegendSections(
      input({
        colorMode: 'metadata',
        metadataTrack: { label: 'pseudotime', min: 0.1, max: 0.9 },
        transcripts: {
          density: {
            colorScale: 'thermal',
            labels: ['0', '12', '24'],
            content: {
              source: 'native-zarr',
              featureNames: ['SNAP25'],
              binSizeMicrometers: 40,
            },
          },
          pointColorMode: null,
        },
      }),
    )

    expect(sections.map((section) => section.title)).toEqual([
      'pseudotime',
      'Transcript density',
    ])
    expect(sections[0]).toMatchObject({ min: '0.1', max: '0.9' })
    expect(sections[1]).toMatchObject({
      min: '0',
      max: '24',
      detail: 'SNAP25 transcripts per 40 µm bin',
    })
    expect(
      viewerLegendSections(input({ colorMode: 'cell-area', cellAreaMax: 412.5 }))[0],
    ).toMatchObject({ title: 'Cell area', max: '412.5' })
  })

  it('shows a quality scale for points coloured by QV', () => {
    expect(
      viewerLegendSections(
        input({ transcripts: { density: null, pointColorMode: 'quality' } }),
      ),
    ).toEqual([expect.objectContaining({ title: 'Transcript quality (QV)', max: '40+' })])
  })

  it('says what the transcript density counts and per what size of bin', () => {
    const content = { source: 'native-zarr', binSizeMicrometers: 40 } as const

    expect(transcriptDensityDetail({ ...content, featureNames: [] })).toBe(
      'All transcripts per 40 µm bin',
    )
    expect(
      transcriptDensityDetail({ ...content, featureNames: ['SNAP25', 'AQP4'] }),
    ).toBe('SNAP25 and AQP4 transcripts per 40 µm bin')
    expect(
      transcriptDensityDetail({ ...content, featureNames: ['A', 'B', 'C', 'D'] }),
    ).toBe('Transcripts of 4 selected genes per 40 µm bin')
    expect(
      transcriptDensityDetail({
        source: 'cell-summary',
        featureNames: [],
        binSizeMicrometers: 412.3,
      }),
    ).toBe('Transcripts in cells per 412 µm bin')
    expect(
      transcriptDensityDetail({
        source: 'native-zarr',
        featureNames: [],
        binSizeMicrometers: undefined,
      }),
    ).toBe('All transcripts per bin')
  })

  it('shortens long gene lists', () => {
    expect(geneListLabel(['A'])).toBe('A')
    expect(geneListLabel(['A', 'B', 'C'])).toBe('A, B, C')
    expect(geneListLabel(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C +2')
  })

  it('puts a category list after the scales', () => {
    const sections = viewerLegendSections(
      input({
        colorMode: 'annotations',
        annotations: {
          setLabel: null,
          items: [{ id: 'a', label: 'T cells', color: '#ff0000', count: 3 }],
          hiddenIds: new Set(),
        },
        transcripts: {
          density: {
            colorScale: 'thermal',
            labels: ['0', '1', '2'],
            content: { source: 'native-zarr', featureNames: [], binSizeMicrometers: 160 },
          },
          pointColorMode: null,
        },
      }),
    )

    expect(sections.map((section) => section.title)).toEqual([
      'Transcript density',
      'Annotations',
    ])
  })
})
