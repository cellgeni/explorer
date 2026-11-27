import { fireEvent, render, renderHook, screen } from '@testing-library/react'
import { lazy, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LazyPanel } from './LazyPanel'
import { useOpenedOnce } from './useOpenedOnce'

// Since O21 Cell Query, Plots, Browse and the Screenshot form load the first
// time they are shown.

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LazyPanel (O21)', () => {
  it('says the panel is loading until its chunk arrives', async () => {
    let arrive: (() => void) | undefined
    const Panel = lazy(
      () =>
        new Promise<{ default: () => React.JSX.Element }>((resolve) => {
          arrive = () => resolve({ default: () => <p>Plots ready</p> })
        }),
    )

    render(
      <LazyPanel label="Plots">
        <Panel />
      </LazyPanel>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('Loading Plots…')
    arrive?.()
    expect(await screen.findByText('Plots ready')).toBeInTheDocument()
  })

  it('says the app was updated when the chunk is gone after a deploy', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const Panel = lazy(() =>
      Promise.reject(
        new TypeError(
          'Failed to fetch dynamically imported module: https://example.test/assets/PlotsPanel-old.js',
        ),
      ),
    )

    render(
      <LazyPanel
        label="Plots"
        frame={(content) => <section aria-label="Frame">{content}</section>}
      >
        <Panel />
      </LazyPanel>,
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'Plots could not load. The app was updated. Reload the page.',
    )
    expect(screen.getByRole('region', { name: 'Frame' })).toContainElement(alert)
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })

  it("offers Retry after an error of the panel's own", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let fail = true
    function Panel() {
      if (fail) throw new Error('no rows')
      return <p>Cell Query ready</p>
    }

    render(
      <LazyPanel label="Cell Query">
        <Panel />
      </LazyPanel>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cell Query failed: no rows',
    )
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Cell Query ready')).toBeInTheDocument()
  })
})

describe('useOpenedOnce (O21)', () => {
  it('is false until the first open, and stays true after', () => {
    const { result, rerender } = renderHook(({ open }) => useOpenedOnce(open), {
      initialProps: { open: false },
    })

    expect(result.current).toBe(false)
    rerender({ open: true })
    expect(result.current).toBe(true)
    rerender({ open: false })
    expect(result.current).toBe(true)
  })

  it('keeps a closed panel mounted once it has opened', () => {
    function Window() {
      const [open, setOpen] = useState(false)
      const opened = useOpenedOnce(open)
      return (
        <>
          <button type="button" title="Toggle" onClick={() => setOpen((value) => !value)}>
            Toggle
          </button>
          {opened ? <p>Panel</p> : null}
        </>
      )
    }

    render(<Window />)
    expect(screen.queryByText('Panel')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Toggle' }))
    fireEvent.click(screen.getByRole('button', { name: 'Toggle' }))
    expect(screen.getByText('Panel')).toBeInTheDocument()
  })
})
