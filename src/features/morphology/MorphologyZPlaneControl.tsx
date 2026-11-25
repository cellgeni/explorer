import { useId } from 'react'
import type { MorphologyImageZStack } from '../../data/morphologyImage'

type ZStackSummary = Pick<
  MorphologyImageZStack,
  'sizeZ' | 'zPlane' | 'micrometersPerPlane'
>

interface MorphologyZPlaneControlProps {
  readonly zStack: ZStackSummary
  // The plane being opened, shown until it replaces `zStack.zPlane`.
  readonly requestedZPlane: number | null
  // False while the canvas still shows another plane (plan 28-D6).
  readonly frameShown?: boolean
  readonly onZPlaneChange: (zPlane: number) => void
}

export function MorphologyZPlaneControl({
  zStack,
  requestedZPlane,
  frameShown = true,
  onZPlaneChange,
}: MorphologyZPlaneControlProps) {
  const inputId = useId()
  const zPlane = requestedZPlane ?? zStack.zPlane
  const label = morphologyZPlaneLabel(zStack, zPlane)
  const busy = requestedZPlane !== null || !frameShown

  return (
    <div className="layer-opacity-control z-plane-control" aria-busy={busy}>
      <div className="layer-opacity-header">
        <label htmlFor={inputId}>Z plane</label>
        <span>{busy ? `${label} …` : label}</span>
      </div>
      <input
        id={inputId}
        type="range"
        min="0"
        max={zStack.sizeZ - 1}
        step="1"
        value={zPlane}
        aria-valuetext={label}
        title="Z plane"
        onChange={(event) => {
          onZPlaneChange(event.currentTarget.valueAsNumber)
        }}
      />
    </div>
  )
}

// One-based plane position, plus the depth from the first plane when the
// OME-XML gives PhysicalSizeZ: "8 / 15 · 21 µm".
function morphologyZPlaneLabel(
  zStack: Pick<ZStackSummary, 'sizeZ' | 'micrometersPerPlane'>,
  zPlane: number,
): string {
  const position = `${(zPlane + 1).toString()} / ${zStack.sizeZ.toString()}`

  if (zStack.micrometersPerPlane === undefined) {
    return position
  }

  const depth = Number((zPlane * zStack.micrometersPerPlane).toFixed(2))

  return `${position} · ${depth.toLocaleString()} µm`
}
