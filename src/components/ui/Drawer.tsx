import { useId, useRef, type ReactNode } from 'react'
import { IconButton } from './Button'
import { classNames } from './classNames'
import { CloseIcon } from './icons'
import { useFocusReturn } from './useFocusReturn'

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

  useFocusReturn(open, panelRef, returnFocusRef)

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
        if (event.key !== 'Escape' || event.defaultPrevented) return
        // Handled, so the press does not also leave the active tool.
        event.preventDefault()
        // Esc in a text field leaves the field, as it would dismiss the
        // browser's suggestions there; a second Esc closes the drawer.
        if (isTypingTarget(event.target)) {
          panelRef.current?.focus()
          return
        }
        onClose()
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

function isTypingTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLElement && target.isContentEditable) return true
  return (
    target instanceof HTMLInputElement &&
    !['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color'].includes(
      target.type,
    )
  )
}
