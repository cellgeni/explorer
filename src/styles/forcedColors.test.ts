import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Forced colours (EXP-314): every state drawn by colour has a forced-colours
// look, and data colours keep theirs. Read from the stylesheets, so a new
// pressed or selected rule without one fails here.

const STYLES = join(process.cwd(), 'src', 'styles')

function css(file: string): string {
  return readFileSync(join(STYLES, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
}

const forced = css('forced-colors.css')
const STATE =
  /\[aria-(?:pressed|selected|current|checked)='true'\]|\.is-(?:selected|active)\b|\[data-beside='true'\]/

// Selectors elsewhere whose rule colours a state, cut after the state, such
// as `.ui-segmented button[aria-pressed='true']`.
const states = readdirSync(STYLES)
  .filter((file) => file.endsWith('.css') && file !== 'forced-colors.css')
  .flatMap((file) =>
    [...css(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((match) =>
        /(?:^|;)\s*(?:background|color|border(?:-[a-z]+)?-color|box-shadow)\s*:/.test(
          match[2] ?? '',
        ),
      )
      .flatMap((match) => (match[1] ?? '').split(','))
      .map((selector) => selector.trim())
      .flatMap((selector) => {
        const state = STATE.exec(selector)
        return state === null
          ? []
          : [{ file, state: selector.slice(0, state.index + state[0].length) }]
      }),
  )

describe('forced colours', () => {
  it('loads after every other stylesheet', () => {
    const imports = [
      ...readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8').matchAll(
        /@import '([^']+)'/g,
      ),
    ].map((match) => match[1])
    expect(imports.at(-1)).toBe('./styles/forced-colors.css')
  })

  it('is one forced-colors block', () => {
    expect(forced.trim().startsWith('@media (forced-colors: active) {')).toBe(true)
  })

  it('finds the states drawn by colour', () => {
    expect(states.length).toBeGreaterThan(15)
  })

  it('gives each of them a forced-colours look', () => {
    const missing = states
      .filter(({ state }) => !forced.includes(state))
      .map(({ file, state }) => `${file}: ${state}`)
    expect(missing).toEqual([])
  })

  it('keeps the colours of class swatches and colour scales', () => {
    const rule = /([^{}]+)\{[^{}]*forced-color-adjust: none;[^{}]*\}/.exec(
      forced.slice(forced.indexOf('{') + 1),
    )
    const kept = (rule?.[1] ?? '').split(',').map((selector) => selector.trim())
    expect(kept).toEqual(
      expect.arrayContaining([
        '.viewer-legend-swatch',
        '.viewer-legend-gradient',
        '.annotation-color-swatch',
        '.annotation-size-bar',
        '.gene-scale-preview',
        '.transcript-density-scale-preview',
        '.collection-bar-scale-ramp',
        '.section-stack-scale-ramp',
        '.plots-heatmap-swatch',
        '.plots-heatmap-bar',
      ]),
    )
  })

  it('draws the bars that show an amount in CanvasText', () => {
    for (const bar of [
      '.cell-z-bar',
      '.cell-expression-bar::before',
      '.roi-gene-bar::before',
      '.magic-lens-gene-bar::before',
      '.channel-histogram-bar',
      '.transcript-budget-meter span',
    ]) {
      expect(forced, bar).toMatch(
        new RegExp(`${bar.replace(/[.[\]()]/g, '\\$&')}[^{]*\\{ background: CanvasText;`),
      )
    }
  })

  it('shows the select arrow, which is a gradient elsewhere', () => {
    expect(forced).toContain('.analysis-section select { appearance: auto; }')
  })
})
