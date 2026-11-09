import { openTiff, tiffImageSelectionUrl } from '../tiff/loader'
import { omeZarrImageRootUrl, openOmeZarrImage } from '../zarr/omeZarrLoader'
import { isOmeZarrImageUrl } from '../zarr/omeZarrUrl'
import {
  datasetFileLabelFor,
  datasetFileUrl,
  datasetFileUrlFor,
  xeniumManifestFileFor,
  zchunkStoreUrlFor,
} from './datasetFiles'
import { notifyFallback, type FallbackNotifier } from './fallbackNotice'
import { isListedAsMissing } from './folderListing'
import { likelyMissingFileError } from './hostResponses'
import type {
  ImagePyramidChannelInfo,
  ImagePyramidLoader,
  ImagePyramidOpener,
  ImagePyramidPlaneRef,
  OpenImagePyramidOptions,
} from './imagePyramid'

export interface MorphologyImage {
  readonly url: string
  readonly loader: ImagePyramidLoader
  readonly channels: readonly ImagePyramidChannelInfo[]
  readonly channelLoaders: readonly MorphologyImageChannel[]
  // Set for a z-stack: `channelLoaders` read plane `zPlane`.
  readonly zStack?: MorphologyImageZStack
}

export interface MorphologyImageZStack {
  readonly sizeZ: number
  readonly zPlane: number
  readonly micrometersPerPlane?: number
  // The same image with its channels at another z plane.
  readonly openPlane: (zPlane: number, signal?: AbortSignal) => Promise<MorphologyImage>
}

export interface MorphologyImageChannel {
  readonly info: ImagePyramidChannelInfo
  readonly loader: ImagePyramidLoader
}

export interface LoadMorphologyImageOptions {
  readonly fetcher?: typeof fetch
  readonly openImage?: ImagePyramidOpener
  readonly candidates?: readonly string[]
  readonly onFallback?: FallbackNotifier
  readonly signal?: AbortSignal
  // Z plane to open a z-stack at; the middle plane by default.
  readonly zPlane?: number
}

export interface LoadCustomMorphologyLayerOptions {
  readonly openImage?: ImagePyramidOpener
  readonly onFallback?: FallbackNotifier
  readonly signal?: AbortSignal
  readonly zPlane?: number
}

// Z planes whose channel loaders a z-stack keeps, so stepping back to a recent
// plane does not reopen its TIFF directories.
const CACHED_Z_PLANES = 8

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
  const openImage = options.openImage ?? openImagePyramid
  const manifestImage = xeniumManifestFileFor(baseUrl, 'morphology')
  const zchunkStoreUrl = zchunkStoreUrlFor(baseUrl)
  const candidates =
    options.candidates ??
    (manifestImage === undefined
      ? await loadMorphologyImageCandidatesFromManifest(baseUrl, fetcher, options.signal)
      : [manifestImage.url])

  const candidate = firstListedCandidate(baseUrl, candidates, options.onFallback)

  if (candidate !== undefined) {
    const url = datasetFileUrl(baseUrl, candidate)
    const loader = await openMorphologyImageLoader(openImage, url, {
      onFallback: options.onFallback,
      signal: options.signal,
      zchunkStoreUrl,
    })

    return createMorphologyImage({
      imageUrl: url,
      loader,
      openImage,
      onFallback: options.onFallback,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(zchunkStoreUrl === undefined ? {} : { zchunkStoreUrl }),
      ...(options.zPlane === undefined ? {} : { zPlane: options.zPlane }),
    })
  }

  if (candidates.length > 0) {
    const namedIn =
      options.candidates === undefined && manifestImage === undefined
        ? ' named in experiment.xenium'
        : ''

    throw new Error(
      `No morphology image${namedIn} is in the dataset folder listing: ${candidates.join(', ')}.`,
    )
  }

  throw new Error('No supported Xenium OME-TIFF image was found.')
}

// The first image path that the dataset folder's listing does not rule out.
// Without a listing that is the first path, as before.
function firstListedCandidate(
  baseUrl: string,
  candidates: readonly string[],
  onFallback: FallbackNotifier | undefined,
): string | undefined {
  const index = candidates.findIndex(
    (path) => !isListedAsMissing(datasetFileUrl(baseUrl, path)),
  )
  const candidate = candidates[index]

  if (candidate !== undefined && index > 0) {
    const skipped = candidates.slice(0, index)

    notifyFallback(onFallback, {
      source: 'Morphology image',
      message: `${skipped.join(', ')} ${skipped.length === 1 ? 'is' : 'are'} not in the dataset folder listing, so the app opened ${candidate}, the next image named in experiment.xenium.`,
      action: 'Add the missing image to the dataset folder to show it instead.',
      coalesceKey: `morphology-image-candidate:${baseUrl}`,
    })
  }

  return candidate
}

