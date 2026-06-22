import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it } from 'vitest'
import { SlideRegistryPanel } from './SlideRegistryPanel'
import type { SlideRecord } from './slideRegistryModel'

describe('SlideRegistryPanel', () => {
  it('defaults the cut date to today and edits a saved slide from the tree', () => {
    const storage = memoryStorage()

    render(<SlideRegistryPanel {...baseProps({ storage })} />)

    expect(screen.getByLabelText('Cut date')).toHaveValue('2026-06-22')
    expect(screen.getByRole('button', { name: 'Save Slide' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Tissue block ID'), {
      target: { value: 'TB-001' },
    })
    fireEvent.change(screen.getByLabelText('Block label'), {
      target: { value: 'Left temporal block' },
    })
    fireEvent.change(screen.getByLabelText('Slide label'), {
      target: { value: 'Section 1' },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Upper left' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Slide' }))

    const tree = screen.getByRole('tree', { name: 'Slides by tissue block' })

    expect(within(tree).getByText('Left temporal block')).toBeInTheDocument()
    expect(within(tree).getByText('Section 1')).toBeInTheDocument()
    expect(within(tree).getByText('Glass slide · Upper left')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update Slide' })).toBeEnabled()

    fireEvent.change(screen.getByLabelText('Slide label'), {
      target: { value: 'Section 1 H&E' },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Lower right' }))
    fireEvent.click(screen.getByRole('button', { name: 'Update Slide' }))

    expect(within(tree).queryByText('Section 1')).not.toBeInTheDocument()
    expect(within(tree).getByText('Section 1 H&E')).toBeInTheDocument()
    expect(within(tree).getByText('Glass slide · Lower right')).toBeInTheDocument()

    const storedSlides = JSON.parse(storage.getItem('slides-test') ?? '[]') as unknown[]
    expect(storedSlides).toHaveLength(1)
    expect(storedSlides[0]).toMatchObject({
      parentSampleId: 'TB-001',
      slideName: 'Section 1 H&E',
      placement: { row: 'lower', column: 'right' },
    })
  })

  it('loads saved slides grouped by parent sample and edits the selected tree item', () => {
    const storage = memoryStorage({
      'slides-test': JSON.stringify([
        slideFixture({
          id: 'slide-1',
          parentSampleId: 'TB-001',
          parentSampleName: 'Left temporal block',
          slideName: 'Section 1',
          cutDate: '2026-06-20',
        }),
        slideFixture({
          id: 'slide-2',
          parentSampleId: 'TB-001',
          parentSampleName: 'Left temporal block',
          slideName: 'Section 2',
          cutDate: '2026-06-21',
          supportType: 'visium-chip',
          placement: { row: 'middle', column: 'right' },
        }),
      ]),
    })

    render(<SlideRegistryPanel {...baseProps({ storage })} />)

    const tree = screen.getByRole('tree', { name: 'Slides by tissue block' })

    expect(within(tree).getByText('2 slides')).toBeInTheDocument()
    fireEvent.click(within(tree).getByRole('treeitem', { name: /Section 2/ }))

    expect(screen.getByLabelText('Slide label')).toHaveValue('Section 2')
    expect(screen.getByLabelText('Physical support')).toHaveValue('visium-chip')
    expect(screen.getByRole('radio', { name: 'Middle right' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })
})

function baseProps(
  overrides: Partial<ComponentProps<typeof SlideRegistryPanel>> = {},
): ComponentProps<typeof SlideRegistryPanel> {
  return {
    active: true,
    parentSampleIdInputId: 'parent-sample-id',
    parentSampleNameInputId: 'parent-sample-name',
    slideNameInputId: 'slide-name',
    cutDateInputId: 'cut-date',
    supportTypeInputId: 'support-type',
    notesInputId: 'notes',
    getToday: () => new Date(2026, 5, 22, 9, 0),
    storageKey: 'slides-test',
    ...overrides,
  }
}

function memoryStorage(initialValues: Readonly<Record<string, string>> = {}): Storage {
  const values = new Map(Object.entries(initialValues))

  return {
    get length() {
      return values.size
    },
    clear() {
      values.clear()
    },
    getItem(key: string) {
      return values.get(key) ?? null
    },
    key(index: number) {
      return [...values.keys()][index] ?? null
    },
    removeItem(key: string) {
      values.delete(key)
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
  }
}

function slideFixture(overrides: Partial<SlideRecord> = {}): SlideRecord {
  return {
    id: 'slide',
    parentSampleId: 'TB-001',
    parentSampleName: 'Left temporal block',
    slideName: 'Section 1',
    cutDate: '2026-06-22',
    supportType: 'glass-slide',
    placement: { row: 'middle', column: 'center' },
    notes: '',
    updatedAt: '2026-06-22T12:00:00.000Z',
    ...overrides,
  }
}
