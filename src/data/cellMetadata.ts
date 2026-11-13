// Per-cell metadata for the Cell card: obs columns of an AnnData table, or
// columns a platform's cell table carries.
export type CellMetadata = Readonly<Record<string, string | number | boolean>>

// A cell's metadata, whether its source built it up front (`metadata`) or
// builds it when asked (`readMetadata`).
export function overviewCellMetadata(cell: {
  readonly metadata?: CellMetadata
  readonly readMetadata?: () => CellMetadata
}): CellMetadata | undefined {
  return cell.metadata ?? cell.readMetadata?.()
}
