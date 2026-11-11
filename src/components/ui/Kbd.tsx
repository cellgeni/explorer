export interface KbdProps {
  // What the key does, such as "Lasso tool".
  readonly title: string
  // The key as printed, such as "L" or "Esc".
  readonly children: string
}

// A keyboard key, for shortcuts in tooltips and help.
export function Kbd({ title, children }: KbdProps) {
  return (
    <kbd className="ui-kbd" title={title}>
      {children}
    </kbd>
  )
}
