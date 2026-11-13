import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const INTERACTIVE_TAGS = new Set([
  'button',
  'canvas',
  'input',
  'select',
  'summary',
  'textarea',
])
const PRIMITIVES_DIRECTORY = join('src', 'components', 'ui')
// Components in the primitives directory, which each take a required title
// (plan 15.0-B). Icons have none.
const PRIMITIVE_TAGS = primitiveComponentNames()

describe('native browser tooltips', () => {
  it('sets title text on visible interactive TSX controls', () => {
    expect(findUntitledInteractiveControls()).toEqual([])
  })

  it('checks the interface primitives too', () => {
    expect([...PRIMITIVE_TAGS].sort()).toEqual(
      expect.arrayContaining(['Button', 'Chip', 'Popover', 'Select', 'Tooltip']),
    )
  })
})

interface UntitledInteractiveControl {
  readonly file: string
  readonly line: number
  readonly tagName: string
}

function findUntitledInteractiveControls(): UntitledInteractiveControl[] {
  return tsxFiles('src').flatMap((file) => {
    const sourceText = readFileSync(file, 'utf8')
    const sourceFile = ts.createSourceFile(
      file,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    )
    const missingControls: UntitledInteractiveControl[] = []
    const sourceLines = sourceText.split('\n')

    // A native control that is the direct child of a Tooltip takes its title
    // from the Tooltip, which would otherwise show twice.
    function check(
      node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
      inTooltip: boolean,
    ): void {
      const tagName = node.tagName.getText(sourceFile)
      const attributes = jsxAttributes(node, sourceFile)
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
      const expectsTitle =
        PRIMITIVE_TAGS.has(tagName) || (INTERACTIVE_TAGS.has(tagName) && !inTooltip)

      if (
        expectsTitle &&
        !attributes.has('title') &&
        !isIntentionallyHidden(attributes) &&
        !sourceLines[line - 1]?.includes('@ts-expect-error')
      ) {
        missingControls.push({ file, line: line + 1, tagName })
      }
    }

    function visit(node: ts.Node, inTooltip: boolean): void {
      if (ts.isJsxElement(node)) {
        check(node.openingElement, inTooltip)
        const isTooltip = node.openingElement.tagName.getText(sourceFile) === 'Tooltip'
        ts.forEachChild(node.openingElement, (child) => visit(child, false))
        for (const child of node.children) visit(child, isTooltip)
        return
      }

      if (ts.isJsxSelfClosingElement(node)) check(node, inTooltip)

      ts.forEachChild(node, (child) => visit(child, false))
    }

    visit(sourceFile, false)

    return missingControls
  })
}

function primitiveComponentNames(): ReadonlySet<string> {
  const names = tsxFiles(PRIMITIVES_DIRECTORY)
    .filter((file) => !file.endsWith('.test.tsx') && !file.endsWith('icons.tsx'))
    .flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/^export function ([A-Z]\w*)/gm)].map(
        (match) => match[1] ?? '',
      ),
    )

  return new Set(names)
}

function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)

    if (entry.isDirectory()) {
      return tsxFiles(path)
    }

    return entry.isFile() && path.endsWith('.tsx') ? [path] : []
  })
}

function jsxAttributes(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, string> {
  const attributes = new Map<string, string>()

  for (const property of node.attributes.properties) {
    if (ts.isJsxAttribute(property)) {
      attributes.set(
        property.name.getText(sourceFile),
        property.initializer?.getText() ?? '',
      )
    }
  }

  return attributes
}

function isIntentionallyHidden(attributes: ReadonlyMap<string, string>): boolean {
  const className = attributes.get('className') ?? ''
  const type = attributes.get('type') ?? ''
  const ariaHidden = attributes.get('aria-hidden') ?? ''

  return (
    className.includes('visually-hidden') ||
    type === '"hidden"' ||
    ariaHidden === '"true"' ||
    ariaHidden === '{true}'
  )
}
