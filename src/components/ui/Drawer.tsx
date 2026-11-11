import { useEffect, useId, useRef, type ReactNode } from 'react'
import { IconButton } from './Button'
import { classNames } from './classNames'
import { CloseIcon } from './icons'
import { focusFirst } from './useDismiss'

export interface DrawerProps {
  // The heading and the dialog's accessible name.
  readonly title: string
  readonly open: boolean
  readonly onClose: () => void
  readonly children: ReactNode
  readonly side?: 'left' | 'right' | undefined
  readonly className?: string | undefined
}

// A panel that slides over the canvas from one side, such as the dataset info
// drawer (UNIFIED_PLAN.md, 15.2-F). It is not modal: the canvas stays usable.
// It stays mounted while closed, so its sections keep their state. Opening
// moves focus into it; Escape inside it or Close returns focus to where it was.
export function Drawer({
  title,
  open,
  onClose,
  children,
  side = 'left',
  className,
}: DrawerProps) {
  const headingId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const panel = panelRef.current
    if (panel === null) return

    if (open) {
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
      focusFirst(panel)
      return
    }

    if (panel.contains(document.activeElement)) returnFocusRef.current?.focus()
  }, [open])

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={headingId}
      tabIndex={-1}
      hidden={!open}
      className={classNames('ui-drawer', `ui-drawer--${side}`, className)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <header className="ui-drawer-header">
        <h2 id={headingId}>{title}</h2>
        <IconButton title={`Close ${title}`} icon={<CloseIcon />} onClick={onClose} />
      </header>
      <div className="ui-drawer-body">{children}</div>
    </div>
  )
}
