import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { testDatasetInfoModel } from '../../test/sectionModels'
import {
  visiumHdControlFailed,
  visiumHdControlLoading,
  type VisiumHdControlState,
} from '../dataset/visiumHdModel'
import {
  AteraImageSelect,
  DatasetViewOptions,
  OpenDatasetForm,
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

describe('OpenDatasetForm', () => {
  it('offers Browse Store beside Load Dataset for Zarr store addresses', () => {
    const { open } = testDatasetInfoModel({
      open: { datasetUrl: '  https://bucket.test/sample.zarr/  ' },
    })
    render(<OpenDatasetForm open={open} />)

    fireEvent.click(screen.getByRole('button', { name: 'Browse Store' }))

    expect(open.onBrowseStructure).toHaveBeenCalledWith(
      'https://bucket.test/sample.zarr/',
    )
    expect(open.onSubmit).not.toHaveBeenCalled()
  })

  it('offers Browse File for Parquet file addresses', () => {
    const { open } = testDatasetInfoModel({
      open: { datasetUrl: 'https://bucket.test/run/cells.parquet' },
    })
    render(<OpenDatasetForm open={open} />)

    expect(screen.queryByRole('button', { name: 'Browse Store' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Browse File' }))

    expect(open.onBrowseStructure).toHaveBeenCalledWith(
      'https://bucket.test/run/cells.parquet',
    )
  })

  it('offers Browse File for HDF5 file addresses', () => {
    const { open } = testDatasetInfoModel({
      open: { datasetUrl: 'https://bucket.test/run/sample.h5ad' },
    })
    render(<OpenDatasetForm open={open} />)

    fireEvent.click(screen.getByRole('button', { name: 'Browse File' }))

    expect(open.onBrowseStructure).toHaveBeenCalledWith(
      'https://bucket.test/run/sample.h5ad',
    )
  })

  it('leaves the browse buttons out for other addresses', () => {
    render(
      <OpenDatasetForm
        open={
          testDatasetInfoModel({ open: { datasetUrl: 'https://bucket.test/run/' } }).open
        }
      />,
    )

    expect(screen.getByRole('button', { name: 'Load Dataset' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Browse Store' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Browse File' })).not.toBeInTheDocument()
  })
})

describe('OpenDatasetForm focus', () => {
  it('moves from Load Dataset, off while the dataset loads, to the address (EXP-316)', () => {
    const form = (isLoading: boolean) => (
      <OpenDatasetForm
        open={
          testDatasetInfoModel({
            open: { datasetUrl: 'https://example.test/run', isLoading },
          }).open
        }
      />
    )
    const { rerender } = render(form(false))
    const load = screen.getByRole('button', { name: 'Load Dataset' })
    load.focus()
    fireEvent.click(load)

    rerender(form(true))
    expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled()
    expect(screen.getByLabelText('Dataset or image URL')).toHaveFocus()
  })
})

describe('OpenDatasetForm addresses', () => {
  it.each(['/data/run.h5ad', './run-1', 'bucket.test/run.h5ad'])(
    'leaves %s for the app to check, as the browser would refuse it',
    (address) => {
      const { open } = testDatasetInfoModel({ open: { datasetUrl: address } })
      render(<OpenDatasetForm open={open} />)

      fireEvent.click(screen.getByRole('button', { name: 'Load Dataset' }))

      expect(open.onSubmit).toHaveBeenCalledTimes(1)
    },
  )
})

describe('Boundary limit', () => {
  function renderLimit() {
    const { open } = testDatasetInfoModel({ open: { boundaryCellLimit: 2_500 } })
    render(<OpenDatasetForm open={open} />)
    const input = screen.getByRole<HTMLInputElement>('spinbutton', {
      name: 'Boundary limit',
    })
    return { open, input }
  }

  it('can be emptied while a number is typed, and keeps the limit if left empty', () => {
    const { open, input } = renderLimit()

    fireEvent.change(input, { target: { value: '' } })
    expect(input.value).toBe('')
    fireEvent.blur(input)

    expect(open.onBoundaryCellLimitChange).not.toHaveBeenCalled()
    expect(input.value).toBe('2500')
  })

  it('applies the typed number when the field is left', () => {
    const { open, input } = renderLimit()

    fireEvent.change(input, { target: { value: '1' } })
    fireEvent.change(input, { target: { value: '10000' } })
    expect(open.onBoundaryCellLimitChange).not.toHaveBeenCalled()
    fireEvent.blur(input)

    expect(open.onBoundaryCellLimitChange).toHaveBeenCalledTimes(1)
    expect(open.onBoundaryCellLimitChange).toHaveBeenCalledWith(10_000)
  })

  it('applies on Enter without loading the dataset', () => {
    const { open, input } = renderLimit()

    fireEvent.change(input, { target: { value: '8000' } })
    // A browser submits the form on Enter in a field unless the key is
    // cancelled; jsdom does not, so the cancel is what is checked.
    const notCancelled = fireEvent.keyDown(input, { key: 'Enter' })

    expect(notCancelled).toBe(false)
    expect(open.onBoundaryCellLimitChange).toHaveBeenCalledWith(8_000)
    expect(open.onSubmit).not.toHaveBeenCalled()
  })

  it('puts the limit back on Escape', () => {
    const { open, input } = renderLimit()

    fireEvent.change(input, { target: { value: '9' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('2500')
    fireEvent.blur(input)

    expect(open.onBoundaryCellLimitChange).not.toHaveBeenCalled()
  })
})

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

  it('name the drawn tier in Active bins while another loads or after it fails', () => {
    const ready16: VisiumHdControlState = {
      status: 'ready',
      url: 'https://example.test/visium-hd',
      selectedBinSize: 16,
      options: [
        { size: 16, available: true, disabled: false, binCount: 54_504 },
        { size: 8, available: true, disabled: false },
        { size: 2, available: true, disabled: false },
      ],
      binCount: 54_504,
    }
    const loading2 = visiumHdControlLoading(ready16, 2)
    const activeBins = (state: VisiumHdControlState) => {
      const { visiumHd } = testDatasetInfoModel({
        viewOptions: { visiumHd: { state } },
      }).viewOptions
      const { unmount } = render(<VisiumHdBinControls visiumHd={visiumHd} />)
      const text = screen.getByText('Active bins').nextElementSibling?.textContent
      unmount()
      return text
    }

    expect(activeBins(ready16)).toBe('54,504 at 16 µm')
    expect(activeBins(loading2)).toBe('54,504 at 16 µm view; 2 µm selected')
    expect(activeBins(visiumHdControlFailed(loading2, 'Read failed'))).toBe(
      '54,504 at 16 µm view; 2 µm selected',
    )
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

describe('AteraImageSelect', () => {
  it('switches between the 2D image and the 3D DAPI stack', () => {
    const onImageChange = vi.fn()
    render(
      <AteraImageSelect
        atera={{
          state: { status: 'ready', choice: '2d' },
          disabled: false,
          onImageChange,
        }}
      />,
    )

    const select = screen.getByLabelText('Morphology')
    expect(select).toHaveValue('2d')
    fireEvent.change(select, { target: { value: '3d' } })
    expect(onImageChange).toHaveBeenCalledWith('3d')
  })

  it('renders nothing without a 3D stack', () => {
    const { container } = render(
      <AteraImageSelect atera={testDatasetInfoModel().viewOptions.atera} />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
