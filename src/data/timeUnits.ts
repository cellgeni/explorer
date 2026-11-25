// Symbols for the time units OME-NGFF axes use (UDUNITS-2 names) and common
// abbreviations. Names match in any case and in the plural. Units outside the
// list give no symbol, so the time is not shown.
const TIME_UNIT_SYMBOLS: Readonly<Record<string, string>> = {
  nanosecond: 'ns',
  microsecond: 'µs',
  millisecond: 'ms',
  centisecond: 'cs',
  decisecond: 'ds',
  second: 's',
  minute: 'min',
  hour: 'h',
  day: 'd',
  ns: 'ns',
  us: 'µs',
  µs: 'µs',
  ms: 'ms',
  s: 's',
  sec: 's',
  min: 'min',
  h: 'h',
  hr: 'h',
  d: 'd',
}

export function timeUnitSymbol(unit: string | undefined): string | undefined {
  if (unit === undefined) {
    return undefined
  }

  const name = unit.trim().toLowerCase()

  return TIME_UNIT_SYMBOLS[name] ?? TIME_UNIT_SYMBOLS[name.replace(/s$/, '')]
}
