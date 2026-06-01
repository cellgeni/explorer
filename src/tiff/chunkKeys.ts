export function tiffChunkKey(level: number, row: number, col: number): string {
  return `${level}/${row}/${col}`
}
