import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Button,
  Card,
  Checkbox,
  Chip,
  Disclosure,
  Drawer,
  IconButton,
  Kbd,
  NumberField,
  Popover,
  Segmented,
  Select,
  Sheet,
  Slider,
  Switch,
  Tooltip,
} from '.'

afterEach(() => {
  vi.useRealTimers()
})

describe('UI primitives', () => {
  it('requires a title on every primitive', () => {
    // tsc fails on an unused @ts-expect-error, so each line proves that
    // leaving out title is a type error.
    const noop = () => {}
    const elements = [
      // @ts-expect-error title is required
      <Button>Go</Button>,
      // @ts-expect-error title is required
      <IconButton icon="x" />,
      // @ts-expect-error title is required
      <Segmented label="Unit" value="a" options={[]} onChange={noop} />,
      // @ts-expect-error title is required
      <Select label="Scale" value="a" options={[]} onChange={noop} />,
      // @ts-expect-error title is required
      <Checkbox label="Cells" checked onChange={noop} />,
      // @ts-expect-error title is required
      <Switch label="Tooltips" checked onChange={noop} />,
      // @ts-expect-error title is required
      <Slider label="Opacity" value={1} min={0} max={1} onChange={noop} />,
      // @ts-expect-error title is required
      <NumberField label="Budget" value={1} onChange={noop} />,
      // @ts-expect-error title is required
      <Chip>SNAP25</Chip>,
      // @ts-expect-error title is required
      <Disclosure summary="Advanced">Body</Disclosure>,
      // @ts-expect-error title is required
      <Popover trigger="Share">Body</Popover>,
      // @ts-expect-error title is required
      <Tooltip>
        <span>Swatch</span>
      </Tooltip>,
      // @ts-expect-error title is required
      <Kbd>L</Kbd>,
      // @ts-expect-error title is required
      <Card>Body</Card>,
      // @ts-expect-error title is required
      <Drawer open onClose={noop}>
        Body
      </Drawer>,
      // @ts-expect-error title is required
      <Sheet expanded onExpandedChange={noop}>
        Body
      </Sheet>,
    ]

    expect(elements).toHaveLength(16)
  })

  it('renders buttons with a native title, a type and an icon label', () => {
    const onClick = vi.fn()
    render(
      <>
        <Button title="Load the dataset" variant="primary" onClick={onClick}>
          Load Dataset
        </Button>
        <IconButton title="Close panel" icon={<svg />} />
      </>,
    )

    const button = screen.getByRole('button', { name: 'Load Dataset' })
    expect(button).toHaveAttribute('title', 'Load the dataset')
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveClass('ui-button--primary')
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Close panel' })).toHaveAttribute(
      'title',
      'Close panel',
    )
  })

  it('presses one segment and reports only changes', () => {
    const onChange = vi.fn()
    render(
      <Segmented
        title="Mouse coordinate unit"
        label="Mouse coordinates"
        value="um"
        options={[
          { value: 'um', label: 'µm', title: 'Micrometres' },
          { value: 'px', label: 'px', title: 'Image pixels' },
        ]}
        onChange={onChange}
      />,
    )

    const group = screen.getByRole('group', { name: 'Mouse coordinates' })
    expect(within(group).getByRole('button', { name: 'µm' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    fireEvent.click(within(group).getByRole('button', { name: 'µm' }))
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(within(group).getByRole('button', { name: 'px' }))
    expect(onChange).toHaveBeenCalledWith('px')
  })

  it('labels a select and returns the chosen option value', () => {
    const onChange = vi.fn()
    render(
      <Select
        title="Gene expression colour scale"
        label="Colour scale"
        value="plasma"
        options={[
          { value: 'plasma', label: 'Plasma' },
          { value: 'viridis', label: 'Viridis' },
        ]}
        onChange={onChange}
      />,
    )

    const select = screen.getByRole('combobox', { name: 'Colour scale' })
    expect(select).toHaveAttribute('title', 'Gene expression colour scale')
    fireEvent.change(select, { target: { value: 'viridis' } })
    expect(onChange).toHaveBeenCalledWith('viridis')
  })

  it('reports checkbox and switch changes', () => {
    const onCheck = vi.fn()
    const onSwitch = vi.fn()
    render(
      <>
        <Checkbox
          title="Show cell boundaries"
          label="Cell boundaries"
          checked={false}
          indeterminate
          onChange={onCheck}
        />
        <Switch
          title="Show hover tooltips"
          label="Tooltips"
          checked
          onChange={onSwitch}
        />
      </>,
    )

    const checkbox = screen.getByRole('checkbox', { name: 'Cell boundaries' })
    expect(checkbox).toHaveProperty('indeterminate', true)
    fireEvent.click(checkbox)
    expect(onCheck).toHaveBeenCalledWith(true)

    const toggle = screen.getByRole('switch', { name: 'Tooltips' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(toggle)
    expect(onSwitch).toHaveBeenCalledWith(false)
  })

  it('shows the slider value and reports numbers', () => {
    const onChange = vi.fn()
    render(
      <Slider
        title="Cell fill opacity"
        label="Fill opacity"
        value={0.5}
        min={0}
        max={1}
        step={0.05}
        formatValue={(value) => `${Math.round(value * 100)}%`}
        onChange={onChange}
      />,
    )

    const slider = screen.getByRole('slider', { name: 'Fill opacity' })
    expect(screen.getByText('50%')).toBeInTheDocument()
    fireEvent.change(slider, { target: { value: '0.75' } })
    expect(onChange).toHaveBeenCalledWith(0.75)
  })

  it('commits a number field on Enter or blur, clamped, and reverts on Escape', () => {
    function Harness({ onChange }: { readonly onChange: (value: number) => void }) {
      const [value, setValue] = useState(100)
      return (
        <NumberField
          title="Exact transcript budget"
          label="Exact budget"
          value={value}
          min={1}
          max={1000}
          onChange={(next) => {
            setValue(next)
            onChange(next)
          }}
        />
      )
    }
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const input = screen.getByRole('spinbutton', { name: 'Exact budget' })

    fireEvent.change(input, { target: { value: '5' } })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith(5)

    fireEvent.change(input, { target: { value: '5000' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenLastCalledWith(1000)
    expect(input).toHaveValue(1000)

    fireEvent.change(input, { target: { value: '7' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input).toHaveValue(1000)

    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(input).toHaveValue(1000)
  })

  it('gives a chip a toggle and a named remove button', () => {
    const onClick = vi.fn()
    const onRemove = vi.fn()
    render(
      <Chip
        title="Colour cells by SNAP25"
        selected
        onClick={onClick}
        onRemove={onRemove}
        removeTitle="Remove SNAP25"
      >
        SNAP25
      </Chip>,
    )

    expect(screen.getByRole('button', { name: 'SNAP25' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove SNAP25' }))
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('keeps disclosure content mounted while closed', () => {
    const onOpenChange = vi.fn()
    const { container } = render(
      <Disclosure
        title="Show advanced settings"
        summary="Advanced"
        onOpenChange={onOpenChange}
      >
        <input title="Search" aria-label="Search" />
      </Disclosure>,
    )

    const details = container.querySelector('details')
    expect(details).not.toHaveAttribute('open')
    expect(screen.getByLabelText('Search')).toBeInTheDocument()

    if (details === null) throw new Error('missing details')
    details.open = true
    fireEvent(details, new Event('toggle'))
    expect(onOpenChange).toHaveBeenCalledWith(true)
    expect(details).toHaveAttribute('open')
  })

  it('opens a popover, moves focus in, and closes on Escape or an outside click', () => {
    render(
      <>
        <Popover title="Share this view" trigger="Share">
          <button type="button" title="Copy the link">
            Copy Link
          </button>
        </Popover>
        <p>Outside</p>
      </>,
    )

    const trigger = screen.getByRole('button', { name: 'Share' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Share this view' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy Link' })).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(trigger).toHaveFocus()

    fireEvent.click(trigger)
    fireEvent.pointerDown(screen.getByText('Outside'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('describes its child with a tooltip shown on focus or after a hover', () => {
    vi.useFakeTimers()
    render(
      <Tooltip title="Lasso selection" detail={<Kbd title="Lasso tool">L</Kbd>}>
        <button type="button">Lasso</button>
      </Tooltip>,
    )

    const button = screen.getByRole('button', { name: 'Lasso' })
    const tooltip = screen.getByRole('tooltip', { hidden: true })
    expect(button).toHaveAttribute('aria-describedby', tooltip.id)
    expect(button).toHaveAccessibleDescription('Lasso selectionL')
    expect(tooltip).not.toBeVisible()

    fireEvent.focus(button)
    expect(tooltip).toBeVisible()
    fireEvent.keyDown(button, { key: 'Escape' })
    expect(tooltip).not.toBeVisible()

    fireEvent.pointerEnter(button)
    expect(tooltip).not.toBeVisible()
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(tooltip).toBeVisible()
    fireEvent.pointerLeave(button)
    expect(tooltip).not.toBeVisible()
  })

  it('names a card by its title and closes it', () => {
    const onClose = vi.fn()
    render(
      <Card title="Selection 1" subtitle="6,229 cells" onClose={onClose}>
        Body
      </Card>,
    )

    expect(screen.getByRole('region', { name: 'Selection 1' })).toHaveTextContent(
      '6,229 cells',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close Selection 1' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('opens a drawer with focus inside and returns focus when it closes', () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" title="Dataset info" onClick={() => setOpen(true)}>
            Info
          </button>
          <Drawer title="Dataset" open={open} onClose={() => setOpen(false)}>
            <input title="Dataset URL" aria-label="Dataset URL" />
          </Drawer>
        </>
      )
    }
    render(<Harness />)

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByLabelText('Dataset URL')).toBeInTheDocument()

    const opener = screen.getByRole('button', { name: 'Info' })
    opener.focus()
    fireEvent.click(opener)
    const drawer = screen.getByRole('dialog', { name: 'Dataset' })
    expect(within(drawer).getByRole('button', { name: 'Close Dataset' })).toHaveFocus()

    fireEvent.keyDown(drawer, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(opener).toHaveFocus()
  })

  it('expands a sheet from its handle and keeps its content mounted', () => {
    function Harness() {
      const [expanded, setExpanded] = useState(false)
      return (
        <Sheet
          title="Layers"
          summary="4 genes"
          expanded={expanded}
          onExpandedChange={setExpanded}
        >
          <p>Layer controls</p>
        </Sheet>
      )
    }
    render(<Harness />)

    const handle = screen.getByRole('button', { name: /Layers/ })
    expect(handle).toHaveAttribute('aria-expanded', 'false')
    expect(handle).toHaveAttribute('title', 'Expand Layers')
    expect(screen.getByText('Layer controls')).not.toBeVisible()

    fireEvent.click(handle)
    expect(handle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Layer controls')).toBeVisible()
  })
})
