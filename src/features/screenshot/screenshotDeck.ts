import type { DeckProps, LayersList, OrthographicView } from '@deck.gl/core'
import { ReleasingDeck } from '../../components/releasingDeck'
import { spatialOverviewView } from '../../rendering/deckLayers'
import type {
  OverviewLayerOptions,
  OverviewViewState,
} from '../../rendering/deckLayerTypes'
import { abortError } from '../../utils/abort'
import type { ScreenshotScale } from './screenshotPlan'

// The cells, outlines, transcripts and annotations of a screenshot (plan 27,
// task D), drawn by a deck.gl Deck of its own, one tile of the frame at a
// time at the screenshot's pixel density. Its canvas sits in the page,
// hidden, only so that its size is measured; the live view is never resized
// or read. Each tile is copied out in the same task it is drawn in, before
// the browser can clear the drawing buffer. The Deck loses its WebGL context
// as soon as the screenshot ends, so it holds one of Chromium's 16 only
// while it runs.

// D5: every loaded cell, not the render cap's sample, and nothing pickable.
export function screenshotLayerOptions(
  options: OverviewLayerOptions,
): OverviewLayerOptions {
  return {
    ...options,
    cellPointPickable: false,
    cellBoundaryPickable: false,
    ...(options.cellPointPacking === undefined
      ? {}
      : { cellPointPacking: { ...options.cellPointPacking, sampleFraction: 1 } }),
  }
}

// The layers' other kinds are pickable for hovers and clicks, which an
// off-screen Deck never gets.
export function unpickableLayers(layers: LayersList): LayersList {
  return layers.map((layer) =>
    Array.isArray(layer)
      ? unpickableLayers(layer)
      : layer
        ? layer.clone({ pickable: false })
        : layer,
  )
}

// What one of deck.gl's animation frames does, now: apply new layers,
// update the canvas size and draw if anything changed.
function runAnimationFrame(deck: ScreenshotDeck): void {
  const { animationLoop } = deck as { animationLoop?: { redraw(): unknown } | null }
  animationLoop?.redraw()
}

export class ScreenshotDeckError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScreenshotDeckError'
  }
}

export type ScreenshotDeckProps = DeckProps<OrthographicView>

// What the renderer needs of a Deck; tests give a fake.
export interface ScreenshotDeck {
  setProps(props: Partial<ScreenshotDeckProps>): void
  redraw(reason?: string): void
  getCanvas(): HTMLCanvasElement | null
  finalize(): void
}

export type CreateScreenshotDeck = (props: ScreenshotDeckProps) => ScreenshotDeck

export interface ScreenshotDeckOptions {
  readonly layers: LayersList
  // The size every tile is drawn at, in CSS pixels.
  readonly tileWidth: number
  readonly tileHeight: number
  readonly scale: ScreenshotScale
  readonly viewState: OverviewViewState
  readonly signal: AbortSignal
  readonly createDeck?: CreateScreenshotDeck
}

interface DeckDevice {
  readonly isLost: boolean
}

export class ScreenshotDeckRenderer {
  private device: DeckDevice | null = null
  private failure: Error | null = null

  private constructor(
    private readonly host: HTMLElement,
    private deck: ScreenshotDeck | null,
    private readonly options: ScreenshotDeckOptions,
  ) {}

  static async create(options: ScreenshotDeckOptions): Promise<ScreenshotDeckRenderer> {
    options.signal.throwIfAborted()
    const host = document.createElement('div')
    host.className = 'screenshot-deck-host'
    host.setAttribute('aria-hidden', 'true')
    Object.assign(host.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: `${options.tileWidth.toString()}px`,
      height: `${options.tileHeight.toString()}px`,
      overflow: 'hidden',
      visibility: 'hidden',
      pointerEvents: 'none',
      zIndex: '-1',
    })
    document.body.append(host)

    const createDeck =
      options.createDeck ?? ((props) => new ReleasingDeck<OrthographicView>(props))
    let loaded!: () => void
    let failed!: (error: Error) => void
    const ready = new Promise<void>((resolve, reject) => {
      loaded = resolve
      failed = reject
    })
    const renderer = new ScreenshotDeckRenderer(host, null, options)
    const onAbort = () => {
      failed(abortError(options.signal))
    }
    options.signal.addEventListener('abort', onAbort, { once: true })

    try {
      renderer.deck = createDeck({
        parent: host,
        width: options.tileWidth,
        height: options.tileHeight,
        useDevicePixels: options.scale,
        views: spatialOverviewView,
        viewState: options.viewState,
        controller: false,
        layers: options.layers,
        style: { pointerEvents: 'none' },
        onDeviceInitialized: (device) => {
          renderer.device = device
        },
        onLoad: () => {
          loaded()
        },
        onError: (error) => {
          renderer.failure ??= error
          failed(error)
        },
      })
      await ready
      // A numeric useDevicePixels sizes the drawing buffer now, rather than
      // when the resize observer next reports.
      renderer.deck?.setProps({ useDevicePixels: options.scale })
      // deck.gl takes layers given before its device was ready only in its
      // next animation frame, and a hidden tab has none: without this the
      // first tiles came out with no cells, and every tile in a hidden tab.
      if (renderer.deck !== null) runAnimationFrame(renderer.deck)
      return renderer
    } catch (error) {
      renderer.destroy()
      throw error
    } finally {
      options.signal.removeEventListener('abort', onAbort)
    }
  }

  // Draws the view of one tile and copies its top-left `width` × `height`
  // CSS pixels to (x, y) of the target, in the target's pixels.
  drawTile(
    target: CanvasRenderingContext2D,
    viewState: OverviewViewState,
    source: { readonly width: number; readonly height: number },
    destination: { readonly x: number; readonly y: number },
  ): void {
    const deck = this.deck
    const canvas = deck?.getCanvas() ?? null
    if (deck === null || canvas === null)
      throw new ScreenshotDeckError('The cells could not be drawn.')

    deck.setProps({ viewState })
    deck.redraw('screenshot')
    this.throwIfLost()

    const { scale, tileWidth, tileHeight } = this.options
    const gl = canvas.getContext('webgl2')
    const width = tileWidth * scale
    const height = tileHeight * scale
    // WebGL shrinks a drawing buffer past its limit without a word; a tile
    // drawn small would be stretched (27-D9).
    if (
      gl !== null &&
      (gl.drawingBufferWidth !== width || gl.drawingBufferHeight !== height)
    ) {
      throw new ScreenshotDeckError(
        `The GPU drew the cells at ${gl.drawingBufferWidth.toString()} × ${gl.drawingBufferHeight.toString()} px, not ${width.toString()} × ${height.toString()}.`,
      )
    }

    target.drawImage(
      canvas,
      0,
      0,
      source.width * scale,
      source.height * scale,
      destination.x,
      destination.y,
      source.width * scale,
      source.height * scale,
    )
  }

  // The Deck is finalized once its canvas has left the page, so
  // ReleasingDeck loses its context.
  destroy(): void {
    this.host.remove()
    const deck = this.deck
    this.deck = null
    deck?.finalize()
  }

  private throwIfLost(): void {
    if (this.device?.isLost === true || this.failure !== null) {
      throw new ScreenshotDeckError(
        'Drawing the cells was interrupted (the GPU was reset, or too many tabs are using it).',
      )
    }
  }
}
