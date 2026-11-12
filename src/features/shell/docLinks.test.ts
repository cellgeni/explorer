import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DOCS_BASE_URL,
  HELP_LINKS,
  HOST_YOUR_OWN_DATA_URL,
  UI_REFERENCE_URL,
  USER_GUIDE_LOADING_DATA_URL,
  USER_GUIDE_URL,
} from './docLinks'

const DOCS_DIR = join(process.cwd(), 'docs')

// The anchor GitHub gives a Markdown heading: lower case, punctuation
// dropped, spaces as hyphens.
function githubAnchor(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')
}

function docPath(url: string): { readonly file: string; readonly anchor?: string } {
  expect(url.startsWith(DOCS_BASE_URL)).toBe(true)
  const [file = '', anchor] = url.slice(DOCS_BASE_URL.length).split('#')
  return anchor === undefined ? { file } : { file, anchor }
}

describe('docLinks', () => {
  it('points every link at a Markdown file under docs/ on main', () => {
    expect(DOCS_BASE_URL).toBe('https://github.com/cellgeni/explorer/blob/main/docs/')

    for (const url of [
      USER_GUIDE_URL,
      USER_GUIDE_LOADING_DATA_URL,
      UI_REFERENCE_URL,
      HOST_YOUR_OWN_DATA_URL,
    ]) {
      const { file } = docPath(url)

      expect(file).toMatch(/\.md$/)
      expect(existsSync(join(DOCS_DIR, file)), `docs/${file} exists`).toBe(true)
    }
  })

  it('links "What can I open?" to a heading in the user guide', () => {
    const { file, anchor } = docPath(USER_GUIDE_LOADING_DATA_URL)
    const headings = readFileSync(join(DOCS_DIR, file), 'utf8')
      .split('\n')
      .filter((line) => /^#{1,6}\s/.test(line))
      .map((line) => githubAnchor(line.replace(/^#+/, '')))

    expect(file).toBe('user-guide.md')
    expect(anchor).toBe('loading-data')
    expect(headings).toContain(anchor)
  })

  it('lists each Help link once, with a label', () => {
    const hrefs = HELP_LINKS.map((link) => link.href)
    const labels = HELP_LINKS.map((link) => link.label)

    expect(new Set(hrefs).size).toBe(HELP_LINKS.length)
    expect(new Set(labels).size).toBe(HELP_LINKS.length)
    expect(labels.every((label) => label.trim().length > 0)).toBe(true)
    expect(hrefs).toEqual([
      USER_GUIDE_URL,
      USER_GUIDE_LOADING_DATA_URL,
      HOST_YOUR_OWN_DATA_URL,
      UI_REFERENCE_URL,
    ])
  })
})
