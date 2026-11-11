import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { micrometers } from '../../data/coords'
import type { TranscriptPoint } from '../../data/transcriptOverlay'
import type { TranscriptPointColorMode } from '../../rendering/deckLayers'
import { TRANSCRIPT_GENE_PALETTE } from './transcriptGeneLegendModel'
import type { TranscriptLayerState } from './transcriptLayerModel'
import { useTranscriptGeneLegend } from './useTranscriptGeneLegend'

function point(featureName: string, index: number): TranscriptPoint {
  return {
    id: `${featureName}-${index}`,
    featureName,
    position: { x: micrometers(index), y: micrometers(index) },
    qv: 30,
    fovName: 'fov',
    cellId: null,
  } as unknown as TranscriptPoint
}

const READY: TranscriptLayerState = {
  status: 'ready',
  points: [point('GFAP', 1), point('GFAP', 2), point('SNAP25', 3)],
} as unknown as TranscriptLayerState

function useHarness(
  colorMode: TranscriptPointColorMode,
  layerState = READY,
  selectedGenes: readonly string[] = ['SNAP25', 'GFAP'],
) {
  const [colors, setColors] = useState<Readonly<Record<string, string>>>({})
  const [hidden, setHidden] = useState<readonly string[]>([])
  return useTranscriptGeneLegend({
    appendDebugEvent: vi.fn(),
    colorMode,
    colors,
    filterMode: 'selected',
    hiddenGenes: hidden,
    layerState,
    overlayShown: true,
    selectedGenes,
    setColors,
    setHiddenGenes: setHidden,
  })
}

describe('useTranscriptGeneLegend', () => {
  it('lists the selected genes with counts while points are coloured by gene', () => {
    const { result } = renderHook(() => useHarness('feature'))

    expect(result.current.model.active).toBe(true)
    expect(result.current.model.items).toEqual([
      { gene: 'SNAP25', color: TRANSCRIPT_GENE_PALETTE[0], visible: true, count: 1 },
      { gene: 'GFAP', color: TRANSCRIPT_GENE_PALETTE[1], visible: true, count: 2 },
    ])
    expect(result.current.legend?.items).toHaveLength(2)
    expect(result.current.featureColor('GFAP')).toEqual([248, 197, 80, 235])
  })

  it('hides a gene, recolours it and shows them all again', () => {
    const { result } = renderHook(() => useHarness('feature'))

    act(() => {
      result.current.model.onVisibilityChange('GFAP', false)
      result.current.model.onColorChange('GFAP', '#ff0000')
    })

    expect(result.current.hiddenGenes.has('GFAP')).toBe(true)
    expect(result.current.model.hiddenCount).toBe(1)
    expect(result.current.model.items[1]).toMatchObject({
      color: '#ff0000',
      visible: false,
    })
    expect(result.current.featureColor('GFAP')).toEqual([255, 0, 0, 235])

    act(() => {
      result.current.model.onShowAll()
    })
    expect(result.current.hiddenGenes.size).toBe(0)
  })

  it('says why there is no list for quality colours or density', () => {
    const quality = renderHook(() => useHarness('quality'))
    expect(quality.result.current.model.active).toBe(false)
    expect(quality.result.current.model.note).toMatch(/coloured by quality/)
    expect(quality.result.current.legend).toBeNull()

    const density = renderHook(() =>
      useHarness('feature', { status: 'idle' } as TranscriptLayerState),
    )
    expect(density.result.current.model.note).toBe(
      'Gene colours show when transcripts are drawn as points.',
    )
  })

  it('keeps each selected gene’s colour when another is added', () => {
    let genes: readonly string[] = ['GFAP', 'SNAP25']
    const { result, rerender } = renderHook(() => useHarness('feature', READY, genes))
    const before = result.current.model.items.map((item) => [item.gene, item.color])

    genes = ['AQP4', 'GFAP', 'SNAP25']
    rerender()

    const after = new Map(
      result.current.model.items.map((item) => [item.gene, item.color]),
    )
    for (const [gene, color] of before) expect(after.get(gene ?? '')).toBe(color)
    expect(after.get('AQP4')).toBe(TRANSCRIPT_GENE_PALETTE[2])
  })

  it('shows every point under QV colours, and hides them again by gene', () => {
    let colorMode: TranscriptPointColorMode = 'feature'
    const { result, rerender } = renderHook(() => useHarness(colorMode))

    act(() => {
      result.current.model.onVisibilityChange('SNAP25', false)
    })
    expect(result.current.hiddenGenes.has('SNAP25')).toBe(true)

    colorMode = 'quality'
    rerender()
    expect(result.current.hiddenGenes.size).toBe(0)

    colorMode = 'feature'
    rerender()
    expect(result.current.hiddenGenes.has('SNAP25')).toBe(true)
  })
})
