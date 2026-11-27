import { useEffect, useRef, useState } from 'react'
import { normalizeCustomMorphologyLayerUrl } from '../../data/morphologyImage'
import type { CustomImageToOpen, CustomImagesToOpen } from './customMorphologyLayers'

interface UseCustomImagesToOpenOptions {
  readonly request: CustomImagesToOpen | null
  readonly loadedDatasetUrl: string | null
  // Bumped when a load commits: layers still to open then belong to a
  // dataset no longer shown.
  readonly loadRequestIdRef: { readonly current: number }
  // Resolves false when the layer did not open.
  readonly loadCustomLayer: (url: string) => Promise<boolean>
  readonly setLayerOpacity: (url: string, opacity: number) => void
}

// Opens the request's layers one at a time, in order, once its dataset is
// ready. Returns those not yet open, which the share link keeps listing so a
// link copied meanwhile still names them.
export function useCustomImagesToOpen({
  request,
  loadedDatasetUrl,
  loadRequestIdRef,
  loadCustomLayer,
  setLayerOpacity,
}: UseCustomImagesToOpenOptions): readonly CustomImageToOpen[] {
  const [progress, setProgress] = useState<{
    readonly request: CustomImagesToOpen
    readonly opened: number
  } | null>(null)
  const startedRef = useRef<CustomImagesToOpen | null>(null)

  useEffect(() => {
    if (
      request === null ||
      request.datasetUrl !== loadedDatasetUrl ||
      startedRef.current === request
    ) {
      return
    }

    startedRef.current = request
    const requestId = loadRequestIdRef.current

    void (async () => {
      for (const [index, image] of request.images.entries()) {
        // Another dataset opened while one loaded takes none of the rest.
        if (loadRequestIdRef.current !== requestId) {
          return
        }

        const loaded = await loadCustomLayer(image.url)

        if (loaded && image.opacity !== undefined) {
          try {
            setLayerOpacity(normalizeCustomMorphologyLayerUrl(image.url), image.opacity)
          } catch {
            // The load surfaced the invalid URL.
          }
        }

        setProgress({ request, opened: index + 1 })
      }
    })()
  }, [loadCustomLayer, loadRequestIdRef, loadedDatasetUrl, request, setLayerOpacity])

  if (request === null) {
    return []
  }

  return request.images.slice(progress?.request === request ? progress.opened : 0)
}
