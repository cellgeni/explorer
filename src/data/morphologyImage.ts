import { openTiff, tiffImageSelectionUrl } from '../tiff/loader'
import {
  omeZarrImageRootUrl,
  omeZarrPlaneSelectionUrl,
  openOmeZarrImage,
} from '../zarr/omeZarrLoader'
import { isIcechunkUrl } from '../zarr/icechunkUrl'
import { isOmeZarrImageUrl } from '../zarr/omeZarrUrl'
import { isZarrZipUrl } from '../zarr/zarrZipUrl'
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
  ImagePyramidPlane,
  ImagePyramidTiffPlaneRef,
  OpenImagePyramidOptions,
} from './imagePyramid'
import { isAbortError } from '../utils/abort'

export interface MorphologyImage {
  readonly url: string
  readonly loader: ImagePyramidLoader
  readonly channels: readonly ImagePyramidChannelInfo[]
  readonly channelLoaders: readonly MorphologyImageChannel[]
  // Set for a z-stack: `channelLoaders` read plane `zStack.zPlane`.
  readonly zStack?: MorphologyImageZStack
  // Set for a time series (plan 28): `channelLoaders` read
  // `timeSeries.timePoint`.
  readonly timeSeries?: MorphologyImageTimeSeries
  // The same image with its channels at another z plane or time point; an
  // axis left out keeps this image's. Set when the image has either.
  readonly openPlane?: (
    plane: ImagePyramidPlane,
    signal?: AbortSignal,
  ) => Promise<MorphologyImage>
}

export interface MorphologyImageZStack {
  readonly sizeZ: number
  readonly zPlane: number
  readonly micrometersPerPlane?: number
}

export interface MorphologyImageTimeSeries {
  readonly sizeT: number
  readonly timePoint: number
  readonly timeStep?: { readonly value: number; readonly unit: string }
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
  // Z plane to open a z-stack at; the image's default plane (the middle one
  // unless it names another) by default.
  readonly zPlane?: number
  // Time point to open a time series at; the image's default by default.
  readonly timePoint?: number
  // The `.zchunkstore` sidecar; the dataset manifest's by default. Null skips
  // the manifest's, for an image it does not cover.
  readonly zchunkStoreUrl?: string | null
}

export interface LoadCustomMorphologyLayerOptions {
  readonly openImage?: ImagePyramidOpener
  readonly onFallback?: FallbackNotifier
  readonly signal?: AbortSignal
  readonly zPlane?: number
  readonly timePoint?: number
}

