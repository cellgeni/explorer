// deck.gl's event root takes keyboard focus (tabindex 0), but it sits in an
// aria-hidden host and the canvas frame handles the keyboard, so it leaves
// the tab order (axe's aria-hidden-focus). A viewer passes its own host;
// without one, the 2D viewers' hosts (`.deckgl-host`) are searched.
export function removeDeckFromTabOrder(host?: ParentNode | null): void {
  const roots =
    host === undefined || host === null
      ? document.querySelectorAll<HTMLElement>('.deckgl-host [tabindex="0"]')
      : host.querySelectorAll<HTMLElement>('[tabindex="0"]')

  for (const root of roots) {
    root.tabIndex = -1
  }
}
