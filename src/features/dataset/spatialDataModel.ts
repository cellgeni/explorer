import type {
  SpatialDataSelection,
  SpatialDataSummary,
} from '../../datasets/spatialDataDataset'
import type { SpatialDataUnits } from '../../datasets/spatialDataUnits'

export type SpatialDataControlState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'ready' | 'loading'
      readonly table?: string
      readonly tables: readonly string[]
      readonly coordinateSystem: string
      readonly coordinateSystems: readonly string[]
      readonly image?: string
      readonly images: readonly string[]
      readonly units: SpatialDataUnits
      readonly selection: SpatialDataSelection
    }

export const IDLE_SPATIALDATA_CONTROL_STATE: SpatialDataControlState = { status: 'idle' }

export function spatialDataControlReady(
  summary: SpatialDataSummary,
  selection: SpatialDataSelection,
): SpatialDataControlState {
  return {
    status: 'ready',
    ...(summary.table === undefined ? {} : { table: summary.table }),
    tables: summary.tables,
    coordinateSystem: summary.coordinateSystem,
    coordinateSystems: summary.coordinateSystems,
    ...(summary.image === undefined ? {} : { image: summary.image }),
    images: summary.images,
    units: summary.units,
    selection,
  }
}

export function spatialDataControlLoading(
  state: SpatialDataControlState,
  selection: SpatialDataSelection,
): SpatialDataControlState {
  return state.status === 'idle' ? state : { ...state, status: 'loading', selection }
}

// Selection fields restored from or written to the shareable URL hash.
export function spatialDataSelectionFromShareable(state: {
  readonly spatialDataTable?: string
  readonly spatialDataCoordinateSystem?: string
  readonly spatialDataImage?: string
  readonly spatialDataMicrometersPerUnit?: number
}): SpatialDataSelection {
  return {
    ...(state.spatialDataTable === undefined ? {} : { table: state.spatialDataTable }),
    ...(state.spatialDataCoordinateSystem === undefined
      ? {}
      : { coordinateSystem: state.spatialDataCoordinateSystem }),
    ...(state.spatialDataImage === undefined ? {} : { image: state.spatialDataImage }),
    ...(state.spatialDataMicrometersPerUnit === undefined
      ? {}
      : { micrometersPerUnit: state.spatialDataMicrometersPerUnit }),
  }
}

export function spatialDataSelectionToShareable(state: SpatialDataControlState): {
  readonly spatialDataTable?: string
  readonly spatialDataCoordinateSystem?: string
  readonly spatialDataImage?: string
  readonly spatialDataMicrometersPerUnit?: number
} {
  if (state.status === 'idle') {
    return {}
  }

  const { table, coordinateSystem, image, micrometersPerUnit } = state.selection

  return {
    ...(table === undefined ? {} : { spatialDataTable: table }),
    ...(coordinateSystem === undefined
      ? {}
      : { spatialDataCoordinateSystem: coordinateSystem }),
    ...(image === undefined ? {} : { spatialDataImage: image }),
    ...(micrometersPerUnit === undefined
      ? {}
      : { spatialDataMicrometersPerUnit: micrometersPerUnit }),
  }
}
