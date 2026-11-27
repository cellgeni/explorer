import type { FlatMorphologyCanvasImage } from '../../components/MorphologyCanvas'
import { collectionChannelSettingsFor } from '../../data/datasetFiles'
import {
  morphologyImageFromPyramidLoader,
  type MorphologyImage,
  type MorphologyImageChannel,
} from '../../data/morphologyImage'
import type { AnnDataVisiumSummary } from '../../datasets/h5adDataset'
import type {
  MerscopeImageChoice,
  MerscopeImageOptions,
  MerscopeImageReadOptions,
} from '../../datasets/merscopeDataset'
import type { DatasetMeta, ImageSource } from '../../datasets/spatialDataset'
import type { VisiumImageKind } from '../../datasets/visiumFormat'
import type {
  MorphologyImageLoader,
  SpatialDatasetDetector,
  SpatialDatasetLoader,
} from '../app-shell/appDependencies'
import { flatMorphologyImageFromSource } from '../app-shell/useVisiumHdBinWorkflow'
import { parseAteraImageChoice } from '../dataset/ateraImageModel'
import {
  imageDatasetChannelIds,
  manifestDefaultsToShareableState,
  resolveMorphologyChannelSelection,
} from '../dataset/datasetManifestModel'
import { merscopeImageForLoad } from '../dataset/merscopeImageModel'
import { visiumImageForLoad } from '../dataset/visiumModel'
import {
  defaultEnabledChannelIds,
  mergeMorphologyChannelDefaults,
  type MorphologyChannelDefaults,
} from '../morphology/morphologyChannels'

// The image a dataset opens with in the main view, opened on its own for a
// panel beside it (plan 30-D4): the same file, plane and placement, by the
// same per-platform steps as the dataset load (useDatasetLifecycle.ts), with
// the dataset manifest's and collection's defaults and nothing from the link. Only what the
// image needs is read.

export type PanelImage =
  | {
      readonly kind: 'pyramid'
      readonly image: MorphologyImage
      // The channels shown at first; undefined shows the first only.
      readonly enabledChannelIds: readonly string[] | undefined
      // Native RGB (H&E) keeps its full window, as in the main view.
      readonly autoContrast: boolean
      // The colours and windows the dataset manifest and collection set.
      readonly channelDefaults?: MorphologyChannelDefaults
    }
  | { readonly kind: 'flat'; readonly image: FlatMorphologyCanvasImage }

interface ReadOptions {
  readonly signal?: AbortSignal
}

// What the steps below call on each platform's dataset.
interface ImageDataset {
  image(options?: ReadOptions): Promise<ImageSource | null>
}

interface MetaDataset {
  meta(): Promise<DatasetMeta>
}

interface AteraImageDataset {
  morphologyUrl(): Promise<string | null>
  morphology3dUrl(): Promise<string | null>
}

interface MerscopeImageDataset {
  imageOptions(): Promise<MerscopeImageOptions | null>
  imageSource(
    choice: MerscopeImageChoice,
    options?: MerscopeImageReadOptions,
  ): Promise<ImageSource>
}

interface VisiumImageDataset extends MetaDataset {
  visiumSummary(options?: ReadOptions): Promise<AnnDataVisiumSummary | null>
  tissueImage(kind: VisiumImageKind): Promise<ImageSource | null>
}

export interface PanelImageLoaders {
  readonly detectSpatialDataset: SpatialDatasetDetector
  readonly getSpatialDataset: SpatialDatasetLoader
  readonly loadMorphologyImage: MorphologyImageLoader
}

