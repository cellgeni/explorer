import type { Dispatch, SetStateAction } from 'react'
import { ALL_ANNOTATION_GROUP_ID } from '../../data/datasetAnnotations'
import { opacityToPercent } from '../../rendering/layerOpacity'
import type { AppendDebugEvent, LoadingTaskArea } from '../app-shell/appRuntimeModel'
import type { AppPlatformCapabilities } from '../app-shell/platformAdapter'
import type { LayerVisibility } from '../app-shell/useAppDomainState'
import type {
  AnnotationsSectionModel,
  GeometricShapesModel,
  SelectionListModel,
} from '../sections/annotationsSectionModel'
import type { CellsSectionModel } from '../sections/cellsSectionModel'
import type { ImageSectionModel } from '../sections/imageSectionModel'
import type { TranscriptsSectionModel } from '../sections/transcriptsSectionModel'

// The layer panel (plan 15.2-C): one accordion
// section per layer, each header with a visibility checkbox, the name and a
// one-line state.
export type LayerSectionId = 'image' | 'cells' | 'transcripts' | 'annotations'

export interface LayerSectionHeader {
  readonly id: LayerSectionId
  readonly title: string
  readonly visible: boolean
  readonly onVisibleChange: (visible: boolean) => void
  // Transcripts cannot be shown until they can load.
  readonly visibilityDisabled: boolean
  readonly summary: string
  readonly loading: boolean
}

export interface LayerPanelModel {
  // Only the sections the platform has.
  readonly sections: readonly LayerSectionHeader[]
}

// "SNAP25", or "4 genes" once a name would crowd the header.
export function genesSummary(genes: readonly string[]): string {
  return genes.length === 1 ? (genes[0] ?? '') : `${genes.length.toLocaleString()} genes`
}

function countLabel(count: number, noun: string): string {
  return `${count.toLocaleString()} ${count === 1 ? noun : `${noun}s`}`
}

export function imageSummary(image: ImageSectionModel, imageAvailable: boolean): string {
  const customLayerCount = image.customLayers.layers.length

  if (!imageAvailable && customLayerCount === 0) {
    return 'No image'
  }

  const parts: string[] = []
  const channelCount = image.channelSettings.length

  if (channelCount > 1) {
    const enabled = image.channelSettings.filter((setting) => setting.enabled).length
    parts.push(`${enabled.toLocaleString()} of ${channelCount.toLocaleString()} channels`)
  }

  if (image.zStack !== undefined) {
    const plane = image.requestedZPlane ?? image.zStack.zPlane
    parts.push(
      `z ${(plane + 1).toLocaleString()} of ${image.zStack.sizeZ.toLocaleString()}`,
    )
  }

  if (customLayerCount > 0) {
    parts.push(`+${countLabel(customLayerCount, 'layer')}`)
  }

  return parts.length > 0 ? parts.join(' · ') : `${opacityToPercent(image.opacity)}%`
}

// What colours the cells.
export function cellsSummary(
  cells: CellsSectionModel,
  annotations: AnnotationsSectionModel,
): string {
  const { colour, genes } = cells

  switch (colour.mode) {
    case 'gene-expression':
      return genes.selected.length === 0
        ? 'Gene expression'
        : genesSummary(genes.selected)
    case 'annotations': {
      const { groupOptions, selectedGroupId } = annotations.sets
      return (
        groupOptions.find((group) => group.id === selectedGroupId)?.label ??
        (selectedGroupId === ALL_ANNOTATION_GROUP_ID ? 'All sets' : 'Clusters')
      )
    }
    case 'metadata': {
      const trackId = colour.selectedMetadataTrackId ?? colour.metadataTracks[0]?.id
      return (
        colour.metadataTracks.find((track) => track.id === trackId)?.label ?? 'Metadata'
      )
    }
    case 'transcript-count':
      return 'Transcript count'
    case 'cell-area':
      return 'Cell area'
  }
}

