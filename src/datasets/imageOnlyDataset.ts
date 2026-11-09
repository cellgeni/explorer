import { micrometers } from '../data/coords'
import { openImagePyramid, openImagePyramidOptions } from '../data/morphologyImage'
import type { FallbackNotifier } from '../data/fallbackNotice'
import type { GexResult } from '../data/gex'
import type { ImagePyramidLoader, ImagePyramidOpener } from '../data/imagePyramid'
import type {
  Annotation,
  DatasetMeta,
  ElementBatch,
  ImageSource,
  SpatialDataset,
  SpatialElementId,
} from './spatialDataset'

export interface ImageOnlyDatasetOptions {
  readonly imageUrl: string
  // `.zchunkstore` sidecar named by the dataset manifest.
  readonly zchunkStoreUrl?: string
  readonly openImage?: ImagePyramidOpener
}

export class ImageOnlyDataset implements SpatialDataset<SpatialElementId> {
  readonly imageUrl: string
  private readonly zchunkStoreUrl: string | undefined
  private readonly openImage: ImagePyramidOpener
  private loaderPromise: Promise<ImagePyramidLoader> | null = null

  constructor(options: ImageOnlyDatasetOptions) {
    this.imageUrl = options.imageUrl
    this.zchunkStoreUrl = options.zchunkStoreUrl
    this.openImage = options.openImage ?? openImagePyramid
  }

  async meta(): Promise<DatasetMeta> {
    const loader = await this.loader()
    const widthMicrometers = loader.imageWidth * loader.units.micrometersPerPixel
    const heightMicrometers = loader.imageHeight * loader.units.micrometersPerPixel

    return {
      platform: 'image',
      units: loader.units,
      extent: {
        minX: micrometers(0),
        maxX: micrometers(widthMicrometers),
        minY: micrometers(0),
        maxY: micrometers(heightMicrometers),
      },
      capabilities: {
        transcripts: false,
        cellBoundaries: false,
        pyramidImage: true,
        multiChannel: loader.channels.length > 1,
      },
      channels: loader.channels.map((channel) => ({
        id: channel.id,
        index: channel.index,
        name: channel.name,
        color: channel.color,
        contrast: channel.contrast,
        ...(channel.fileName === undefined ? {} : { fileName: channel.fileName }),
        ...(channel.purpose === undefined ? {} : { purpose: channel.purpose }),
      })),
    }
  }

  async elements(): Promise<ElementBatch<SpatialElementId>> {
    return { elements: [] }
  }

  async matrix(ids: readonly SpatialElementId[]): Promise<GexResult<SpatialElementId>> {
    return {
      geneNames: [],
      cells: new Map(ids.map((id) => [id, { geneNames: [], counts: [] }])),
    }
  }

  async annotations(): Promise<readonly Annotation<SpatialElementId>[]> {
    return []
  }

  async image(): Promise<ImageSource> {
    return {
      kind: 'pyramid',
      loader: await this.loader(),
      openChannelLoader: (url, signal, onFallback) =>
        this.openSourceImage(url, signal, onFallback),
    }
  }

  private loader(): Promise<ImagePyramidLoader> {
    this.loaderPromise ??= this.openSourceImage(this.imageUrl)
    return this.loaderPromise
  }

  // The image and its channel files (`#ifd=N` or sibling files) open with the
  // manifest's sidecar.
  private openSourceImage(
    url: string,
    signal?: AbortSignal,
    onFallback?: FallbackNotifier,
  ): Promise<ImagePyramidLoader> {
    return this.openImage(
      url,
      signal,
      onFallback,
      openImagePyramidOptions(this.zchunkStoreUrl),
    )
  }
}
