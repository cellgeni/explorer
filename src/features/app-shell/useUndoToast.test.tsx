import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UndoToast } from './UndoToast'
import { UNDO_TIMEOUT_MS, useUndoToast } from './useUndoToast'

function Probe() {
  const store = useUndoToast()
  return (
    <>
      <button
        type="button"
        title="Remove"
        onClick={() => {
          store.offerUndo({ message: 'Removed Cluster 3', undo: undoSpy })
        }}
      >
        Remove
      </button>
      <input aria-label="Search" title="Search" />
      <UndoToast store={store} />
    </>
  )
}

const undoSpy = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  undoSpy.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useUndoToast', () => {
  it('offers Undo for 8 s', () => {
    render(<Probe />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    expect(screen.getByRole('status')).toHaveTextContent('Removed Cluster 3')
    act(() => {
      vi.advanceTimersByTime(UNDO_TIMEOUT_MS - 1)
    })
    expect(screen.getByRole('status')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(undoSpy).not.toHaveBeenCalled()
  })

  it('undoes once, then goes', () => {
    render(<Probe />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    const undo = screen.getByRole('button', { name: 'Undo' })

    fireEvent.click(undo)
    fireEvent.click(undo)
    expect(undoSpy).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('stays while hovered or focused, then has its full time again', () => {
    render(<Probe />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    const toast = screen.getByRole('status')

    fireEvent.pointerEnter(toast)
    act(() => {
      vi.advanceTimersByTime(UNDO_TIMEOUT_MS * 2)
    })
    expect(toast).toBeInTheDocument()

    fireEvent.pointerLeave(toast)
    act(() => {
      vi.advanceTimersByTime(UNDO_TIMEOUT_MS - 1)
    })
    expect(toast).toBeInTheDocument()

    fireEvent.focus(screen.getByRole('button', { name: 'Undo' }))
    act(() => {
      vi.advanceTimersByTime(UNDO_TIMEOUT_MS)
    })
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('undoes with Ctrl+Z or Cmd+Z, except in a text field', () => {
    render(<Probe />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search' }), {
      key: 'z',
      ctrlKey: true,
    })
    expect(undoSpy).not.toHaveBeenCalled()

    fireEvent.keyDown(document.body, { key: 'z', metaKey: true, shiftKey: true })
    expect(undoSpy).not.toHaveBeenCalled()

    fireEvent.keyDown(document.body, { key: 'Z', metaKey: true })
    expect(undoSpy).toHaveBeenCalledTimes(1)
  })

  it('keeps only the newest offer, with a fresh timer', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { result } = renderHook(() => useUndoToast())

    act(() => {
      result.current.offerUndo({ message: 'First', undo: first })
    })
    act(() => {
      vi.advanceTimersByTime(UNDO_TIMEOUT_MS - 100)
      result.current.offerUndo({ message: 'Second', undo: second })
    })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(result.current.offer?.message).toBe('Second')

    act(() => {
      result.current.undo()
    })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
