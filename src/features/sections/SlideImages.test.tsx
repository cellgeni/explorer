import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { imagePixels, micrometers } from '../../data/coords'
import type {
  ImagePyramidAssociatedImage,
  ImagePyramidLoader,
} from '../../data/imagePyramid'
import { parseShareableState } from '../../data/shareableState'
import { SlideImages } from './SlideImages'

function imageLoader(url: string, width: number, height: number): ImagePyramidLoader {
  return {
    url,
    units: {
      dataUnit: 'micrometer',
      imageUnit: 'pixel',
      micrometersPerPixel: micrometers(1),
      origin: 'top-left',
      imageYAxis: 'down',
    },
    tileWidth: imagePixels(256),
    tileHeight: imagePixels(256),
    numLevels: 1,
    imageWidth: imagePixels(width),
    imageHeight: imagePixels(height),
    channels: [],
    bestLevel: () => 0,
    tilesForBbox: () => [],
    tilesForLevel: () => [{ col: 0, row: 0 }],
    tileBounds: () => ({
      minX: micrometers(0),
      maxX: micrometers(width),
      minY: micrometers(0),
      maxY: micrometers(height),
    }),
    tileSourceSize: () => ({ width: imagePixels(width), height: imagePixels(height) }),
  }
}

describe('SlideImages', () => {
  it('shows the label, macro, and thumbnail, each with a link to open it', async () => {
    const slide = 'https://example.test/slide.svs'
    const images: readonly ImagePyramidAssociatedImage[] = [
      {
        name: 'thumbnail',
        ifdIndex: 1,
        width: 1024,
        height: 757,
        loader: imageLoader(`${slide}#ifd=1`, 1024, 757),
      },
      {
        name: 'label',
        ifdIndex: 3,
        width: 674,
        height: 698,
        loader: imageLoader(`${slide}#ifd=3`, 674, 698),
      },
      { name: 'macro', ifdIndex: 4, width: 1600, height: 618, error: 'Bad strips.' },
    ]
    const associatedImages = vi.fn(async () => images)

    render(<SlideImages source={{ associatedImages }} />)

    expect(screen.getByRole('status')).toHaveTextContent('Reading the slide images')
    const list = await screen.findByRole('list', { name: 'Slide images' })
    const items = within(list).getAllByRole('listitem')

    expect(items.map((item) => item.querySelector('figcaption')?.textContent)).toEqual([
      'Label674 × 698 pxOpen',
      'Macro (whole slide)1,600 × 618 px',
      'Thumbnail1,024 × 757 pxOpen',
    ])
    expect(screen.getByRole('img', { name: 'Label, 674 × 698 px' })).toHaveStyle({
      width: '232px',
      height: '240px',
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Macro (whole slide) could not be read: Bad strips.',
    )

    const open = within(items[0] as HTMLElement).getByRole('link', { name: 'Open' })
    expect(open).toHaveAttribute('target', '_blank')
    expect(
      parseShareableState(new URL(open.getAttribute('href') ?? '').hash).datasetUrl,
    ).toBe(`${slide}#ifd=3`)
  })

  it('says when the slide images cannot be read', async () => {
    render(
      <SlideImages
        source={{
          associatedImages: async () => {
            throw new Error('IFD 5 is past the end of the file.')
          },
        }}
      />,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The slide images could not be read: IFD 5 is past the end of the file.',
    )
  })

  it('stops reading when it closes', () => {
    let signal: AbortSignal | undefined
    const { unmount } = render(
      <SlideImages
        source={{
          associatedImages: (nextSignal) => {
            signal = nextSignal
            return new Promise(() => {})
          },
        }}
      />,
    )

    unmount()
    expect(signal?.aborted).toBe(true)
  })
})
