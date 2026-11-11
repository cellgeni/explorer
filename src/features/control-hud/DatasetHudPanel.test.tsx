import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DatasetHudPanel } from './DatasetHudPanel'

describe('DatasetHudPanel', () => {
  it('renders dataset controls and forwards updates', async () => {
    const onSubmit = vi.fn((event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
    })
    const onDatasetUrlChange = vi.fn()
    const onShouldLoadMorphologyChange = vi.fn()
    const onBoundaryCellLimitChange = vi.fn()
    const onRunDatasetDiagnostics = vi.fn()
    const onDownloadDiagnostics = vi.fn()
    const onClearDebugLog = vi.fn()
    const onCopyLink = vi.fn(async () => true)

    render(
      <DatasetHudPanel
        active
        datasetInputId="dataset-url"
        morphologyInputId="morphology"
        boundaryLimitInputId="boundary-limit"
        visiumHdBinSizeInputId="visium-bin-size"
        datasetAbout={null}
        datasetUrl="https://example.test/output"
        shouldLoadMorphology={false}
        morphologyLabel="Morphology image"
        boundaryCellLimit={50000}
        maxBoundaryCellLimit={100000}
        boundaryControlsDisabled={false}
        isLoading={false}
        diagnosticsState={{ status: 'idle' }}
        cellFeatureMatrixCapabilityState={{ status: 'idle' }}
        visiumHdControlState={{ status: 'idle' }}
        spatialDataControlState={{ status: 'idle' }}
        onSpatialDataSelectionChange={vi.fn()}
        visiumControlState={{ status: 'idle' }}
        onVisiumImageChange={vi.fn()}
        onVisiumViewChange={vi.fn()}
        activeErrors={[]}
        fallbackNotices={[]}
        debugLog={[{ id: 1, timestamp: 1_700_000_000_000, message: 'Loaded' }]}
        onSubmit={onSubmit}
        onDatasetUrlChange={onDatasetUrlChange}
        onShouldLoadMorphologyChange={onShouldLoadMorphologyChange}
        onBoundaryCellLimitChange={onBoundaryCellLimitChange}
        onVisiumHdBinSizeChange={vi.fn()}
        onRunDatasetDiagnostics={onRunDatasetDiagnostics}
        onDownloadDiagnostics={onDownloadDiagnostics}
        onClearDebugLog={onClearDebugLog}
        canCopyLink
        onCopyLink={onCopyLink}
      />,
    )

    fireEvent.change(screen.getByLabelText('Dataset or image URL'), {
      target: { value: 'https://example.test/next' },
    })
    fireEvent.click(screen.getByLabelText('Morphology image'))
    fireEvent.change(screen.getByLabelText('Boundary limit'), {
      target: { value: '2500' },
    })
    fireEvent.submit(
      screen.getByRole('button', { name: 'Load Dataset' }).closest('form')!,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose Dataset' }))
    fireEvent.click(screen.getByRole('button', { name: 'Download diagnostics' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(onDatasetUrlChange).toHaveBeenCalledWith('https://example.test/next')
    expect(onShouldLoadMorphologyChange).toHaveBeenCalledWith(true)
    expect(onBoundaryCellLimitChange).toHaveBeenCalledWith(2500)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onRunDatasetDiagnostics).toHaveBeenCalledTimes(1)
    expect(onDownloadDiagnostics).toHaveBeenCalledTimes(1)
    expect(onClearDebugLog).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Copy Link' }))
    expect(onCopyLink).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Link copied')).toBeInTheDocument()
  })

  it('renders Visium HD bin controls and disables unavailable tiers', () => {
    const onVisiumHdBinSizeChange = vi.fn()

    render(
      <DatasetHudPanel
        active
        datasetInputId="dataset-url"
        morphologyInputId="morphology"
        boundaryLimitInputId="boundary-limit"
        visiumHdBinSizeInputId="visium-bin-size"
        datasetAbout={null}
        datasetUrl="https://example.test/visium"
        shouldLoadMorphology
        morphologyLabel="Tissue image"
        boundaryCellLimit={50000}
        maxBoundaryCellLimit={100000}
        boundaryControlsDisabled
        isLoading={false}
        diagnosticsState={{ status: 'idle' }}
        cellFeatureMatrixCapabilityState={{ status: 'idle' }}
        visiumHdControlState={{
          status: 'ready',
          url: 'https://example.test/visium',
          selectedBinSize: 16,
          binCount: 54_504,
          options: [
            { size: 16, available: true, disabled: false, binCount: 54_504 },
            { size: 8, available: true, disabled: false },
            {
              size: 2,
              available: false,
              disabled: true,
              reason: '2 µm binned output was not detected.',
            },
          ],
        }}
        spatialDataControlState={{ status: 'idle' }}
        onSpatialDataSelectionChange={vi.fn()}
        visiumControlState={{ status: 'idle' }}
        onVisiumImageChange={vi.fn()}
        onVisiumViewChange={vi.fn()}
        activeErrors={[]}
        fallbackNotices={[]}
        debugLog={[]}
        onSubmit={vi.fn()}
        onDatasetUrlChange={vi.fn()}
        onShouldLoadMorphologyChange={vi.fn()}
        onBoundaryCellLimitChange={vi.fn()}
        onVisiumHdBinSizeChange={onVisiumHdBinSizeChange}
        onRunDatasetDiagnostics={vi.fn()}
        onDownloadDiagnostics={vi.fn()}
        onClearDebugLog={vi.fn()}
      />,
    )

    expect(screen.getByText('Visium HD')).toBeInTheDocument()
    expect(screen.getByLabelText('Tissue image')).toBeChecked()
    expect(screen.getByLabelText('Boundary limit')).toBeDisabled()
    expect(screen.getByRole('button', { name: '16 µm' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    fireEvent.click(screen.getByRole('button', { name: '8 µm' }))

    expect(onVisiumHdBinSizeChange).toHaveBeenCalledWith(8)
    expect(screen.getByRole('button', { name: '2 µm' })).toBeDisabled()
    expect(screen.getByText('2 µm binned output was not detected.')).toBeInTheDocument()
  })

  it('forwards 2 µm bin changes when the tier is available', () => {
    const onVisiumHdBinSizeChange = vi.fn()

    render(
      <DatasetHudPanel
        active
        datasetInputId="dataset-url"
        morphologyInputId="morphology"
        boundaryLimitInputId="boundary-limit"
        visiumHdBinSizeInputId="visium-bin-size"
        datasetAbout={null}
        datasetUrl="https://example.test/visium"
        shouldLoadMorphology
        morphologyLabel="Tissue image"
        boundaryCellLimit={50000}
        maxBoundaryCellLimit={100000}
        boundaryControlsDisabled
        isLoading={false}
        diagnosticsState={{ status: 'idle' }}
        cellFeatureMatrixCapabilityState={{ status: 'idle' }}
        visiumHdControlState={{
          status: 'ready',
          url: 'https://example.test/visium',
          selectedBinSize: 16,
          binCount: 54_504,
          options: [
            { size: 16, available: true, disabled: false, binCount: 54_504 },
            { size: 8, available: true, disabled: false },
            { size: 2, available: true, disabled: false },
          ],
        }}
        spatialDataControlState={{ status: 'idle' }}
        onSpatialDataSelectionChange={vi.fn()}
        visiumControlState={{ status: 'idle' }}
        onVisiumImageChange={vi.fn()}
        onVisiumViewChange={vi.fn()}
        activeErrors={[]}
        fallbackNotices={[]}
        debugLog={[]}
        onSubmit={vi.fn()}
        onDatasetUrlChange={vi.fn()}
        onShouldLoadMorphologyChange={vi.fn()}
        onBoundaryCellLimitChange={vi.fn()}
        onVisiumHdBinSizeChange={onVisiumHdBinSizeChange}
        onRunDatasetDiagnostics={vi.fn()}
        onDownloadDiagnostics={vi.fn()}
        onClearDebugLog={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '2 µm' }))

    expect(onVisiumHdBinSizeChange).toHaveBeenCalledWith(2)
    expect(
      screen.queryByText('2 µm binned output was not detected.'),
    ).not.toBeInTheDocument()
  })

  it('changes the SpatialData image and unit scale', () => {
    const onSpatialDataSelectionChange = vi.fn()

    render(
      <DatasetHudPanel
        active
        datasetInputId="dataset-url"
        morphologyInputId="morphology"
        boundaryLimitInputId="boundary-limit"
        visiumHdBinSizeInputId="visium-bin-size"
        datasetAbout={null}
        datasetUrl="https://example.test/sample.zarr"
        shouldLoadMorphology
        morphologyLabel="Morphology image"
        boundaryCellLimit={50000}
        maxBoundaryCellLimit={100000}
        boundaryControlsDisabled={false}
        isLoading={false}
        diagnosticsState={{ status: 'idle' }}
        cellFeatureMatrixCapabilityState={{ status: 'idle' }}
        visiumHdControlState={{ status: 'idle' }}
        spatialDataControlState={{
          status: 'ready',
          coordinateSystem: 'global',
          coordinateSystems: ['global', 'aligned'],
          image: 'he',
          images: ['he', 'morphology'],
          units: {
            micrometersPerUnit: 0.2125,
            source: 'estimated',
            detail: 'cell_area vs seg label pixels',
          },
          selection: {},
        }}
        onSpatialDataSelectionChange={onSpatialDataSelectionChange}
        visiumControlState={{ status: 'idle' }}
        onVisiumImageChange={vi.fn()}
        onVisiumViewChange={vi.fn()}
        activeErrors={[]}
        fallbackNotices={[]}
        debugLog={[]}
        onSubmit={vi.fn()}
        onDatasetUrlChange={vi.fn()}
        onShouldLoadMorphologyChange={vi.fn()}
        onBoundaryCellLimitChange={vi.fn()}
        onVisiumHdBinSizeChange={vi.fn()}
        onRunDatasetDiagnostics={vi.fn()}
        onDownloadDiagnostics={vi.fn()}
        onClearDebugLog={vi.fn()}
      />,
    )

    expect(
      screen.getByText(
        'Estimated from cell_area vs seg label pixels. Set the scale if you know it.',
      ),
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Image'), { target: { value: 'morphology' } })
    expect(onSpatialDataSelectionChange).toHaveBeenLastCalledWith({
      coordinateSystem: 'global',
      image: 'morphology',
    })

    const units = screen.getByLabelText('Micrometers per coordinate-system unit')
    expect(units).toHaveValue(0.2125)
    fireEvent.change(units, { target: { value: '0.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set' }))
    expect(onSpatialDataSelectionChange).toHaveBeenLastCalledWith({
      coordinateSystem: 'global',
      micrometersPerUnit: 0.5,
    })

    fireEvent.change(screen.getByLabelText('Coordinate system'), {
      target: { value: 'aligned' },
    })
    expect(onSpatialDataSelectionChange).toHaveBeenLastCalledWith({
      coordinateSystem: 'aligned',
    })
  })

  it('shows the Visium library, scale, and tissue image choice', () => {
    const onVisiumImageChange = vi.fn()
    const onVisiumViewChange = vi.fn()

    render(
      <DatasetHudPanel
        active
        datasetInputId="dataset-url"
        morphologyInputId="morphology"
        boundaryLimitInputId="boundary-limit"
        visiumHdBinSizeInputId="visium-bin-size"
        datasetAbout={null}
        datasetUrl="https://example.test/visium.h5ad"
        shouldLoadMorphology
        morphologyLabel="Tissue image"
        boundaryCellLimit={50000}
        maxBoundaryCellLimit={100000}
        boundaryControlsDisabled={false}
        isLoading={false}
        diagnosticsState={{ status: 'idle' }}
        cellFeatureMatrixCapabilityState={{ status: 'idle' }}
        visiumHdControlState={{ status: 'idle' }}
        spatialDataControlState={{ status: 'idle' }}
        onSpatialDataSelectionChange={vi.fn()}
        visiumControlState={{
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
            chemistry: "Spatial 3' v1",
          },
        }}
        onVisiumImageChange={onVisiumImageChange}
        onVisiumViewChange={onVisiumViewChange}
        activeErrors={[]}
        fallbackNotices={[]}
        debugLog={[]}
        onSubmit={vi.fn()}
        onDatasetUrlChange={vi.fn()}
        onShouldLoadMorphologyChange={vi.fn()}
        onBoundaryCellLimitChange={vi.fn()}
        onVisiumHdBinSizeChange={vi.fn()}
        onRunDatasetDiagnostics={vi.fn()}
        onDownloadDiagnostics={vi.fn()}
        onClearDebugLog={vi.fn()}
      />,
    )

    const section = screen.getByRole('region', { name: 'Visium dataset' })
    expect(section).toHaveTextContent('Visium (H5AD)')
    expect(section).toHaveTextContent('2,698 × 55 µm (2,294 off tissue hidden)')
    expect(screen.getByTitle('Visium library to show')).toHaveValue('V1_Mouse_Brain')
    expect(section).toHaveTextContent("Spatial 3' v1")
    expect(section).toHaveTextContent('0.5404 µm per pixel (array row/column fit')

    const select = screen.getByTitle('Visium tissue image to show')
    expect(select).toHaveValue('hires')
    fireEvent.change(select, { target: { value: 'lowres' } })
    expect(onVisiumImageChange).toHaveBeenLastCalledWith('lowres')
    fireEvent.change(select, { target: { value: '' } })
    expect(onVisiumImageChange).toHaveBeenLastCalledWith(null)

    fireEvent.change(screen.getByTitle('Visium library to show'), {
      target: { value: 'V1_Mouse_Kidney' },
    })
    expect(onVisiumViewChange).toHaveBeenLastCalledWith({ libraryId: 'V1_Mouse_Kidney' })

    const offTissue = screen.getByLabelText('Show off-tissue spots')
    expect(offTissue).not.toBeChecked()
    fireEvent.click(offTissue)
    expect(onVisiumViewChange).toHaveBeenLastCalledWith({ showOffTissue: true })
  })

  it('renders fallback notices in the dataset HUD', () => {
    render(
      <DatasetHudPanel
        active
        datasetInputId="dataset-url"
        morphologyInputId="morphology"
        boundaryLimitInputId="boundary-limit"
        visiumHdBinSizeInputId="visium-bin-size"
        datasetAbout={null}
        datasetUrl="https://example.test/output"
        shouldLoadMorphology={false}
        morphologyLabel="Morphology image"
        boundaryCellLimit={50000}
        maxBoundaryCellLimit={100000}
        boundaryControlsDisabled={false}
        isLoading={false}
        diagnosticsState={{ status: 'idle' }}
        cellFeatureMatrixCapabilityState={{ status: 'idle' }}
        visiumHdControlState={{ status: 'idle' }}
        spatialDataControlState={{ status: 'idle' }}
        onSpatialDataSelectionChange={vi.fn()}
        visiumControlState={{ status: 'idle' }}
        onVisiumImageChange={vi.fn()}
        onVisiumViewChange={vi.fn()}
        activeErrors={[]}
        fallbackNotices={[
          {
            id: 1,
            timestamp: 1_700_000_000_000,
            source: 'Dataset overview',
            message:
              'The browser Parquet reader could not decode cells.parquet, so the app switched to the DuckDB-WASM overview reader.',
            action: 'The first overview read may be slower.',
            detail: 'Out of bounds access',
          },
        ]}
        debugLog={[]}
        onSubmit={vi.fn()}
        onDatasetUrlChange={vi.fn()}
        onShouldLoadMorphologyChange={vi.fn()}
        onBoundaryCellLimitChange={vi.fn()}
        onVisiumHdBinSizeChange={vi.fn()}
        onRunDatasetDiagnostics={vi.fn()}
        onDownloadDiagnostics={vi.fn()}
        onClearDebugLog={vi.fn()}
      />,
    )

    expect(screen.getByRole('status', { name: 'Fallback notices' })).toBeInTheDocument()
    expect(screen.getByText('Fallbacks')).toBeInTheDocument()
    expect(screen.getByText('Dataset overview')).toBeInTheDocument()
    expect(screen.getByText(/DuckDB-WASM overview reader/)).toBeInTheDocument()
    expect(screen.getByText('The first overview read may be slower.')).toBeInTheDocument()
    expect(screen.getByText('Out of bounds access')).toBeInTheDocument()
  })

  it('shows the manifest name, description, and source', () => {
    render(
      <DatasetHudPanel
        active
        datasetInputId="dataset-url"
        morphologyInputId="morphology"
        boundaryLimitInputId="boundary-limit"
        visiumHdBinSizeInputId="visium-bin-size"
        datasetAbout={{
          name: 'Skin Xenium run',
          description: 'Human skin, 5K panel.',
          source: {
            repository: 'BioImage Archive',
            accession: 'S-BIAD2214',
            url: 'https://www.ebi.ac.uk/biostudies/BioImages/studies/S-BIAD2214',
            license: 'CC0',
            citation: 'Example et al. (2025)',
          },
        }}
        datasetUrl="https://example.test/output"
        shouldLoadMorphology={false}
        morphologyLabel="Morphology image"
        boundaryCellLimit={50000}
        maxBoundaryCellLimit={100000}
        boundaryControlsDisabled={false}
        isLoading={false}
        diagnosticsState={{ status: 'idle' }}
        cellFeatureMatrixCapabilityState={{ status: 'idle' }}
        visiumHdControlState={{ status: 'idle' }}
        spatialDataControlState={{ status: 'idle' }}
        onSpatialDataSelectionChange={vi.fn()}
        visiumControlState={{ status: 'idle' }}
        onVisiumImageChange={vi.fn()}
        onVisiumViewChange={vi.fn()}
        activeErrors={[]}
        fallbackNotices={[]}
        debugLog={[]}
        onSubmit={vi.fn()}
        onDatasetUrlChange={vi.fn()}
        onShouldLoadMorphologyChange={vi.fn()}
        onBoundaryCellLimitChange={vi.fn()}
        onVisiumHdBinSizeChange={vi.fn()}
        onRunDatasetDiagnostics={vi.fn()}
        onDownloadDiagnostics={vi.fn()}
        onClearDebugLog={vi.fn()}
      />,
    )

    const about = screen.getByRole('region', { name: 'About this dataset' })
    expect(about).toHaveTextContent('Skin Xenium run')
    expect(about).toHaveTextContent('Human skin, 5K panel.')
    expect(
      screen.getByRole('link', { name: 'BioImage Archive S-BIAD2214' }),
    ).toHaveAttribute(
      'href',
      'https://www.ebi.ac.uk/biostudies/BioImages/studies/S-BIAD2214',
    )
    expect(about).toHaveTextContent('CC0')
    expect(about).toHaveTextContent('Example et al. (2025)')
  })
})
