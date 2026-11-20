import { afterEach, describe, expect, it } from 'vitest'
import { removeDeckFromTabOrder } from './deckTabOrder'

afterEach(() => {
  document.body.replaceChildren()
})

describe('removeDeckFromTabOrder', () => {
  it("takes deck.gl's root out of the tab order in the host given, or the 2D hosts", () => {
    document.body.innerHTML = `
      <div class="deckgl-host" aria-hidden="true"><div id="flat" tabindex="0"></div></div>
      <div class="volume-viewer-canvas" aria-hidden="true"><div id="stack" tabindex="0"></div></div>
      <button id="toolbar" tabindex="0">Reset</button>`
    const tabIndex = (id: string) => document.getElementById(id)?.tabIndex

    removeDeckFromTabOrder()
    expect([tabIndex('flat'), tabIndex('stack'), tabIndex('toolbar')]).toEqual([-1, 0, 0])

    removeDeckFromTabOrder(document.querySelector('.volume-viewer-canvas'))
    expect([tabIndex('stack'), tabIndex('toolbar')]).toEqual([-1, 0])
  })
})
