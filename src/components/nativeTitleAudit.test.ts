import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const INTERACTIVE_TAGS = new Set(['button', 'canvas', 'input', 'select', 'textarea'])

describe('native browser tooltips', () => {
  it('sets title text on visible interactive TSX controls', () => {
    expect(findUntitledInteractiveControls()).toEqual([])
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

    function visit(node: ts.Node): void {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tagName = node.tagName.getText(sourceFile)
        const attributes = jsxAttributes(node, sourceFile)

        if (
          INTERACTIVE_TAGS.has(tagName) &&
          !attributes.has('title') &&
          !isIntentionallyHidden(attributes)
        ) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(
            node.getStart(sourceFile),
          )
          missingControls.push({ file, line: line + 1, tagName })
        }
      }

      ts.forEachChild(node, visit)
    }

    visit(sourceFile)

    return missingControls
  })
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
