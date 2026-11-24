import { ScatterplotLayer } from '@deck.gl/layers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OverviewViewState } from '../../rendering/deckLayerTypes'
import {
  ScreenshotDeckError,
  ScreenshotDeckRenderer,
  screenshotLayerOptions,
  unpickableLayers,
  type ScreenshotDeckProps,
} from './screenshotDeck'

const viewState: OverviewViewState = {
  target: [0, 0, 0],
  zoom: 0,
  minZoom: -10,
  maxZoom: 10,
}

// A Deck that loads when told, records its props, and draws into a canvas
// whose WebGL drawing buffer is the size asked for unless told otherwise.
function fakeDeck(options: { readonly bufferWidth?: number } = {}) {
  const decks: {
    props: ScreenshotDeckProps
    setProps: ReturnType<typeof vi.fn>
    redraw: ReturnType<typeof vi.fn>
    finalize: ReturnType<typeof vi.fn>
    animationLoop: { redraw: ReturnType<typeof vi.fn> }
    canvas: HTMLCanvasElement
    load: () => void
    fail: (error: Error) => void
    lose: () => void
  }[] = []
  const createDeck = (props: ScreenshotDeckProps) => {
    const canvas = document.createElement('canvas')
    props.parent?.append(canvas)
    const device = { isLost: false }
    const width = (props.width as number) * (props.useDevicePixels as number)
    const height = (props.height as number) * (props.useDevicePixels as number)
    vi.spyOn(canvas, 'getContext').mockReturnValue({
      drawingBufferWidth: options.bufferWidth ?? width,
      drawingBufferHeight: height,
    } as unknown as RenderingContext)
    const deck = {
      props,
      setProps: vi.fn(),
      redraw: vi.fn(),
      finalize: vi.fn(),
      animationLoop: { redraw: vi.fn() },
      canvas,
      load: () => {
        props.onDeviceInitialized?.(device as never)
        props.onLoad?.()
      },
      fail: (error: Error) => {
        props.onError?.(error)
      },
      lose: () => {
        device.isLost = true
      },
      getCanvas: () => canvas,
    }
    decks.push(deck)
    return deck
  }

  return { decks, createDeck }
}

