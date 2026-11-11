import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// WCAG 2.2 AA for the dark theme (UNIFIED_PLAN.md, 15.1-K): 4.5:1 for text
// and 3:1 for the parts that identify a control. Read from tokens.css, so a
// token change that breaks contrast fails here.

type Rgb = readonly [number, number, number]

const css = readFileSync(join(process.cwd(), 'src', 'styles', 'tokens.css'), 'utf8')
const declarations = new Map(
  [...css.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((match) => [
    match[1] ?? '',
    (match[2] ?? '').trim(),
  ]),
)

function hex(value: string): Rgb {
  const digits = value.replace('#', '')
  const full =
    digits.length === 3
      ? digits
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : digits
  return [0, 2, 4].map((index) =>
    parseInt(full.slice(index, index + 2), 16),
  ) as unknown as Rgb
}

// A token's colour, with a color-mix tint composited over the surface below.
function color(name: string, over?: Rgb): Rgb {
  const value = declarations.get(name)
  if (value === undefined) throw new Error(`No token --${name}`)
  if (value.startsWith('#')) return hex(value)

  const variable = /^var\(--([a-z0-9-]+)\)$/.exec(value)
  if (variable !== null) return color(variable[1] ?? '', over)

  const mix = /^color-mix\(in srgb, var\(--([a-z0-9-]+)\) (\d+)%, transparent\)$/.exec(
    value,
  )
  if (mix !== null && over !== undefined) {
    const base = color(mix[1] ?? '')
    const share = Number(mix[2]) / 100
    return base.map((channel, index) =>
      Math.round(channel * share + (over[index] ?? 0) * (1 - share)),
    ) as unknown as Rgb
  }

  throw new Error(`Cannot read --${name}: ${value}`)
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}

function contrast(a: Rgb, b: Rgb): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05)
}

const SURFACES = ['surface-0', 'surface-1', 'surface-2', 'surface-3']
const TEXT = ['text-1', 'text-2', 'text-3']
const ROLES = ['accent', 'focus', 'highlight', 'danger', 'warning']

describe('dark theme tokens', () => {
  it.each(
    SURFACES.flatMap((surface) => [...TEXT, ...ROLES].map((text) => [text, surface])),
  )('--%s on --%s passes 4.5:1 for text', (text, surface) => {
    expect(contrast(color(text), color(surface))).toBeGreaterThanOrEqual(4.5)
  })

  it.each(
    ['surface-1', 'surface-2'].flatMap((surface) =>
      [
        ['accent', 'accent-soft'],
        ['highlight', 'highlight-soft'],
        ['danger', 'danger-soft'],
        ['warning', 'warning-soft'],
      ].map(([role, tint]) => [role, tint, surface]),
    ),
  )('--%s on --%s over --%s passes 4.5:1', (role, tint, surface) => {
    const background = color(tint ?? '', color(surface ?? ''))
    expect(contrast(color(role ?? ''), background)).toBeGreaterThanOrEqual(4.5)
  })

  it.each([
    ['accent-contrast', 'accent'],
    ['danger-contrast', 'danger'],
    ['warning-contrast', 'warning'],
  ])('--%s on --%s passes 4.5:1', (text, fill) => {
    expect(contrast(color(text), color(fill))).toBeGreaterThanOrEqual(4.5)
  })

  it.each(
    ['surface-1', 'surface-2'].flatMap((surface) =>
      ['border-strong', 'accent', 'focus'].map((part) => [part, surface]),
    ),
  )('--%s against --%s passes 3:1 for controls', (part, surface) => {
    expect(contrast(color(part), color(surface))).toBeGreaterThanOrEqual(3)
  })
})
