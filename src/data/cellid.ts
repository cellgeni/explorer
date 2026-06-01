declare const cellIdBrand: unique symbol
declare const cellIdPrefixBrand: unique symbol
declare const cellIdSuffixBrand: unique symbol

export type CellId = string & { readonly [cellIdBrand]: true }
export type CellIdPrefix = number & { readonly [cellIdPrefixBrand]: true }
export type CellIdSuffix = number & { readonly [cellIdSuffixBrand]: true }

export interface CellIdIntPair {
  readonly prefix: CellIdPrefix
  readonly suffix: CellIdSuffix
}

const HEX_DIGITS = '0123456789abcdef'
const SHIFTED_DIGITS = 'abcdefghijklmnop'

const toShifted = new Map<string, string>(
  [...HEX_DIGITS].map((digit, index) => [digit, SHIFTED_DIGITS[index] ?? '']),
)

const fromShifted = new Map<string, string>(
  [...SHIFTED_DIGITS].map((digit, index) => [digit, HEX_DIGITS[index] ?? '']),
)

export function asCellIdPrefix(value: number): CellIdPrefix {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(`Cell ID prefix must be a uint32, received ${value}.`)
  }

  return value as CellIdPrefix
}

export function asCellIdSuffix(value: number): CellIdSuffix {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(`Cell ID suffix must be a uint32, received ${value}.`)
  }

  return value as CellIdSuffix
}

export function asCellId(value: string): CellId {
  if (!/^[a-p]{8}-\d+$/.test(value)) {
    throw new Error(`Invalid Xenium cell ID: ${value}.`)
  }

  return value as CellId
}

export function cellIdFromIntPair(pair: CellIdIntPair): CellId {
  const hex = (pair.prefix >>> 0).toString(16).padStart(8, '0')
  const shifted = [...hex].map((digit) => {
    const encoded = toShifted.get(digit)

    if (encoded === undefined) {
      throw new Error(`Cannot encode hex digit ${digit}.`)
    }

    return encoded
  })

  return asCellId(`${shifted.join('')}-${pair.suffix}`)
}

export function intToCellId(prefix: number, suffix = 1): CellId {
  return cellIdFromIntPair({
    prefix: asCellIdPrefix(prefix),
    suffix: asCellIdSuffix(suffix),
  })
}

export function cellIdToIntPair(cellId: CellId): CellIdIntPair {
  const [encodedPrefix, encodedSuffix] = cellId.split('-')

  if (encodedPrefix === undefined || encodedSuffix === undefined) {
    throw new Error(`Invalid Xenium cell ID: ${cellId}.`)
  }

  const hex = [...encodedPrefix].map((digit) => {
    const decoded = fromShifted.get(digit)

    if (decoded === undefined) {
      throw new Error(`Cannot decode shifted digit ${digit}.`)
    }

    return decoded
  })

  return {
    prefix: asCellIdPrefix(parseInt(hex.join(''), 16) >>> 0),
    suffix: asCellIdSuffix(Number.parseInt(encodedSuffix, 10)),
  }
}

export function cellIdToInt(cellId: string): CellIdIntPair {
  return cellIdToIntPair(asCellId(cellId))
}
