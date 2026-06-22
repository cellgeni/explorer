import { describe, expect, it } from 'vitest'
import {
  createBlankSlideForm,
  formFromSlideRecord,
  groupSlidesByParentSample,
  localDateInputValue,
  parseSlideRecords,
  parentSampleDisplayName,
  saveSlideRecord,
  slideFormIsSaveable,
  slidePlacementLabel,
  slideSupportTypeLabel,
  type SlideRecord,
} from './slideRegistryModel'

describe('slideRegistryModel', () => {
  it('uses the local calendar date for new slide cut dates', () => {
    const date = new Date(2026, 5, 22, 1, 30)

    expect(localDateInputValue(date)).toBe('2026-06-22')
    expect(createBlankSlideForm(date).cutDate).toBe('2026-06-22')
  })

  it('requires a parent sample and slide name before saving', () => {
    const form = createBlankSlideForm(new Date(2026, 5, 22))

    expect(slideFormIsSaveable(form)).toBe(false)
    expect(
      slideFormIsSaveable({
        ...form,
        parentSampleId: 'TB-01',
        slideName: 'Section 1',
      }),
    ).toBe(true)
  })

  it('creates and updates saved slides without duplicating them', () => {
    const form = {
      ...createBlankSlideForm(new Date(2026, 5, 22)),
      parentSampleId: 'TB-01',
      parentSampleName: 'Left temporal block',
      slideName: 'Section 1',
      placement: { row: 'upper', column: 'left' } as const,
    }
    const created = saveSlideRecord([], form, {
      id: 'slide-1',
      updatedAt: new Date('2026-06-22T12:00:00.000Z'),
    })

    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      id: 'slide-1',
      parentSampleId: 'TB-01',
      slideName: 'Section 1',
      cutDate: '2026-06-22',
      placement: { row: 'upper', column: 'left' },
    })

    const updated = saveSlideRecord(
      created,
      {
        ...formFromSlideRecord(created[0]!),
        slideName: 'Section 1 H&E',
        placement: { row: 'lower', column: 'right' },
      },
      {
        id: 'unused',
        editingSlideId: 'slide-1',
        updatedAt: new Date('2026-06-23T12:00:00.000Z'),
      },
    )

    expect(updated).toHaveLength(1)
    expect(updated[0]).toMatchObject({
      id: 'slide-1',
      slideName: 'Section 1 H&E',
      placement: { row: 'lower', column: 'right' },
    })
  })

  it('groups slides by parent sample for the tissue-block tree', () => {
    const slides: readonly SlideRecord[] = [
      slideFixture({
        id: 'slide-2',
        parentSampleId: 'TB-01',
        parentSampleName: 'Left temporal block',
        slideName: 'Section 2',
        cutDate: '2026-06-23',
      }),
      slideFixture({
        id: 'slide-1',
        parentSampleId: 'TB-01',
        parentSampleName: 'Left temporal block',
        slideName: 'Section 1',
        cutDate: '2026-06-22',
      }),
      slideFixture({
        id: 'slide-3',
        parentSampleId: 'TB-02',
        parentSampleName: 'Right temporal block',
        slideName: 'Section 1',
        cutDate: '2026-06-22',
      }),
    ]

    const groups = groupSlidesByParentSample(slides)

    expect(groups).toHaveLength(2)
    expect(parentSampleDisplayName(groups[0]!)).toBe('Left temporal block')
    expect(groups[0]?.slides.map((slide) => slide.id)).toEqual(['slide-1', 'slide-2'])
    expect(parentSampleDisplayName(groups[1]!)).toBe('Right temporal block')
  })

  it('parses only valid stored slide records', () => {
    const validSlide = slideFixture({ id: 'slide-1' })
    const parsed = parseSlideRecords(
      JSON.stringify([
        validSlide,
        {
          id: 'broken',
          placement: { row: 'outside', column: 'left' },
        },
      ]),
    )

    expect(parsed).toEqual([validSlide])
    expect(parseSlideRecords('not-json')).toEqual([])
  })

  it('formats placement and support labels for clinical users', () => {
    expect(slidePlacementLabel({ row: 'upper', column: 'right' })).toBe('Upper right')
    expect(slideSupportTypeLabel('glass-slide')).toBe('Glass slide')
    expect(slideSupportTypeLabel('visium-chip')).toBe('Visium chip')
    expect(slideSupportTypeLabel('other')).toBe('Other support')
  })
})

function slideFixture(overrides: Partial<SlideRecord> = {}): SlideRecord {
  return {
    id: 'slide',
    parentSampleId: 'TB-01',
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
