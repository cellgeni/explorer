import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DatasetHudPanel } from './DatasetHudPanel'

describe('DatasetHudPanel', () => {
  it('renders dataset controls and forwards updates', () => {
    const onSubmit = vi.fn((event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
    })
    const onDatasetUrlChange = vi.fn()
    const onShouldLoadMorphologyChange = vi.fn()
    const onBoundaryCellLimitChange = vi.fn()
    const onRunDatasetDiagnostics = vi.fn()
    const onDownloadDiagnostics = vi.fn()
    const onClearDebugLog = vi.fn()

    render(
      <DatasetHudPanel
        active
        datasetInputId="dataset-url"
        morphologyInputId="morphology"
        boundaryLimitInputId="boundary-limit"
        visiumHdBinSizeInputId="visium-bin-size"
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

  it('renders fallback notices in the dataset HUD', () => {
    render(
      <DatasetHudPanel
        active
        datasetInputId="dataset-url"
        morphologyInputId="morphology"
        boundaryLimitInputId="boundary-limit"
        visiumHdBinSizeInputId="visium-bin-size"
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
})
