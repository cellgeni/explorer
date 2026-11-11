import {
  CopyLinkButton,
  DatasetAbout,
  DatasetDiagnostics,
  DatasetViewOptions,
  OpenDatasetForm,
} from '../sections/DatasetInfoBlocks'
import type { DatasetInfoModel } from '../sections/datasetInfoModel'

interface DatasetHudPanelProps {
  readonly active: boolean
  readonly info: DatasetInfoModel
}

// The Dataset tab: the dataset info blocks.
export function DatasetHudPanel({ active, info }: DatasetHudPanelProps) {
  return (
    <div
      id="hud-panel-dataset"
      className="hud-tab-panel"
      role="tabpanel"
      aria-labelledby="hud-tab-dataset"
      hidden={!active}
    >
      <OpenDatasetForm open={info.open} />
      <CopyLinkButton share={info.share} />
      {info.about === null ? null : <DatasetAbout about={info.about} />}
      <DatasetViewOptions viewOptions={info.viewOptions} />
      <DatasetDiagnostics diagnostics={info.diagnostics} />
    </div>
  )
}
