import { openTiff } from '../tiff/loader'
import { datasetFileUrl } from './datasetFiles'
import type { TiffPyramidLoader } from '../tiff/loader'

export const XENIUM_MORPHOLOGY_CANDIDATES = [
  'morphology_mip.ome.tif',
  'morphology_focus/morphology_focus_0000.ome.tif',
  'morphology.ome.tif',
] as const

export interface MorphologyImage {
  readonly url: string
  readonly loader: TiffPyramidLoader
}

export interface LoadMorphologyImageOptions {
  readonly fetcher?: typeof fetch
  readonly openImage?: (url: string, signal?: AbortSignal) => Promise<TiffPyramidLoader>
  readonly candidates?: readonly string[]
  readonly signal?: AbortSignal
}

export async function loadMorphologyImage(
  baseUrl: string,
  options: LoadMorphologyImageOptions = {},
): Promise<MorphologyImage> {
  const candidates = options.candidates ?? XENIUM_MORPHOLOGY_CANDIDATES
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  const openImage = options.openImage ?? openTiff

  for (const candidate of candidates) {
    const url = datasetFileUrl(baseUrl, candidate)

    if (!(await imageExists(url, fetcher, options.signal))) {
      continue
    }

    return {
      url,
      loader:
        options.signal === undefined
          ? await openImage(url)
          : await openImage(url, options.signal),
    }
  }

  throw new Error('No supported Xenium OME-TIFF image was found.')
}

async function imageExists(
  url: string,
  fetcher: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  try {
    const response = await fetcher(url, {
      method: 'HEAD',
      ...(signal === undefined ? {} : { signal }),
    })
    return response.ok
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') {
      throw cause
    }

    return false
  }
}
