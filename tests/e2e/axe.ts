import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

// Accessibility check for the E2E smoke tests (Phase 15.0-F). axe runs the
// WCAG 2.2 A and AA rules on a page state, and each violation is keyed by rule
// and target. Known violations are listed in axe-baseline.json; a violation
// that is not listed fails the test, and so does a listed one that no state
// shows any more, so the baseline can only shrink. To rewrite the baseline
// after fixing violations, run with UPDATE_AXE_BASELINE=1.

const BASELINE_PATH = join(process.cwd(), 'tests', 'e2e', 'axe-baseline.json')
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

type AxeBaseline = Record<string, readonly string[]>

// The states each violation was seen in, by "rule target" key.
export type AxeFindings = Map<string, Set<string>>

// React's useId values change with render order, so targets that use them
// are compared without the id.
function stableTarget(target: readonly unknown[]): string {
  return target
    .map((selector) => String(selector))
    .join(' >>> ')
    .replace(/\\?«r[0-9a-z]+\\?»|_r_[0-9a-z]+_|\\?:r[0-9a-z]+\\?:/gi, 'react-id')
}

export async function collectAxeFindings(
  page: Page,
  state: string,
  findings: AxeFindings,
): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()

  for (const violation of results.violations) {
    for (const node of violation.nodes) {
      const key = `${violation.id} ${stableTarget(node.target)}`
      const states = findings.get(key) ?? new Set<string>()
      states.add(state)
      findings.set(key, states)
    }
  }
}

function readBaseline(): AxeBaseline {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as AxeBaseline
  } catch {
    return {}
  }
}

function baselineKeys(baseline: AxeBaseline): Set<string> {
  return new Set(
    Object.entries(baseline).flatMap(([rule, targets]) =>
      targets.map((target) => `${rule} ${target}`),
    ),
  )
}

function writeBaseline(findings: AxeFindings): void {
  const baseline: Record<string, string[]> = {}

  for (const key of [...findings.keys()].sort()) {
    const separator = key.indexOf(' ')
    const rule = key.slice(0, separator)
    ;(baseline[rule] ??= []).push(key.slice(separator + 1))
  }

  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`)
}

export function expectAxeFindingsMatchBaseline(findings: AxeFindings): void {
  if (process.env.UPDATE_AXE_BASELINE === '1') {
    writeBaseline(findings)
    return
  }

  const known = baselineKeys(readBaseline())
  const added = [...findings.entries()]
    .filter(([key]) => !known.has(key))
    .map(([key, states]) => `${key} (in: ${[...states].join('; ')})`)
  const fixed = [...known].filter((key) => !findings.has(key))

  expect(added, 'New accessibility violations; fix them').toEqual([])
  expect(
    fixed,
    'These violations are fixed; remove them from tests/e2e/axe-baseline.json',
  ).toEqual([])
}
