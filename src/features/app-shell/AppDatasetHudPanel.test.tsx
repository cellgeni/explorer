import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AppDatasetHudPanel } from './AppDatasetHudPanel'

type Props = ComponentProps<typeof AppDatasetHudPanel>

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    active: true,
    activeErrors: [],
    appendDebugEvent: vi.fn(),
    boundaryCellLimit: 50_000,
    cellFeatureMatrixCapabilityState: { status: 'idle' },
    controlIds: {
      boundaryLimitInputId: 'boundary-limit',
      datasetInputId: 'dataset-url',
      morphologyInputId: 'morphology',
    },
    datasetUrl: 'https://example.test/output',
    debugLog: [],
    diagnosticsState: { status: 'idle' },
    handleDatasetSubmit: vi.fn((event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
    }),
    handleDownloadDiagnostics: vi.fn(),
    handleRunDatasetDiagnostics: vi.fn(async () => undefined),
    isLoading: false,
    setBoundaryCellLimit: vi.fn(),
    setDatasetUrl: vi.fn(),
    setDebugLog: vi.fn(),
    setShouldLoadMorphology: vi.fn(),
    shouldLoadMorphology: true,
    ...overrides,
  }
}

describe('AppDatasetHudPanel', () => {
  it('normalizes dataset controls before updating app state', () => {
    const props = baseProps()

    render(<AppDatasetHudPanel {...props} />)

    fireEvent.change(screen.getByLabelText('Dataset URL'), {
      target: { value: 'https://example.test/next' },
    })
    fireEvent.click(screen.getByLabelText('Morphology image'))
    fireEvent.change(screen.getByLabelText('Boundary limit'), {
      target: { value: '100001' },
    })

    expect(props.setDatasetUrl).toHaveBeenCalledWith('https://example.test/next')
    expect(props.setShouldLoadMorphology).toHaveBeenCalledWith(false)
    expect(props.appendDebugEvent).toHaveBeenCalledWith('Morphology image disabled')
    expect(props.setBoundaryCellLimit).toHaveBeenCalledWith(100_000)
    expect(props.appendDebugEvent).toHaveBeenCalledWith('Boundary limit: 100,000', {
      coalesceKey: 'boundary-limit',
    })
  })

  it('runs async diagnostics without leaking the promise into the button handler', () => {
    const props = baseProps()

    render(<AppDatasetHudPanel {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Diagnose Dataset' }))

    expect(props.handleRunDatasetDiagnostics).toHaveBeenCalledTimes(1)
  })
})
