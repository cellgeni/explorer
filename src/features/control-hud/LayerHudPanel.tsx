import { CellBoundaryToggles, CellOpacityControls } from '../sections/CellsSectionBlocks'
import type { CellsSectionModel } from '../sections/cellsSectionModel'
import { LayerStackLines } from '../sections/DatasetInfoBlocks'
import type { DatasetInfoModel } from '../sections/datasetInfoModel'
import {
  CustomImageLayers,
  ImageChannelControls,
  ImageOpacityControl,
  ImageZPlaneControl,
} from '../sections/ImageSectionBlocks'
import type { ImageSectionModel } from '../sections/imageSectionModel'
import {
  CoordinateUnitControl,
  HoverTooltipsToggle,
  MeasureToolControls,
} from '../sections/ViewSettingsBlocks'
import type { ViewSettingsModel } from '../sections/viewSettingsModel'

interface LayerHudPanelProps {
  readonly active: boolean
  readonly image: ImageSectionModel
  readonly cells: CellsSectionModel
  readonly settings: ViewSettingsModel
  readonly info: DatasetInfoModel
}

// The Layers tab: blocks from the Image and Cells sections, view settings,
// the measure tool, and the debug layer-stack lines.
export function LayerHudPanel({
  active,
  image,
  cells,
  settings,
  info,
}: LayerHudPanelProps) {
  return (
    <div
      id="hud-panel-layers"
      className="hud-tab-panel"
      role="tabpanel"
      aria-labelledby="hud-tab-layers"
      hidden={!active}
    >
      <section className="layer-section" aria-labelledby="layer-heading">
        <h2 id="layer-heading">Layer Stack</h2>
        <LayerStackLines diagnostics={info.diagnostics} />
        <div className="boundary-layer-toggles" aria-label="Layer display controls">
          <CellBoundaryToggles appearance={cells.appearance} />
          <HoverTooltipsToggle settings={settings} />
        </div>
        <div className="layer-opacity-controls">
          <ImageOpacityControl image={image} />
          <ImageZPlaneControl image={image} />
          <CellOpacityControls appearance={cells.appearance} />
        </div>
        <CoordinateUnitControl settings={settings} />
        <MeasureToolControls measure={settings.measure} />
        <ImageChannelControls image={image} />
        <CustomImageLayers layers={image.customLayers} />
      </section>
    </div>
  )
}
