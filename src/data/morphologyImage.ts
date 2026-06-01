import { openTiff } from '../tiff/loader'
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
  readonly openImage?: (url: string) => Promise<TiffPyramidLoader>
  readonly candidates?: readonly string[]
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

    if (!(await imageExists(url, fetcher))) {
      continue
    }

    return {
      url,
      loader: await openImage(url),
    }
  }

  throw new Error('No supported Xenium OME-TIFF image was found.')
}

export function datasetFileUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

async function imageExists(url: string, fetcher: typeof fetch): Promise<boolean> {
  try {
    const response = await fetcher(url, { method: 'HEAD' })
    return response.ok
  } catch {
    return false
  }
}
