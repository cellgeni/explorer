declare module 'hyparquet/src/encoding.js' {
  export function readRleBitPackedHybrid(
    reader: { view: DataView; offset: number },
    width: number,
    output: unknown[],
    length?: number,
  ): void
}
