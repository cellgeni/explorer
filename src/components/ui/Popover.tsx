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

// A panel that opens below its trigger button. Focus moves into it; Escape,
// or closing from inside, returns focus to the trigger. A click outside also
// closes it, without moving focus.
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

  const wasOpenRef = useRef(isOpen)
  const dismissedOutsideRef = useRef(false)

  useDismiss(isOpen, [triggerRef, panelRef], (reason) => {
    dismissedOutsideRef.current = reason === 'outside'
    setOpen(false)
    if (reason === 'escape') triggerRef.current?.focus()
  })

  useEffect(() => {
    const wasOpen = wasOpenRef.current
    wasOpenRef.current = isOpen

    if (isOpen) {
      dismissedOutsideRef.current = false
      if (panelRef.current !== null) focusFirst(panelRef.current)
      return
    }

    // Closed from inside, such as by picking a menu item: the focused
    // element went with the panel, so focus returns to the trigger
    // (15.5-D). A click outside leaves focus where it went.
    const lost =
      document.activeElement === null || document.activeElement === document.body
    if (wasOpen && lost && !dismissedOutsideRef.current) triggerRef.current?.focus()
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
