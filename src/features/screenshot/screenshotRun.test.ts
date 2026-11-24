import { describe, expect, it, vi } from 'vitest'
import { imagePixels, micrometers, type BBox } from '../../data/coords'
import type { ImagePyramidLoader } from '../../data/imagePyramid'
import type { OverviewViewState } from '../../rendering/deckLayerTypes'
import { pngTextEntries, readPngChunks } from './pngChunks'
import { screenshotOverlayPaint, type ScreenshotInclude } from './screenshotOverlay'
import {
  drawScreenshot,
  screenshotDescription,
  type ScreenshotProgress,
  type ScreenshotSnapshot,
} from './screenshotRun'
import type { ScreenshotDeckProps } from './screenshotDeck'

const ONE_PIXEL_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  ),
  (char) => char.charCodeAt(0),
)
const NONE: ScreenshotInclude = {
  scaleBar: false,
  legend: false,
  axes: false,
  selections: false,
}
const viewState: OverviewViewState = {
  target: [100, -50, 0],
  zoom: 0,
  minZoom: -10,
  maxZoom: 10,
}

// Canvases whose contexts record what is drawn on them, in order.
function fakeCanvases() {
  const log: string[] = []
  const canvases: { width: number; height: number; name: string }[] = []
  const createCanvas = (width: number, height: number) => {
    const name = canvases.length === 0 ? 'png' : 'scratch'
    const canvas = {
      width,
      height,
      name,
      getContext: () => context,
      toBlob: (callback: (blob: Blob | null) => void) => {
        callback(new Blob([ONE_PIXEL_PNG], { type: 'image/png' }))
      },
    }
    const context = {
      canvas,
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      fillStyle: '',
      imageSmoothingQuality: 'low',
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(function (this: { fillStyle: string }) {
        log.push(`${name} fill ${this.fillStyle}`)
      }),
      drawImage: vi.fn(function (
        this: { globalAlpha: number },
        image: { name?: string; key?: string },
        ...args: number[]
      ) {
        log.push(
          `${name} draw ${image.name ?? image.key ?? 'image'} at ${args.slice(-4).join(',')} alpha ${this.globalAlpha.toString()}`,
        )
      }),
    }
    canvases.push(canvas)
    return canvas as unknown as HTMLCanvasElement
  }

  return { log, canvases, createCanvas }
}

function fakeDeck(log: string[]) {
  return (props: ScreenshotDeckProps) => {
    const canvas = { name: 'deck', getContext: () => null }
    queueMicrotask(() => {
      props.onLoad?.()
    })
    return {
      setProps: vi.fn(),
      redraw: () => {
        log.push('deck redraw')
      },
      getCanvas: () => canvas as unknown as HTMLCanvasElement,
      finalize: () => {
        log.push('deck finalize')
      },
    }
  }
}

function loader(): ImagePyramidLoader {
  return {
    url: 'https://example.test/dapi.ome.tif',
    channels: [{ id: 'dapi', name: 'DAPI' }],
    bestLevel: () => 0,
    tilesForBbox: () => [{ col: 0, row: 0 }],
    tileBounds: (): BBox => ({
      minX: micrometers(0),
      maxX: micrometers(100),
      minY: micrometers(0),
      maxY: micrometers(100),
    }),
    tileSourceSize: () => ({ width: imagePixels(100), height: imagePixels(100) }),
    loadTile: () =>
      Promise.resolve({
        bitmap: { key: 'tile', close: vi.fn() } as unknown as ImageBitmap,
        width: 100,
        height: 100,
        lo: 0,
        hi: 255,
      }),
  } as unknown as ImagePyramidLoader
}

function snapshot(overrides: Partial<ScreenshotSnapshot> = {}): ScreenshotSnapshot {
  const image = loader()
  return {
    viewState,
    viewport: { width: 200, height: 100 },
    image: {
      channels: [
        {
          id: 'dapi',
          loader: image,
          enabled: true,
          color: [0, 0, 255],
          contrast: { lo: 0, hi: 255 },
        },
      ],
      flatImage: null,
      opacity: 0.5,
    },
    layers: () => [],
    overlays: { scaleBar: null, axes: null, legend: [], selections: [] },
    cells: null,
    unitLabel: 'µm',
    maxConcurrentTileRequests: 4,
    viewChangedAt: 0,
    ...overrides,
  }
}

const file = {
  fileName: 'run-screenshot.png',
  software: 'Spatial Omics Explorer v1.0.0',
  source: 'https://example.test/run.h5ad',
  zPlane: 3,
}

