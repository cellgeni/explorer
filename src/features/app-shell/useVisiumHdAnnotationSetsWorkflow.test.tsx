import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NO_ANNOTATION_GROUP_ID } from '../../data/datasetAnnotations'
import type { VisiumHdBinSizeMicrometers } from '../../datasets/visiumHdDataset'
import {
  IDLE_ANNOTATION_STATE,
  annotationGroupLoadReady,
  annotationLoadReady,
  type AnnotationState,
} from '../annotations/annotationModel'
import { datasetLoadReady } from '../dataset/datasetLoadModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import type { SpatialDatasetLoader } from './appDependencies'
import { useVisiumHdAnnotationSetsWorkflow } from './useVisiumHdAnnotationSetsWorkflow'
import type { AnnotationGroupOption } from '../../data/annotation'

const DATASET_URL = 'https://example.test/visium'

function group(
  binSizeMicrometers: VisiumHdBinSizeMicrometers,
  clustering: string,
): AnnotationGroupOption {
  return {
    id: `visium-hd-clusters:${binSizeMicrometers}:${clustering}`,
    label: clustering.replace(/^gene_expression_/, ''),
    groupingName: clustering,
    groupCount: 0,
  }
}

const GROUPS: Readonly<Record<VisiumHdBinSizeMicrometers, AnnotationGroupOption[]>> = {
  2: [],
  8: [
    group(8, 'gene_expression_kmeans_2_clusters'),
    group(8, 'gene_expression_graphclust'),
  ],
  16: [
    group(16, 'gene_expression_graphclust'),
    group(16, 'gene_expression_kmeans_2_clusters'),
  ],
}

function renderWorkflow(
  binSize: VisiumHdBinSizeMicrometers,
  annotationState: AnnotationState<StructuredLoadError>,
) {
  const annotationGroups = vi.fn(async (size?: VisiumHdBinSizeMicrometers) =>
    size === undefined ? [] : GROUPS[size],
  )
  const dataset = { annotationGroups, annotations: vi.fn(async () => []) }
  const loadAnnotationGroup = vi.fn(async () => undefined)
  const setAnnotationGroupState = vi.fn()
  const setAnnotationState = vi.fn()
  const setSelectedAnnotationGroupId = vi.fn()
  const props = {
    appendDebugEvent: vi.fn(),
    activeBinSize: binSize,
    annotationState,
    // Only the annotation methods are read.
    getSpatialDataset: vi.fn(async () => dataset) as unknown as SpatialDatasetLoader,
    isVisiumHdDataset: true,
    loadAnnotationGroup,
    loadState: datasetLoadReady(DATASET_URL, 54_504),
    setAnnotationGroupState,
    setAnnotationState,
    setSelectedAnnotationGroupId,
  }
  const view = renderHook(
    (current: typeof props) => {
      useVisiumHdAnnotationSetsWorkflow(current)
    },
    { initialProps: props },
  )

  return {
    ...view,
    annotationGroups,
    loadAnnotationGroup,
    props,
    setAnnotationGroupState,
    setAnnotationState,
    setSelectedAnnotationGroupId,
  }
}

// The group a functional setSelectedAnnotationGroupId call picks from `current`.
function selectedFrom(setter: ReturnType<typeof vi.fn>, current: string): string {
  const update = setter.mock.calls.at(-1)?.[0] as (value: string) => string
  return update(current)
}

describe('useVisiumHdAnnotationSetsWorkflow', () => {
  it('lists the active tier sets and picks graphclust', async () => {
    const { annotationGroups, setAnnotationGroupState, setSelectedAnnotationGroupId } =
      renderWorkflow(16, IDLE_ANNOTATION_STATE)

    await waitFor(() => {
      expect(setAnnotationGroupState).toHaveBeenLastCalledWith(
        annotationGroupLoadReady(DATASET_URL, GROUPS[16]),
      )
    })
    expect(annotationGroups).toHaveBeenCalledWith(16, { signal: expect.any(AbortSignal) })
    expect(selectedFrom(setSelectedAnnotationGroupId, NO_ANNOTATION_GROUP_ID)).toBe(
      'visium-hd-clusters:16:gene_expression_graphclust',
    )
  })

  it('reads a loaded set again for the new tier, keeping the colour mode', async () => {
    const loaded = annotationLoadReady(
      DATASET_URL,
      [],
      'visium-hd-clusters:16:gene_expression_kmeans_2_clusters',
    )
    const { loadAnnotationGroup, props, rerender, setSelectedAnnotationGroupId } =
      renderWorkflow(16, loaded)

    await waitFor(() => {
      expect(setSelectedAnnotationGroupId).toHaveBeenCalled()
    })
    // The 16 µm set is the active tier's: nothing to read again.
    expect(loadAnnotationGroup).not.toHaveBeenCalled()

    rerender({ ...props, activeBinSize: 8 })

    await waitFor(() => {
      expect(loadAnnotationGroup).toHaveBeenCalledWith(
        'visium-hd-clusters:8:gene_expression_kmeans_2_clusters',
        { switchColorMode: false },
      )
    })
    expect(setSelectedAnnotationGroupId).toHaveBeenCalledWith(
      'visium-hd-clusters:8:gene_expression_kmeans_2_clusters',
    )
  })

  it('clears a loaded set when the new tier has no clusterings', async () => {
    const loaded = annotationLoadReady(
      DATASET_URL,
      [],
      'visium-hd-clusters:16:gene_expression_graphclust',
    )
    const { setAnnotationState, setSelectedAnnotationGroupId } = renderWorkflow(2, loaded)

    await waitFor(() => {
      expect(setAnnotationState).toHaveBeenCalledWith(IDLE_ANNOTATION_STATE)
    })
    expect(
      selectedFrom(
        setSelectedAnnotationGroupId,
        'visium-hd-clusters:16:gene_expression_graphclust',
      ),
    ).toBe(NO_ANNOTATION_GROUP_ID)
  })

  it('does nothing for another platform', async () => {
    const { annotationGroups, props, rerender } = renderWorkflow(
      16,
      IDLE_ANNOTATION_STATE,
    )

    await waitFor(() => {
      expect(annotationGroups).toHaveBeenCalledTimes(1)
    })
    rerender({ ...props, activeBinSize: 8, isVisiumHdDataset: false })
    await Promise.resolve()

    expect(annotationGroups).toHaveBeenCalledTimes(1)
  })
})
