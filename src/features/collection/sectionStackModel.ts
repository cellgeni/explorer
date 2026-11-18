import {
  collectionEntryFor,
  type DatasetCollection,
  type DatasetCollectionEntry,
} from '../../datasets/datasetCollection'
import type { PreviewBounds } from './collectionPreviewData'
import type { PreviewEntry } from './collectionPreviewStore'
import { collectionEntryLabel } from './collectionModel'

// Serial sections stacked in 3D: every section of the open dataset's
// coordinate system, at the depth (z) the collection gives it. Their cells
// are registered in x and y, so each section is its cells lifted to its
// depth. The link names the stack with sectionView=3d.

export interface StackSection {
  readonly entry: DatasetCollectionEntry
  readonly z: number
}

// Serial sections are a few micrometres apart across millimetres of tissue,
// so at true depth a stack is flat; the Depth control stretches it.
export const MIN_STACK_DEPTH_SCALE_LOG2 = -2
export const MAX_STACK_DEPTH_SCALE_LOG2 = 7
// A stack opens stretched to about this fraction of its width deep.
const OPENING_DEPTH_FRACTION = 0.25

// The sections stacked with the open dataset, shallowest first, entries at
// one depth in collection order. None unless its coordinate system gives
// depths, for at least two sections.
export function stackSections(
  collection: DatasetCollection | null,
  openUrl: string | null,
): readonly StackSection[] {
  if (collection === null) return []

  const openEntry = collectionEntryFor(collection, openUrl)
  const system = openEntry?.coordinateSystem
  if (system === undefined || openEntry?.z === undefined) return []

  const sections = collection.datasets.flatMap((entry) =>
    entry.coordinateSystem === system && entry.z !== undefined
      ? [{ entry, z: entry.z }]
      : [],
  )

  return sections.length < 2 ? [] : sections.sort((first, second) => first.z - second.z)
}

// Where the stack is: the middle of the read sections' cells, which the
// camera orbits, and how far they spread. Depths are every section's, read
// or not, so the stack does not move as sections arrive.
export interface StackFrame {
  readonly centerX: number
  readonly centerY: number
  readonly centerZ: number
  readonly width: number
  readonly height: number
  readonly depth: number
}

export function stackFrame(
  depths: readonly number[],
  bounds: readonly (PreviewBounds | null)[],
): StackFrame | null {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  for (const box of bounds) {
    if (box === null) continue

    minX = Math.min(minX, box.minX)
    maxX = Math.max(maxX, box.maxX)
    minY = Math.min(minY, box.minY)
    maxY = Math.max(maxY, box.maxY)
  }

  if (!Number.isFinite(minX) || depths.length === 0) return null

  const minZ = Math.min(...depths)
  const maxZ = Math.max(...depths)

  return {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    centerZ: (minZ + maxZ) / 2,
    width: maxX - minX,
    height: maxY - minY,
    depth: maxZ - minZ,
  }
}

// The stretch a stack opens with: the power of two that makes it about a
// quarter as deep as it is wide, never flattened.
export function openingStackDepthScaleLog2(frame: StackFrame | null): number {
  if (frame === null || frame.depth <= 0) return 0

  const wanted =
    (Math.max(frame.width, frame.height) * OPENING_DEPTH_FRACTION) / frame.depth
  if (!(wanted > 1)) return 0

  return Math.min(MAX_STACK_DEPTH_SCALE_LOG2, Math.round(Math.log2(wanted)))
}

// Places a section's cells, drawn at (x, -y, 0), in the stack: centred on
// the frame, at its stretched depth. Column-major, as deck.gl takes it.
export function sectionModelMatrix(
  frame: StackFrame,
  z: number,
  depthScale: number,
): Float32Array {
  // prettier-ignore
  return Float32Array.of(
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    -frame.centerX, frame.centerY, (z - frame.centerZ) * depthScale, 1,
  )
}

// What the stack says under it: sections still being read, and those it
// cannot show, by name.
export interface StackStatus {
  readonly reading: string | null
  readonly missing: string | null
}

export function stackStatus(
  sections: readonly StackSection[],
  previews: readonly (PreviewEntry | null)[],
  colored: boolean,
): StackStatus {
  let done = 0
  const missing: string[] = []

  sections.forEach((section, index) => {
    const preview = previews[index] ?? null
    const label = collectionEntryLabel(section.entry)

    if (preview?.unavailable != null) {
      missing.push(`${label} (${lowerFirst(preview.unavailable)})`)
      done += 1
    } else if (preview?.error != null) {
      missing.push(`${label} (could not be read)`)
      done += 1
    } else if (
      preview !== null &&
      preview.cells !== null &&
      !(colored && preview.loading)
    ) {
      done += 1
    }
  })

  return {
    reading:
      done < sections.length
        ? `Reading sections: ${done.toLocaleString()} of ${sections.length.toLocaleString()}`
        : null,
    missing: missing.length === 0 ? null : `Not shown: ${missing.join(', ')}`,
  }
}

function lowerFirst(text: string): string {
  return text
    .replace(/\.$/, '')
    .replace(/^[A-Z](?![A-Z])/, (letter) => letter.toLowerCase())
}
