import { describe, expect, it } from 'vitest'
import { imagePixels, micrometers } from '../../data/coords'
import type {
  ImagePyramidAssociatedImage,
  ImagePyramidLoader,
} from '../../data/imagePyramid'
import { parseShareableState } from '../../data/shareableState'
import {
  slideImageChannel,
  slideImageLayout,
  slideImageOpenHref,
  slideImageTitle,
  sortSlideImages,
} from './slideImagesModel'

const units = {
  dataUnit: 'micrometer',
  imageUnit: 'pixel',
  micrometersPerPixel: micrometers(1),
  origin: 'top-left',
  imageYAxis: 'down',
} as const

describe('slideImagesModel', () => {
  it('puts the label first, then the macro and the thumbnail', () => {
    const image = (name: string, ifdIndex: number): ImagePyramidAssociatedImage => ({
      name,
      ifdIndex,
      width: 1,
      height: 1,
      error: 'unread',
    })

    expect(
      sortSlideImages([
        image('thumbnail', 1),
        image('overview', 7),
        image('label', 5),
        image('macro', 6),
      ]).map((sorted) => sorted.name),
    ).toEqual(['label', 'macro', 'thumbnail', 'overview'])
    expect(slideImageTitle('macro')).toBe('Macro (whole slide)')
    expect(slideImageTitle('overview')).toBe('Overview')
  })

  it('fits the image in the box without enlarging it', () => {
    const macro = { imageWidth: imagePixels(1600), imageHeight: imagePixels(618), units }
    const layout = slideImageLayout(macro, 320, 240)

    expect(layout).toMatchObject({ width: 320, height: 124 })
    expect(layout.viewState.target).toEqual([800, -309, 0])
    expect(2 ** layout.viewState.zoom).toBeCloseTo(0.2, 3)

    const label = { imageWidth: imagePixels(200), imageHeight: imagePixels(100), units }
    expect(slideImageLayout(label, 320, 240)).toMatchObject({ width: 200, height: 100 })
    expect(slideImageLayout(label, 150, 240)).toMatchObject({ width: 150, height: 75 })
  })

  it('draws the image in its own channel’s colour and window, opaque', () => {
    const loader = {
      url: 'https://example.test/slide.svs#ifd=5',
      channels: [
        {
          id: 'Channel:0',
          index: 0,
          name: 'RGB',
          color: [255, 255, 255],
          contrast: { min: 0, max: 255 },
        },
      ],
    } as unknown as ImagePyramidLoader

    expect(slideImageChannel(loader)).toEqual({
      id: 'Channel:0',
      loader,
      enabled: true,
      color: [255, 255, 255],
      contrast: { lo: 0, hi: 255 },
      alphaFromIntensity: false,
    })
  })

  it('links to the image opened on its own', () => {
    const href = slideImageOpenHref(
      'https://cellgeni.github.io/explorer/?debug=1#xv=2&dataset=x',
      'https://example.test/slide.svs#ifd=5',
    )
    const url = new URL(href)

    expect(url.search).toBe('?debug=1')
    expect(parseShareableState(url.hash).datasetUrl).toBe(
      'https://example.test/slide.svs#ifd=5',
    )
  })
})
