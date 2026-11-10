// Icechunk URL helpers, kept apart from the reader so detection can use them
// without loading icechunk-js.

// Icechunk repositories are recognised by suffix, as Icechunk's own examples
// name them (`my-repo.icechunk`).
export function isIcechunkUrl(url: string): boolean {
  try {
    return /\.icechunk\/*$/i.test(new URL(url).pathname)
  } catch {
    return false
  }
}

// The H5AD that a repository named `<file>.h5ad.icechunk` references. Its
// chunks are read from there in place of the locations the repository stores,
// as for the companion repository found next to an H5AD.
export function icechunkCompanionFileUrl(url: string): string | undefined {
  const parsed = new URL(url)
  const pathname = parsed.pathname.replace(/\/+$/, '')

  if (!/\.h5ad\.icechunk$/i.test(pathname)) {
    return undefined
  }

  parsed.hash = ''
  parsed.pathname = pathname.slice(0, -'.icechunk'.length)
  return parsed.toString()
}
