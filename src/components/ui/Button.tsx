import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { classNames } from './classNames'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'title' | 'type' | 'className' | 'children'
>

export interface ButtonProps extends NativeButtonProps {
  // Every control shows a native tooltip (see nativeTitleAudit.test.ts).
  readonly title: string
  readonly children: ReactNode
  readonly variant?: ButtonVariant | undefined
  readonly type?: 'button' | 'submit' | 'reset' | undefined
  readonly className?: string | undefined
}

// A text button. Names stay in Title Case (plan 15, D5).
export function Button({
  title,
  children,
  variant = 'secondary',
  type = 'button',
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      title={title}
      className={classNames('ui-button', `ui-button--${variant}`, className)}
    >
      {children}
    </button>
  )
}

export interface IconButtonProps extends NativeButtonProps {
  // Also the accessible name, unless aria-label is given.
  readonly title: string
  readonly icon: ReactNode
  readonly variant?: ButtonVariant | undefined
  readonly className?: string | undefined
}

// A square button that shows only an icon.
export function IconButton({
  title,
  icon,
  variant = 'ghost',
  className,
  'aria-label': ariaLabel,
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      type="button"
      title={title}
      aria-label={ariaLabel ?? title}
      className={classNames(
        'ui-button',
        'ui-icon-button',
        `ui-button--${variant}`,
        className,
      )}
    >
      {icon}
    </button>
  )
}
