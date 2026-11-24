import { afterEach, describe, expect, it } from 'vitest'
import { focusSpatialView } from './spatialViewFocus'

function renderRegion(inMainTile = '', afterTiles = ''): void {
  document.body.innerHTML = `
    <a class="skip-link" href="#viewer-heading">Skip To Spatial View</a>
    <section class="viewer-region">
      <h2 id="viewer-heading" tabindex="-1">Spatial View</h2>
      <div class="viewer-tiles">
        <div class="viewer-tile"><div class="viewport-frame" tabindex="0"></div></div>
        <div class="viewer-tile viewer-main-tile">
          <div class="viewport-frame" tabindex="0"></div>
          ${inMainTile}
        </div>
      </div>
      ${afterTiles}
    </section>
  `
}

describe('focusSpatialView', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it("focuses the main view's frame and leaves the address", () => {
    renderRegion()
    const hash = window.location.hash
    focusSpatialView(document)

    expect(document.activeElement).toBe(
      document.querySelector('.viewer-main-tile .viewport-frame'),
    )
    expect(window.location.hash).toBe(hash)
  })

  it.each([
    ['a 3D view', '<section class="volume-viewer"><button>Close</button></section>', ''],
    ['the start screen', '', '<section class="start-screen"><input /></section>'],
    ['stacked sections', '', '<section class="volume-viewer section-stack"></section>'],
  ])('focuses the heading when %s covers the view', (_name, inMainTile, afterTiles) => {
    renderRegion(inMainTile, afterTiles)
    focusSpatialView(document)

    expect(document.activeElement).toBe(document.getElementById('viewer-heading'))
  })
})
