import { openTiff, tiffImageSelectionUrl } from '../tiff/loader'
import { datasetFileUrl } from './datasetFiles'
import type { TiffPyramidLoader } from '../tiff/loader'
import type { TiffChannelInfo } from '../tiff/omeMetadata'

export interface MorphologyImage {
  readonly url: string
  readonly loader: TiffPyramidLoader
  readonly channels: readonly TiffChannelInfo[]
  readonly channelLoaders: readonly MorphologyImageChannel[]
}

export interface MorphologyImageChannel {
  readonly info: TiffChannelInfo
  readonly loader: TiffPyramidLoader
}

export interface LoadMorphologyImageOptions {
  readonly fetcher?: typeof fetch
  readonly openImage?: (url: string, signal?: AbortSignal) => Promise<TiffPyramidLoader>
  readonly candidates?: readonly string[]
  readonly signal?: AbortSignal
}

export interface LoadCustomMorphologyLayerOptions {
  readonly openImage?: (url: string, signal?: AbortSignal) => Promise<TiffPyramidLoader>
  readonly signal?: AbortSignal
}

const EXPERIMENT_MANIFEST_FILE = 'experiment.xenium'

const MORPHOLOGY_IMAGE_PATH_KEY_GROUPS = [
  ['morphology_mip_filepath', 'morphology_mip_filepaths'],
  ['morphology_focus_filepath', 'morphology_focus_filepaths'],
  ['morphology_filepath', 'morphology_filepaths'],
] as const

export async function loadMorphologyImage(
  baseUrl: string,
  options: LoadMorphologyImageOptions = {},
): Promise<MorphologyImage> {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  const openImage = options.openImage ?? openTiff
  const candidates =
    options.candidates ??
    (await loadMorphologyImageCandidatesFromManifest(baseUrl, fetcher, options.signal))

  const candidate = candidates[0]

  if (candidate !== undefined) {
    const url = datasetFileUrl(baseUrl, candidate)
    const loader =
      options.signal === undefined
        ? await openImage(url)
        : await openImage(url, options.signal)

    return {
      url,
      loader,
      channels: loader.channels ?? [],
      channelLoaders: await loadMorphologyChannelLoaders({
        imageUrl: url,
        loader,
        openImage,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }),
    }
  }

  throw new Error('No supported Xenium OME-TIFF image was found.')
}

