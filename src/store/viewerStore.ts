import { create } from 'zustand'
import type { DatasetReader } from '../datasets/datasetReader'

// The Xenium demo, which the start screen offers when the examples cannot be
// read (plan 15.3-A). The address box starts empty.
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
  // The address field's reader menu: the reader Load Dataset opens the
  // address with, or null to detect it.
  readonly datasetReader: DatasetReader | null
  readonly viewState: ViewerViewState
  setDatasetUrl(datasetUrl: string): void
  setDatasetReader(datasetReader: DatasetReader | null): void
  setViewState(viewState: ViewerViewState): void
}

export const initialViewerState: Pick<
  ViewerStoreState,
  'datasetUrl' | 'datasetReader' | 'viewState'
> = {
  datasetUrl: '',
  datasetReader: null,
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
  setDatasetReader(datasetReader) {
    set({ datasetReader })
  },
  setViewState(viewState) {
    set({ viewState })
  },
}))
