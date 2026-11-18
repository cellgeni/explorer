import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { testImageSectionModel } from '../../test/sectionModels'
import { ImageVolumeViewControl } from './ImageSectionBlocks'

describe('ImageVolumeViewControl', () => {
  it('is absent for an image without a 3D view', () => {
    const { container } = render(
      <ImageVolumeViewControl image={testImageSectionModel()} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('switches between 2D and 3D', () => {
    const onOpenChange = vi.fn()
    render(
      <ImageVolumeViewControl
        image={testImageSectionModel({ volumeView: { open: false, onOpenChange } })}
      />,
    )
    const group = screen.getByRole('group', { name: 'Image view' })

    expect(within(group).getByRole('button', { name: '2D' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    fireEvent.click(within(group).getByRole('button', { name: '3D' }))
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })
})
