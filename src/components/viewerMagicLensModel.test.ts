import { describe, expect, it } from 'vitest'
import type { OverviewViewState } from '../rendering/deckLayers'
import type { ViewerMagicLensSummary } from './viewerCoreTypes'
import { magicLensOverlayModel } from './viewerMagicLensModel'

const VIEWPORT = { width: 800, height: 600 }

function viewState(zoom: number): OverviewViewState {
  return { target: [0, 0, 0], zoom, minZoom: -8, maxZoom: 8 }
}

function summary(geneCount: number): ViewerMagicLensSummary {
  return {
    transcriptCount: 1200,
    cellCount: 40,
    geneCount,
    selectedGeneTranscriptCount: 12,
    topGenes: Array.from({ length: geneCount }, (_, index) => ({
      gene: `Gene${index}`,
      count: 100 - index,
      selected: index === 0,
    })),
    hitLimit: false,
  }
}

describe('magicLensOverlayModel', () => {
  it('centres the circle on the pointer and puts the HUD to its right', () => {
    // Zoom 0: 1 px per µm. Three genes: 46 + 3 * 22 = 112 px tall.
    const model = magicLensOverlayModel(
      { x: 200, y: 300 },
      50,
      viewState(0),
      VIEWPORT,
      'ready',
      summary(3),
    )

    expect(model.circleStyle).toEqual({ left: 200, top: 300, width: 100, height: 100 })
    expect(model.hudStyle).toEqual({ left: 260, top: 244, width: 190 })
  })

  it('scales the radius with zoom and keeps it at least 10 px', () => {
    const zoomedIn = magicLensOverlayModel(
      { x: 100, y: 300 },
      50,
      viewState(2),
      VIEWPORT,
      'ready',
      summary(1),
    )
    const tiny = magicLensOverlayModel(
      { x: 100, y: 300 },
      1,
      viewState(-1),
      VIEWPORT,
      'ready',
      summary(1),
    )

    expect(zoomedIn.circleStyle.width).toBe(400)
    expect(tiny.circleStyle).toMatchObject({ width: 20, height: 20 })
    expect(tiny.hudStyle.left).toBe(100 + 10 + 10)
  })

  it('moves the HUD to the left of the circle near the right edge', () => {
    const model = magicLensOverlayModel(
      { x: 700, y: 300 },
      50,
      viewState(0),
      VIEWPORT,
      'ready',
      summary(3),
    )

    expect(model.hudStyle.left).toBe(700 - 50 - 10 - 190)
  })

  it('keeps the HUD 8 px inside a viewport too narrow for either side', () => {
    const model = magicLensOverlayModel(
      { x: 150, y: 300 },
      100,
      viewState(0),
      { width: 300, height: 600 },
      'ready',
      summary(3),
    )

    expect(model.hudStyle.left).toBe(8)
  })

  it('sizes the HUD for the loading message, the gene rows, or one row', () => {
    const top = (
      status: 'loading' | 'ready',
      lensSummary: ViewerMagicLensSummary | null,
    ) =>
      magicLensOverlayModel(
        { x: 100, y: 300 },
        20,
        viewState(0),
        VIEWPORT,
        status,
        lensSummary,
      ).hudStyle.top

    // The HUD is centred on the pointer, so its top is y - height / 2.
    expect(top('loading', summary(5))).toBe(300 - 58 / 2)
    expect(top('ready', null)).toBe(300 - (46 + 22) / 2)
    expect(top('ready', summary(0))).toBe(300 - 46 / 2)
    // At most eight gene rows.
    expect(top('ready', summary(12))).toBe(300 - (46 + 8 * 22) / 2)
  })

  it('keeps the HUD 8 px inside the top and bottom edges', () => {
    const top = (y: number, height = 600) =>
      magicLensOverlayModel(
        { x: 100, y },
        20,
        viewState(0),
        { width: 800, height },
        'ready',
        summary(3),
      ).hudStyle.top

    expect(top(10)).toBe(8)
    expect(top(590)).toBe(600 - 112 - 8)
    // Shorter than the HUD: pinned to the top.
    expect(top(50, 100)).toBe(8)
  })
})
