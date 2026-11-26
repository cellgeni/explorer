import { memo, useState } from 'react'
import { SHOW_ONLY_HINT, showOnlyClick } from '../utils/altClick'
import { ChevronDownIcon, CloseIcon } from './ui'
import {
  LEGEND_CATEGORY_LIMIT,
  type CategoryLegendSection,
  type ContinuousLegendSection,
  type PythonLegendItem,
  type PythonLegendSection,
  type ViewerLegendSection,
} from './viewerLegendTypes'

// The section id tells the eyes of transcript genes from those of classes.
// `only` is Alt- or Shift-click, or Enter, on a class: show only that class.
export type LegendCategoryVisibilityChange = (
  id: string,
  visible: boolean,
  sectionId: string,
  only?: boolean,
) => void

interface ViewerLegendProps {
  readonly sections: readonly ViewerLegendSection[]
  readonly onCategoryVisibilityChange?: LegendCategoryVisibilityChange | undefined
  // "+N more in …" opens where the rest are listed, with the section's id.
  readonly onShowMore?: ((sectionId: string) => void) | undefined
  // A Python layer's clear button, with the item's id.
  readonly onPythonClear?: ((itemId: string) => void) | undefined
}

// The canvas legend in the bottom-left stack. It sits next to the deck.gl
// canvas, never inside it, so collapsing it or hovering it does not redraw
// the map.
export const ViewerLegend = memo(function ViewerLegend({
  sections,
  onCategoryVisibilityChange,
  onShowMore,
  onPythonClear,
}: ViewerLegendProps) {
  const [collapsed, setCollapsed] = useState(false)

  if (sections.length === 0) {
    return null
  }

  return (
    <section className="viewer-legend" aria-label="Legend">
      <button
        type="button"
        className="viewer-legend-toggle"
        aria-expanded={!collapsed}
        title={collapsed ? 'Show the legend' : 'Hide the legend'}
        onClick={() => {
          setCollapsed((current) => !current)
        }}
      >
        <span>Legend</span>
        <ChevronDownIcon />
      </button>
      {collapsed ? null : (
        <div className="viewer-legend-body">
          {sections.map((section) =>
            section.kind === 'continuous' ? (
              <ContinuousLegend key={section.id} section={section} />
            ) : section.kind === 'python' ? (
              <PythonLegend key={section.id} section={section} onClear={onPythonClear} />
            ) : (
              <CategoryLegend
                key={section.id}
                section={section}
                onVisibilityChange={onCategoryVisibilityChange}
                onShowMore={onShowMore}
              />
            ),
          )}
        </div>
      )}
    </section>
  )
})

function ContinuousLegend({ section }: { readonly section: ContinuousLegendSection }) {
  return (
    <div className="viewer-legend-section">
      <p className="viewer-legend-title">{section.title}</p>
      {section.detail === undefined ? null : (
        <p className="viewer-legend-detail">{section.detail}</p>
      )}
      <span
        className="viewer-legend-gradient"
        style={{ backgroundImage: section.gradient }}
        role="img"
        aria-label={`${section.title}: from ${section.min} to ${section.max}`}
      />
      <span className="viewer-legend-range" aria-hidden="true">
        <span>{section.min}</span>
        <span>{section.max}</span>
      </span>
    </div>
  )
}

