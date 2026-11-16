// deck.gl's event root takes keyboard focus (tabindex 0), but it sits in an
// aria-hidden host and the canvas frame handles the keyboard, so it leaves
// the tab order (axe's aria-hidden-focus).
export function removeDeckFromTabOrder(): void {
  for (const root of document.querySelectorAll<HTMLElement>(
    '.deckgl-host [tabindex="0"]',
  )) {
    root.tabIndex = -1
  }
}