export async function loadCustomMorphologyLayer(
  imageUrl: string,
  options: LoadCustomMorphologyLayerOptions = {},
): Promise<MorphologyImage> {
  const url = normalizeCustomMorphologyLayerUrl(imageUrl)
  const openImage = options.openImage ?? openImagePyramid

  const loadOptions = {
    openImage,
    onFallback: options.onFallback,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.zPlane === undefined ? {} : { zPlane: options.zPlane }),
  }

  try {
    return await loadMorphologyImageFromUrl(url, loadOptions)
  } catch (error) {
    if (options.signal?.aborted) {
      throw error
    }

    const fallbackUrl = httpsFallbackUrl(url)

    if (fallbackUrl === null) {
      throw error
    }

    return loadMorphologyImageFromUrl(fallbackUrl, loadOptions)
  }
}

export async function morphologyImageFromPyramidLoader(
  url: string,
  loader: ImagePyramidLoader,
  options: LoadCustomMorphologyLayerOptions = {},
): Promise<MorphologyImage> {
  return createMorphologyImage({
    imageUrl: url,
    loader,
    openImage: options.openImage ?? openImagePyramid,
    onFallback: options.onFallback,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.zPlane === undefined ? {} : { zPlane: options.zPlane }),
  })
}

// The plane a z-stack opens at when none is asked for: the middle one, since
// the outer planes of a tissue stack are often nearly empty.
export function defaultMorphologyZPlane(sizeZ: number): number {
  return Math.max(0, Math.floor((sizeZ - 1) / 2))
}

export function clampMorphologyZPlane(zPlane: number, sizeZ: number): number {
  if (!Number.isFinite(zPlane)) {
    return defaultMorphologyZPlane(sizeZ)
  }

  return Math.min(Math.max(0, Math.round(zPlane)), Math.max(0, sizeZ - 1))
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

function httpsFallbackUrl(url: string): string | null {
  const parsedUrl = new URL(url)

  if (parsedUrl.protocol !== 'http:' || isLoopbackHostname(parsedUrl.hostname)) {
    return null
  }

  parsedUrl.protocol = 'https:'
  return parsedUrl.toString()
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost')
  )
}

interface LoadMorphologyImageFromUrlOptions {
  readonly openImage: ImagePyramidOpener
  readonly onFallback: FallbackNotifier | undefined
  readonly signal?: AbortSignal
  readonly zPlane?: number
}

async function loadMorphologyImageFromUrl(
  url: string,
  options: LoadMorphologyImageFromUrlOptions,
): Promise<MorphologyImage> {
  const loader = await openMorphologyImageLoader(options.openImage, url, {
    onFallback: options.onFallback,
    signal: options.signal,
  })

  return createMorphologyImage({
    imageUrl: url,
    loader,
    openImage: options.openImage,
    onFallback: options.onFallback,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.zPlane === undefined ? {} : { zPlane: options.zPlane }),
  })
}

interface LoadMorphologyChannelLoadersOptions {
  readonly imageUrl: string
  readonly loader: ImagePyramidLoader
  readonly openImage: ImagePyramidOpener
  readonly onFallback: FallbackNotifier | undefined
  readonly signal?: AbortSignal
  readonly zchunkStoreUrl?: string
  readonly zPlane?: number
}

async function createMorphologyImage(
  options: LoadMorphologyChannelLoadersOptions,
): Promise<MorphologyImage> {
  const { imageUrl: url, loader } = options
  const channels = loader.channels ?? []
  const zStack = loader.zStack

  if (zStack === undefined || zStack.sizeZ <= 1 || channels.length === 0) {
    return {
      url,
      loader,
      channels,
      channelLoaders: await loadMorphologyChannelLoaders(options),
    }
  }

  // Most recent last.
  const planeChannelLoaders = new Map<number, readonly MorphologyImageChannel[]>()
  const openPlane = async (
    requestedZPlane: number,
    signal?: AbortSignal,
  ): Promise<MorphologyImage> => {
    const zPlane = clampMorphologyZPlane(requestedZPlane, zStack.sizeZ)
    let channelLoaders = planeChannelLoaders.get(zPlane)

    if (channelLoaders === undefined) {
      channelLoaders = await loadMorphologyChannelLoaders({
        imageUrl: url,
        loader,
        openImage: options.openImage,
        onFallback: options.onFallback,
        ...(signal === undefined ? {} : { signal }),
        ...(options.zchunkStoreUrl === undefined
          ? {}
          : { zchunkStoreUrl: options.zchunkStoreUrl }),
        zPlane,
      })
    }

    planeChannelLoaders.delete(zPlane)
    planeChannelLoaders.set(zPlane, channelLoaders)

    for (const cachedZPlane of planeChannelLoaders.keys()) {
      if (planeChannelLoaders.size <= CACHED_Z_PLANES) {
        break
      }

      planeChannelLoaders.delete(cachedZPlane)
    }

    return {
      url,
      loader,
      channels,
      channelLoaders,
      zStack: {
        sizeZ: zStack.sizeZ,
        zPlane,
        ...(zStack.micrometersPerPlane === undefined
          ? {}
          : { micrometersPerPlane: zStack.micrometersPerPlane }),
        openPlane,
      },
    }
  }

  return openPlane(
    options.zPlane ?? defaultMorphologyZPlane(zStack.sizeZ),
    options.signal,
  )
}