export async function loadCustomMorphologyLayer(
  imageUrl: string,
  options: LoadCustomMorphologyLayerOptions = {},
): Promise<MorphologyImage> {
  const url = normalizeCustomMorphologyLayerUrl(imageUrl)
  const openImage = options.openImage ?? openTiff

  return loadMorphologyImageFromUrl(url, {
    openImage,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
}

export function normalizeCustomMorphologyLayerUrl(imageUrl: string): string {
  const trimmedUrl = imageUrl.trim()

  if (trimmedUrl.length === 0) {
    throw new Error('Enter a custom image layer URL.')
  }

  let url: URL

  try {
    url = new URL(trimmedUrl)
  } catch {
    throw new Error('Enter a valid custom image layer URL.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Custom image layer URLs must use HTTP or HTTPS.')
  }

  return url.toString()
}

interface LoadMorphologyImageFromUrlOptions {
  readonly openImage: NonNullable<LoadMorphologyImageOptions['openImage']>
  readonly signal?: AbortSignal
}

async function loadMorphologyImageFromUrl(
  url: string,
  options: LoadMorphologyImageFromUrlOptions,
): Promise<MorphologyImage> {
  const loader =
    options.signal === undefined
      ? await options.openImage(url)
      : await options.openImage(url, options.signal)

  return {
    url,
    loader,
    channels: loader.channels ?? [],
    channelLoaders: await loadMorphologyChannelLoaders({
      imageUrl: url,
      loader,
      openImage: options.openImage,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    }),
  }
}

interface LoadMorphologyChannelLoadersOptions {
  readonly imageUrl: string
  readonly loader: TiffPyramidLoader
  readonly openImage: NonNullable<LoadMorphologyImageOptions['openImage']>
  readonly signal?: AbortSignal
}

async function loadMorphologyChannelLoaders(
  options: LoadMorphologyChannelLoadersOptions,
): Promise<readonly MorphologyImageChannel[]> {
  const channels = options.loader.channels ?? []

  if (channels.length === 0) {
    return []
  }

  const loaderByUrl = new Map<string, TiffPyramidLoader>([
    [options.imageUrl, options.loader],
  ])

  return Promise.all(
    channels.map(async (channel) => {
      const channelUrl = morphologyChannelImageUrl(options.imageUrl, channel)
      let loader = loaderByUrl.get(channelUrl)

      if (loader === undefined) {
        loader =
          options.signal === undefined
            ? await options.openImage(channelUrl)
            : await options.openImage(channelUrl, options.signal)
        loaderByUrl.set(channelUrl, loader)
      }

      return {
        info: channel,
        loader,
      }
    }),
  )
}

function morphologyChannelImageUrl(imageUrl: string, channel: TiffChannelInfo): string {
  if (channel.fileName !== undefined) {
    const channelUrl = new URL(channel.fileName, imageUrl).toString()

    if (
      channel.ifdIndex !== undefined &&
      channel.ifdIndex > 0 &&
      urlsReferToSameImage(channelUrl, imageUrl)
    ) {
      return tiffImageSelectionUrl(imageUrl, channel.ifdIndex)
    }

    return channelUrl
  }

  if (channel.ifdIndex !== undefined && channel.ifdIndex > 0) {
    return tiffImageSelectionUrl(imageUrl, channel.ifdIndex)
  }

  return imageUrl
}

function urlsReferToSameImage(left: string, right: string): boolean {
  const leftUrl = new URL(left)
  const rightUrl = new URL(right)
  leftUrl.hash = ''
  rightUrl.hash = ''
  return leftUrl.toString() === rightUrl.toString()
}

export async function loadMorphologyImageCandidatesFromManifest(
  baseUrl: string,
  fetcher: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<readonly string[]> {
  const url = datasetFileUrl(baseUrl, EXPERIMENT_MANIFEST_FILE)
  const response =
    signal === undefined ? await fetcher(url) : await fetcher(url, { signal })

  if (!response.ok) {
    throw new Error(
      `Unable to load ${EXPERIMENT_MANIFEST_FILE}: HTTP ${response.status}.`,
    )
  }

  return morphologyImagePathsFromExperiment(await response.json())
}

export function morphologyImagePathsFromExperiment(manifest: unknown): readonly string[] {
  const records = manifestRecords(manifest)
  const paths = new Set<string>()

  for (const keyGroup of MORPHOLOGY_IMAGE_PATH_KEY_GROUPS) {
    for (const record of records) {
      for (const key of keyGroup) {
        addImagePaths(record[key], paths)
      }
    }
  }

  if (paths.size === 0) {
    for (const record of records) {
      for (const [key, value] of Object.entries(record)) {
        if (key.toLowerCase().includes('morphology')) {
          addImagePaths(value, paths)
        }
      }
    }
  }

  return [...paths]
}

function manifestRecords(
  manifest: unknown,
): readonly Readonly<Record<string, unknown>>[] {
  const root = isRecord(manifest) ? manifest : undefined
  const payload = readRecordProperty(root, 'payload')
  const rootImages = readRecordProperty(root, 'images')
  const payloadImages = readRecordProperty(payload, 'images')
  return [rootImages, payloadImages, root, payload].filter(isRecord)
}

function addImagePaths(value: unknown, paths: Set<string>): void {
  if (typeof value === 'string') {
    addPath(value, paths)
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      addImagePaths(item, paths)
    }
    return
  }

  if (isRecord(value)) {
    for (const item of Object.values(value)) {
      addImagePaths(item, paths)
    }
  }
}

function addPath(path: string, paths: Set<string>): void {
  const normalized = path.trim()

  if (isTiffPath(normalized)) {
    paths.add(normalized)
  }
}

function isTiffPath(path: string): boolean {
  return /\.(?:ome\.)?tiff?$/i.test(path)
}

function readRecordProperty(
  value: Readonly<Record<string, unknown>> | undefined,
  key: string,
): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) {
    return undefined
  }

  const property = value[key]

  return isRecord(property) ? property : undefined
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}
