import { VolumeViewer } from '../../components/VolumeViewer'
import type { MorphologyImage } from '../../data/morphologyImage'
import type { MorphologyChannelSetting } from './morphologyChannels'
import { useMorphologyVolumeWorkflow } from './useMorphologyVolumeWorkflow'

// The dataset image's z-stack in 3D. The volumes it reads live as long as it
// does, and reading them re-renders only this view.
export function MorphologyVolumeView({
  image,
  settings,
  onClose,
}: {
  readonly image: MorphologyImage | null
  readonly settings: readonly MorphologyChannelSetting[]
  readonly onClose: () => void
}) {
  const volume = useMorphologyVolumeWorkflow({ image, settings })

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
