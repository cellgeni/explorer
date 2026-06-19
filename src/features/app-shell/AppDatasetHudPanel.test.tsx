import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { VISIUM_HD_TWO_MICROMETER_STRATEGY_REASON } from '../../datasets/visiumHdStrategy'
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
      visiumHdBinSizeInputId: 'visium-bin-size',
      visiumHdTwoMicrometerBudgetInputId: 'visium-2um-budget',
      visiumHdBarcodeMappingBudgetInputId: 'visium-mapping-budget',
    },
    datasetUrl: 'https://example.test/output',
    debugLog: [],
    fallbackNotices: [],
    diagnosticsState: { status: 'idle' },
    handleDatasetSubmit: vi.fn((event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
    }),
    handleDownloadDiagnostics: vi.fn(),
    handleRunDatasetDiagnostics: vi.fn(async () => undefined),
    handleVisiumHdBinSizeChange: vi.fn(async () => undefined),
    isLoading: false,
    isVisiumHdDataset: false,
    setBoundaryCellLimit: vi.fn(),
    setDatasetUrl: vi.fn(),
    setDebugLog: vi.fn(),
    setShouldLoadMorphology: vi.fn(),
    onVisiumHdTwoMicrometerBudgetInputChange: vi.fn(),
    onVisiumHdBarcodeMappingBudgetInputChange: vi.fn(),
    shouldLoadMorphology: true,
    visiumHdControlState: { status: 'idle' },
    visiumHdTwoMicrometerBudgetInput: '',
    visiumHdBarcodeMappingBudgetInput: '',
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
    fireEvent.change(screen.getByLabelText('2 µm budget'), {
      target: { value: '25000' },
    })
    fireEvent.change(screen.getByLabelText('Mapping rows'), {
      target: { value: '12000000' },
    })

    expect(props.setDatasetUrl).toHaveBeenCalledWith('https://example.test/next')
    expect(props.setShouldLoadMorphology).toHaveBeenCalledWith(false)
    expect(props.appendDebugEvent).toHaveBeenCalledWith('Morphology image disabled')
    expect(props.setBoundaryCellLimit).toHaveBeenCalledWith(100_000)
    expect(props.appendDebugEvent).toHaveBeenCalledWith('Boundary limit: 100,000', {
      coalesceKey: 'boundary-limit',
    })
    expect(props.onVisiumHdTwoMicrometerBudgetInputChange).toHaveBeenCalledWith('25000')
    expect(props.appendDebugEvent).toHaveBeenCalledWith(
      'Visium HD 2 µm budget: 25,000 barcodes',
      {
        coalesceKey: 'visium-hd-2um-budget',
      },
    )
    expect(props.onVisiumHdBarcodeMappingBudgetInputChange).toHaveBeenCalledWith(
      '12000000',
    )
    expect(props.appendDebugEvent).toHaveBeenCalledWith(
      'Visium HD mapping row budget: 12,000,000 rows',
      {
        coalesceKey: 'visium-hd-mapping-budget',
      },
    )
  })

  it('runs async diagnostics without leaking the promise into the button handler', () => {
    const props = baseProps()

    render(<AppDatasetHudPanel {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Diagnose Dataset' }))

    expect(props.handleRunDatasetDiagnostics).toHaveBeenCalledTimes(1)
  })

  it('forwards Visium HD bin changes through the async handler', () => {
    const props = baseProps({
      isVisiumHdDataset: true,
      visiumHdControlState: {
        status: 'ready',
        url: 'https://example.test/visium',
        selectedBinSize: 16,
        options: [
          { size: 16, available: true, disabled: false },
          { size: 8, available: true, disabled: false },
          {
            size: 2,
            available: true,
            disabled: true,
            reason: VISIUM_HD_TWO_MICROMETER_STRATEGY_REASON,
          },
        ],
      },
    })

    render(<AppDatasetHudPanel {...props} />)

    fireEvent.click(screen.getByRole('button', { name: '8 µm' }))

    expect(props.handleVisiumHdBinSizeChange).toHaveBeenCalledWith(8)
    expect(screen.getByLabelText('Boundary limit')).toBeDisabled()
  })
})