// Planes whose channel loaders an image keeps, so stepping back to a recent
// plane does not reopen its TIFF directories, and returns the same loaders.
const CACHED_PLANES = 8

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
  const zchunkStoreUrl =
    options.zchunkStoreUrl === null
      ? undefined
      : (options.zchunkStoreUrl ?? zchunkStoreUrlFor(baseUrl))
  const candidates =
    options.candidates ??
    (manifestImage === undefined
      ? await loadMorphologyImageCandidatesFromManifest(baseUrl, fetcher, options.signal)
      : [manifestImage.url])

  const listed = candidates.filter(
    (path) => !isListedAsMissing(datasetFileUrl(baseUrl, path)),
  )
  const failures: MorphologyImageCandidateFailure[] = []

  // Open the first image that works, so a broken first path does not hide the
  // others experiment.xenium names.
  for (const candidate of listed) {
    const url = datasetFileUrl(baseUrl, candidate)
    let loader: ImagePyramidLoader

    try {
      loader = await openMorphologyImageLoader(openImage, url, {
        onFallback: options.onFallback,
        signal: options.signal,
        zchunkStoreUrl,
      })
    } catch (error) {
      if (options.signal?.aborted === true || isAbortError(error)) {
        throw error
      }

      failures.push({ path: candidate, error })
      continue
    }

    notifyImageCandidateFallback(options.onFallback, baseUrl, {
      opened: candidate,
      skipped: candidates
        .slice(0, candidates.indexOf(candidate))
        .filter((path) => !listed.includes(path)),
      failures,
    })

    return createMorphologyImage({
      imageUrl: url,
      loader,
      openImage,
      onFallback: options.onFallback,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(zchunkStoreUrl === undefined ? {} : { zchunkStoreUrl }),
      ...(options.zPlane === undefined ? {} : { zPlane: options.zPlane }),
      ...(options.timePoint === undefined ? {} : { timePoint: options.timePoint }),
    })
  }

  // Every listed image failed: report the preferred one.
  if (failures[0] !== undefined) {
    throw failures[0].error
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

interface MorphologyImageCandidateFailure {
  readonly path: string
  readonly error: unknown
}

// Says which earlier image paths were passed over: missing from the dataset
// folder's listing, or failing to open.
function notifyImageCandidateFallback(
  onFallback: FallbackNotifier | undefined,
  baseUrl: string,
  {
    opened,
    skipped,
    failures,
  }: {
    readonly opened: string
    readonly skipped: readonly string[]
    readonly failures: readonly MorphologyImageCandidateFailure[]
  },
): void {
  const reasons: string[] = []

  if (skipped.length > 0) {
    reasons.push(
      `${skipped.join(', ')} ${skipped.length === 1 ? 'is' : 'are'} not in the dataset folder listing`,
    )
  }

  const firstFailure = failures[0]

  if (firstFailure !== undefined) {
    reasons.push(
      `${failures.map((failure) => failure.path).join(', ')} could not be opened (${errorMessage(firstFailure.error)})`,
    )
  }

  if (reasons.length === 0) {
    return
  }

  notifyFallback(onFallback, {
    source: 'Morphology image',
    message: `${reasons.join(', and ')}, so the app opened ${opened}, the next image named in experiment.xenium.`,
    action:
      failures.length > 0
        ? 'Check that the image path is readable to show it instead.'
        : 'Add the missing image to the dataset folder to show it instead.',
    coalesceKey: `morphology-image-candidate:${baseUrl}`,
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : String(error)
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
    ...(options.timePoint === undefined ? {} : { timePoint: options.timePoint }),
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

    try {
      return await loadMorphologyImageFromUrl(fallbackUrl, loadOptions)
    } catch (fallbackError) {
      if (options.signal?.aborted) {
        throw fallbackError
      }

      // Report the attempt the server answered: the http: read's 404 or "not
      // a TIFF", unless it got no response (an HTTPS page blocks it as mixed
      // content) and the https: retry did. The other is kept as the cause.
      throw gotNoResponse(error) && !gotNoResponse(fallbackError)
        ? withCause(fallbackError, error)
        : withCause(error, fallbackError)
    }
  }
}

// A fetch that failed without a response throws a TypeError, which readers
// may wrap (the Range probe keeps it as the cause).
function gotNoResponse(error: unknown): boolean {
  let current = error

  for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
    if (current.name === 'TypeError') {
      return true
    }

    current = current.cause
  }

  return false
}

function withCause(error: unknown, cause: unknown): unknown {
  if (error instanceof Error && error.cause === undefined) {
    error.cause = cause
  }

  return error
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
    ...(options.timePoint === undefined ? {} : { timePoint: options.timePoint }),
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

export function clampMorphologyTimePoint(timePoint: number, sizeT: number): number {
  if (!Number.isFinite(timePoint)) {
    return 0
  }

  return Math.min(Math.max(0, Math.round(timePoint)), Math.max(0, sizeT - 1))
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
  readonly timePoint?: number
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
    ...(options.timePoint === undefined ? {} : { timePoint: options.timePoint }),
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
  readonly timePoint?: number
}

async function createMorphologyImage(
  options: LoadMorphologyChannelLoadersOptions,
): Promise<MorphologyImage> {
  const { imageUrl: url, loader } = options
  const channels = loader.channels ?? []
  const zStack =
    loader.zStack !== undefined && loader.zStack.sizeZ > 1 ? loader.zStack : undefined
  const timeSeries =
    loader.timeSeries !== undefined && loader.timeSeries.sizeT > 1
      ? loader.timeSeries
      : undefined

  if ((zStack === undefined && timeSeries === undefined) || channels.length === 0) {
    return {
      url,
      loader,
      channels,
      channelLoaders: await loadMorphologyChannelLoaders(options),
    }
  }

  const loaderOptions = {
    imageUrl: url,
    loader,
    openImage: options.openImage,
    onFallback: options.onFallback,
    ...(options.zchunkStoreUrl === undefined
      ? {}
      : { zchunkStoreUrl: options.zchunkStoreUrl }),
  }
  // A loader that makes its other planes itself (OME-Zarr, plan 28-D5): the
  // channels are opened once, at the loader's own plane, and each plane is
  // made from them without requests. Otherwise each plane's channels are
  // opened from their URLs (TIFF).
  let rootChannelLoaders: readonly MorphologyImageChannel[] | null = null
  const loadPlane = async (
    z: number | undefined,
    t: number | undefined,
    signal: AbortSignal | undefined,
  ): Promise<readonly MorphologyImageChannel[]> => {
    const signalOption = signal === undefined ? {} : { signal }

    if (loader.atPlane === undefined) {
      return loadMorphologyChannelLoaders({
        ...loaderOptions,
        ...signalOption,
        ...(z === undefined ? {} : { zPlane: z }),
      })
    }

    rootChannelLoaders ??= await loadMorphologyChannelLoaders({
      ...loaderOptions,
      ...signalOption,
    })
    const plane = { ...(z === undefined ? {} : { z }), ...(t === undefined ? {} : { t }) }

    return rootChannelLoaders.map((channel) => ({
      info: channel.info,
      loader: channel.loader.atPlane?.(plane) ?? channel.loader,
    }))
  }
  // Most recent last.
  const planeChannelLoaders = new Map<string, readonly MorphologyImageChannel[]>()
  const openPlane = async (
    requestedZPlane: number | undefined,
    requestedTimePoint: number | undefined,
    signal?: AbortSignal,
  ): Promise<MorphologyImage> => {
    const zPlane =
      zStack === undefined
        ? undefined
        : clampMorphologyZPlane(
            requestedZPlane ??
              zStack.defaultZPlane ??
              defaultMorphologyZPlane(zStack.sizeZ),
            zStack.sizeZ,
          )
    const timePoint =
      timeSeries === undefined
        ? undefined
        : clampMorphologyTimePoint(
            requestedTimePoint ?? timeSeries.defaultTimePoint,
            timeSeries.sizeT,
          )
    const key = `${zPlane?.toString() ?? ''}:${timePoint?.toString() ?? ''}`
    const channelLoaders =
      planeChannelLoaders.get(key) ?? (await loadPlane(zPlane, timePoint, signal))

    planeChannelLoaders.delete(key)
    planeChannelLoaders.set(key, channelLoaders)

    for (const cachedKey of planeChannelLoaders.keys()) {
      if (planeChannelLoaders.size <= CACHED_PLANES) {
        break
      }

      planeChannelLoaders.delete(cachedKey)
    }

    return {
      url,
      loader,
      channels,
      channelLoaders,
      ...(zStack === undefined || zPlane === undefined
        ? {}
        : {
            zStack: {
              sizeZ: zStack.sizeZ,
              zPlane,
              ...(zStack.micrometersPerPlane === undefined
                ? {}
                : { micrometersPerPlane: zStack.micrometersPerPlane }),
            },
          }),
      ...(timeSeries === undefined || timePoint === undefined
        ? {}
        : {
            timeSeries: {
              sizeT: timeSeries.sizeT,
              timePoint,
              ...(timeSeries.timeStep === undefined
                ? {}
                : { timeStep: timeSeries.timeStep }),
            },
          }),
      openPlane: (plane, planeSignal) =>
        openPlane(plane.z ?? zPlane, plane.t ?? timePoint, planeSignal),
    }
  }

  return openPlane(options.zPlane, options.timePoint, options.signal)
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
        options.loader.zStack?.defaultZPlane,
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

  // An image in an Icechunk repository or a zip is OME-Zarr.
  if (
    isOmeZarrImageUrl(url) ||
    isOmeZarrImageUrl(rootUrl) ||
    isIcechunkUrl(url) ||
    isZarrZipUrl(rootUrl)
  ) {
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
  defaultZPlane: number | undefined,
): string {
  const plane = zPlane === undefined ? undefined : channel.zPlanes?.[zPlane]

  if (plane !== undefined && 'zIndex' in plane) {
    const channelUrl = channel.sourceUrl ?? imageUrl

    // The channel's own URL reads the image's default plane, so channel 0
    // keeps the image URL's loader there.
    return plane.zIndex === defaultZPlane
      ? channelUrl
      : omeZarrPlaneSelectionUrl(channelUrl, plane.zIndex)
  }

  if (channel.sourceUrl !== undefined) {
    return channel.sourceUrl
  }

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

function tiffPlaneImageUrl(imageUrl: string, plane: ImagePyramidTiffPlaneRef): string {
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
