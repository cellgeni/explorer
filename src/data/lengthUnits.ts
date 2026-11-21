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
  // Symbols. OME-XML's upper-case prefixes (Mm, Pm, …) would read as their
  // lower-case namesakes, so only the small ones are listed.
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

// Undefined for a unit that is not a length, or not known.
export function micrometersPerLengthUnit(unit: string | undefined): number | undefined {
  if (unit === undefined) {
    return undefined
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
