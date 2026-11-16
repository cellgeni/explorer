import { createElement, type ReactNode } from 'react'
import type { SvgChild } from './svgMarkup'

// Renders a plot's SVG tree (plan 22-D9). React names SVG attributes in
// camelCase, except ARIA and data attributes; `class` is `className`.
export function SvgTree({ node }: { readonly node: SvgChild }): ReactNode {
  return renderSvgChild(node, 0)
}

function renderSvgChild(node: SvgChild, key: number): ReactNode {
  if (typeof node === 'string') return node

  const props: Record<string, string | number> = { key }
  for (const [name, value] of Object.entries(node.attrs ?? {})) {
    if (value !== undefined) props[reactAttributeName(name)] = value
  }

  return createElement(
    node.tag,
    props,
    ...(node.children ?? []).map((child, index) => renderSvgChild(child, index)),
  )
}

function reactAttributeName(name: string): string {
  if (name === 'class') return 'className'
  if (name.startsWith('aria-') || name.startsWith('data-')) return name
  return name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
}
