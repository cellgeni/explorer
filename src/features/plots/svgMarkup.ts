// A plot as a tree of SVG elements (plan 22-D9, 22-D10). The panel renders
// it with React, and Export SVG writes it as a file, so both come from one
// model. Attribute names are written as in SVG files (`text-anchor`).

export interface SvgNode {
  readonly tag: string
  readonly attrs?: Readonly<Record<string, string | number | undefined>>
  readonly children?: readonly SvgChild[]
}

export type SvgChild = SvgNode | string

export function svgNode(
  tag: string,
  attrs: Readonly<Record<string, string | number | undefined>> = {},
  children: readonly SvgChild[] = [],
): SvgNode {
  return { tag, attrs, children }
}

// The file: an XML declaration, then the tree with the SVG namespace.
export function svgDocument(root: SvgNode): string {
  const withNamespace: SvgNode = {
    ...root,
    attrs: { xmlns: 'http://www.w3.org/2000/svg', ...root.attrs },
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${svgMarkup(withNamespace)}\n`
}

export function svgMarkup(node: SvgChild): string {
  if (typeof node === 'string') return escapeXml(node)

  const attrs = Object.entries(node.attrs ?? {})
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([name, value]) => ` ${name}="${escapeXml(formatAttribute(value))}"`)
    .join('')
  const children = node.children ?? []

  return children.length === 0
    ? `<${node.tag}${attrs}/>`
    : `<${node.tag}${attrs}>${children.map(svgMarkup).join('')}</${node.tag}>`
}

function formatAttribute(value: string | number): string {
  return typeof value === 'number' ? String(Math.round(value * 100) / 100) : value
}

// Characters XML 1.0 allows (its Char production), even as references: no
// C0 control but tab, line feed and carriage return; no U+FFFE, U+FFFF or
// unpaired surrogate. A name from an imported file can hold the others,
// which become U+FFFD.
function xmlCharacters(text: string): string {
  let result = ''
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    const allowed =
      code === 0x9 ||
      code === 0xa ||
      code === 0xd ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      code >= 0x10000
    result += allowed ? character : '\uFFFD'
  }
  return result
}

function escapeXml(text: string): string {
  return xmlCharacters(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
