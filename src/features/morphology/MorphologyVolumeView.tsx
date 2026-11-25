import { useEffect, useMemo } from 'react'
import { VolumeViewer } from '../../components/VolumeViewer'
import type { MorphologyImage } from '../../data/morphologyImage'
import type { MorphologyChannelSetting } from './morphologyChannels'
import { morphologyImageFrame, type ShownMorphologyFrame } from './morphologyFrame'
import { useMorphologyVolumeWorkflow } from './useMorphologyVolumeWorkflow'

// The dataset image's z-stack in 3D. The volumes it reads live as long as it
// does, and reading them re-renders only this view. `shownFrame` learns when
// the image's time point is drawn, for the plane controls (plan 28-D11).
export function MorphologyVolumeView({
  image,
  settings,
  shownFrame,
  onClose,
}: {
  readonly image: MorphologyImage | null
  readonly settings: readonly MorphologyChannelSetting[]
  readonly shownFrame: ShownMorphologyFrame
  readonly onClose: () => void
}) {
  const volume = useMorphologyVolumeWorkflow({ image, settings })
  const frame = useMemo(() => morphologyImageFrame(image), [image])

  useEffect(() => {
    if (volume.frameShown && frame !== undefined) {
      shownFrame.show(frame)
    }
  }, [frame, shownFrame, volume.frameShown])

  return (
    <VolumeViewer
      level={volume.level}
      levelCount={volume.levelCount}
      channels={volume.channels}
      enabledChannelCount={volume.enabledChannelCount}
      progress={volume.progress}
      error={volume.error}
      onClose={onClose}
    />
  )
}
