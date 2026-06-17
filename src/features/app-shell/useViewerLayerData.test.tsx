import { render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it } from 'vitest'
import { asCellId } from '../../data/cellid'
import { micrometers } from '../../data/coords'
import type { SpatialElement } from '../../datasets/spatialDataset'
import type { GeneExpressionBatch } from '../../datasets/xeniumDataset'
import type { GridCellDatum, OverviewCellDatum } from '../../rendering/deckLayers'
import { useViewerLayerData } from './useViewerLayerData'
import type { MorphologyImageChannel } from '../../data/morphologyImage'
import type { MorphologyChannelSetting } from '../morphology/morphologyChannels'
import type { TiffPyramidLoader } from '../../tiff/loader'

const overviewCells: readonly OverviewCellDatum[] = [
  {
    id: 'aaaaaaaa-1',
    position: [5, -5, 0],
    radiusPixels: 1,
    fillColor: [0, 0, 0],
    transcriptCount: 4,
  },
]

const expressionBatch: GeneExpressionBatch = {
  cells: [
    {
      id: asCellId('aaaaaaaa-1'),
      position: { x: micrometers(5), y: micrometers(5) },
      count: 3,
    },
  ],
  genes: ['Actb'],
  maxCount: 3,
}

type Result = ReturnType<typeof useViewerLayerData>
let result: Result

function Probe({ onReady }: { readonly onReady: (nextResult: Result) => void }) {
  const nextResult = useViewerLayerData({
    annotationColors: {},
    annotationState: {
      status: 'ready',
      url: 'https://example.test/output',
      annotations: [{ id: 'a', label: 'Astrocytes', cellIds: [asCellId('aaaaaaaa-1')] }],
    },
    cellMetadataTrack: null,
    boundaryElements: [],
    currentViewportBbox: {
      minX: micrometers(0),
      minY: micrometers(0),
      maxX: micrometers(10),
      maxY: micrometers(10),
    },
    geneExpressionBatch: expressionBatch,
    geneExpressionColorScale: 'plasma',
    geneExpressionScaleDatasetUrl: 'https://example.test/output',
    geneExpressionScaleDomain: { key: '', max: 0 },
    geneExpressionScoreMode: 'sum',
    morphologyChannelSettings: [],
    morphologyChannels: [],
    morphologyImage: null,
    observationColorMode: 'annotations',
    overviewCells,
    selectedGenes: ['Actb'],
    transcriptDensityColorScale: 'thermal',
    transcriptLayerState: { status: 'idle' },
    transcriptPointColorMode: 'feature',
  })

  React.useEffect(() => {
    onReady(nextResult)
  })

  return null
}

