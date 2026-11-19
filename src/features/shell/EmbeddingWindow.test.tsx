import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { testEmbeddingModel } from '../../test/sectionModels'
import { EmbeddingWindow } from './EmbeddingWindow'

function panelStyle(): CSSStyleDeclaration {
  return screen.getByRole('region', { name: 'Embedding' }).style
}

describe('EmbeddingWindow', () => {
  it('loads embeddings, and closes', () => {
    const embedding = testEmbeddingModel()
    const onClose = vi.fn()
    render(<EmbeddingWindow embedding={embedding} open onClose={onClose} />)

    expect(screen.getByText('No embedding loaded')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load Embeddings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close embedding' }))
    fireEvent.keyDown(screen.getByLabelText('Embedding view'), { key: 'Escape' })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Load Embeddings' }), {
      key: 'Escape',
    })

    expect(embedding.onLoad).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('takes focus when it opens and gives it back when it closes (15.5-D)', () => {
    const embedding = testEmbeddingModel()
    function Harness({ open }: { readonly open: boolean }) {
      return (
        <>
          <button type="button" title="Show the UMAP or t-SNE panel">
            Embedding
          </button>
          <EmbeddingWindow embedding={embedding} open={open} onClose={vi.fn()} />
        </>
      )
    }
    const { rerender } = render(<Harness open={false} />)
    const opener = screen.getByRole('button', { name: 'Embedding' })
    opener.focus()

    rerender(<Harness open />)
    expect(screen.getByRole('button', { name: 'Close embedding' })).toHaveFocus()

    rerender(<Harness open={false} />)
    expect(opener).toHaveFocus()
  })

  it('stays mounted, hidden, while closed', () => {
    render(
      <EmbeddingWindow embedding={testEmbeddingModel()} open={false} onClose={vi.fn()} />,
    )

    expect(screen.queryByRole('region', { name: 'Embedding' })).not.toBeInTheDocument()
    expect(document.querySelector('.shell-embedding')).toHaveAttribute('hidden')
  })

  it('resizes from its grip by keyboard and pointer, within limits', () => {
    render(<EmbeddingWindow embedding={testEmbeddingModel()} open onClose={vi.fn()} />)
    const grip = screen.getByRole('button', { name: 'Resize the embedding panel' })

    expect(panelStyle().width).toBe('360px')
    fireEvent.keyDown(grip, { key: 'ArrowLeft' })
    fireEvent.keyDown(grip, { key: 'ArrowDown' })
    expect(panelStyle().width).toBe('380px')
    expect(panelStyle().height).toBe('420px')
    // The grip says its size (15.5-D).
    expect(grip).toHaveAccessibleDescription('380 by 420 px')

    fireEvent.pointerDown(grip, { clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(grip, { clientX: 400, clientY: 40, pointerId: 1 })
    fireEvent.pointerUp(grip, { pointerId: 1 })
    expect(panelStyle().width).toBe('280px')
    expect(panelStyle().height).toBe('360px')
  })

  it('moves by its title bar or its grip button, inside the canvas', () => {
    const { container } = render(
      <EmbeddingWindow embedding={testEmbeddingModel()} open onClose={vi.fn()} />,
    )
    const panel = screen.getByRole('region', { name: 'Embedding' })
    const grip = screen.getByRole('button', { name: 'Move the embedding panel' })
    const title = screen.getByRole('heading', { name: 'Embedding' })

    // The grip says where the window is (15.5-D).
    expect(grip).toHaveAccessibleDescription('12 px from the top, 12 px from the right')
    fireEvent.keyDown(grip, { key: 'ArrowLeft' })
    fireEvent.keyDown(grip, { key: 'ArrowDown' })
    expect(panel).toHaveClass('is-moved')
    expect(panelStyle().getPropertyValue('--floating-right')).toBe('32px')
    expect(panelStyle().getPropertyValue('--floating-top')).toBe('32px')
    expect(grip).toHaveAccessibleDescription('32 px from the top, 32 px from the right')

    // A click that barely moves leaves it in place; a drag moves it.
    fireEvent.pointerDown(title, { clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(title, { clientX: 101, clientY: 101, pointerId: 1 })
    expect(panelStyle().getPropertyValue('--floating-right')).toBe('32px')
    fireEvent.pointerMove(title, { clientX: 0, clientY: 150, pointerId: 1 })
    fireEvent.pointerUp(title, { pointerId: 1 })
    expect(panelStyle().getPropertyValue('--floating-right')).toBe('132px')
    expect(panelStyle().getPropertyValue('--floating-top')).toBe('82px')

    // Close does not start a move.
    const close = screen.getByRole('button', { name: 'Close embedding' })
    fireEvent.pointerDown(close, { clientX: 100, clientY: 100, pointerId: 2 })
    fireEvent.pointerMove(close, { clientX: 0, clientY: 0, pointerId: 2 })
    fireEvent.pointerUp(close, { pointerId: 2 })
    expect(panelStyle().getPropertyValue('--floating-right')).toBe('132px')

    // It stays inside an 800 x 600 px canvas, and is resized only up to its
    // edges.
    Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true })
    Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true })
    fireEvent.pointerDown(title, { clientX: 500, clientY: 100, pointerId: 3 })
    fireEvent.pointerMove(title, { clientX: 0, clientY: 900, pointerId: 3 })
    fireEvent.pointerUp(title, { pointerId: 3 })
    expect(panelStyle().getPropertyValue('--floating-right')).toBe('428px')
    expect(panelStyle().getPropertyValue('--floating-top')).toBe('188px')
    const resize = screen.getByRole('button', { name: 'Resize the embedding panel' })
    fireEvent.keyDown(resize, { key: 'ArrowLeft' })
    fireEvent.keyDown(resize, { key: 'ArrowDown' })
    expect(panelStyle().width).toBe('360px')
    expect(panelStyle().height).toBe('400px')
    for (let step = 0; step < 30; step += 1) fireEvent.keyDown(grip, { key: 'ArrowUp' })
    expect(panelStyle().getPropertyValue('--floating-top')).toBe('12px')
  })

  it('spans the canvas without moving under 860 px', () => {
    render(
      <EmbeddingWindow
        embedding={testEmbeddingModel()}
        open
        fullWidth
        onClose={vi.fn()}
      />,
    )
    const title = screen.getByRole('heading', { name: 'Embedding' })

    expect(
      screen.queryByRole('button', { name: 'Move the embedding panel' }),
    ).not.toBeInTheDocument()
    fireEvent.pointerDown(title, { clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(title, { clientX: 0, clientY: 150, pointerId: 1 })
    expect(screen.getByRole('region', { name: 'Embedding' })).not.toHaveClass('is-moved')
  })
})
