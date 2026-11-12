import { describe, expect, it } from 'vitest'
import {
  TRANSCRIPT_GENE_LEGEND_ID,
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
      status: 'ready',
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

  it('says when expression is loading, or cannot be shown', () => {
    const genes = { ...input().genes, names: ['SNAP25'] }
    const sections = (status: ViewerLegendInput['genes']['status']) =>
      viewerLegendSections(
        input({ colorMode: 'gene-expression', genes: { ...genes, status } }),
      )

    expect(sections('loading')).toEqual([
      expect.objectContaining({ detail: 'Loading expression' }),
    ])
    expect(sections('unavailable')).toEqual([
      expect.objectContaining({ detail: 'Expression unavailable' }),
    ])
  })

  it('leaves out the cell colour while the cells are hidden', () => {
    const genes = { ...input().genes, scaleMax: 11, names: ['SNAP25'] }

    expect(
      viewerLegendSections(
        input({ cellsVisible: false, colorMode: 'gene-expression', genes }),
      ),
    ).toEqual([])
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
      noun: { singular: 'cell', plural: 'cells' },
    })
  })

  it('counts spots on Visium (15.5-E)', () => {
    const spot = { singular: 'spot', plural: 'spots' }
    const genes = { ...input().genes, scaleMax: 85, names: ['ACTB'] }
    const annotations = {
      setLabel: null,
      items: [{ id: 'a', label: 'Fibrosis', color: '#ff0000', count: 131 }],
      hiddenIds: new Set<string>(),
    }

    expect(
      viewerLegendSections(
        input({ cellNoun: spot, colorMode: 'gene-expression', genes }),
      ),
    ).toEqual([expect.objectContaining({ detail: 'Expression per spot' })])
    expect(
      viewerLegendSections(
        input({ cellNoun: spot, colorMode: 'annotations', annotations }),
      ),
    ).toEqual([expect.objectContaining({ noun: spot })])
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

  it('lists the transcript genes with their colours when points are coloured by gene', () => {
    expect(
      viewerLegendSections(
        input({
          transcripts: {
            density: null,
            pointColorMode: 'feature',
            genes: {
              items: [
                { gene: 'SNAP25', color: '#4cd3c2', visible: true, count: 12 },
                { gene: 'GFAP', color: '#f8c550', visible: false, count: 3 },
              ],
              moreCount: 4,
            },
          },
        }),
      ),
    ).toEqual([
      {
        kind: 'categories',
        id: TRANSCRIPT_GENE_LEGEND_ID,
        title: 'Transcripts',
        items: [
          { id: 'SNAP25', label: 'SNAP25', color: '#4cd3c2', count: 12, visible: true },
          { id: 'GFAP', label: 'GFAP', color: '#f8c550', count: 3, visible: false },
        ],
        noun: { singular: 'transcript', plural: 'transcripts' },
        moreCount: 4,
        moreWhere: 'Transcripts',
      },
    ])
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
