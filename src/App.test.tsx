import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from './App'

describe('App', () => {
  it('renders the Xenium viewer shell', () => {
    render(<App />)

    const datasetInput = screen.getByLabelText('Dataset URL')

    expect(screen.getByRole('heading', { name: 'Xenium Explorer' })).toBeInTheDocument()
    expect(datasetInput).toBeInstanceOf(HTMLInputElement)

    if (datasetInput instanceof HTMLInputElement) {
      expect(datasetInput.value).toContain('/public/xenium/')
    }

    expect(screen.getByRole('button', { name: 'Load Dataset' })).toBeInTheDocument()
  })
})
