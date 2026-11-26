// Sections of an AnnData file that holds several, such as registered serial
// sections combined in one table, named by the URL's fragment:
//
// - `<file>#obs.<column>=<value>` is one section, the rows whose obs
//   <column> holds <value>, opened as a dataset of its own;
// - `<file>#obs.<column>` is the file split into its sections, opened as a
//   collection with one dataset per value.
//
// A fetch leaves the fragment out, but the readers add paths to a URL, so the
// file is read by its own URL, through its own dataset, which its sections
// share. Column and value are percent-encoded.

export interface AnnDataSectionRef {
  readonly fileUrl: string
  readonly column: string
  // Null for the split: every section.
  readonly value: string | null
}

const FRAGMENT_PREFIX = 'obs.'

// obs columns that name a table's sections, the likeliest first; a split
// without a column takes the first the table has.
export const SECTION_COLUMN_NAMES: readonly string[] = [
  'section',
  'section_id',
  'section_name',
  'slice',
  'slice_id',
  'sample',
  'sample_id',
  'library_id',
  'slide',
  'slide_id',
]

// An obs column that splits a table, and how many sections it gives.
export interface AnnDataSectionColumn {
  readonly column: string
  readonly sectionCount: number
  // A Visium table's library column, the only one it splits by.
  readonly library?: boolean
}

export function parseAnnDataSectionUrl(url: string): AnnDataSectionRef | null {
  const hash = url.indexOf('#')
  if (hash === -1) return null

  const fragment = url.slice(hash + 1)
  if (!fragment.startsWith(FRAGMENT_PREFIX)) return null

  const equals = fragment.indexOf('=')
  const column = decodePart(
    fragment.slice(FRAGMENT_PREFIX.length, equals === -1 ? undefined : equals),
  )
  if (column === '') return null

  return {
    fileUrl: url.slice(0, hash).replace(/\/+$/, ''),
    column,
    value: equals === -1 ? null : decodePart(fragment.slice(equals + 1)),
  }
}

// One section's URL, or with no value the split's.
export function annDataSectionUrl(
  fileUrl: string,
  column: string,
  value?: string,
): string {
  const file = fileUrl.replace(/\/+$/, '')
  return `${file}#${FRAGMENT_PREFIX}${encodeURIComponent(column)}${
    value === undefined ? '' : `=${encodeURIComponent(value)}`
  }`
}

export function isSectionColumnName(column: string): boolean {
  return SECTION_COLUMN_NAMES.includes(column.toLowerCase())
}

function decodePart(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}
