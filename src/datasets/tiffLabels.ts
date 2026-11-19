import type { TiffPyramidLoader } from '../tiff/loader'
import { sharedStripDecodePool } from '../workers/tileDecodePool'
import { traceTiffLabelTile } from '../workers/tiffLabelTraceCore'
import {
  LabelOutlineReader,
  type LabelChunkTracer,
  type LabelLevelGeometry,
} from './spatialDataLabels'
import type { Affine2D } from './spatialDataTransforms'

// A TIFF label image (an integer segmentation mask, such as Cellpose's
// `_cp_masks.tif`), traced into outlines one TIFF tile at a time. Tiled and
// stripped files are read as the image loader reads them: a stripped level
// is cut into tiles from bands of whole rows. Pyramid levels (SubIFDs) are
// used as for images.

export interface TiffLabelLevel extends LabelLevelGeometry {
  // The level's index in the loader.
  readonly index: number
}

export interface OpenTiffLabelsOptions {
  readonly signal?: AbortSignal
  // The whole file, read without requests (a picked file).
  readonly bytes?: Uint8Array<ArrayBuffer>
}

// The mask's tile reader; placing its outlines is up to the caller.
export async function openTiffLabelLoader(
  url: string,
  options: OpenTiffLabelsOptions = {},
): Promise<TiffPyramidLoader> {
  const { openTiff } = await import('../tiff/loader')
  return openTiff(url, options.signal, undefined, {
    labels: true,
    ...(options.bytes === undefined ? {} : { bytes: options.bytes }),
  })
}

// Outlines come back in `toTarget` applied to level-0 mask pixels.
export function tiffLabelOutlineReader(
  loader: TiffPyramidLoader,
  toTarget: Affine2D,
): LabelOutlineReader<TiffLabelLevel> {
  const levels: TiffLabelLevel[] = []

  for (let index = 0; index < loader.numLevels; index += 1) {
    const size = loader.levelSize(index)
    levels.push({
      index,
      width: size.width,
      height: size.height,
      chunkWidth: loader.tileWidth,
      chunkHeight: loader.tileHeight,
      scaleX: loader.imageWidth / size.width,
      scaleY: loader.imageHeight / size.height,
    })
  }

  return new LabelOutlineReader(levels, toTarget, tiffLabelTracer(loader))
}

// Fetches a tile here (so the loader's byte-range cache and strip bands
// apply) and decodes and traces it in the tile decode workers, or here where
// there are none.
function tiffLabelTracer(loader: TiffPyramidLoader): LabelChunkTracer<TiffLabelLevel> {
  return async ({ level, col, row, x0, y0, width, height, signal }) => {
    const bytes = await loader.fetchTileBytes(level.index, col, row, signal)
    const options = {
      ...loader.tileDecodeOptions(level.index, col, row),
      width,
      height,
      levelX0: x0,
      levelY0: y0,
      levelWidth: level.width,
    }
    const pool = sharedStripDecodePool()

    return pool === null
      ? traceTiffLabelTile(bytes, options)
      : pool.traceLabels(bytes, options)
  }
}
