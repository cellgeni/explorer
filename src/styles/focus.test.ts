import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Focus that can be seen and targets that can be hit (EXP-315, EXP-321),
// read from the stylesheets.

const STYLES = join(process.cwd(), 'src', 'styles')

interface Rule {
  readonly file: string
  readonly selectors: readonly string[]
  readonly body: string
}

const rules: Rule[] = readdirSync(STYLES)
  .filter((file) => file.endsWith('.css'))
  .flatMap((file) =>
    [
      ...readFileSync(join(STYLES, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, ' ')
        .matchAll(/([^{}]+)\{([^{}]*)\}/g),
    ].map((match) => ({
      file,
      selectors: (match[1] ?? '').split(',').map((selector) => selector.trim()),
      body: match[2] ?? '',
    })),
  )

function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return tsxFiles(path)
    return entry.name.endsWith('.tsx') && !entry.name.includes('.test.') ? [path] : []
  })
}

function declaration(selector: string, property: string): string {
  const values = rules
    .filter((rule) => rule.selectors.includes(selector))
    .flatMap((rule) =>
      [...rule.body.matchAll(new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`, 'g'))].map(
        (match) => (match[1] ?? '').trim(),
      ),
    )
  return values[0] ?? ''
}

const tokens = new Map(
  [
    ...readFileSync(join(STYLES, 'tokens.css'), 'utf8').matchAll(
      /--(z-[a-z-]+):\s*(\d+);/g,
    ),
  ].map((match) => [match[1] ?? '', Number(match[2])]),
)

// A z-index as written: a number, a token, or a token plus a number.
function zIndex(value: string): number {
  const token = /var\(--(z-[a-z-]+)\)/.exec(value)
  const base = token === null ? Number(value) : (tokens.get(token[1] ?? '') ?? NaN)
  const plus = /\+\s*(\d+)\)/.exec(value)
  return base + (plus === null ? 0 : Number(plus[1]))
}

describe('focus can be seen', () => {
  it('draws the focused skip link over every layer', () => {
    expect(tokens.size).toBeGreaterThan(5)
    expect(zIndex(declaration('.skip-link', 'z-index'))).toBeGreaterThan(
      Math.max(...tokens.values()),
    )
  })

  it('shows a clipped file input focus on its label', () => {
    expect(
      declaration(
        '.secondary-file-action:has(+ .visually-hidden-file:focus-visible)',
        'outline',
      ),
    ).toBe('3px solid var(--focus)')
  })

  it('places each clipped file input on its label, so focus scrolls to it', () => {
    expect(declaration('.file-action', 'position')).toBe('relative')
    expect(declaration('.file-action > .visually-hidden-file', 'top')).toBe('0')
    expect(declaration('.file-action > .visually-hidden-file', 'width')).toBe('1px')
    const sources = tsxFiles(join(process.cwd(), 'src')).map((file) =>
      readFileSync(file, 'utf8'),
    )
    const inputs = sources.flatMap((source) => [
      ...source.matchAll(
        /<span className="file-action">\s*<label[^>]*>[^<]*<\/label>\s*<input[^>]*className="visually-hidden-file"/g,
      ),
    ])
    const all = sources.flatMap((source) => [
      ...source.matchAll(/className="visually-hidden-file"/g),
    ])
    expect(all.length).toBeGreaterThanOrEqual(3)
    expect(inputs).toHaveLength(all.length)
  })

  it('leaves room for a focus ring in rows that skip painting out of view', () => {
    // content-visibility: auto also clips paint at the box's edge.
    const contained = rules.filter((rule) => /content-visibility:\s*auto/.test(rule.body))
    expect(contained.length).toBeGreaterThan(0)
    for (const rule of contained) {
      expect(rule.body, `${rule.file}: ${rule.selectors.join(', ')}`).toMatch(
        /overflow-clip-margin:\s*6px/,
      )
    }
  })

  it('draws the gene option ring inside the button, as the list clips', () => {
    expect(declaration('.gene-option-list button:focus-visible', 'outline-offset')).toBe(
      '-3px',
    )
  })

  it('pads the collection bar scroller by a dataset ring', () => {
    const ring =
      parseFloat(declaration('.collection-bar-dataset:focus-visible', 'outline')) +
      parseFloat(declaration('.collection-bar-dataset:focus-visible', 'outline-offset'))
    expect(declaration('.collection-bar-groups', 'padding')).toBe(
      `${ring}px ${ring}px 5px`,
    )
    expect(declaration('.collection-bar-groups', 'margin')).toBe(`-${ring}px`)
  })
})

describe('targets can be hit', () => {
  it('makes the loading list Cancel buttons 24 px tall', () => {
    expect(
      parseFloat(declaration('.loading-indicator .loading-task-cancel', 'min-height')),
    ).toBeGreaterThanOrEqual(24)
  })
})