function CategoryLegend({
  section,
  onVisibilityChange,
  onShowMore,
}: {
  readonly section: CategoryLegendSection
  readonly onVisibilityChange?: LegendCategoryVisibilityChange | undefined
  readonly onShowMore?: ((sectionId: string) => void) | undefined
}) {
  const moreWhere = section.moreWhere ?? 'Cells › Clusters'
  const shown = section.items.slice(0, LEGEND_CATEGORY_LIMIT)
  const moreCount = section.items.length - shown.length + (section.moreCount ?? 0)
  const noun = section.noun ?? { singular: 'cell', plural: 'cells' }

  return (
    <div className="viewer-legend-section">
      <p className="viewer-legend-title">{section.title}</p>
      <ul className="viewer-legend-categories">
        {shown.map((item) => (
          <li key={item.id} className={item.visible ? undefined : 'is-hidden'}>
            {/* The full name on hover, as the label is cut at 260 px. */}
            <label title={item.label}>
              <input
                type="checkbox"
                checked={item.visible}
                disabled={onVisibilityChange === undefined}
                aria-label={`${item.label}, ${item.count.toLocaleString()} ${item.count === 1 ? noun.singular : noun.plural}`}
                title={`${item.visible ? 'Hide' : 'Show'} ${item.label}${
                  section.showOnly === true ? ` (${SHOW_ONLY_HINT})` : ''
                }`}
                onChange={(event) => {
                  // React takes a checkbox's change from its click.
                  if (section.showOnly === true && showOnlyClick(event.nativeEvent)) {
                    onVisibilityChange?.(item.id, true, section.id, true)
                  } else {
                    onVisibilityChange?.(item.id, event.currentTarget.checked, section.id)
                  }
                }}
                onKeyDown={(event) => {
                  if (section.showOnly !== true || event.key !== 'Enter') return
                  event.preventDefault()
                  onVisibilityChange?.(item.id, true, section.id, true)
                }}
              />
              <span
                className="viewer-legend-swatch"
                style={{ backgroundColor: item.color }}
                aria-hidden="true"
              />
              <span className="viewer-legend-label">{item.label}</span>
              <span className="viewer-legend-count">{item.count.toLocaleString()}</span>
            </label>
          </li>
        ))}
      </ul>
      {moreCount <= 0 ? null : onShowMore === undefined ? (
        <p className="viewer-legend-detail">
          +{moreCount.toLocaleString()} more in {moreWhere}
        </p>
      ) : (
        <button
          type="button"
          className="viewer-legend-detail viewer-legend-more"
          title={`Show the other ${moreCount.toLocaleString()} in ${moreWhere}`}
          onClick={() => {
            onShowMore(section.id)
          }}
        >
          +{moreCount.toLocaleString()} more in {moreWhere}
        </button>
      )}
    </div>
  )
}

function PythonLegend({
  section,
  onClear,
}: {
  readonly section: PythonLegendSection
  readonly onClear?: ((itemId: string) => void) | undefined
}) {
  return (
    <div className="viewer-legend-section">
      <p className="viewer-legend-title">{section.title}</p>
      <ul className="viewer-legend-python">
        {section.items.map((item) => (
          <li key={item.id}>
            <PythonLegendRow item={item} noun={section.noun} onClear={onClear} />
          </li>
        ))}
      </ul>
      {section.detail === undefined ? null : (
        <p className="viewer-legend-detail">{section.detail}</p>
      )}
    </div>
  )
}

function PythonLegendRow({
  item,
  noun,
  onClear,
}: {
  readonly item: PythonLegendItem
  readonly noun: PythonLegendSection['noun']
  readonly onClear?: ((itemId: string) => void) | undefined
}) {
  const { swatch } = item
  const count = `${item.count.toLocaleString()} ${item.count === 1 ? noun.singular : noun.plural}`
  const what = swatch.kind === 'shown' ? 'show()' : item.label

  return (
    <>
      <span className="viewer-legend-python-row" title={item.label}>
        {swatch.kind === 'ramp' ? null : (
          <span
            className={`viewer-legend-swatch${swatch.kind === 'ring' ? ' is-ring' : ''}${swatch.kind === 'shown' ? ' is-shown' : ''}`}
            style={
              swatch.kind === 'color'
                ? { backgroundColor: swatch.color }
                : swatch.kind === 'ring'
                  ? { borderColor: swatch.color }
                  : undefined
            }
            aria-hidden="true"
          />
        )}
        <span className="viewer-legend-label">{item.label}</span>
        {swatch.kind === 'shown' ? null : (
          <span className="viewer-legend-count" aria-label={count}>
            {item.count.toLocaleString()}
          </span>
        )}
        {onClear === undefined ? null : (
          <button
            type="button"
            className="viewer-legend-clear"
            title={swatch.kind === 'shown' ? 'Show every cell again' : `Clear ${what}`}
            aria-label={
              swatch.kind === 'shown' ? 'Show every cell again' : `Clear ${what}`
            }
            onClick={() => {
              onClear(item.id)
            }}
          >
            <CloseIcon />
          </button>
        )}
      </span>
      {swatch.kind === 'ramp' ? (
        <>
          <span
            className="viewer-legend-gradient"
            style={{ backgroundImage: swatch.gradient }}
            role="img"
            aria-label={`${item.label}: from ${swatch.min} to ${swatch.max}`}
          />
          <span className="viewer-legend-range" aria-hidden="true">
            <span>{swatch.min}</span>
            <span>{swatch.max}</span>
          </span>
        </>
      ) : null}
    </>
  )
}
