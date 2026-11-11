import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { testDatasetInfoModel } from '../../test/sectionModels'
import {
  DatasetViewOptions,
  VisiumHdBinControls,
  VisiumOffTissueToggle,
  VisiumTissueImageSelect,
} from './DatasetInfoBlocks'

const VISIUM_VIEW_OPTIONS = testDatasetInfoModel({
  viewOptions: {
    visium: {
      state: {
        status: 'ready',
        source: 'h5ad',
        image: 'hires',
        summary: {
          libraryId: 'V1_Mouse_Brain',
          libraryIds: ['V1_Mouse_Brain', 'V1_Mouse_Kidney'],
          spotCount: 2698,
          offTissueSpotCount: 2294,
          showOffTissue: false,
          spotDiameterMicrometers: 55,
          units: {
            micrometersPerPixel: 0.5404,
            source: 'spot-grid',
            detail: 'array row/column fit (100 µm spot pitch)',
          },
          scalefactors: { tissueHiresScalef: 0.17, tissueLowresScalef: 0.05 },
          images: ['hires', 'lowres'],
        },
      },
    },
    visiumHd: {
      state: {
        status: 'ready',
        url: 'https://example.test/visium-hd',
        selectedBinSize: 16,
        options: [
          { size: 16, available: true, disabled: false },
          { size: 8, available: true, disabled: false },
        ],
      },
    },
  },
}).viewOptions

describe('DatasetViewOptions', () => {
  it('leaves section controls to the layer panel (15.2-C)', () => {
    render(<DatasetViewOptions viewOptions={VISIUM_VIEW_OPTIONS} />)

    expect(screen.getByTitle('Visium library to show')).toBeInTheDocument()
    expect(screen.queryByTitle('Visium tissue image to show')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Show off-tissue spots')).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Bin size' })).not.toBeInTheDocument()
  })
})

describe('Visium section blocks', () => {
  it('render the tissue image, off-tissue spots and bin size on their own', () => {
    render(
      <>
        <VisiumTissueImageSelect visium={VISIUM_VIEW_OPTIONS.visium} />
        <VisiumOffTissueToggle visium={VISIUM_VIEW_OPTIONS.visium} />
        <VisiumHdBinControls visiumHd={VISIUM_VIEW_OPTIONS.visiumHd} />
      </>,
    )

    fireEvent.change(screen.getByTitle('Visium tissue image to show'), {
      target: { value: 'lowres' },
    })
    fireEvent.click(screen.getByLabelText('Show off-tissue spots'))
    fireEvent.click(screen.getByRole('button', { name: '8 µm' }))

    expect(VISIUM_VIEW_OPTIONS.visium.onImageChange).toHaveBeenCalledWith('lowres')
    expect(VISIUM_VIEW_OPTIONS.visium.onViewChange).toHaveBeenCalledWith({
      showOffTissue: true,
    })
    expect(VISIUM_VIEW_OPTIONS.visiumHd.onBinSizeChange).toHaveBeenCalledWith(8)
  })

  it('render nothing for other platforms', () => {
    const { container } = render(
      <>
        <VisiumTissueImageSelect visium={testDatasetInfoModel().viewOptions.visium} />
        <VisiumOffTissueToggle visium={testDatasetInfoModel().viewOptions.visium} />
        <VisiumHdBinControls visiumHd={testDatasetInfoModel().viewOptions.visiumHd} />
      </>,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
