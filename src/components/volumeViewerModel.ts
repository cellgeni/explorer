import type { OrbitViewState } from '@deck.gl/core'
import type { ImagePyramidVolumeLevel } from '../data/imagePyramid'
import { MAX_VOLUME_CHANNELS } from '../data/imageVolume'

// Tilted, so that the first view shows depth.
const INITIAL_ROTATION_X = 30
const INITIAL_ROTATION_ORBIT = -30

// Looking at the centre of the volume, zoomed so that it fits at any angle.
export function fittedVolumeViewState(
  extent: readonly [number, number, number],
  size: { readonly width: number; readonly height: number },
): OrbitViewState {
  const diameter = Math.hypot(...extent) || 1
  const pixels = Math.max(1, Math.min(size.width, size.height)) * 0.9

  return {
    target: [0, 0, 0],
    rotationX: INITIAL_ROTATION_X,
    rotationOrbit: INITIAL_ROTATION_ORBIT,
    zoom: Math.log2(pixels / diameter),
  }
}

// What the 3D view says under the volume: its resolution, how much is read,
// or why nothing is drawn; and which channels it draws when more are on than
// it can draw.
export function volumeStatus({
  level,
  levelCount,
  channels,
  enabledChannelCount,
  progress,
}: {
  readonly level: ImagePyramidVolumeLevel | null
  readonly levelCount: number
  // Channels read so far, and those turned on in the image controls, which
  // may be more than the 3D view draws.
  readonly channels: readonly unknown[]
  readonly enabledChannelCount: number
  readonly progress: { readonly planesRead: number; readonly planesTotal: number } | null
}): string | null {
  if (level === null) {
    return 'This image is too large to show in 3D.'
  }

  if (enabledChannelCount === 0) {
    return 'Turn on a channel to show it in 3D.'
  }

  const status = volumeReadStatus(level, levelCount, channels, progress)

  if (enabledChannelCount <= MAX_VOLUME_CHANNELS) {
    return status
  }

  const shown = `Showing the first ${MAX_VOLUME_CHANNELS.toString()} of ${enabledChannelCount.toLocaleString()} enabled channels`
  return status === null ? shown : `${status}. ${shown}`
}

function volumeReadStatus(
  level: ImagePyramidVolumeLevel,
  levelCount: number,
  channels: readonly unknown[],
  progress: { readonly planesRead: number; readonly planesTotal: number } | null,
): string | null {
  const voxels = `${level.width.toLocaleString()} × ${level.height.toLocaleString()} × ${level.depth.toLocaleString()} voxels`
  const resolution =
    levelCount > 1
      ? `Level ${(level.level + 1).toString()} of ${levelCount.toString()}, ${voxels}`
      : voxels

  if (progress !== null) {
    return `Reading ${resolution}: ${progress.planesRead.toLocaleString()} of ${progress.planesTotal.toLocaleString()} planes`
  }

  return channels.length === 0 ? null : resolution
}
