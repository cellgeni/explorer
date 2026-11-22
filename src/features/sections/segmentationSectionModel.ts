import { useMemo } from 'react'
import type { BBox } from '../../data/coords'
import type { ImportedSegmentation } from '../../datasets/importedSegmentation'
import {
  segmentationFormatFromFileName,
  segmentationFormatFromName,
  type SegmentationCoordinates,
  type SegmentationFormat,
  type SegmentationSource,
} from '../../datasets/segmentationSource'
import { shouldLoadBoundaryPolygons } from '../../rendering/boundaryViewport'
import type { OverviewViewState } from '../../rendering/deckLayers'
import { percentToOpacity } from '../../rendering/layerOpacity'
import type { AppendDebugEvent } from '../app-shell/appRuntimeModel'
import type { BoundaryLoadState } from '../dataset/datasetLoadModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import type {
  ImportedSegmentationController,
  ImportedSegmentationState,
} from '../segmentation/useImportedSegmentation'

// The Segmentation section (plan 25): import a label mask or polygon outlines
// onto a plain image, and how its outlines are drawn.
export interface SegmentationSectionModel {
  readonly state: ImportedSegmentationState
  // Outlines are drawn (the header checkbox).
  readonly show: boolean
  readonly onShowChange: (show: boolean) => void
  readonly outlineColor: string
  readonly onOutlineColorChange: (color: string) => void
  // 0–1; the control shows percent.
  readonly opacity: number
  readonly onOpacityPercentChange: (percent: number) => void
  readonly view: SegmentationViewStatus
  // Each returns an error to show, or null once the load has started.
  readonly onLoadUrl: (url: string, options: SegmentationImportOptions) => string | null
  readonly onLoadFile: (file: File, options: SegmentationImportOptions) => string | null
  readonly onRemove: () => void
}

export interface SegmentationImportOptions {
  // Null takes the format from the name.
  readonly format: SegmentationFormat | null
  readonly coordinates: SegmentationCoordinates
}

// What the view shows of a ready segmentation.
export type SegmentationViewStatus =
  | { readonly kind: 'none' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'drawn'; readonly count: number }
  // Too many outlines in view to draw; `count` is how many, when known, and
  // an estimate for a mask.
  | {
      readonly kind: 'over-limit'
      readonly count?: number
      readonly estimated: boolean
      readonly limit: number
    }
  // The mask has no level fine enough to trace this view.
  | { readonly kind: 'zoom-in' }
  | { readonly kind: 'error'; readonly message: string }

export const DEFAULT_SEGMENTATION_OUTLINE_COLOR = '#4ade80'

export interface SegmentationSectionModelInput {
  readonly appendDebugEvent: AppendDebugEvent
  readonly boundaryCellLimit: number
  readonly boundaryState: BoundaryLoadState<StructuredLoadError>
  readonly controller: ImportedSegmentationController
  readonly currentViewport: {
    readonly bbox: BBox
    readonly viewState: OverviewViewState
  } | null
  readonly outlineColor: string
  readonly outlineOpacity: number
  readonly setOutlineColor: (color: string) => void
  readonly setOutlineOpacity: (opacity: number) => void
  readonly setShowOutlines: (show: boolean) => void
  readonly showOutlines: boolean
}

