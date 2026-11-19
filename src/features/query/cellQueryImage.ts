import type { ChannelHistogram } from '../../data/morphologyContrast'
import type { ImagePyramidLoader } from '../../data/imagePyramid'
import { formatReadSize } from '../plots/plotsPanelModel'
import {
  canMeasureCellImage,
  CELL_IMAGE_REFUSE_BYTES,
  cellImageLevels,
  defaultCellImageLevel,
} from './cellImageMeasurer'
import type {
  CellImageColumnNeed,
  CellImageMeasurements,
  CellImageMeasurementState,
} from './cellImageMeasurements'
import {
  formatMicrometersPerPixel,
  IMAGE_CHANNEL_LIMIT,
  imageChannelLimitCopy,
  type CellQueryColumn,
  type CellQueryImageChannelOption,
  type CellQueryImageColumnSpec,
  type CellQueryRange,
} from './cellQueryModel'

// Cell Query's image columns (plan 25) as the window's model sees them:
// which channels are listed, which columns are measured, and what each
// condition says while its channel is measured.

// A channel of the canvas's image, as App passes it.
export interface CellQueryImageChannel {
  readonly id: string
  readonly name: string
  readonly loader: ImagePyramidLoader
  // RGB channels are not measured (25, Non-Goals).
  readonly rgb: boolean
  // Auto-contrast's, with Otsu's threshold (25-D6).
  readonly histogram?: ChannelHistogram
}

export interface CellQueryImageLevelOption {
  readonly level: number
  readonly label: string
}

// A measurement as a condition or the footer shows it.
export interface CellQueryMeasurementView {
  // Reads the share measured from the model's `imageProgress`.
  readonly key: string
  readonly label: string
  readonly channelName: string
  readonly status: 'measuring' | 'asking' | 'refused' | 'cancelled' | 'error' | 'ready'
  readonly bytes: number | null
  readonly message: string | null
  readonly onMeasure: () => void
  readonly onCancel: () => void
}

// An image condition's own settings (25-D4 to D6).
export interface CellQueryConditionImage {
  readonly spec: CellQueryImageColumnSpec
  readonly channelName: string
  readonly levels: readonly CellQueryImageLevelOption[]
  readonly histogram: ChannelHistogram | null
  readonly measurement: CellQueryMeasurementView
}

// The share of a measurement's tiles read so far, read by the condition that
// shows it rather than through the model, so progress renders the window's
// conditions alone.
export interface CellQueryImageProgress {
  readonly subscribeProgress: (listener: () => void) => () => void
  readonly getProgressVersion: () => number
  progress(key: string): number | null
}

const levelsByLoader = new WeakMap<ImagePyramidLoader, readonly number[]>()

// Each level's micrometres per pixel, worked out once per loader.
export function loaderLevels(loader: ImagePyramidLoader): readonly number[] {
  let levels = levelsByLoader.get(loader)
  if (levels === undefined) {
    levels = cellImageLevels(loader).map((level) => level.micrometersPerPixel)
    levelsByLoader.set(loader, levels)
  }
  return levels
}

export function measurableImageChannels(
  channels: readonly CellQueryImageChannel[],
): readonly CellQueryImageChannel[] {
  return channels.filter((channel) => !channel.rgb && canMeasureCellImage(channel.loader))
}

// Why an image's channels are not in the Image group, or null.
export function imageGroupNote(
  channels: readonly CellQueryImageChannel[],
): string | null {
  if (channels.length === 0 || measurableImageChannels(channels).length > 0) return null
  return channels.every((channel) => channel.rgb)
    ? 'RGB images are not measured'
    : 'This image cannot be measured yet'
}

export function imageChannelOptions(
  channels: readonly CellQueryImageChannel[],
  measurements: Pick<CellImageMeasurements, 'threshold'>,
): readonly CellQueryImageChannelOption[] {
  return measurableImageChannels(channels).map((channel) => ({
    id: channel.id,
    name: channel.name,
    levels: loaderLevels(channel.loader),
    defaultLevel: defaultCellImageLevel(channel.loader),
    threshold: channel.histogram?.threshold ?? measurements.threshold(channel.id),
  }))
}

