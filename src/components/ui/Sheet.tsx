import { useId, type ReactNode } from 'react'
import { classNames } from './classNames'

export interface SheetProps {
  // Shown in the handle, which names the sheet.
  readonly title: string
  readonly expanded: boolean
  readonly onExpandedChange: (expanded: boolean) => void
  readonly children: ReactNode
  // A one-line state shown in the handle, such as "4 genes · points".
  readonly summary?: ReactNode
  readonly className?: string | undefined
}

// A bottom sheet for screens under 860 px (UNIFIED_PLAN.md, 15.2-I). Collapsed,
// only its 56 px handle shows. The content stays mounted either way.
export function Sheet({
  title,
  expanded,
  onExpandedChange,
  children,
  summary,
  className,
}: SheetProps) {
  const bodyId = useId()

  return (
    <section
      aria-label={title}
      className={classNames('ui-sheet', expanded && 'is-expanded', className)}
    >
      <button
        type="button"
        className="ui-sheet-handle"
        title={expanded ? `Collapse ${title}` : `Expand ${title}`}
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => {
          onExpandedChange(!expanded)
        }}
      >
        <span className="ui-sheet-grip" aria-hidden="true" />
        <span className="ui-sheet-title">{title}</span>
        {summary !== undefined ? (
          <span className="ui-sheet-summary">{summary}</span>
        ) : null}
      </button>
      <div id={bodyId} className="ui-sheet-body" hidden={!expanded}>
        {children}
      </div>
    </section>
  )
}