export function useSegmentationSectionModel({
  appendDebugEvent,
  boundaryCellLimit,
  boundaryState,
  controller,
  currentViewport,
  outlineColor,
  outlineOpacity,
  setOutlineColor,
  setOutlineOpacity,
  setShowOutlines,
  showOutlines,
}: SegmentationSectionModelInput): SegmentationSectionModel {
  // Counting a million polygons in view takes milliseconds, so the count is
  // kept until the view or the segmentation changes.
  const { segmentation } = controller
  const view = useMemo(
    () =>
      segmentationViewStatus({
        boundaryCellLimit,
        boundaryState,
        currentViewport,
        segmentation,
        showOutlines,
      }),
    [boundaryCellLimit, boundaryState, currentViewport, segmentation, showOutlines],
  )
  const load = (
    url: string,
    file: File | undefined,
    options: SegmentationImportOptions,
  ): string | null => {
    const format =
      options.format ??
      (file === undefined
        ? segmentationFormatFromName(url)
        : segmentationFormatFromFileName(file.name))

    if (format === null) {
      return 'The format cannot be told from the name. Choose one under Format.'
    }

    if (file === undefined && !/^https?:\/\//i.test(url)) {
      return 'Enter an http or https URL.'
    }

    const source: SegmentationSource = {
      url,
      ...(file === undefined ? {} : { file }),
      format,
      coordinates: options.coordinates,
    }
    controller.load(source)
    return null
  }

  return {
    state: controller.state,
    show: showOutlines,
    onShowChange: (show) => {
      setShowOutlines(show)
      appendDebugEvent(`Segmentation outlines ${show ? 'shown' : 'hidden'}`, {
        coalesceKey: 'segmentation-outlines',
      })
    },
    outlineColor,
    onOutlineColorChange: (color) => {
      setOutlineColor(color)
    },
    opacity: outlineOpacity,
    onOpacityPercentChange: (percent) => {
      setOutlineOpacity(percentToOpacity(percent))
      appendDebugEvent(`Segmentation outline opacity: ${percent.toString()}%`, {
        coalesceKey: 'segmentation-opacity',
      })
    },
    view,
    onLoadUrl: (url, options) => load(url.trim(), undefined, options),
    onLoadFile: (file, options) => load(file.name, file, options),
    onRemove: () => {
      controller.clear()
      appendDebugEvent('Segmentation removed', { coalesceKey: 'segmentation' })
    },
  }
}

export function segmentationViewStatus({
  boundaryCellLimit,
  boundaryState,
  currentViewport,
  segmentation,
  showOutlines,
}: Pick<
  SegmentationSectionModelInput,
  'boundaryCellLimit' | 'boundaryState' | 'currentViewport' | 'showOutlines'
> & {
  readonly segmentation: ImportedSegmentation | null
}): SegmentationViewStatus {
  if (segmentation === null || !showOutlines) {
    return { kind: 'none' }
  }

  switch (boundaryState.status) {
    case 'loading':
      return { kind: 'loading' }
    case 'error':
      return { kind: 'error', message: boundaryState.error.message }
    case 'ready':
      if (boundaryState.overLimit !== undefined) {
        return boundaryState.overLimit.count === undefined
          ? { kind: 'zoom-in' }
          : {
              kind: 'over-limit',
              count: boundaryState.overLimit.count,
              estimated: false,
              limit: boundaryCellLimit,
            }
      }

      return { kind: 'drawn', count: boundaryState.cellCount }
    case 'idle':
      break
  }

  // Nothing requested: the view holds more than the boundary limit, or none.
  if (currentViewport === null) {
    return { kind: 'none' }
  }

  const count = segmentation.estimateCount(currentViewport.bbox)

  return count > 0 &&
    !shouldLoadBoundaryPolygons(
      { ...currentViewport, visibleCellCount: count },
      { cellLimit: boundaryCellLimit },
    )
    ? {
        kind: 'over-limit',
        count,
        estimated: segmentation.shapeCount === undefined,
        limit: boundaryCellLimit,
      }
    : { kind: 'drawn', count: 0 }
}

// The header's one line: "312,456 outlines", "Label mask", "Reading 40%".
export function segmentationSummary(model: SegmentationSectionModel): string {
  const { state } = model

  switch (state.status) {
    case 'idle':
      return 'None'
    case 'loading':
      return state.shapeCount === undefined
        ? 'Reading'
        : `Reading · ${state.shapeCount.toLocaleString()}`
    case 'error':
      return 'Failed'
    case 'ready':
      if (!model.show) {
        return 'Hidden'
      }

      return state.segmentation.shapeCount === undefined
        ? 'Label mask'
        : `${state.segmentation.shapeCount.toLocaleString()} outlines`
  }
}
