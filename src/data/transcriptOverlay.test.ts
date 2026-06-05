import { describe, expect, it } from 'vitest'
import {
  TRANSCRIPT_EXACT_RENDER_LIMIT,
  planTranscriptLod,
  transcriptViewportRequestKey,
} from './transcriptOverlay'
import { micrometers } from './coords'

describe('transcriptOverlay', () => {
  it('plans exact rendering when the viewport is close and inside budget', () => {
    const plan = planTranscriptLod(
      { viewState: { zoom: 2 } },
      {
        detailMode: 'auto',
        visibleTranscriptEstimate: TRANSCRIPT_EXACT_RENDER_LIMIT,
        hasRawParquet: true,
        hasNativeZarr: false,
        hasSelectedFeatureFilter: true,
      },
    )

    expect(plan.kind).toBe('exact')
  })

  it('prefers native Xenium Zarr LOD when exact rendering would exceed budget', () => {
    const plan = planTranscriptLod(
      { viewState: { zoom: -1 } },
      {
        detailMode: 'auto',
        visibleTranscriptEstimate: TRANSCRIPT_EXACT_RENDER_LIMIT + 1,
        hasRawParquet: true,
        hasNativeZarr: true,
        hasSelectedFeatureFilter: true,
      },
    )

    expect(plan.kind).toBe('native-zarr')
  })

  it('keeps auto mode on native LOD when exact would be under budget', () => {
    const plan = planTranscriptLod(
      { viewState: { zoom: 3 } },
      {
        detailMode: 'auto',
        visibleTranscriptEstimate: 20,
        hasRawParquet: true,
        hasNativeZarr: true,
        hasSelectedFeatureFilter: true,
      },
    )

    expect(plan.kind).toBe('native-zarr')
  })

  it('waits instead of sampling exact rows when native LOD is unavailable', () => {
    const plan = planTranscriptLod(
      { viewState: { zoom: 0 } },
      {
        detailMode: 'exact',
        visibleTranscriptEstimate: TRANSCRIPT_EXACT_RENDER_LIMIT + 1,
        hasRawParquet: true,
        hasNativeZarr: false,
        hasSelectedFeatureFilter: true,
      },
    )

    expect(plan.kind).toBe('waiting')
  })

  it('requires a selected-gene filter when selected mode has no genes', () => {
    const plan = planTranscriptLod(
      { viewState: { zoom: 3 } },
      {
        detailMode: 'exact',
        visibleTranscriptEstimate: 10,
        hasRawParquet: true,
        hasNativeZarr: true,
        hasSelectedFeatureFilter: false,
      },
    )

    expect(plan.kind).toBe('waiting')
    if (plan.kind !== 'waiting') {
      throw new Error('Expected waiting transcript LOD plan.')
    }

    expect(plan.message).toContain('Select genes')
  })

  it('normalizes feature order in viewport request keys', () => {
    const bbox = {
      minX: micrometers(1),
      minY: micrometers(2),
      maxX: micrometers(3),
      maxY: micrometers(4),
    }
    const left = transcriptViewportRequestKey('https://example.test/out', bbox, {
      minQv: 20,
      geneOnly: true,
      featureNames: ['Gad1', 'Actb'],
      pointLimit: 100,
    })
    const right = transcriptViewportRequestKey('https://example.test/out', bbox, {
      minQv: 20,
      geneOnly: true,
      featureNames: ['Actb', 'Gad1'],
      pointLimit: 100,
    })

    expect(left).toBe(right)
  })
})
