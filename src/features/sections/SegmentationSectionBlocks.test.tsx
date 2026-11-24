import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SegmentationSource } from '../../datasets/segmentationSource'
import { SegmentationPanel } from './SegmentationSectionBlocks'
import type { SegmentationSectionModel } from './segmentationSectionModel'

function reading(source: SegmentationSource): SegmentationSectionModel {
  return {
    state: { status: 'loading', source },
    show: true,
    onShowChange: vi.fn(),
    outlineColor: '#4ade80',
    onOutlineColorChange: vi.fn(),
    opacity: 1,
    onOpacityPercentChange: vi.fn(),
    view: { kind: 'none' },
    onLoadUrl: vi.fn(() => null),
    onLoadFile: vi.fn(() => null),
    onRemove: vi.fn(),
  }
}

describe('SegmentationPanel', () => {
  it.each([
    ['https://host.test/masks/labels.zarr/', 'Reading labels.zarr...'],
    [
      'https://host.test/masks/cp_masks.tif?X-Amz-Signature=abc123',
      'Reading cp_masks.tif...',
    ],
    ['https://host.test/masks/cell%20masks.tif', 'Reading cell masks.tif...'],
  ])('names %s as the imported row will while reading it', (url, text) => {
    render(
      <SegmentationPanel
        segmentation={reading({ url, format: 'label-tiff', coordinates: 'pixels' })}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent(text)
  })

  it('names a picked file as it is', () => {
    render(
      <SegmentationPanel
        segmentation={reading({
          url: 'masks?v2.tif',
          file: new Blob(),
          format: 'label-tiff',
          coordinates: 'pixels',
        })}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('Reading masks?v2.tif...')
  })
})