function target() {
  const drawImage = vi.fn()
  return { context: { drawImage } as unknown as CanvasRenderingContext2D, drawImage }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('screenshot deck (plan 27, task D)', () => {
  it('draws every loaded cell and nothing pickable (D5)', () => {
    const packing = {
      geometry: {} as never,
      colors: new Uint8Array(4),
      filterValues: new Float32Array(1),
      sampleFraction: 0.18,
    }
    const options = screenshotLayerOptions({
      cellPointPickable: true,
      cellBoundaryPickable: true,
      cellPointPacking: packing,
      transcriptOpacity: 0.5,
    })

    expect(options).toEqual({
      cellPointPickable: false,
      cellBoundaryPickable: false,
      cellPointPacking: { ...packing, sampleFraction: 1 },
      transcriptOpacity: 0.5,
    })
  })

  it('clones every layer without picking', () => {
    const layers = unpickableLayers([
      new ScatterplotLayer({ id: 'a', data: [], pickable: true }),
      [new ScatterplotLayer({ id: 'b', data: [], pickable: true })],
      null,
    ])
    const flat = layers.flat() as ScatterplotLayer[]

    expect(flat[0]?.props.pickable).toBe(false)
    expect(flat[1]?.props.pickable).toBe(false)
    expect(flat[2]).toBeNull()
  })

  it('draws at the screenshot’s pixel density in a hidden canvas in the page', async () => {
    const { decks, createDeck } = fakeDeck()
    const creating = ScreenshotDeckRenderer.create({
      layers: [],
      tileWidth: 512,
      tileHeight: 256,
      scale: 4,
      viewState,
      signal: new AbortController().signal,
      createDeck,
    })
    const deck = decks[0]
    deck?.load()
    const renderer = await creating
    const host = document.querySelector<HTMLElement>('.screenshot-deck-host')

    expect(deck?.props).toMatchObject({
      width: 512,
      height: 256,
      useDevicePixels: 4,
      controller: false,
    })
    expect(host?.style.visibility).toBe('hidden')
    expect(host?.getAttribute('aria-hidden')).toBe('true')
    expect(deck?.setProps).toHaveBeenCalledWith({ useDevicePixels: 4 })
    // The layers given before the device was ready are applied at once, not
    // in an animation frame a hidden tab never has.
    expect(deck?.animationLoop.redraw).toHaveBeenCalledOnce()

    const { context, drawImage } = target()
    const tileView = { ...viewState, target: [10, 20, 0] as [number, number, number] }
    renderer.drawTile(context, tileView, { width: 300, height: 256 }, { x: 2048, y: 0 })

    expect(deck?.setProps).toHaveBeenCalledWith({ viewState: tileView })
    expect(deck?.redraw).toHaveBeenCalledWith('screenshot')
    expect(drawImage).toHaveBeenCalledWith(
      deck?.canvas,
      0,
      0,
      1200,
      1024,
      2048,
      0,
      1200,
      1024,
    )
  })

  it('leaves the page and finalizes its Deck, so it loses its context', async () => {
    const { decks, createDeck } = fakeDeck()
    const creating = ScreenshotDeckRenderer.create({
      layers: [],
      tileWidth: 100,
      tileHeight: 100,
      scale: 2,
      viewState,
      signal: new AbortController().signal,
      createDeck,
    })
    decks[0]?.load()
    const renderer = await creating
    const canvas = decks[0]?.canvas

    renderer.destroy()

    expect(document.querySelector('.screenshot-deck-host')).toBeNull()
    expect(canvas?.isConnected).toBe(false)
    expect(decks[0]?.finalize).toHaveBeenCalledOnce()
  })

  it('fails rather than stretch a drawing buffer the GPU shrank (D9)', async () => {
    const { decks, createDeck } = fakeDeck({ bufferWidth: 2048 })
    const creating = ScreenshotDeckRenderer.create({
      layers: [],
      tileWidth: 1024,
      tileHeight: 1024,
      scale: 4,
      viewState,
      signal: new AbortController().signal,
      createDeck,
    })
    decks[0]?.load()
    const renderer = await creating
    const { context, drawImage } = target()

    expect(() => {
      renderer.drawTile(context, viewState, { width: 1024, height: 1024 }, { x: 0, y: 0 })
    }).toThrow(ScreenshotDeckError)
    expect(drawImage).not.toHaveBeenCalled()
  })

  it('fails when its context is lost', async () => {
    const { decks, createDeck } = fakeDeck()
    const creating = ScreenshotDeckRenderer.create({
      layers: [],
      tileWidth: 100,
      tileHeight: 100,
      scale: 1,
      viewState,
      signal: new AbortController().signal,
      createDeck,
    })
    decks[0]?.load()
    const renderer = await creating
    decks[0]?.lose()
    const { context } = target()

    expect(() => {
      renderer.drawTile(context, viewState, { width: 100, height: 100 }, { x: 0, y: 0 })
    }).toThrow(/interrupted/)
  })

  it('cleans up when cancelled or when the Deck fails before it loads', async () => {
    const cancelled = fakeDeck()
    const controller = new AbortController()
    const creating = ScreenshotDeckRenderer.create({
      layers: [],
      tileWidth: 100,
      tileHeight: 100,
      scale: 1,
      viewState,
      signal: controller.signal,
      createDeck: cancelled.createDeck,
    })
    controller.abort()

    await expect(creating).rejects.toThrow(/abort/i)
    expect(cancelled.decks[0]?.finalize).toHaveBeenCalledOnce()
    expect(document.querySelector('.screenshot-deck-host')).toBeNull()

    const failing = fakeDeck()
    const failed = ScreenshotDeckRenderer.create({
      layers: [],
      tileWidth: 100,
      tileHeight: 100,
      scale: 1,
      viewState,
      signal: new AbortController().signal,
      createDeck: failing.createDeck,
    })
    failing.decks[0]?.fail(new Error('WebGL2 is not available'))

    await expect(failed).rejects.toThrow('WebGL2 is not available')
    expect(failing.decks[0]?.finalize).toHaveBeenCalledOnce()
  })
})
