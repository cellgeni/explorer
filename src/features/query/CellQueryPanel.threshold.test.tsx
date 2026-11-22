import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ImagePyramidLoader } from '../../data/imagePyramid'
import { fakeCellImage } from '../../test/cellImageFixtures'
import { CELL_QUERY_TEST_CELLS, useCellQueryHarness } from '../../test/cellQueryHarness'
import type { CellQueryImageChannel } from './cellQueryImage'
import { CellQueryPanel } from './CellQueryPanel'

const IMAGE = fakeCellImage({ width: 8, height: 8, pixel: () => 1 })
// A float channel whose window, 0 to 0.5, is narrower than 1.
const CHANNELS: readonly CellQueryImageChannel[] = [
  {
    id: 'Channel:0',
    name: 'Signal',
    loader: IMAGE.loader as unknown as ImagePyramidLoader,
    rgb: false,
    histogram: {
      bins: [4, 4, 4, 4],
      maxCount: 4,
      min: 0,
      max: 0.5,
      sampleCount: 16,
      threshold: 0.25,
    },
  },
]

const CELLS = [{ ...CELL_QUERY_TEST_CELLS[0]!, cellArea: Math.PI }]

function Harness() {
  const query = useCellQueryHarness({
    initial: [
      {
        kind: 'number',
        columnId: 'image:above:0:t0.25:Channel:0',
        operator: 'at-least',
        min: 50,
        max: Infinity,
      },
    ],
    overrides: {
      cells: CELLS,
      imageChannels: CHANNELS,
    },
  })
  return <CellQueryPanel query={query} />
}

describe('Cell Query threshold histogram', () => {
  it('draws the threshold where it sits among the bars of a narrow float window', async () => {
    render(<Harness />)
    const histogram = await screen.findByRole('img', {
      name: 'Signal histogram, threshold 0.25',
    })
    await waitFor(() => {
      expect(histogram.querySelector('.cell-query-threshold-line')).not.toBeNull()
    })

    expect(
      histogram.querySelector<HTMLElement>('.cell-query-threshold-line')?.style.left,
    ).toBe('50%')
  })
})
