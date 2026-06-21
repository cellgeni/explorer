export interface CellGeneExpressionStatus {
  readonly status: 'idle' | 'loading' | 'unavailable' | 'error'
  readonly message: string
}

export function expressionStatusLabel(
  status: CellGeneExpressionStatus | undefined,
): string {
  if (status?.status === 'loading') {
    return 'Loading'
  }

  if (status?.status === 'error') {
    return 'Error'
  }

  return 'Unavailable'
}
