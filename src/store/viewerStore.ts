import { create } from 'zustand'

export const DEMO_DATASET_URL =
  'https://mp33.cog.sanger.ac.uk/public/xenium/output-XETG00155__0033412__Sob23-BRA-0-FFPE-2-s30__20240829__110328'

export interface ViewerViewState {
  readonly target: readonly [number, number, number]
  readonly zoom: number
  readonly minZoom: number
  readonly maxZoom: number
}

export interface ViewerStoreState {
  readonly datasetUrl: string
  readonly viewState: ViewerViewState
  setDatasetUrl(datasetUrl: string): void
  setViewState(viewState: ViewerViewState): void
}

export const initialViewerState: Pick<ViewerStoreState, 'datasetUrl' | 'viewState'> = {
  datasetUrl: DEMO_DATASET_URL,
  viewState: {
    target: [0, 0, 0],
    zoom: 0,
    minZoom: -4,
    maxZoom: 10,
  },
}

export const useViewerStore = create<ViewerStoreState>((set) => ({
  ...initialViewerState,
  setDatasetUrl(datasetUrl) {
    set({ datasetUrl })
  },
  setViewState(viewState) {
    set({ viewState })
  },
}))
