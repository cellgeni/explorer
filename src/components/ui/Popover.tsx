import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { classNames } from './classNames'
import { focusFirst, useDismiss } from './useDismiss'

export interface PopoverProps {
  // The trigger's tooltip and the popover's accessible name.
  readonly title: string
  readonly trigger: ReactNode
  readonly children: ReactNode
  // Controlled when set.
  readonly open?: boolean | undefined
  readonly onOpenChange?: ((open: boolean) => void) | undefined
  // Which edge of the trigger the popover lines up with.
  readonly align?: 'start' | 'end' | undefined
  readonly triggerClassName?: string | undefined
  readonly className?: string | undefined
}

// A panel that opens below its trigger button. Focus moves into it; Escape
// closes it and returns focus to the trigger, and so does a click outside
// (without moving focus).
export function Popover({
  title,
  trigger,
  children,
  open,
  onOpenChange,
  align = 'start',
  triggerClassName,
  className,
}: PopoverProps) {
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const isOpen = open ?? uncontrolledOpen

  function setOpen(nextOpen: boolean) {
    if (open === undefined) setUncontrolledOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  useDismiss(isOpen, [triggerRef, panelRef], (reason) => {
    setOpen(false)
    if (reason === 'escape') triggerRef.current?.focus()
  })

  useEffect(() => {
    if (isOpen && panelRef.current !== null) focusFirst(panelRef.current)
  }, [isOpen])

  return (
    <span className="ui-popover-anchor">
      <button
        ref={triggerRef}
        type="button"
        title={title}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? id : undefined}
        className={classNames('ui-button', 'ui-button--ghost', triggerClassName)}
        onClick={() => {
          setOpen(!isOpen)
        }}
      >
        {trigger}
      </button>
      {isOpen ? (
        <div
          ref={panelRef}
          id={id}
          role="dialog"
          aria-label={title}
          tabIndex={-1}
          className={classNames('ui-popover', `ui-popover--${align}`, className)}
        >
          {children}
        </div>
      ) : null}
    </span>
  )
}
