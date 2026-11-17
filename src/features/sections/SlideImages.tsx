import { useEffect, useMemo, useRef, useState } from 'react'
import { MorphologyCanvas } from '../../components/MorphologyCanvas'
import type { ImagePyramidAssociatedImage } from '../../data/imagePyramid'
import {
  SLIDE_IMAGE_MAX_WIDTH,
  slideImageChannel,
  slideImageLayout,
  slideImageOpenHref,
  slideImageTitle,
  sortSlideImages,
  type SlideImagesSource,
} from './slideImagesModel'

const SLIDE_IMAGE_TILE_REQUESTS = 2

type SlideImagesState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly images: readonly ImagePyramidAssociatedImage[] }
  | { readonly status: 'error'; readonly message: string }

// The info drawer's Slide images: the label, macro and thumbnail a slide
// scanner stores beside the image (SVS), each drawn whole and openable on
// its own. They are listed when the drawer opens, since the macro's IFD is
// read only then.
export function SlideImages({ source }: { readonly source: SlideImagesSource }) {
  const [loaded, setLoaded] = useState<{
    readonly source: SlideImagesSource
    readonly state: SlideImagesState
  } | null>(null)
  const state: SlideImagesState =
    loaded?.source === source ? loaded.state : { status: 'loading' }
  const listRef = useRef<HTMLUListElement>(null)
  // Previews shrink to fit a narrow drawer.
  const [maxWidth, setMaxWidth] = useState(SLIDE_IMAGE_MAX_WIDTH)
  const listed = state.status === 'ready' && state.images.length > 0

  useEffect(() => {
    const list = listRef.current

    if (!listed || list === null || typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(() => {
      const width = list.clientWidth

      if (width > 0) {
        setMaxWidth(Math.min(SLIDE_IMAGE_MAX_WIDTH, Math.floor(width)))
      }
    })
    observer.observe(list)

    return () => {
      observer.disconnect()
    }
  }, [listed])

  useEffect(() => {
    const controller = new AbortController()

    source.associatedImages(controller.signal).then(
      (images) => {
        setLoaded({ source, state: { status: 'ready', images: sortSlideImages(images) } })
      },
      (error: unknown) => {
        if (controller.signal.aborted) {
          return
        }

        setLoaded({
          source,
          state: {
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          },
        })
      },
    )

    return () => {
      controller.abort()
    }
  }, [source])

  if (state.status === 'loading') {
    return (
      <p className="shell-drawer-empty" role="status">
        Reading the slide images…
      </p>
    )
  }

  if (state.status === 'error') {
    return (
      <p className="slide-image-error" role="alert">
        The slide images could not be read: {state.message}
      </p>
    )
  }

  if (state.images.length === 0) {
    return <p className="shell-drawer-empty">The image has no slide images.</p>
  }

  return (
    <ul ref={listRef} className="slide-images" aria-label="Slide images">
      {state.images.map((image) => (
        <li key={image.ifdIndex}>
          <SlideImage image={image} maxWidth={maxWidth} />
        </li>
      ))}
    </ul>
  )
}

function SlideImage({
  image,
  maxWidth,
}: {
  readonly image: ImagePyramidAssociatedImage
  readonly maxWidth: number
}) {
  const title = slideImageTitle(image.name)
  const size = `${image.width.toLocaleString()} × ${image.height.toLocaleString()} px`
  const [tileError, setTileError] = useState<string | null>(null)
  const loader = image.loader
  const layout = useMemo(
    () => (loader === undefined ? null : slideImageLayout(loader, maxWidth)),
    [loader, maxWidth],
  )
  const channels = useMemo(
    () => (loader === undefined ? [] : [slideImageChannel(loader)]),
    [loader],
  )
  const error = image.error ?? tileError

  return (
    <figure className="slide-image">
      {layout === null || loader === undefined ? null : (
        <div
          className="slide-image-frame"
          style={{ width: layout.width, height: layout.height }}
          role="img"
          aria-label={`${title}, ${size}`}
        >
          <MorphologyCanvas
            loader={loader}
            channels={channels}
            viewState={layout.viewState}
            maxConcurrentTileRequests={SLIDE_IMAGE_TILE_REQUESTS}
            tileCacheMaxTiles={Math.max(24, loader.tilesForLevel(0).length)}
            onTileError={(cause) => {
              setTileError(cause.message)
            }}
          />
        </div>
      )}
      <figcaption>
        <span className="slide-image-title">{title}</span>
        <span className="slide-image-size">{size}</span>
        {loader === undefined ? null : (
          <a
            href={slideImageOpenHref(window.location.href, loader.url)}
            target="_blank"
            rel="noreferrer"
            title={`Open the ${title.toLowerCase()} on its own in a new tab`}
          >
            Open
          </a>
        )}
      </figcaption>
      {error === null || error === undefined ? null : (
        <p className="slide-image-error" role="alert">
          {title} could not be read: {error}
        </p>
      )}
    </figure>
  )
}
