import { render } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it } from 'vitest'
import { asCellId } from '../../data/cellid'
import { micrometers } from '../../data/coords'
import type { GeneExpressionBatch } from '../../datasets/xeniumDataset'
import type { OverviewCellDatum } from '../../rendering/deckLayers'
import { useViewerLayerData } from './useViewerLayerData'

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
})