describe('drawing a screenshot (plan 27, steps 2–6)', () => {
  it('fills the background, lays the image at its opacity, then the cells', async () => {
    const { log, createCanvas } = fakeCanvases()

    await drawScreenshot(
      snapshot(),
      { scale: 2, dpi: 300, include: NONE, background: 'white' },
      file,
      {
        signal: new AbortController().signal,
        createCanvas,
        createDeck: fakeDeck(log),
        paint: screenshotOverlayPaint('white', null),
      },
    )

    expect(log).toEqual([
      'png fill #ffffff',
      'scratch draw tile at 0,0,200,200 alpha 1',
      'png draw scratch at 0,0,400,200 alpha 0.5',
      'deck redraw',
      'png draw deck at 0,0,400,200 alpha 1',
      'deck finalize',
    ])
  })

  it('writes the dpi and where the PNG came from (D11)', async () => {
    const { log, createCanvas } = fakeCanvases()

    const blob = await drawScreenshot(
      snapshot(),
      { scale: 2, dpi: 600, include: NONE, background: 'transparent' },
      file,
      {
        signal: new AbortController().signal,
        createCanvas,
        createDeck: fakeDeck(log),
        paint: screenshotOverlayPaint('transparent', null),
        now: () => new Date('2026-11-24T12:00:00Z'),
      },
    )
    const png = new Uint8Array(await blob.arrayBuffer())

    expect(blob.type).toBe('image/png')
    expect(log[0]).not.toMatch(/fill/)
    expect(readPngChunks(png).map((chunk) => chunk.type)).toEqual([
      'IHDR',
      'pHYs',
      'tEXt',
      'tEXt',
      'tEXt',
      'tEXt',
      'IDAT',
      'IEND',
    ])
    expect(pngTextEntries(png)).toEqual({
      Software: 'Spatial Omics Explorer v1.0.0',
      Source: 'https://example.test/run.h5ad',
      Description: 'x 0 to 200 µm, y 0 to 100 µm; 0.5 µm per pixel; 2× scale; z plane 3',
      'Creation Time': '2026-11-24T12:00:00.000Z',
    })
  })

  it('reports progress, and empties its canvases when done', async () => {
    const { log, canvases, createCanvas } = fakeCanvases()
    const progress: ScreenshotProgress[] = []

    await drawScreenshot(
      snapshot(),
      { scale: 1, dpi: 300, include: NONE, background: 'canvas' },
      file,
      {
        signal: new AbortController().signal,
        createCanvas,
        createDeck: fakeDeck(log),
        paint: screenshotOverlayPaint('canvas', null),
        onProgress: (step) => progress.push(step),
      },
    )

    expect(progress.at(-1)).toEqual({ stage: 'writing', done: 2, total: 3 })
    expect(progress.map((step) => step.stage)).toEqual([
      'image',
      'image',
      'cells',
      'writing',
    ])
    expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(
      true,
    )
  })

  it('draws no cells where the view has no layers', async () => {
    const { log, createCanvas } = fakeCanvases()

    await drawScreenshot(
      snapshot({ layers: null }),
      { scale: 1, dpi: 300, include: NONE, background: 'canvas' },
      file,
      {
        signal: new AbortController().signal,
        createCanvas,
        createDeck: fakeDeck(log),
        paint: screenshotOverlayPaint('canvas', null),
      },
    )

    expect(log.some((line) => line.startsWith('deck'))).toBe(false)
  })

  it('refuses a PNG over the size limit (D10)', async () => {
    const { createCanvas } = fakeCanvases()

    await expect(
      drawScreenshot(
        snapshot({ viewport: { width: 4000, height: 3000 } }),
        { scale: 8, dpi: 300, include: NONE, background: 'canvas' },
        file,
        { signal: new AbortController().signal, createCanvas },
      ),
    ).rejects.toThrow(/too large/)
  })

  it('stops, and lets the Deck go, when cancelled', async () => {
    const { log, canvases, createCanvas } = fakeCanvases()
    const controller = new AbortController()

    const drawing = drawScreenshot(
      snapshot(),
      { scale: 1, dpi: 300, include: NONE, background: 'canvas' },
      file,
      {
        signal: controller.signal,
        createCanvas,
        createDeck: fakeDeck(log),
        paint: screenshotOverlayPaint('canvas', null),
        onProgress: (step) => {
          if (step.stage === 'cells') controller.abort()
        },
      },
    )

    await expect(drawing).rejects.toThrow(/abort/i)
    expect(log.at(-1)).toBe('deck finalize')
    expect(canvases.every((canvas) => canvas.width === 0)).toBe(true)
  })

  it('describes the view without its locale’s separators', () => {
    expect(
      screenshotDescription(
        {
          viewState: { ...viewState, target: [12_345.67, -2_000, 0], zoom: -2 },
          unitLabel: 'units',
        },
        { width: 1000, height: 400 },
        { scale: 4 },
        null,
      ),
    ).toBe(
      'x 10345.7 to 14345.7 units, y 1200 to 2800 units; 1 units per pixel; 4× scale',
    )
  })
})
