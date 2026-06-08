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
        datasetUrl="https://example.test/output"
        shouldLoadMorphology={false}
        boundaryCellLimit={50000}
        maxBoundaryCellLimit={100000}
        isLoading={false}
        diagnosticsState={{ status: 'idle' }}
        cellFeatureMatrixCapabilityState={{ status: 'idle' }}
        activeErrors={[]}
        debugLog={[{ id: 1, timestamp: 1_700_000_000_000, message: 'Loaded' }]}
        onSubmit={onSubmit}
        onDatasetUrlChange={onDatasetUrlChange}
        onShouldLoadMorphologyChange={onShouldLoadMorphologyChange}
        onBoundaryCellLimitChange={onBoundaryCellLimitChange}
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
})
