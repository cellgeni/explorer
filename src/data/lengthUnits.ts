// Micrometres per unit of length, for the units OME-NGFF axes use (UDUNITS-2
// names) and the OME-XML `PhysicalSize` unit symbols. Names match in any case,
// in British spelling and in the plural.
const MICROMETERS_PER_UNIT: Readonly<Record<string, number>> = {
  yoctometer: 1e-18,
  zeptometer: 1e-15,
  attometer: 1e-12,
  femtometer: 1e-9,
  picometer: 1e-6,
  angstrom: 1e-4,
  nanometer: 1e-3,
  micrometer: 1,
  micron: 1,
  millimeter: 1e3,
  centimeter: 1e4,
  decimeter: 1e5,
  meter: 1e6,
  decameter: 1e7,
  hectometer: 1e8,
  kilometer: 1e9,
  megameter: 1e12,
  gigameter: 1e15,
  terameter: 1e18,
  petameter: 1e21,
  exameter: 1e24,
  zettameter: 1e27,
  yottameter: 1e30,
  inch: 25_400,
  foot: 304_800,
  yard: 914_400,
  mile: 1_609_344_000,
  parsec: 3.085_677_581_491_367e22,
  // Symbols in any case, after the exact OME-XML symbols below: `UM`, `NM`.
  pm: 1e-6,
  å: 1e-4,
  nm: 1e-3,
  um: 1,
  mm: 1e3,
  cm: 1e4,
  dm: 1e5,
  m: 1e6,
  km: 1e9,
  in: 25_400,
  ft: 304_800,
}

// OME-XML `UnitsLength` symbols, matched as written, since case tells mega
// from milli (Mm, mm) and peta from pico (Pm, pm). `pixel` and `reference
// frame` are not lengths.
const MICROMETERS_PER_OME_SYMBOL: Readonly<Record<string, number>> = {
  Ym: 1e30,
  Zm: 1e27,
  Em: 1e24,
  Pm: 1e21,
  Tm: 1e18,
  Gm: 1e15,
  Mm: 1e12,
  km: 1e9,
  hm: 1e8,
  dam: 1e7,
  m: 1e6,
  dm: 1e5,
  cm: 1e4,
  mm: 1e3,
  nm: 1e-3,
  pm: 1e-6,
  fm: 1e-9,
  am: 1e-12,
  zm: 1e-15,
  ym: 1e-18,
  Å: 1e-4,
  thou: 25.4,
  li: 25_400 / 12,
  in: 25_400,
  ft: 304_800,
  yd: 914_400,
  mi: 1_609_344_000,
  ua: 1.495_978_707e17,
  ly: 9.460_730_472_580_8e21,
  pc: 3.085_677_581_491_367e22,
  pt: 25_400 / 72,
}

// Undefined for a unit that is not a length, or not known.
export function micrometersPerLengthUnit(unit: string | undefined): number | undefined {
  if (unit === undefined) {
    return undefined
  }

  const symbol = MICROMETERS_PER_OME_SYMBOL[unit.trim()]
  if (symbol !== undefined) {
    return symbol
  }

  const name = unit
    .trim()
    .toLowerCase()
    .replace(/[μµ]/g, 'u')
    .replace(/ångström|ångstrom/, 'angstrom')
    .replace(/metres?$/, 'meter')
  const singular =
    name === 'feet' ? 'foot' : name === 'inches' ? 'inch' : name.replace(/(?<=..)s$/, '')

  return MICROMETERS_PER_UNIT[name] ?? MICROMETERS_PER_UNIT[singular]
}