// Null for a dataset without an image.
export async function loadPanelImage(
  url: string,
  loaders: PanelImageLoaders,
  signal?: AbortSignal,
): Promise<PanelImage | null> {
  const signalOption = signal === undefined ? {} : { signal }
  const detection = await loaders.detectSpatialDataset(url, signalOption)
  signal?.throwIfAborted()

  if (detection.platform === 'unknown') return null

  const defaults = manifestDefaultsToShareableState(detection.manifest?.defaults).state
  const plane = {
    ...(defaults.morphologyZPlane === undefined
      ? {}
      : { zPlane: defaults.morphologyZPlane }),
    ...(defaults.morphologyTimePoint === undefined
      ? {}
      : { timePoint: defaults.morphologyTimePoint }),
  }
  const selection = defaults.morphologyEnabledChannelIds
  const channelDefaults = mergeMorphologyChannelDefaults(
    detection.manifest?.defaults?.channelSettings,
    collectionChannelSettingsFor(detection.baseUrl),
  )
  // The dataset as the previews open it, so the image is placed with the
  // cells they draw.
  const dataset: unknown = await loaders.getSpatialDataset(detection.baseUrl, {
    detection,
    ...signalOption,
  })
  signal?.throwIfAborted()

  if (detection.platform === 'xenium') {
    const image = await loaders.loadMorphologyImage(url, { ...signalOption, ...plane })

    return pyramid(
      image,
      chosenChannels(image, selection, undefined),
      true,
      channelDefaults,
    )
  }

  if (detection.platform === 'atera') {
    if (!hasMethods<AteraImageDataset>(dataset, 'morphologyUrl', 'morphology3dUrl')) {
      return null
    }

    const [morphologyUrl, morphology3dUrl] = await Promise.all([
      dataset.morphologyUrl(),
      dataset.morphology3dUrl(),
    ])
    const choice =
      morphology3dUrl !== null &&
      (morphologyUrl === null || parseAteraImageChoice(defaults.ateraImage) === '3d')
        ? '3d'
        : '2d'
    const imageUrl = choice === '3d' ? morphology3dUrl : morphologyUrl
    if (imageUrl === null) return null

    const image = await loaders.loadMorphologyImage(url, {
      candidates: [imageUrl],
      ...signalOption,
      ...plane,
      ...(choice === '3d' ? { zchunkStoreUrl: null } : {}),
    })

    return pyramid(
      image,
      chosenChannels(image, selection, undefined),
      true,
      channelDefaults,
    )
  }

  if (detection.platform === 'merscope') {
    if (!hasMethods<MerscopeImageDataset>(dataset, 'imageOptions', 'imageSource')) {
      return null
    }

    const options = await dataset.imageOptions()
    if (options === null) return null

    // A large default image waits to be chosen in the main view; asked for
    // here, it is read.
    const { choice, deferred } = merscopeImageForLoad(options, defaults.merscopeImage)
    const shown = choice ?? (deferred ? options.defaultChoice : null)
    if (shown === null) return null

    const source = await dataset.imageSource(shown, signalOption)

    return source.kind === 'pyramid'
      ? pyramid(
          await imageFromSource(source.loader.url, source, signal),
          undefined,
          true,
          channelDefaults,
        )
      : null
  }

  if (detection.platform === 'image') {
    if (!hasMethods<ImageDataset>(dataset, 'image')) return null

    const source = await dataset.image()
    if (source?.kind !== 'pyramid') return null

    const image = await imageFromSource(detection.imageUrl, source, signal, plane)

    return pyramid(
      image,
      imageDatasetChannelIds(image.channelLoaders, selection),
      true,
      channelDefaults,
    )
  }

  if (detection.platform === 'visium-hd') {
    if (!hasMethods<ImageDataset & MetaDataset>(dataset, 'image', 'meta')) return null

    const [source, meta] = await Promise.all([dataset.image(), dataset.meta()])

    return flatPanelImage(flatMorphologyImageFromSource(source, meta))
  }

  // Standard Visium, from Space Ranger output or an AnnData table with
  // `uns/spatial`.
  if (detection.platform === 'visium' || detection.platform === 'h5ad') {
    const flat = await visiumImage(dataset, defaults.visiumImage, signal)
    if (flat !== undefined) return flat
  }

  // An AnnData table's attached image, or a SpatialData store's.
  if (detection.platform === 'h5ad' || detection.platform === 'spatialdata') {
    if (!hasMethods<ImageDataset>(dataset, 'image')) return null

    const source = await dataset.image(signalOption)
    if (source?.kind !== 'pyramid') return null

    const image = await imageFromSource(source.loader.url, source, signal, plane)
    const native = isNativeRgb(image)

    return pyramid(
      image,
      chosenChannels(image, selection, defaultEnabledChannelIds(image.channelLoaders)),
      !native,
      channelDefaults,
    )
  }

  return null
}

// A Visium tissue image: undefined when the dataset is not Visium, as an
// AnnData table without `uns/spatial`.
async function visiumImage(
  dataset: unknown,
  shared: string | undefined,
  signal: AbortSignal | undefined,
): Promise<PanelImage | null | undefined> {
  if (!hasMethods<VisiumImageDataset>(dataset, 'meta', 'visiumSummary', 'tissueImage')) {
    return undefined
  }

  const summary = await dataset.visiumSummary(signal === undefined ? {} : { signal })
  if (summary === null) return undefined

  const kind = visiumImageForLoad(summary.images, shared)
  if (kind === null) return null

  const [source, meta] = await Promise.all([dataset.tissueImage(kind), dataset.meta()])

  return flatPanelImage(flatMorphologyImageFromSource(source, meta))
}

function flatPanelImage(image: FlatMorphologyCanvasImage | null): PanelImage | null {
  return image === null ? null : { kind: 'flat', image }
}

function pyramid(
  image: MorphologyImage,
  enabledChannelIds: readonly string[] | undefined,
  autoContrast: boolean,
  channelDefaults: MorphologyChannelDefaults | undefined,
): PanelImage {
  return {
    kind: 'pyramid',
    image,
    enabledChannelIds,
    autoContrast,
    ...(channelDefaults === undefined ? {} : { channelDefaults }),
  }
}

function imageFromSource(
  url: string,
  source: Extract<ImageSource, { kind: 'pyramid' }>,
  signal: AbortSignal | undefined,
  plane: { readonly zPlane?: number; readonly timePoint?: number } = {},
): Promise<MorphologyImage> {
  const { openChannelLoader } = source

  return morphologyImageFromPyramidLoader(url, source.loader, {
    ...(signal === undefined ? {} : { signal }),
    ...(openChannelLoader === undefined ? {} : { openImage: openChannelLoader }),
    ...plane,
  })
}

function chosenChannels(
  image: MorphologyImage,
  selection: readonly string[] | undefined,
  defaults: readonly string[] | undefined,
): readonly string[] | undefined {
  return selection === undefined
    ? defaults
    : resolveMorphologyChannelSelection(image.channelLoaders, selection, defaults)
}

function isNativeRgb(image: MorphologyImage): boolean {
  return (
    image.channelLoaders.length === 3 &&
    image.channelLoaders.every(
      (channel: MorphologyImageChannel) => channel.info.alphaFromIntensity === false,
    )
  )
}

function hasMethods<T>(
  value: unknown,
  ...keys: readonly (keyof T & string)[]
): value is T {
  return (
    typeof value === 'object' &&
    value !== null &&
    keys.every((key) => typeof (value as Record<string, unknown>)[key] === 'function')
  )
}