// The genes shown and how: "SNAP25 · density", "All features · points".
export function transcriptsSummary(transcripts: TranscriptsSectionModel): string {
  if (!transcripts.show) {
    return 'Off'
  }

  const { filterMode, selected } = transcripts.features
  const parts = [
    filterMode === 'selected' && selected.length > 0
      ? genesSummary(selected)
      : 'All features',
  ]

  switch (transcripts.layerState.status) {
    case 'ready':
      parts.push('points')
      break
    case 'aggregate':
      parts.push('density')
      break
    case 'loading':
      parts.push('loading')
      break
    case 'waiting':
      parts.push('waiting')
      break
    case 'unavailable':
      parts.push('unavailable')
      break
    case 'idle':
    case 'error':
      break
  }

  return parts.join(' · ')
}

// "2 selections · 1 shape", or "No shapes".
export function annotationsSummary(
  selections: SelectionListModel,
  shapes: GeometricShapesModel,
): string {
  const parts = [
    ...(selections.available && selections.selections.length > 0
      ? [countLabel(selections.selections.length, 'selection')]
      : []),
    ...(shapes.shapes.length > 0 ? [countLabel(shapes.shapes.length, 'shape')] : []),
  ]

  return parts.length === 0
    ? selections.available
      ? 'No selections'
      : 'No shapes'
    : parts.join(' · ')
}

export interface LayerPanelModelInput {
  readonly annotations: AnnotationsSectionModel
  readonly appendDebugEvent: AppendDebugEvent
  readonly capabilities: Pick<
    AppPlatformCapabilities,
    'cells' | 'geometricAnnotations' | 'transcripts'
  >
  readonly cells: CellsSectionModel
  // 'cells', 'spots' or 'bins', which titles the Cells section.
  readonly elementNoun: string
  readonly image: ImageSectionModel
  // A dataset image or tissue image is loaded.
  readonly imageAvailable: boolean
  readonly layerVisibility: LayerVisibility
  readonly loadingAreas: ReadonlySet<LoadingTaskArea>
  readonly setLayerVisibility: Dispatch<SetStateAction<LayerVisibility>>
  readonly transcripts: TranscriptsSectionModel
}

export function useLayerPanelModel({
  annotations,
  appendDebugEvent,
  capabilities,
  cells,
  elementNoun,
  image,
  imageAvailable,
  layerVisibility,
  loadingAreas,
  setLayerVisibility,
  transcripts,
}: LayerPanelModelInput): LayerPanelModel {
  function visibilityHeader(
    id: 'image' | 'cells' | 'annotations',
    title: string,
    summary: string,
  ): LayerSectionHeader {
    return {
      id,
      title,
      visible: layerVisibility[id],
      onVisibleChange: (visible) => {
        setLayerVisibility((current) => ({ ...current, [id]: visible }))
        appendDebugEvent(`${title} ${visible ? 'shown' : 'hidden'}`, {
          coalesceKey: `layer-visible:${id}`,
        })
      },
      visibilityDisabled: false,
      summary,
      loading: id !== 'annotations' && loadingAreas.has(id),
    }
  }

  const sections: LayerSectionHeader[] = [
    visibilityHeader('image', 'Image', imageSummary(image, imageAvailable)),
  ]

  if (capabilities.cells) {
    sections.push(
      visibilityHeader(
        'cells',
        elementNoun.charAt(0).toUpperCase() + elementNoun.slice(1),
        cellsSummary(cells, annotations),
      ),
    )
  }

  if (capabilities.transcripts) {
    sections.push({
      id: 'transcripts',
      title: 'Transcripts',
      visible: transcripts.show,
      onVisibleChange: transcripts.onShowChange,
      visibilityDisabled: !transcripts.loadEnabled,
      summary: transcriptsSummary(transcripts),
      loading: loadingAreas.has('transcripts'),
    })
  }

  if (capabilities.geometricAnnotations) {
    sections.push(
      visibilityHeader(
        'annotations',
        'Annotations',
        annotationsSummary(annotations.selections, annotations.shapes),
      ),
    )
  }

  return { sections }
}
