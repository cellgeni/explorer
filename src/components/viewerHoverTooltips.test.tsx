import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { TranscriptAggregateDatum } from '../rendering/deckLayers'
import {
  transcriptAggregateCountRows,
  transcriptAggregateTitle,
} from './viewerHoverModel'
import {
  CellBoundaryHoverTooltip,
  GridCellHoverTooltip,
  OverviewCellHoverTooltip,
  TranscriptHoverTooltip,
} from './viewerHoverTooltips'
import type {
  ViewerCellBoundaryHoverDetail,
  ViewerGridCellHoverDetail,
  ViewerOverviewCellHoverDetail,
} from './viewerCoreTypes'

const square: TranscriptAggregateDatum = {
  id: 'native-zarr-density:2:1:1',
  position: [60, -60, 0],
  source: 'native-zarr',
  glyphType: 'density',
  level: 2,
  binX: 1,
  binY: 1,
  count: 12,
  radiusMicrometers: 16,
  binSizeMicrometers: 40,
  fillColor: [255, 0, 0, 255],
}

describe('transcript density hover', () => {
  it('says what a square counts', () => {
    expect(transcriptAggregateTitle(square)).toBe('All transcripts')
    expect(transcriptAggregateTitle({ ...square, source: 'cell-summary' })).toBe(
      'Transcripts in cells',
    )
    expect(
      transcriptAggregateTitle({
        ...square,
        selectedGeneCount: 12,
        topFeatures: [{ featureName: 'SNAP25', count: 12 }],
      }),
    ).toBe('SNAP25 transcripts')
    expect(
      transcriptAggregateTitle({
        ...square,
        selectedGeneCount: 12,
        topFeatures: [
          { featureName: 'SNAP25', count: 9 },
          { featureName: 'AQP4', count: 3 },
        ],
      }),
    ).toBe('Selected-gene transcripts')
  })

  it('lists each selected gene when a square counts several', () => {
    render(
      <TranscriptHoverTooltip
        detail={{
          aggregate: {
            ...square,
            selectedGeneCount: 12,
            topFeatures: [
              { featureName: 'SNAP25', count: 9 },
              { featureName: 'AQP4', count: 3 },
            ],
          },
          screen: { x: 10, y: 10 },
        }}
      />,
    )

    const rows = [...document.querySelectorAll('.transcript-hover-tooltip dl > div')].map(
      (row) => row.textContent,
    )
    expect(screen.getByText('Selected-gene transcripts')).toBeInTheDocument()
    expect(rows.slice(0, 3)).toEqual(['Count12', 'SNAP259', 'AQP43'])
  })

  it('marks a coarse grid level count as sampled', () => {
    // The demo's level 7 keeps 5,292,443 of 554,699,029 transcripts.
    render(
      <TranscriptHoverTooltip
        detail={{
          aggregate: { ...square, level: 7, sampledShare: 5_292_443 / 554_699_029 },
          screen: { x: 10, y: 10 },
        }}
      />,
    )

    const rows = [...document.querySelectorAll('.transcript-hover-tooltip dl > div')].map(
      (row) => row.textContent,
    )
    expect(rows.slice(0, 3)).toEqual([
      'Sampled count12',
      'Sample0.95% of transcripts',
      'Level7',
    ])
    expect(
      transcriptAggregateCountRows({ ...square, level: 1, sampledShare: 0.764 }),
    ).toContainEqual({ label: 'Sample', value: '76% of transcripts' })
  })
})

describe('cell boundary hover', () => {
  it('names the source of the cell under the outline', () => {
    const boundary = {
      id: '2717',
      polygon: [
        [0, 0],
        [2, 0],
        [2, 2],
      ],
      fillColor: [0, 0, 0, 0],
      lineColor: [0, 0, 0, 0],
    } as unknown as ViewerCellBoundaryHoverDetail['boundary']
    const cell = {
      id: '2717',
      position: [2397.2, 1126.1, 0],
    } as unknown as NonNullable<ViewerCellBoundaryHoverDetail['cell']>
    const screenPoint = { x: 10, y: 10 } as ViewerCellBoundaryHoverDetail['screen']
    const { rerender } = render(
      <CellBoundaryHoverTooltip detail={{ boundary, cell, screen: screenPoint }} />,
    )

    expect(screen.getByText('Xenium')).toBeInTheDocument()
    rerender(
      <CellBoundaryHoverTooltip
        detail={{ boundary, cell, screen: screenPoint }}
        sourceLabel="H5AD"
      />,
    )
    expect(screen.getByText('H5AD')).toBeInTheDocument()
    rerender(
      <CellBoundaryHoverTooltip
        detail={{ boundary, screen: screenPoint }}
        sourceLabel="H5AD"
      />,
    )
    expect(screen.getByText('Segmented')).toBeInTheDocument()
  })
})

// A SpatialData dataset whose units are unknown shows "units" on the scale
// bar and axes, so its tooltips say units too (EXP-052).
describe('hover units', () => {
  const screenPoint = { x: 10, y: 10 } as ViewerCellBoundaryHoverDetail['screen']
  const rows = () =>
    [...document.querySelectorAll('.transcript-hover-tooltip dl > div')].map(
      (row) => row.textContent,
    )

  it('writes positions and areas in µm by default', () => {
    const cell = {
      id: 'cell-1',
      position: [12, -34, 0],
      cellArea: 56,
    } as unknown as ViewerOverviewCellHoverDetail['cell']
    render(<OverviewCellHoverTooltip detail={{ cell, screen: screenPoint }} />)

    expect(rows()).toContain('X/Y12, 34 µm')
    expect(rows()).toContain('Area56 µm²')
  })

  it("writes them in the viewer's unit", () => {
    const cell = {
      id: 'cell-1',
      position: [12, -34, 0],
      cellArea: 56,
    } as unknown as ViewerOverviewCellHoverDetail['cell']
    const boundary = {
      id: 'cell-1',
      polygon: [
        [0, 0],
        [2, 0],
        [2, 2],
      ],
    } as unknown as ViewerCellBoundaryHoverDetail['boundary']
    const bin = {
      id: 'bin-1',
      row: 1,
      col: 2,
      binSizeMicrometers: 8,
    } as unknown as ViewerGridCellHoverDetail['cell']
    const { unmount } = render(
      <>
        <OverviewCellHoverTooltip
          detail={{ cell, screen: screenPoint }}
          unitLabel="units"
        />
        <CellBoundaryHoverTooltip
          detail={{ boundary, cell, screen: screenPoint }}
          unitLabel="units"
        />
        <GridCellHoverTooltip
          detail={{ cell: bin, screen: screenPoint }}
          unitLabel="units"
        />
        <TranscriptHoverTooltip
          detail={{
            transcript: {
              id: 'tx-1',
              position: [5, -6, 0],
              featureName: 'Actb',
              fovName: null,
              cellId: null,
              qv: 30,
              fillColor: [0, 0, 0],
              zLocation: 7,
              nucleusDistance: 1.5,
            },
            screen: screenPoint,
          }}
          unitLabel="units"
        />
        <TranscriptHoverTooltip
          detail={{ aggregate: square, screen: screenPoint }}
          unitLabel="units"
        />
      </>,
    )

    expect(rows()).toEqual(
      expect.arrayContaining([
        'X/Y12, 34 units',
        'Area56 units²',
        'Cell Area56 units²',
        'Area2 units²',
        'Bin8 units',
        'X/Y5, 6 units',
        'Z7 units',
        'Distance1.5 units',
        'X/Y60, 60 units',
      ]),
    )
    expect(rows().join(' ')).not.toContain('µm')
    unmount()
  })
})
