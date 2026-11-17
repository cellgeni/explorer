import type { DisplayWindow } from '../../codecs/jpeg2000'
import type {
  ImagePyramidAssociatedImage,
  ImagePyramidLoader,
} from '../../data/imagePyramid'
import { formatShareableState } from '../../data/shareableState'
import type { OverviewViewState } from '../../rendering/deckLayerTypes'
import { fitExtentViewState } from '../../rendering/overviewViewState'

// The images a slide scanner stores beside the pyramid (an SVS label, macro
// and thumbnail), shown in the info drawer's Slide images section.
export type SlideImagesSource = Required<Pick<ImagePyramidLoader, 'associatedImages'>>

// The label names the slide, so it comes first; then the photograph of the
// whole glass slide, then the thumbnail of the scanned image.
const SLIDE_IMAGE_ORDER = ['label', 'macro', 'thumbnail']

const SLIDE_IMAGE_TITLES: Readonly<Record<string, string>> = {
  label: 'Label',
  macro: 'Macro (whole slide)',
  thumbnail: 'Thumbnail',
}

// Previews fit in this box, in CSS px, and are never drawn larger than the
// image itself.
export const SLIDE_IMAGE_MAX_WIDTH = 320
export const SLIDE_IMAGE_MAX_HEIGHT = 240

export function sortSlideImages(
  images: readonly ImagePyramidAssociatedImage[],
): readonly ImagePyramidAssociatedImage[] {
  const rank = (name: string) => {
    const index = SLIDE_IMAGE_ORDER.indexOf(name)
    return index < 0 ? SLIDE_IMAGE_ORDER.length : index
  }

  return [...images].sort(
    (left, right) => rank(left.name) - rank(right.name) || left.ifdIndex - right.ifdIndex,
  )
}

export function slideImageTitle(name: string): string {
  return SLIDE_IMAGE_TITLES[name] ?? name.charAt(0).toUpperCase() + name.slice(1)
}

export interface SlideImageLayout {
  readonly width: number
  readonly height: number
  readonly viewState: OverviewViewState
}

// The preview's size and the view that fits the image's extent into it.
export function slideImageLayout(
  loader: Pick<ImagePyramidLoader, 'imageWidth' | 'imageHeight' | 'units'>,
  maxWidth = SLIDE_IMAGE_MAX_WIDTH,
  maxHeight = SLIDE_IMAGE_MAX_HEIGHT,
): SlideImageLayout {
  const imageWidth = Math.max(1, loader.imageWidth)
  const imageHeight = Math.max(1, loader.imageHeight)
  const scale = Math.min(1, maxWidth / imageWidth, maxHeight / imageHeight)
  const width = Math.max(1, Math.round(imageWidth * scale))
  const height = Math.max(1, Math.round(imageHeight * scale))
  const micrometersPerPixel = loader.units.micrometersPerPixel

  return {
    width,
    height,
    viewState: fitExtentViewState(
      {
        minX: 0,
        maxX: imageWidth * micrometersPerPixel,
        minY: -imageHeight * micrometersPerPixel,
        maxY: 0,
      },
      { width, height },
    ),
  }
}

// The image drawn as its own channel describes it: RGB as stored, grey with
// its bit depth's window.
export function slideImageChannel(loader: ImagePyramidLoader): {
  readonly id: string
  readonly loader: ImagePyramidLoader
  readonly enabled: true
  readonly color: readonly [number, number, number]
  readonly contrast: DisplayWindow
  readonly alphaFromIntensity: false
} {
  const info = loader.channels[0]

  return {
    id: info?.id ?? loader.url,
    loader,
    enabled: true,
    color: info?.color ?? [255, 255, 255],
    contrast: { lo: info?.contrast.min ?? 0, hi: info?.contrast.max ?? 255 },
    alphaFromIntensity: false,
  }
}

// Opens the image on its own (`#ifd=N`), in the app at `appHref`.
export function slideImageOpenHref(appHref: string, imageUrl: string): string {
  const url = new URL(appHref)
  url.hash = formatShareableState({ datasetUrl: imageUrl })
  return url.toString()
}
