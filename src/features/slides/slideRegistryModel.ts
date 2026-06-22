export const SLIDE_REGISTRY_STORAGE_KEY = 'cellgeni.explorer.slideRegistry.v1'

export const SLIDE_PLACEMENT_ROWS = ['upper', 'middle', 'lower'] as const
export const SLIDE_PLACEMENT_COLUMNS = ['left', 'center', 'right'] as const

export type SlidePlacementRow = (typeof SLIDE_PLACEMENT_ROWS)[number]
export type SlidePlacementColumn = (typeof SLIDE_PLACEMENT_COLUMNS)[number]
export type SlideSupportType = 'glass-slide' | 'visium-chip' | 'other'

export interface SlidePlacement {
  readonly row: SlidePlacementRow
  readonly column: SlidePlacementColumn
}

export interface SlideRecord {
  readonly id: string
  readonly parentSampleId: string
  readonly parentSampleName: string
  readonly slideName: string
  readonly cutDate: string
  readonly supportType: SlideSupportType
  readonly placement: SlidePlacement
  readonly notes: string
  readonly updatedAt: string
}

export interface SlideFormState {
  readonly parentSampleId: string
  readonly parentSampleName: string
  readonly slideName: string
  readonly cutDate: string
  readonly supportType: SlideSupportType
  readonly placement: SlidePlacement
  readonly notes: string
}

export interface SlideTreeGroup {
  readonly key: string
  readonly parentSampleId: string
  readonly parentSampleName: string
  readonly slides: readonly SlideRecord[]
}

const DEFAULT_PLACEMENT: SlidePlacement = { row: 'middle', column: 'center' }

const PLACEMENT_ROW_LABELS: Readonly<Record<SlidePlacementRow, string>> = {
  upper: 'Upper',
  middle: 'Middle',
  lower: 'Lower',
}

const PLACEMENT_COLUMN_LABELS: Readonly<Record<SlidePlacementColumn, string>> = {
  left: 'left',
  center: 'center',
  right: 'right',
}

export function localDateInputValue(date: Date = new Date()): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

export function createBlankSlideForm(date: Date = new Date()): SlideFormState {
  return {
    parentSampleId: '',
    parentSampleName: '',
    slideName: '',
    cutDate: localDateInputValue(date),
    supportType: 'glass-slide',
    placement: DEFAULT_PLACEMENT,
    notes: '',
  }
}

export function formFromSlideRecord(slide: SlideRecord): SlideFormState {
  return {
    parentSampleId: slide.parentSampleId,
    parentSampleName: slide.parentSampleName,
    slideName: slide.slideName,
    cutDate: slide.cutDate,
    supportType: slide.supportType,
    placement: slide.placement,
    notes: slide.notes,
  }
}

export function slideFormIsSaveable(form: SlideFormState): boolean {
  return form.parentSampleId.trim() !== '' && form.slideName.trim() !== ''
}

export function slidePlacementLabel(placement: SlidePlacement): string {
  return `${PLACEMENT_ROW_LABELS[placement.row]} ${PLACEMENT_COLUMN_LABELS[placement.column]}`
}

export function slideSupportTypeLabel(supportType: SlideSupportType): string {
  if (supportType === 'visium-chip') {
    return 'Visium chip'
  }

  if (supportType === 'other') {
    return 'Other support'
  }

  return 'Glass slide'
}

export function saveSlideRecord(
  slides: readonly SlideRecord[],
  form: SlideFormState,
  options: {
    readonly id: string
    readonly editingSlideId?: string | null
    readonly updatedAt: Date
  },
): readonly SlideRecord[] {
  const nextSlide: SlideRecord = {
    id: options.editingSlideId ?? options.id,
    parentSampleId: form.parentSampleId.trim(),
    parentSampleName: form.parentSampleName.trim(),
    slideName: form.slideName.trim(),
    cutDate: form.cutDate,
    supportType: form.supportType,
    placement: form.placement,
    notes: form.notes.trim(),
    updatedAt: options.updatedAt.toISOString(),
  }

  if (options.editingSlideId === null || options.editingSlideId === undefined) {
    return sortSlides([...slides, nextSlide])
  }

  let replaced = false
  const nextSlides = slides.map((slide) => {
    if (slide.id !== options.editingSlideId) {
      return slide
    }

    replaced = true
    return nextSlide
  })

  return sortSlides(replaced ? nextSlides : [...slides, nextSlide])
}

export function groupSlidesByParentSample(
  slides: readonly SlideRecord[],
): readonly SlideTreeGroup[] {
  const groups = new Map<string, SlideRecord[]>()

  for (const slide of slides) {
    const key = parentSampleKey(slide.parentSampleId, slide.parentSampleName)
    const group = groups.get(key)

    if (group === undefined) {
      groups.set(key, [slide])
    } else {
      group.push(slide)
    }
  }

  return [...groups.entries()]
    .map(([key, groupSlides]) => {
      const firstSlide = groupSlides[0]

      return {
        key,
        parentSampleId: firstSlide?.parentSampleId ?? '',
        parentSampleName: firstSlide?.parentSampleName ?? '',
        slides: sortSlides(groupSlides),
      }
    })
    .sort((left, right) =>
      parentSampleDisplayName(left).localeCompare(parentSampleDisplayName(right), 'en'),
    )
}

export function parentSampleDisplayName(
  group: Pick<SlideTreeGroup, 'parentSampleId' | 'parentSampleName'>,
): string {
  return group.parentSampleName.trim() || group.parentSampleId
}

export function parseSlideRecords(value: string | null): readonly SlideRecord[] {
  if (value === null) {
    return []
  }

  try {
    const parsed: unknown = JSON.parse(value)

    if (!Array.isArray(parsed)) {
      return []
    }

    return sortSlides(parsed.filter(isSlideRecord))
  } catch {
    return []
  }
}

function sortSlides(slides: readonly SlideRecord[]): readonly SlideRecord[] {
  return [...slides].sort((left, right) => {
    const parentCompare = parentSampleKey(
      left.parentSampleId,
      left.parentSampleName,
    ).localeCompare(parentSampleKey(right.parentSampleId, right.parentSampleName), 'en')

    if (parentCompare !== 0) {
      return parentCompare
    }

    const cutDateCompare = left.cutDate.localeCompare(right.cutDate)

    if (cutDateCompare !== 0) {
      return cutDateCompare
    }

    return left.slideName.localeCompare(right.slideName, 'en')
  })
}

function parentSampleKey(parentSampleId: string, parentSampleName: string): string {
  return `${parentSampleName.trim().toLocaleLowerCase()}|${parentSampleId
    .trim()
    .toLocaleLowerCase()}`
}

function isSlideRecord(value: unknown): value is SlideRecord {
  if (value === null || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<SlideRecord>

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.parentSampleId === 'string' &&
    typeof candidate.parentSampleName === 'string' &&
    typeof candidate.slideName === 'string' &&
    typeof candidate.cutDate === 'string' &&
    isSlideSupportType(candidate.supportType) &&
    isSlidePlacement(candidate.placement) &&
    typeof candidate.notes === 'string' &&
    typeof candidate.updatedAt === 'string'
  )
}

function isSlidePlacement(value: unknown): value is SlidePlacement {
  if (value === null || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<SlidePlacement>

  return (
    SLIDE_PLACEMENT_ROWS.includes(candidate.row as SlidePlacementRow) &&
    SLIDE_PLACEMENT_COLUMNS.includes(candidate.column as SlidePlacementColumn)
  )
}

function isSlideSupportType(value: unknown): value is SlideSupportType {
  return value === 'glass-slide' || value === 'visium-chip' || value === 'other'
}
