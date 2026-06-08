import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { asCellId } from '../../data/cellid'
import { micrometers } from '../../data/coords'
import { RoiHudPanel } from './RoiHudPanel'

const bbox = {
  minX: micrometers(0),
  minY: micrometers(0),
  maxX: micrometers(10),
  maxY: micrometers(10),
}

describe('RoiHudPanel', () => {
  it('renders ROI summary and forwards drawing/export actions', () => {
    const onRoiModeChange = vi.fn()
    const onClearRoi = vi.fn()
    const onRoiNameChange = vi.fn()
    const onSaveRoiAnnotation = vi.fn()
    const onExportRoiCells = vi.fn()
    const onExportRoiTranscripts = vi.fn()

    render(
      <RoiHudPanel
        active
        roiNameInputId="roi-name"
        roiHeaderCopy="1 cell"
        isLoading={false}
        canDrawRoi
        roiMode="idle"
        roiName="ROI 1"
        loadEnabled
        roiState={{
          status: 'ready',
          url: 'https://example.test/output',
          bbox,
          selection: { kind: 'box', bbox },
          cells: [
            {
              id: asCellId('aaaaaaaa-1'),
              position: { x: micrometers(1), y: micrometers(2) },
            },
          ],
          hitCellLimit: false,
        }}
        roiSummary={{ cellCount: 1, meanTranscriptCount: 12, meanCellArea: 40 }}
        roiGeneStatsCopy="Genes: top 1"
        roiGeneStatsState={{
          status: 'ready',
          url: 'https://example.test/output',
          stats: {
            genes: [
              {
                gene: 'Actb',
                count: 4,
                detectedCells: 1,
                percentCells: 100,
                meanPerCell: 4,
                percentTotal: 100,
              },
            ],
            cellCount: 1,
            sampledCellCount: 1,
            totalCount: 4,
            hitCellLimit: false,
          },
        }}
        roiTranscriptExportState={{ status: 'idle' }}
        onRoiModeChange={onRoiModeChange}
        onClearRoi={onClearRoi}
        onRoiNameChange={onRoiNameChange}
        onSaveRoiAnnotation={onSaveRoiAnnotation}
        onExportRoiCells={onExportRoiCells}
        onExportRoiTranscripts={onExportRoiTranscripts}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Draw Box' }))
    fireEvent.click(screen.getByRole('button', { name: 'Draw Lasso' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    fireEvent.change(screen.getByLabelText('ROI name'), {
      target: { value: 'Marker ROI' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save ROI' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export Cells' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export Transcripts' }))

    expect(screen.getByLabelText('ROI summary')).toHaveTextContent('12')
    expect(onRoiModeChange).toHaveBeenNthCalledWith(1, 'box')
    expect(onRoiModeChange).toHaveBeenNthCalledWith(2, 'lasso')
    expect(onClearRoi).toHaveBeenCalledTimes(1)
    expect(onRoiNameChange).toHaveBeenCalledWith('Marker ROI')
    expect(onSaveRoiAnnotation).toHaveBeenCalledTimes(1)
    expect(onExportRoiCells).toHaveBeenCalledTimes(1)
    expect(onExportRoiTranscripts).toHaveBeenCalledTimes(1)
  })
})