// "0.85 µm/px, 172 MiB (default)": each level with the size of its tiles
// once the tile index has told it (25-D5).
export function imageLevelOptions(
  channel: CellQueryImageChannelOption,
  sizes: readonly (number | null)[] | undefined,
): readonly CellQueryImageLevelOption[] {
  return channel.levels.map((micrometersPerPixel, level) => {
    const size = sizes?.[level] ?? null
    return {
      level,
      label: `${formatMicrometersPerPixel(micrometersPerPixel)} µm/px${size === null ? '' : `, ${formatReadSize(size)}`}${level === channel.defaultLevel ? ' (default)' : ''}`,
    }
  })
}

// The image columns to measure: those of the first three channels in use
// (25-D2). Columns of further channels are left out and say why.
export function imageColumnNeeds(
  columns: readonly CellQueryColumn[],
  channels: readonly CellQueryImageChannelOption[],
): {
  readonly needs: readonly CellImageColumnNeed[]
  readonly channelsInUse: readonly string[]
  readonly overLimit: ReadonlyMap<string, string>
} {
  const channelsInUse: string[] = []
  const needs: CellImageColumnNeed[] = []
  const overLimit = new Map<string, string>()

  for (const column of columns) {
    if (column.source.kind !== 'image') continue
    const { spec } = column.source
    if (!channelsInUse.includes(spec.channelId)) {
      if (channelsInUse.length >= IMAGE_CHANNEL_LIMIT) {
        overLimit.set(column.id, '')
        continue
      }
      channelsInUse.push(spec.channelId)
    }
    needs.push({
      columnId: column.id,
      stat: spec.stat,
      spec: {
        channelId: spec.channelId,
        level: spec.level,
        z: spec.z ?? null,
        radius: spec.radius ?? null,
        threshold: spec.stat === 'above' ? (spec.threshold ?? null) : null,
      },
    })
  }

  const message = imageChannelLimitCopy(
    channelsInUse.map((id) => channels.find((channel) => channel.id === id)?.name ?? id),
  )
  for (const columnId of overLimit.keys()) overLimit.set(columnId, message)

  return { needs, channelsInUse, overLimit }
}

export function measurementView(
  column: CellQueryColumn,
  channelName: string,
  key: string | undefined,
  state: CellImageMeasurementState | undefined,
  overLimitMessage: string | undefined,
  measurements: Pick<CellImageMeasurements, 'measure' | 'cancel'>,
): CellQueryMeasurementView {
  const base = {
    key: key ?? '',
    label: column.label,
    channelName,
    bytes: null,
    message: null,
    onMeasure: () => {
      if (key !== undefined) measurements.measure(key)
    },
    onCancel: () => {
      if (key !== undefined) measurements.cancel(key)
    },
  }

  if (overLimitMessage !== undefined) {
    return { ...base, status: 'error', message: overLimitMessage }
  }
  if (column.source.kind === 'image' && column.source.spec.stat === 'above') {
    if (column.source.spec.threshold === undefined) {
      return { ...base, status: 'error', message: 'Set a threshold to measure.' }
    }
  }

  switch (state?.status) {
    case undefined:
    case 'planning':
      return { ...base, status: 'measuring' }
    case 'measuring':
      return { ...base, status: 'measuring', bytes: state.bytes }
    case 'asking':
      return { ...base, status: 'asking', bytes: state.bytes }
    case 'refused':
      return {
        ...base,
        status: 'refused',
        bytes: state.bytes,
        message: `Measuring ${channelName} at this resolution would read ${formatReadSize(state.bytes)}, over the ${formatReadSize(CELL_IMAGE_REFUSE_BYTES)} limit. Choose a coarser resolution.`,
      }
    case 'cancelled':
      return { ...base, status: 'cancelled' }
    case 'error':
      return { ...base, status: 'error', message: state.message }
    case 'ready':
      return { ...base, status: 'ready' }
  }
}

const rangesByValues = new WeakMap<Float64Array, CellQueryRange | null>()

// The lowest and highest value measured, for the bounds' note.
export function measuredRange(values: Float64Array): CellQueryRange | undefined {
  let range = rangesByValues.get(values)
  if (range === undefined) {
    let min = Infinity
    let max = -Infinity
    for (const value of values) {
      if (value < min) min = value
      if (value > max) max = value
    }
    range = Number.isFinite(min) ? { min, max } : null
    rangesByValues.set(values, range)
  }
  return range ?? undefined
}
