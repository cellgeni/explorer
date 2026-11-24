import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Pressed and disabled looks that a hover rule must not undo (EXP-312,
// EXP-313). Read from every stylesheet, so a new hover rule that forgets a
// state fails here.

const STYLES = join(process.cwd(), 'src', 'styles')

interface Selector {
  readonly file: string
  readonly text: string
}

// Splits at commas outside parentheses.
function splitList(list: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < list.length; index += 1) {
    const char = list[index]
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    else if (char === ',' && depth === 0) {
      parts.push(list.slice(start, index))
      start = index + 1
    }
  }
  parts.push(list.slice(start))
  return parts.map((part) => part.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

const selectors: Selector[] = readdirSync(STYLES)
  .filter((file) => file.endsWith('.css'))
  .flatMap((file) => {
    const css = readFileSync(join(STYLES, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    return [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((match) =>
      splitList(match[1] ?? '').map((text) => ({ file, text })),
    )
  })

// Removes each `name(...)` pseudo-class, nested parentheses included.
function withoutFunctional(selector: string, name: string): string {
  let result = selector
  for (;;) {
    const start = result.indexOf(`:${name}(`)
    if (start < 0) return result
    let depth = 0
    let end = start + name.length + 1
    for (; end < result.length; end += 1) {
      if (result[end] === '(') depth += 1
      else if (result[end] === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    result = result.slice(0, start) + result.slice(end + 1)
  }
}

const DISABLED = [':disabled', "[aria-disabled='true']", ':has(+ input:disabled)']
const PRESSED = "[aria-pressed='true']"

// The control a selector styles, without its hover, pressed, disabled and
// :not() states.
function base(selector: string): string {
  let result = withoutFunctional(selector, 'not')
  for (const state of [':hover', PRESSED, ...DISABLED])
    result = result.split(state).join('')
  return result.trim()
}

// Hover rules on the hovered element itself, not on a part inside it.
const hovers = selectors.filter(({ text }) =>
  withoutFunctional(text, 'not').trim().endsWith(':hover'),
)

describe('hover keeps pressed and disabled states', () => {
  it('finds the hover rules', () => {
    expect(hovers.length).toBeGreaterThan(20)
  })

  it('names hover in the pressed rule of a control that has a hover rule', () => {
    const pressedBases = new Set(
      selectors
        .filter(({ text }) => text.includes(PRESSED))
        .map(({ text }) => base(text)),
    )
    const missing = hovers
      .filter(({ text }) => pressedBases.has(base(text)) && !text.includes(PRESSED))
      .filter(({ text }) => !text.includes(`:not(${PRESSED})`))
      .filter(
        ({ text }) =>
          !selectors.some(
            (other) =>
              other.text.includes(PRESSED) &&
              other.text.includes(':hover') &&
              base(other.text) === base(text),
          ),
      )
      .map(({ file, text }) => `${file}: ${text}`)
    expect(missing).toEqual([])
  })

  it('keeps the pressed look of IconButtons under the ghost hover', () => {
    // IconButton is `.ui-button--ghost`, whose hover (0,3,0) outranks a
    // `.name[aria-pressed='true']` rule (0,2,0).
    for (const name of [
      '.collection-bar-action',
      '.collection-bar-beside',
      '.shell-panel-toggle',
    ]) {
      expect(
        selectors.some(
          ({ text }) => text.startsWith(`${name}${PRESSED}`) && text.includes(':hover'),
        ),
        name,
      ).toBe(true)
    }
  })

  it('leaves out disabled controls from the hover fill', () => {
    const disabledBases = new Set(
      selectors
        .filter(({ text }) => DISABLED.some((state) => text.includes(state)))
        .filter(({ text }) => !text.includes(':not('))
        .map(({ text }) => base(text)),
    )
    const unguarded = hovers
      .filter(({ text }) => disabledBases.has(base(text)))
      .filter(({ text }) => !DISABLED.some((state) => text.includes(`:not(${state})`)))
      .map(({ file, text }) => `${file}: ${text}`)
    expect(unguarded).toEqual([])
  })

  it('shows a disabled field and Import File as disabled', () => {
    for (const selector of [
      '.dataset-form input:disabled',
      '.analysis-section input:disabled',
      '.analysis-section select:disabled',
      '.analysis-section textarea:disabled',
      '.shell-setting-field input:disabled',
      '.secondary-file-action:has(+ input:disabled)',
    ]) {
      expect(
        selectors.some(({ text }) => text === selector),
        selector,
      ).toBe(true)
    }
  })
})
