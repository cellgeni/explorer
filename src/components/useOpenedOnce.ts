import { useState } from 'react'

// Whether a panel loaded on first use (LazyPanel.tsx) has been opened yet:
// true from the first render with `open` on, so the panel stays mounted, and
// keeps its state, once closed again.
export function useOpenedOnce(open: boolean): boolean {
  const [opened, setOpened] = useState(open)

  if (open && !opened) {
    setOpened(true)
  }

  return opened || open
}
