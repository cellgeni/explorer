import { memo, useState } from 'react'
import { ChevronDownIcon } from './ui'
import {
  LEGEND_CATEGORY_LIMIT,
  type CategoryLegendSection,
  type ContinuousLegendSection,
  type ViewerLegendSection,
} from './viewerLegendTypes'

// The section id tells the eyes of transcript genes from those of classes.
export type LegendCategoryVisibilityChange = (
  id: string,
  visible: boolean,
  sectionId: string,
) => void

interface ViewerLegendProps {
  readonly sections: readonly ViewerLegendSection[]
  readonly onCategoryVisibilityChange?: LegendCategoryVisibilityChange | undefined
}

// The canvas legend in the bottom-left stack. It sits next to the deck.gl
// canvas, never inside it, so collapsing it or hovering it does not redraw
// the map.
export const ViewerLegend = memo(function ViewerLegend({
  sections,
  onCategoryVisibilityChange,
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
            ) : (
              <CategoryLegend
                key={section.id}
                section={section}
                onVisibilityChange={onCategoryVisibilityChange}
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
}: {
  readonly section: CategoryLegendSection
  readonly onVisibilityChange?: LegendCategoryVisibilityChange | undefined
}) {
  const shown = section.items.slice(0, LEGEND_CATEGORY_LIMIT)
  const moreCount = section.items.length - shown.length + (section.moreCount ?? 0)
  const noun = section.noun ?? { singular: 'cell', plural: 'cells' }

  return (
    <div className="viewer-legend-section">
      <p className="viewer-legend-title">{section.title}</p>
      <ul className="viewer-legend-categories">
        {shown.map((item) => (
          <li key={item.id} className={item.visible ? undefined : 'is-hidden'}>
            <label>
              <input
                type="checkbox"
                checked={item.visible}
                disabled={onVisibilityChange === undefined}
                aria-label={`${item.label}, ${item.count.toLocaleString()} ${item.count === 1 ? noun.singular : noun.plural}`}
                title={`${item.visible ? 'Hide' : 'Show'} ${item.label}`}
                onChange={(event) => {
                  onVisibilityChange?.(item.id, event.currentTarget.checked, section.id)
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
      {moreCount <= 0 ? null : (
        <p className="viewer-legend-detail">
          +{moreCount.toLocaleString()} more in {section.moreWhere ?? 'Cells › Clusters'}
        </p>
      )}
    </div>
  )
}
