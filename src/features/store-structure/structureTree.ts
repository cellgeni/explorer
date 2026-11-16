// Trees the structure drawer browses: a Zarr store's groups and arrays, or a
// Parquet file's schema. Paths join names from the root with '/'; '' is the
// root.
export interface StructureTreeNode<N> {
  readonly path: string
  readonly name: string
  readonly children: readonly N[]
}

export function allBranchPaths<N extends StructureTreeNode<N>>(node: N): string[] {
  return node.children.length === 0
    ? []
    : [node.path, ...node.children.flatMap((child) => allBranchPaths(child))]
}

export interface StructureFilter {
  // Nodes that match, their ancestors, and everything below a match.
  readonly visible: ReadonlySet<string>
  // Ancestors of matches, opened so the matches show.
  readonly expanded: ReadonlySet<string>
  readonly matchCount: number
}

// Nodes whose name contains the query, ignoring case, or whose path does
// when the query has a '/'. Null for an empty query.
export function filterStructure<N extends StructureTreeNode<N>>(
  root: N,
  query: string,
): StructureFilter | null {
  const needle = query.trim().toLowerCase()

  if (needle === '') {
    return null
  }

  const visible = new Set<string>()
  const expanded = new Set<string>()
  let matchCount = 0

  const showAll = (node: N) => {
    visible.add(node.path)
    node.children.forEach(showAll)
  }
  const byPath = needle.includes('/')
  const visit = (node: N): boolean => {
    const matches =
      node.path !== '' && (byPath ? node.path : node.name).toLowerCase().includes(needle)
    let anyChild = false

    for (const child of node.children) {
      if (visit(child)) anyChild = true
    }

    if (matches) {
      matchCount += 1
      // A matching group's contents can be opened too.
      showAll(node)
    }

    if (anyChild) {
      visible.add(node.path)
      expanded.add(node.path)
    }

    return matches || anyChild
  }

  visit(root)
  visible.add('')
  expanded.add('')
  return { visible, expanded, matchCount }
}

export function findNode<N extends StructureTreeNode<N>>(
  node: N,
  path: string,
): N | undefined {
  if (node.path === path) return node

  for (const child of node.children) {
    if (path === child.path || path.startsWith(`${child.path}/`)) {
      // A name holding '/' can make a sibling's path a prefix too.
      const found = findNode(child, path)
      if (found !== undefined) return found
    }
  }

  return undefined
}
