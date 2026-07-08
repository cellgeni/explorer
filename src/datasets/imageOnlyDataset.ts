import { micrometers } from '../data/coords'
import { openTiff } from '../tiff/loader'
import type { GexResult } from '../data/gex'
import type { TiffPyramidLoader } from '../tiff/loader'
import type {
  Annotation,
  DatasetMeta,
  ElementBatch,
  ImageSource,
  SpatialDataset,
  SpatialElementId,
} from './spatialDataset'

export type ImageOnlyTiffLoader = (url: string) => Promise<TiffPyramidLoader>

export interface ImageOnlyDatasetOptions {
  readonly imageUrl: string
  readonly openImage?: ImageOnlyTiffLoader
}

export class ImageOnlyDataset implements SpatialDataset<SpatialElementId> {
  readonly imageUrl: string
  private readonly openImage: ImageOnlyTiffLoader
  private loaderPromise: Promise<TiffPyramidLoader> | null = null

  constructor(options: ImageOnlyDatasetOptions) {
    this.imageUrl = options.imageUrl
    this.openImage = options.openImage ?? openTiff
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
    return { kind: 'pyramid', loader: await this.loader() }
  }

  private loader(): Promise<TiffPyramidLoader> {
    this.loaderPromise ??= this.openImage(this.imageUrl)
    return this.loaderPromise
  }
}
