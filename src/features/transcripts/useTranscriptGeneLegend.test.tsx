import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { micrometers } from '../../data/coords'
import type {
  TranscriptAggregateBin,
  TranscriptPoint,
} from '../../data/transcriptOverlay'
import type {
  TranscriptDensityColorScale,
  TranscriptPointColorMode,
} from '../../rendering/deckLayers'
import {
  OTHER_TRANSCRIPT_GENES_COLOR,
  OTHER_TRANSCRIPT_GENES_ID,
  TRANSCRIPT_GENE_PALETTE,
} from './transcriptGeneLegendModel'
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

function group(featureName: string, count: number) {
  return { featureName, count, position: { x: micrometers(5), y: micrometers(5) } }
}

const DENSITY: TranscriptLayerState = {
  status: 'aggregate',
  bins: [
    { featureGroups: [group('GFAP', 4), group('SNAP25', 1)] },
    { featureGroups: [group('SNAP25', 2)] },
  ] as unknown as readonly TranscriptAggregateBin[],
} as unknown as TranscriptLayerState

const ASTROCYTES = {
  id: 'gene-set:astrocytes',
  name: 'Astrocytes',
  genes: ['GFAP', 'AQP4'],
}
const NO_SETS: readonly (typeof ASTROCYTES)[] = []

function useHarness(
  colorMode: TranscriptPointColorMode,
  layerState = READY,
  selectedGenes: readonly string[] = ['SNAP25', 'GFAP'],
  densityColorScale: TranscriptDensityColorScale = 'thermal',
  geneSets = NO_SETS,
) {
  const [colors, setColors] = useState<Readonly<Record<string, string>>>({})
  const [setColorsById, setSetColors] = useState<Readonly<Record<string, string>>>({})
  const [hidden, setHidden] = useState<readonly string[]>([])
  const [hiddenSets, setHiddenSets] = useState<readonly string[]>([])
  return useTranscriptGeneLegend({
    appendDebugEvent: vi.fn(),
    colorMode,
    colors,
    densityColorScale,
    filterMode: 'selected',
    geneSets,
    geneSetColors: setColorsById,
    hiddenGenes: hidden,
    hiddenGeneSets: hiddenSets,
    layerState,
    overlayShown: true,
    selectedGenes,
    setColors,
    setGeneSetColors: setSetColors,
    setHiddenGenes: setHidden,
    setHiddenGeneSets: setHiddenSets,
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
      'Gene colours show when transcripts are drawn as points, or as density with Density color set to Gene markers.',
    )
    expect(
      renderHook(() => useHarness('feature', DENSITY)).result.current.model.active,
    ).toBe(false)
  })

  it('lists the genes of gene markers, with their transcripts in the squares', () => {
    const { result } = renderHook(() =>
      useHarness('quality', DENSITY, ['SNAP25', 'GFAP'], 'gene'),
    )

    expect(result.current.markersShown).toBe(true)
    expect(result.current.model.note).toBeNull()
    expect(result.current.legend?.items).toEqual([
      { gene: 'SNAP25', color: TRANSCRIPT_GENE_PALETTE[0], visible: true, count: 3 },
      { gene: 'GFAP', color: TRANSCRIPT_GENE_PALETTE[1], visible: true, count: 4 },
    ])

    // QV point colours do not stop gene markers hiding genes.
    act(() => {
      result.current.model.onVisibilityChange('GFAP', false)
    })
    expect(result.current.hiddenGenes.has('GFAP')).toBe(true)
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

  it('colours by gene set, with Other genes for genes in no set', () => {
    const { result } = renderHook(() =>
      useHarness('gene-set', READY, ['SNAP25', 'GFAP'], 'thermal', [ASTROCYTES]),
    )

    expect(result.current.model.bySet).toBe(true)
    expect(result.current.model.note).toBeNull()
    expect(result.current.model.items).toEqual([
      {
        gene: 'Astrocytes',
        color: TRANSCRIPT_GENE_PALETTE[0],
        visible: true,
        count: 2,
        geneSet: { id: ASTROCYTES.id, geneCount: 2 },
      },
      {
        gene: 'Other genes',
        color: OTHER_TRANSCRIPT_GENES_COLOR,
        visible: true,
        count: 1,
        geneSet: { id: OTHER_TRANSCRIPT_GENES_ID, geneCount: 0 },
      },
    ])
    expect(result.current.legend?.bySet).toBe(true)
    expect(result.current.featureColor('GFAP')).toEqual([76, 211, 194, 235])
    expect(result.current.featureColor('SNAP25')).toEqual([156, 163, 175, 235])
    expect(result.current.featureGroup?.('AQP4')).toMatchObject({ label: 'Astrocytes' })
  })

  it('hides and recolours a gene set by its ID', () => {
    const { result } = renderHook(() =>
      useHarness('gene-set', READY, ['SNAP25', 'GFAP'], 'thermal', [ASTROCYTES]),
    )

    act(() => {
      result.current.model.onVisibilityChange(ASTROCYTES.id, false)
      result.current.model.onColorChange(ASTROCYTES.id, '#ff0000')
    })

    expect([...result.current.hiddenGenes]).toEqual(['GFAP'])
    expect(result.current.model.hiddenCount).toBe(1)
    expect(result.current.model.items[0]).toMatchObject({
      color: '#ff0000',
      visible: false,
    })
    expect(result.current.featureColor('GFAP')).toEqual([255, 0, 0, 235])

    act(() => {
      result.current.model.onVisibilityChange(OTHER_TRANSCRIPT_GENES_ID, false)
    })
    expect([...result.current.hiddenGenes].sort()).toEqual(['GFAP', 'SNAP25'])

    act(() => {
      result.current.model.onShowAll()
    })
    expect(result.current.hiddenGenes.size).toBe(0)
  })

  it('merges gene markers by gene set and counts the sets’ transcripts', () => {
    const { result } = renderHook(() =>
      useHarness('gene-set', DENSITY, ['SNAP25', 'GFAP'], 'gene', [ASTROCYTES]),
    )

    expect(result.current.markersShown).toBe(true)
    expect(result.current.featureGroup).toBeDefined()
    expect(result.current.legend?.items.map((item) => [item.gene, item.count])).toEqual([
      ['Astrocytes', 4],
      ['Other genes', 3],
    ])
  })

  it('says how to save a set when there are none', () => {
    const { result } = renderHook(() => useHarness('gene-set'))

    expect(result.current.model.active).toBe(true)
    expect(result.current.model.note).toMatch(/No gene sets are saved/)
    expect(result.current.model.items.map((item) => item.gene)).toEqual(['Other genes'])
  })

  it('leaves gene markers per gene unless coloured by gene set', () => {
    const { result } = renderHook(() =>
      useHarness('feature', DENSITY, ['SNAP25', 'GFAP'], 'gene', [ASTROCYTES]),
    )

    expect(result.current.featureGroup).toBeUndefined()
    expect(result.current.legend?.bySet).toBeUndefined()
  })
})