async function loadMorphologyChannelLoaders(
  options: LoadMorphologyChannelLoadersOptions,
): Promise<readonly MorphologyImageChannel[]> {
  const channels = options.loader.channels ?? []

  if (channels.length === 0) {
    return []
  }

  const loaderByUrl = new Map<string, ImagePyramidLoader>([
    [options.imageUrl, options.loader],
  ])

  return Promise.all(
    channels.map(async (channel) => {
      const channelUrl = morphologyChannelImageUrl(
        options.imageUrl,
        channel,
        options.zPlane,
      )
      let loader = loaderByUrl.get(channelUrl)

      if (loader === undefined) {
        loader = await openMorphologyImageLoader(options.openImage, channelUrl, {
          onFallback: options.onFallback,
          signal: options.signal,
          zchunkStoreUrl: options.zchunkStoreUrl,
        })
        loaderByUrl.set(channelUrl, loader)
      }

      return {
        info: channel,
        loader,
      }
    }),
  )
}

async function openMorphologyImageLoader(
  openImage: ImagePyramidOpener,
  url: string,
  options: {
    readonly onFallback: FallbackNotifier | undefined
    readonly signal: AbortSignal | undefined
    readonly zchunkStoreUrl?: string | undefined
  },
): Promise<ImagePyramidLoader> {
  try {
    return await openImage(
      url,
      options.signal,
      options.onFallback,
      openImagePyramidOptions(options.zchunkStoreUrl),
    )
  } catch (error) {
    throw likelyMissingFileError(imageFileLabel(url), url, error) ?? error
  }
}

function imageFileLabel(url: string): string {
  return new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? url
}

// Options carrying a manifest sidecar, or none when there is no sidecar.
export function openImagePyramidOptions(
  zchunkStoreUrl: string | undefined,
): OpenImagePyramidOptions | undefined {
  return zchunkStoreUrl === undefined ? undefined : { zchunkStoreUrl }
}

export async function openImagePyramid(
  url: string,
  signal?: AbortSignal,
  onFallback?: FallbackNotifier,
  options?: OpenImagePyramidOptions,
): Promise<ImagePyramidLoader> {
  const rootUrl = omeZarrImageRootUrl(url)

  if (isOmeZarrImageUrl(url) || isOmeZarrImageUrl(rootUrl)) {
    if (options?.zchunkStoreUrl !== undefined) {
      notifyFallback(onFallback, {
        source: 'Morphology image',
        message:
          'The dataset manifest names a .zchunkstore sidecar, but the image is OME-Zarr, so the sidecar is not used.',
        action: 'Remove the sidecar from the manifest; OME-Zarr images do not need one.',
        coalesceKey: `zchunkstore-ome-zarr:${options.zchunkStoreUrl}`,
      })
    }

    return openOmeZarrImage(url, signal)
  }

  return openTiff(url, signal, onFallback, options)
}

function morphologyChannelImageUrl(
  imageUrl: string,
  channel: ImagePyramidChannelInfo,
  zPlane: number | undefined,
): string {
  if (channel.sourceUrl !== undefined) {
    return channel.sourceUrl
  }

  const plane = zPlane === undefined ? undefined : channel.zPlanes?.[zPlane]

  if (plane !== undefined) {
    return tiffPlaneImageUrl(imageUrl, plane)
  }

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

function tiffPlaneImageUrl(imageUrl: string, plane: ImagePyramidPlaneRef): string {
  const fileUrl =
    plane.fileName === undefined ? imageUrl : new URL(plane.fileName, imageUrl).toString()

  if (!urlsReferToSameImage(fileUrl, imageUrl)) {
    return plane.ifdIndex > 0 ? tiffImageSelectionUrl(fileUrl, plane.ifdIndex) : fileUrl
  }

  // The image URL itself opens IFD 0 unless it selects another IFD.
  return plane.ifdIndex === 0 && new URL(imageUrl).hash === ''
    ? imageUrl
    : tiffImageSelectionUrl(imageUrl, plane.ifdIndex)
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
  const url = datasetFileUrlFor(baseUrl, 'experiment')
  const response =
    signal === undefined ? await fetcher(url) : await fetcher(url, { signal })

  if (!response.ok) {
    throw new Error(
      `Unable to load ${datasetFileLabelFor(baseUrl, 'experiment')}: HTTP ${response.status}.`,
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
