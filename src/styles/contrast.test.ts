import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Colours set outside tokens.css that the token test cannot see (EXP-309,
// EXP-310, EXP-311): placeholders, hidden classes, the selected tree row, the
// channel contrast fields and the marks drawn over images. The token test
// checks the contrast of the tokens these rules use.

interface Rule {
  readonly selector: string
  readonly body: string
}

function rules(file: string): Rule[] {
  const css = readFileSync(join(process.cwd(), 'src', 'styles', file), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  )
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: (match[1] ?? '').replace(/\s+/g, ' ').trim(),
    body: match[2] ?? '',
  }))
}

function declaration(file: string, selector: string, property: string): string {
  const values = rules(file)
    .filter((rule) => rule.selector.split(',').some((part) => part.trim() === selector))
    .flatMap((rule) =>
      [...rule.body.matchAll(new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`, 'g'))].map(
        (match) => (match[1] ?? '').replace(/\s+/g, ' ').trim(),
      ),
    )
  return values.at(-1) ?? ''
}

// Selectors of rules that set an opacity on one of these elements.
function dimmed(file: string, elements: readonly string[]): string[] {
  return rules(file)
    .filter((rule) => /(?:^|;)\s*opacity:/.test(rule.body))
    .flatMap((rule) => rule.selector.split(','))
    .map((selector) => selector.trim())
    .filter((selector) => elements.some((element) => selector.endsWith(element)))
}

describe('contrast outside the tokens', () => {
  it('draws placeholders in --text-3 at full opacity', () => {
    expect(declaration('base.css', '::placeholder', 'color')).toBe('var(--text-3)')
    expect(declaration('base.css', '::placeholder', 'opacity')).toBe('1')
  })

  it('shows hidden class names in --text-3 rather than dimming them', () => {
    expect(
      dimmed('annotation-controls.css', [
        '.annotation-set-rows',
        '.annotation-set-row',
        '.annotation-set-label',
      ]),
    ).toEqual([])
    expect(dimmed('viewer.css', ['.viewer-legend-label'])).toEqual([])
    expect(
      declaration(
        'annotation-controls.css',
        '.annotation-set-row.is-hidden .annotation-set-label',
        'color',
      ),
    ).toBe('var(--text-3)')
    expect(
      declaration(
        'annotation-controls.css',
        '.annotation-set.is-hidden .annotation-set-row',
        'color',
      ),
    ).toBe('var(--text-3)')
    expect(
      declaration(
        'viewer.css',
        '.viewer-legend-categories li.is-hidden .viewer-legend-label',
        'color',
      ),
    ).toBe('var(--text-3)')
  })

  it('sizes the class share text', () => {
    expect(
      declaration('annotation-controls.css', '.annotation-set-row small', 'font-size'),
    ).toBe('var(--font-caption)')
  })

  it('marks the selected tree row with an accent bar, not a tint alone', () => {
    expect(
      declaration(
        'store-structure.css',
        '.store-structure-row.is-selected',
        'box-shadow',
      ),
    ).toContain('var(--accent)')
  })

  it('outlines the channel contrast fields in --border-strong', () => {
    expect(
      declaration('tool-controls.css', '.channel-contrast input', 'border'),
    ).toContain('var(--border-strong)')
  })

  it('puts a dark line next to each mark drawn over an image', () => {
    expect(declaration('viewer.css', '.roi-path-casing', 'stroke')).toBe(
      'var(--overlay-shade)',
    )
    expect(
      Number(declaration('viewer.css', '.roi-path-casing', 'stroke-width')),
    ).toBeGreaterThan(
      Number(declaration('viewer.css', '.roi-lasso-path', 'stroke-width')) + 1,
    )
    expect(declaration('viewer.css', '.viewer-minimap-view', 'box-shadow')).toContain(
      'var(--overlay-shade)',
    )
    expect(
      declaration('viewer.css', '.viewer-magic-lens-circle', 'box-shadow'),
    ).toContain('var(--overlay-shade)')
  })
})
