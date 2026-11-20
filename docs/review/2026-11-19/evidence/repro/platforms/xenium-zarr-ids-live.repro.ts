// @vitest-environment node
// PLT review, live data: do transcripts.zarr.zip point IDs line up with
// transcripts.parquet, as the cell-ID enrichment of exact Zarr points assumes
// (`mergeTranscriptPointMetadata` keys on fov name + transcript ID)?
//
// Oracle (independent): the demo's transcripts.parquet first row group,
// decoded with hyparquet in a scratch script (evidence/platforms/
// xenium-demo-transcripts-ids.log): transcript_id 281668250306971, fov_name
// "F1", feature ZNF683 at (220.703125, 1464.421875).
//
// Reads the Zarr's central directory and one 250 µm tile by Range (a few MB).
import { describe, expect, it } from 'vitest'
import { micrometers } from '../../../../../../src/data/coords'
import { loadTranscriptZarrViewport } from '../../../../../../src/data/transcriptZarr'

const DEMO =
  'https://mp33.cog.sanger.ac.uk/public/xenium/output-XETG00155__0033412__Sob23-BRA-0-FFPE-2-s30__20240829__110328'

describe('Xenium demo: Zarr transcript IDs versus transcripts.parquet', () => {
  it('the Zarr point at the parquet transcript has the same fov and transcript ID', async () => {
    const result = await loadTranscriptZarrViewport(
      `${DEMO}/transcripts.zarr.zip`,
      {
        minX: micrometers(220.7),
        maxX: micrometers(220.71),
        minY: micrometers(1464.42),
        maxY: micrometers(1464.43),
      },
      { minQv: 0, geneOnly: false, pointLimit: 10 },
    )

    console.log(
      JSON.stringify(
        result.points.map((point) => ({
          id: point.id,
          transcriptId: point.transcriptId,
          fovName: point.fovName,
          featureName: point.featureName,
          x: point.position.x,
          y: point.position.y,
          qv: point.qv,
        })),
      ),
    )
    expect(
      result.points.map((point) => [point.fovName, point.transcriptId]),
    ).toContainEqual(['F1', '281668250306971'])
  }, 180_000)
})

// All-transcript density squares show `grid_number_objects` of the level that
// fits the view, and the hover card prints it as "Count". Oracle: level 0
// holds every transcript (root attr `number_rnas`, and the code's own comment),
// so a square's count at any level should sum to the level-0 counts under it.
import { loadTranscriptZarrAggregates } from '../../../../../../src/data/transcriptZarr'

describe('Xenium demo: density square counts by grid level', () => {
  it('whole-slide totals agree across the levels the density view picks', async () => {
    const slide = {
      minX: micrometers(-1e6),
      maxX: micrometers(1e6),
      minY: micrometers(-1e6),
      maxY: micrometers(1e6),
    }
    const totals: Record<string, number> = {}

    for (const maxBins of [1_000_000, 1_500, 400, 100, 25, 6, 1]) {
      const result = await loadTranscriptZarrAggregates(
        `${DEMO}/transcripts.zarr.zip`,
        slide,
        {
          maxBins,
        },
      )
      const total = result.bins.reduce((sum, bin) => sum + bin.count, 0)
      totals[
        `maxBins ${maxBins}: level ${result.level.level}, ${result.bins.length} squares of ${result.level.gridSizeMicrometers} um`
      ] = total
    }

    console.log(JSON.stringify(totals, null, 1))

    // Per square: level-1 count over the sum of the four level-0 squares in it.
    const level0 = await loadTranscriptZarrAggregates(
      `${DEMO}/transcripts.zarr.zip`,
      slide,
      {
        maxBins: 1_000_000,
      },
    )
    const level1 = await loadTranscriptZarrAggregates(
      `${DEMO}/transcripts.zarr.zip`,
      slide,
      {
        maxBins: 1_500,
      },
    )
    const fine = new Map(level0.bins.map((bin) => [`${bin.binX},${bin.binY}`, bin.count]))
    const ratios = level1.bins
      .map((bin) => {
        let truth = 0
        for (const dx of [0, 1])
          for (const dy of [0, 1])
            truth += fine.get(`${2 * bin.binX + dx},${2 * bin.binY + dy}`) ?? 0
        return { ratio: bin.count / truth, truth }
      })
      .filter((entry) => entry.truth >= 10_000)
      .map((entry) => entry.ratio)
      .sort((a, b) => a - b)
    const q = (f: number) => ratios[Math.floor(f * (ratios.length - 1))]?.toFixed(3)
    console.log(
      `level 1 / level 0 per square (${ratios.length} squares with >= 10k transcripts): min ${q(0)} p05 ${q(0.05)} median ${q(0.5)} p95 ${q(0.95)} max ${q(1)}`,
    )
    expect(new Set(Object.values(totals)).size).toBe(1)
  }, 180_000)
})
