// CSV for the exports. Cell IDs, labels and gene names come from remote
// datasets and `annotationUrl=` imports, and a field that starts with `=`, `+`,
// `-`, `@`, a tab or a line break can run as a formula when the file is opened
// in a spreadsheet. Such a field gets a leading `'`, which spreadsheets read as
// text (OWASP's advice on CSV injection). Numbers are left as they are, so
// negative coordinates stay numbers. A field that already starts with `'`s
// before one of those characters gets one more, so `withoutCsvFormulaGuard`
// gives back exactly what was exported.
const FORMULA_START = /^'*[=+\-@\t\r\n]/
const GUARDED_FORMULA_START = /^'+[=+\-@\t\r\n]/
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i

export function formatCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(csvField).join(',')).join('\n')
}

export function withCsvFormulaGuard(value: string): string {
  return FORMULA_START.test(value) && !NUMBER.test(value) ? `'${value}` : value
}

// For CSV imports: drops the `'` an export added.
export function withoutCsvFormulaGuard(field: string): string {
  return GUARDED_FORMULA_START.test(field) ? field.slice(1) : field
}

function csvField(value: string): string {
  const guarded = withCsvFormulaGuard(value)

  return /[",\n\r]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded
}
