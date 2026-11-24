import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NARROW_SCREEN_QUERY } from '../features/shell/useNarrowScreen'

const dir = join(process.cwd(), 'src', 'styles')
const sheets = readdirSync(dir)
  .filter((name) => name.endsWith('.css'))
  .map((name) => ({ name, css: readFileSync(join(dir, name), 'utf8') }))

// The body of the first rule for a selector, as written.
function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`No rule for ${selector}`)
  return css.slice(start, css.indexOf('}', start))
}

describe('stylesheet breakpoints', () => {
  // At exactly 860 CSS px (a 1075 px window at 125%) the shell was wide but
  // rules written at 860px took their narrow layout (EXP-302).
  it('take the narrow layout at the width the shell does', () => {
    const narrow = /\(max-width: 8[5-6]\d(?:\.\d+)?px\)/g
    const found = sheets.flatMap(({ name, css }) =>
      [...css.matchAll(narrow)].map((match) => `${name}: ${match[0]}`),
    )

    expect(found.length).toBeGreaterThan(0)
    expect(found.filter((query) => !query.endsWith(NARROW_SCREEN_QUERY))).toEqual([])
  })

  // AppErrorBoundary's <main class="app-shell app-error-shell"> took the
  // shell's 48 px top bar row, which cut off the top of the box (EXP-303).
  it('give the application error box a row of its own, which scrolls', () => {
    const css = sheets.find(({ name }) => name === 'app-shell.css')?.css ?? ''
    const body = ruleBody(css, '.app-error-shell')

    expect(body).toContain('grid-template-rows: minmax(0, 1fr);')
    expect(body).toContain('overflow-y: auto;')
  })
})