describe('useViewerLayerData', () => {
  it('derives annotation, expression, extent, and transcript view data', () => {
    render(
      <Probe
        onReady={(nextResult) => {
          result = nextResult
        }}
      />,
    )

    expect(result.activeAnnotationStyleColors).toHaveLength(1)
    expect(result.viewerObservationColorMode).toBe('annotations')
    expect(result.styledGeneExpressionCells).toHaveLength(1)
    expect(result.geneExpressionScaleMax).toBeGreaterThan(0)
    expect(result.overviewExtent).not.toBeNull()
    expect(result.visibleTranscriptEstimate).toBe(4)
  })

  it('activates metadata coloring when a selected metadata track exists', () => {
    function MetadataProbe({
      onReady,
    }: {
      readonly onReady: (nextResult: Result) => void
    }) {
      const nextResult = useViewerLayerData({
        annotationColors: {},
        annotationState: { status: 'idle' },
        cellMetadataTrack: {
          id: 'metadata:confidence',
          values: [{ cellId: asCellId('aaaaaaaa-1'), value: 0.5 }],
          min: 0,
          max: 1,
        },
        boundaryElements: [],
        currentViewportBbox: null,
        geneExpressionBatch: null,
        geneExpressionColorScale: 'plasma',
        geneExpressionScaleDatasetUrl: 'https://example.test/output',
        geneExpressionScaleDomain: { key: '', max: 0 },
        geneExpressionScoreMode: 'sum',
        morphologyChannelSettings: [],
        morphologyChannels: [],
        morphologyImage: null,
        observationColorMode: 'metadata',
        overviewCells,
        selectedGenes: [],
        transcriptDensityColorScale: 'thermal',
        transcriptLayerState: { status: 'idle' },
        transcriptPointColorMode: 'feature',
      })

      React.useEffect(() => {
        onReady(nextResult)
      })

      return null
    }

    render(
      <MetadataProbe
        onReady={(nextResult) => {
          result = nextResult
        }}
      />,
    )

    expect(result.viewerObservationColorMode).toBe('metadata')
    expect(result.activeCellMetadataTrack?.id).toBe('metadata:confidence')
  })

  it('derives extent from Visium HD grid cells when overview cells are absent', () => {
    const gridCells: readonly GridCellDatum[] = [
      {
        id: 'BC-1',
        gridId: 'grid-16um',
        row: 0,
        col: 0,
        polygon: [
          [10, -20, 0],
          [26, -20, 0],
          [26, -36, 0],
          [10, -36, 0],
        ],
        fillColor: [34, 120, 108, 28],
        lineColor: [22, 90, 82, 150],
      },
    ]

    function GridProbe({ onReady }: { readonly onReady: (nextResult: Result) => void }) {
      const nextResult = useViewerLayerData({
        annotationColors: {},
        annotationState: { status: 'idle' },
        cellMetadataTrack: null,
        boundaryElements: [],
        currentViewportBbox: null,
        geneExpressionBatch: null,
        geneExpressionColorScale: 'plasma',
        geneExpressionScaleDatasetUrl: 'https://example.test/visium',
        geneExpressionScaleDomain: { key: '', max: 0 },
        geneExpressionScoreMode: 'sum',
        gridCells,
        morphologyChannelSettings: [],
        morphologyChannels: [],
        morphologyImage: null,
        observationColorMode: 'annotations',
        overviewCells: [],
        selectedGenes: [],
        transcriptDensityColorScale: 'thermal',
        transcriptLayerState: { status: 'idle' },
        transcriptPointColorMode: 'feature',
      })

      React.useEffect(() => {
        onReady(nextResult)
      })

      return null
    }

    render(
      <GridProbe
        onReady={(nextResult) => {
          result = nextResult
        }}
      />,
    )

    expect(result.overviewExtent).toEqual({
      minX: micrometers(10),
      maxX: micrometers(26),
      minY: micrometers(20),
      maxY: micrometers(36),
    })
  })

  it('preserves annotated nucleus boundary styling in layer data', () => {
    const nucleusBoundaryElements: readonly SpatialElement[] = [
      {
        id: 'nucleus-7',
        geometry: {
          kind: 'polygon',
          rings: [
            [
              { x: micrometers(0), y: micrometers(0) },
              { x: micrometers(4), y: micrometers(0) },
              { x: micrometers(4), y: micrometers(4) },
              { x: micrometers(0), y: micrometers(0) },
            ],
          ],
        },
        metadata: {
          segmentation: {
            kind: 'nucleus',
            annotation: {
              label: 'Nucleus Cluster 4',
              fillColor: '#248f8f',
              lineColor: '#ff8800',
            },
          },
        },
      },
    ]

    function NucleusProbe({
      onReady,
    }: {
      readonly onReady: (nextResult: Result) => void
    }) {
      const nextResult = useViewerLayerData({
        annotationColors: {},
        annotationState: { status: 'idle' },
        cellMetadataTrack: null,
        boundaryElements: [],
        currentViewportBbox: null,
        geneExpressionBatch: null,
        geneExpressionColorScale: 'plasma',
        geneExpressionScaleDatasetUrl: 'https://example.test/output',
        geneExpressionScaleDomain: { key: '', max: 0 },
        geneExpressionScoreMode: 'sum',
        morphologyChannelSettings: [],
        morphologyChannels: [],
        morphologyImage: null,
        nucleusBoundaryElements,
        observationColorMode: 'annotations',
        overviewCells,
        selectedGenes: [],
        transcriptDensityColorScale: 'thermal',
        transcriptLayerState: { status: 'idle' },
        transcriptPointColorMode: 'feature',
      })

      React.useEffect(() => {
        onReady(nextResult)
      })

      return null
    }

    render(
      <NucleusProbe
        onReady={(nextResult) => {
          result = nextResult
        }}
      />,
    )

    expect(result.nucleusBoundaryLayerData).toEqual([
      expect.objectContaining({
        id: 'nucleus-7',
        annotationLabel: 'Nucleus Cluster 4',
        fillColor: [36, 143, 143, 82],
        lineColor: [255, 136, 0, 210],
      }),
    ])
  })

  it('passes morphology channel alpha rendering metadata to the canvas model', () => {
    const loader = {} as TiffPyramidLoader
    const morphologyChannels: readonly MorphologyImageChannel[] = [
      {
        info: {
          id: 'custom-layer:1:Channel:0:0',
          index: 0,
          name: 'rgb.ome.tif / Red',
          color: [255, 0, 0],
          contrast: { min: 0, max: 255 },
          alphaFromIntensity: false,
        },
        loader,
      },
    ]
    const morphologyChannelSettings: readonly MorphologyChannelSetting[] = [
      {
        id: 'custom-layer:1:Channel:0:0',
        enabled: true,
        color: [255, 0, 0],
        contrastMin: 0,
        contrastMax: 255,
      },
    ]

    function MorphologyProbe({
      onReady,
    }: {
      readonly onReady: (nextResult: Result) => void
    }) {
      const nextResult = useViewerLayerData({
        annotationColors: {},
        annotationState: { status: 'idle' },
        cellMetadataTrack: null,
        boundaryElements: [],
        currentViewportBbox: null,
        geneExpressionBatch: null,
        geneExpressionColorScale: 'plasma',
        geneExpressionScaleDatasetUrl: 'https://example.test/output',
        geneExpressionScaleDomain: { key: '', max: 0 },
        geneExpressionScoreMode: 'sum',
        morphologyChannelSettings,
        morphologyChannelOpacities: new Map([['custom-layer:1:Channel:0:0', 0.35]]),
        morphologyChannels,
        morphologyImage: null,
        observationColorMode: 'annotations',
        overviewCells,
        selectedGenes: [],
        transcriptDensityColorScale: 'thermal',
        transcriptLayerState: { status: 'idle' },
        transcriptPointColorMode: 'feature',
      })

      React.useEffect(() => {
        onReady(nextResult)
      })

      return null
    }

    render(
      <MorphologyProbe
        onReady={(nextResult) => {
          result = nextResult
        }}
      />,
    )

    expect(result.morphologyCanvasChannels[0]).toMatchObject({
      id: 'custom-layer:1:Channel:0:0',
      enabled: true,
      opacity: 0.35,
      alphaFromIntensity: false,
    })
  })
})
