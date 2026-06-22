import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import {
  SLIDE_PLACEMENT_COLUMNS,
  SLIDE_PLACEMENT_ROWS,
  SLIDE_REGISTRY_STORAGE_KEY,
  createBlankSlideForm,
  formFromSlideRecord,
  groupSlidesByParentSample,
  parentSampleDisplayName,
  parseSlideRecords,
  saveSlideRecord,
  slideFormIsSaveable,
  slidePlacementLabel,
  slideSupportTypeLabel,
  type SlideFormState,
  type SlidePlacement,
  type SlideRecord,
  type SlideSupportType,
} from './slideRegistryModel'

interface SlideRegistryPanelProps {
  readonly active: boolean
  readonly parentSampleIdInputId: string
  readonly parentSampleNameInputId: string
  readonly slideNameInputId: string
  readonly cutDateInputId: string
  readonly supportTypeInputId: string
  readonly notesInputId: string
  readonly getToday?: () => Date
  readonly storage?: Storage | null
  readonly storageKey?: string
}

const SUPPORT_TYPE_OPTIONS: readonly SlideSupportType[] = [
  'glass-slide',
  'visium-chip',
  'other',
]

const currentDate = () => new Date()

export function SlideRegistryPanel({
  active,
  parentSampleIdInputId,
  parentSampleNameInputId,
  slideNameInputId,
  cutDateInputId,
  supportTypeInputId,
  notesInputId,
  getToday = currentDate,
  storage,
  storageKey = SLIDE_REGISTRY_STORAGE_KEY,
}: SlideRegistryPanelProps) {
  const resolvedStorage = storage === undefined ? browserLocalStorage() : storage
  const [slides, setSlides] = useState<readonly SlideRecord[]>(() =>
    parseSlideRecords(resolvedStorage?.getItem(storageKey) ?? null),
  )
  const [editingSlideId, setEditingSlideId] = useState<string | null>(null)
  const [form, setForm] = useState<SlideFormState>(() => createBlankSlideForm(getToday()))
  const nextSlideIdRef = useRef(slides.length + 1)
  const slideTreeGroups = useMemo(() => groupSlidesByParentSample(slides), [slides])
  const editingSlide = useMemo(
    () =>
      editingSlideId === null
        ? null
        : (slides.find((slide) => slide.id === editingSlideId) ?? null),
    [editingSlideId, slides],
  )
  const saveDisabled = !slideFormIsSaveable(form)

  useEffect(() => {
    if (resolvedStorage === null) {
      return
    }

    try {
      resolvedStorage.setItem(storageKey, JSON.stringify(slides))
    } catch {
      // Storage is best-effort; the in-memory registry remains editable.
    }
  }, [resolvedStorage, slides, storageKey])

  const updateForm = <Key extends keyof SlideFormState>(
    key: Key,
    value: SlideFormState[Key],
  ) => {
    setForm((current) => ({
      ...current,
      [key]: value,
    }))
  }

  const handleNewSlide = () => {
    setEditingSlideId(null)
    setForm(createBlankSlideForm(getToday()))
  }

  const handleEditSlide = (slide: SlideRecord) => {
    setEditingSlideId(slide.id)
    setForm(formFromSlideRecord(slide))
  }

  const handleSaveSlide = () => {
    if (saveDisabled) {
      return
    }

    const savedSlideId = editingSlideId ?? nextAvailableSlideId(slides, nextSlideIdRef)

    setSlides((currentSlides) => {
      return saveSlideRecord(currentSlides, form, {
        id: savedSlideId,
        editingSlideId,
        updatedAt: new Date(),
      })
    })
    setEditingSlideId(savedSlideId)
  }

  return (
    <div
      id="hud-panel-slides"
      className="hud-tab-panel"
      role="tabpanel"
      aria-labelledby="hud-tab-slides"
      hidden={!active}
    >
      <section className="analysis-section slide-registry-panel">
        <div className="section-heading-row">
          <h2>Slides</h2>
          <span>{slides.length.toLocaleString()} saved</span>
        </div>

        <form
          className="slide-form"
          aria-label={editingSlide === null ? 'New slide' : 'Edit slide'}
          onSubmit={(event) => {
            event.preventDefault()
            handleSaveSlide()
          }}
        >
          <div className="slide-form-grid">
            <label htmlFor={parentSampleIdInputId}>Tissue block ID</label>
            <input
              id={parentSampleIdInputId}
              type="text"
              autoComplete="off"
              value={form.parentSampleId}
              placeholder="TB-001"
              title="Tissue block ID"
              onChange={(event) => {
                updateForm('parentSampleId', event.currentTarget.value)
              }}
            />

            <label htmlFor={parentSampleNameInputId}>Block label</label>
            <input
              id={parentSampleNameInputId}
              type="text"
              autoComplete="off"
              value={form.parentSampleName}
              placeholder="Left temporal block"
              title="Block label"
              onChange={(event) => {
                updateForm('parentSampleName', event.currentTarget.value)
              }}
            />

            <label htmlFor={slideNameInputId}>Slide label</label>
            <input
              id={slideNameInputId}
              type="text"
              autoComplete="off"
              value={form.slideName}
              placeholder="Section 1"
              title="Slide label"
              onChange={(event) => {
                updateForm('slideName', event.currentTarget.value)
              }}
            />

            <label htmlFor={cutDateInputId}>Cut date</label>
            <input
              id={cutDateInputId}
              type="date"
              value={form.cutDate}
              title="Cut date"
              onChange={(event) => {
                updateForm('cutDate', event.currentTarget.value)
              }}
            />

            <label htmlFor={supportTypeInputId}>Physical support</label>
            <select
              id={supportTypeInputId}
              value={form.supportType}
              title="Physical support"
              onChange={(event) => {
                updateForm('supportType', event.currentTarget.value as SlideSupportType)
              }}
            >
              {SUPPORT_TYPE_OPTIONS.map((supportType) => (
                <option key={supportType} value={supportType}>
                  {slideSupportTypeLabel(supportType)}
                </option>
              ))}
            </select>
          </div>

          <fieldset className="slide-placement-fieldset">
            <legend>Tissue position</legend>
            <div
              className="physical-slide-map"
              role="radiogroup"
              aria-label="Tissue position on chip or slide"
            >
              {SLIDE_PLACEMENT_ROWS.map((row) =>
                SLIDE_PLACEMENT_COLUMNS.map((column) => {
                  const placement: SlidePlacement = { row, column }
                  const selected =
                    form.placement.row === row && form.placement.column === column
                  const label = slidePlacementLabel(placement)

                  return (
                    <button
                      key={`${row}-${column}`}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={label}
                      title={label}
                      className={selected ? 'is-selected' : undefined}
                      onClick={() => {
                        updateForm('placement', placement)
                      }}
                    >
                      <span aria-hidden="true">{shortPlacementLabel(placement)}</span>
                    </button>
                  )
                }),
              )}
            </div>
            <p aria-live="polite">{slidePlacementLabel(form.placement)}</p>
          </fieldset>

          <label htmlFor={notesInputId}>Notes</label>
          <textarea
            id={notesInputId}
            value={form.notes}
            placeholder="Stain, section depth, visible tissue, QC notes"
            title="Slide notes"
            onChange={(event) => {
              updateForm('notes', event.currentTarget.value)
            }}
          />

          <div className="slide-form-actions">
            <button
              type="button"
              className="secondary-action"
              title="Start a new slide record"
              onClick={handleNewSlide}
            >
              New Slide
            </button>
            <button
              type="submit"
              className="slide-primary-action"
              disabled={saveDisabled}
              title={editingSlide === null ? 'Save slide' : 'Update slide'}
            >
              {editingSlide === null ? 'Save Slide' : 'Update Slide'}
            </button>
          </div>
        </form>

        <section className="slide-tree-section" aria-label="Slides by tissue block">
          <div className="section-heading-row">
            <h2>Block Tree</h2>
            <span>{slideTreeGroups.length.toLocaleString()} blocks</span>
          </div>
          {slideTreeGroups.length === 0 ? (
            <p className="option-empty">No saved slides.</p>
          ) : (
            <div className="slide-tree" role="tree" aria-label="Slides by tissue block">
              {slideTreeGroups.map((group) => (
                <div
                  key={group.key}
                  className="slide-tree-block"
                  role="treeitem"
                  aria-label={`${parentSampleDisplayName(group)}, ${
                    group.slides.length
                  } ${group.slides.length === 1 ? 'slide' : 'slides'}`}
                  aria-expanded="true"
                  tabIndex={0}
                >
                  <div className="slide-tree-block-heading">
                    <strong>{parentSampleDisplayName(group)}</strong>
                    <span>
                      {group.slides.length.toLocaleString()}{' '}
                      {group.slides.length === 1 ? 'slide' : 'slides'}
                    </span>
                  </div>
                  <div role="group" className="slide-tree-slide-list">
                    {group.slides.map((slide) => (
                      <button
                        key={slide.id}
                        type="button"
                        role="treeitem"
                        aria-selected={editingSlideId === slide.id}
                        aria-label={`${slide.slideName}, cut ${slide.cutDate}, ${slideSupportTypeLabel(
                          slide.supportType,
                        )}, ${slidePlacementLabel(slide.placement)}`}
                        title={`Edit ${slide.slideName}`}
                        className={
                          editingSlideId === slide.id
                            ? 'slide-tree-slide is-selected'
                            : 'slide-tree-slide'
                        }
                        onClick={() => {
                          handleEditSlide(slide)
                        }}
                      >
                        <span className="slide-tree-slide-title">{slide.slideName}</span>
                        <span>{slide.cutDate}</span>
                        <small>
                          {slideSupportTypeLabel(slide.supportType)} ·{' '}
                          {slidePlacementLabel(slide.placement)}
                        </small>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </section>
    </div>
  )
}

function nextAvailableSlideId(
  slides: readonly SlideRecord[],
  nextSlideIdRef: MutableRefObject<number>,
): string {
  const existingIds = new Set(slides.map((slide) => slide.id))

  while (existingIds.has(`slide-${nextSlideIdRef.current}`)) {
    nextSlideIdRef.current += 1
  }

  const nextId = `slide-${nextSlideIdRef.current}`
  nextSlideIdRef.current += 1

  return nextId
}

function shortPlacementLabel(placement: SlidePlacement): string {
  return `${placement.row.slice(0, 1).toUpperCase()}${placement.column
    .slice(0, 1)
    .toUpperCase()}`
}

function browserLocalStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const candidate = window.localStorage

    if (
      typeof candidate.getItem !== 'function' ||
      typeof candidate.setItem !== 'function'
    ) {
      return null
    }

    return candidate
  } catch {
    return null
  }
}
