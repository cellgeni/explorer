import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { VISIUM_HD_TWO_MICROMETER_STRATEGY_REASON } from '../../datasets/visiumHdStrategy'
import { DatasetHudPanel } from './DatasetHudPanel'

describe('DatasetHudPanel', () => {
  it('renders dataset controls and forwards updates', () => {
    const onSubmit = vi.fn((event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
    })
    const onDatasetUrlChange = vi.fn()
    const onShouldLoadMorphologyChange = vi.fn()
    const onBoundaryCellLimitChange = vi.fn()
    const onVisiumHdTwoMicrometerBudgetInputChange = vi.fn()
    const onVisiumHdBarcodeMappingBudgetInputChange = vi.fn()
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
        visiumHdTwoMicrometerBudgetInputId="visium-2um-budget"
        visiumHdBarcodeMappingBudgetInputId="visium-mapping-budget"
        datasetUrl="https://example.test/output"
        shouldLoadMorphology={false}
        visiumHdTwoMicrometerBudgetInput=""
        visiumHdBarcodeMappingBudgetInput=""
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
        onVisiumHdTwoMicrometerBudgetInputChange={
          onVisiumHdTwoMicrometerBudgetInputChange
        }
        onVisiumHdBarcodeMappingBudgetInputChange={
          onVisiumHdBarcodeMappingBudgetInputChange
        }
        onVisiumHdBinSizeChange={vi.fn()}
        onRunDatasetDiagnostics={onRunDatasetDiagnostics}
        onDownloadDiagnostics={onDownloadDiagnostics}
        onClearDebugLog={onClearDebugLog}
      />,
    )

    fireEvent.change(screen.getByLabelText('Dataset URL'), {
      target: { value: 'https://example.test/next' },
    })
    fireEvent.click(screen.getByLabelText('Morphology image'))
    fireEvent.change(screen.getByLabelText('Boundary limit'), {
      target: { value: '2500' },
    })
    fireEvent.change(screen.getByLabelText('2 µm budget'), {
      target: { value: '25000' },
    })
    fireEvent.change(screen.getByLabelText('Mapping rows'), {
      target: { value: '12000000' },
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
    expect(onVisiumHdTwoMicrometerBudgetInputChange).toHaveBeenCalledWith('25000')
    expect(onVisiumHdBarcodeMappingBudgetInputChange).toHaveBeenCalledWith('12000000')
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
        visiumHdTwoMicrometerBudgetInputId="visium-2um-budget"
        visiumHdBarcodeMappingBudgetInputId="visium-mapping-budget"
        datasetUrl="https://example.test/visium"
        shouldLoadMorphology
        visiumHdTwoMicrometerBudgetInput=""
        visiumHdBarcodeMappingBudgetInput=""
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
              available: true,
              disabled: true,
              reason: VISIUM_HD_TWO_MICROMETER_STRATEGY_REASON,
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
        onVisiumHdTwoMicrometerBudgetInputChange={vi.fn()}
        onVisiumHdBarcodeMappingBudgetInputChange={vi.fn()}
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
    expect(screen.getByText(VISIUM_HD_TWO_MICROMETER_STRATEGY_REASON)).toBeInTheDocument()
  })

  it('forwards 2 µm bin changes when the tier is budget-enabled', () => {
    const onVisiumHdBinSizeChange = vi.fn()

    render(
      <DatasetHudPanel
        active
        datasetInputId="dataset-url"
        morphologyInputId="morphology"
        boundaryLimitInputId="boundary-limit"
        visiumHdBinSizeInputId="visium-bin-size"
        visiumHdTwoMicrometerBudgetInputId="visium-2um-budget"
        visiumHdBarcodeMappingBudgetInputId="visium-mapping-budget"
        datasetUrl="https://example.test/visium"
        shouldLoadMorphology
        visiumHdTwoMicrometerBudgetInput="25000"
        visiumHdBarcodeMappingBudgetInput=""
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
        onVisiumHdTwoMicrometerBudgetInputChange={vi.fn()}
        onVisiumHdBarcodeMappingBudgetInputChange={vi.fn()}
        onVisiumHdBinSizeChange={onVisiumHdBinSizeChange}
        onRunDatasetDiagnostics={vi.fn()}
        onDownloadDiagnostics={vi.fn()}
        onClearDebugLog={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '2 µm' }))

    expect(onVisiumHdBinSizeChange).toHaveBeenCalledWith(2)
    expect(
      screen.queryByText(VISIUM_HD_TWO_MICROMETER_STRATEGY_REASON),
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
        visiumHdTwoMicrometerBudgetInputId="visium-2um-budget"
        visiumHdBarcodeMappingBudgetInputId="visium-mapping-budget"
        datasetUrl="https://example.test/output"
        shouldLoadMorphology={false}
        visiumHdTwoMicrometerBudgetInput=""
        visiumHdBarcodeMappingBudgetInput=""
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
        onVisiumHdTwoMicrometerBudgetInputChange={vi.fn()}
        onVisiumHdBarcodeMappingBudgetInputChange={vi.fn()}
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
