import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { formatCsv, withCsvFormulaGuard, withoutCsvFormulaGuard } from './csv'

describe('formatCsv', () => {
  it('quotes fields with commas, quotes and line breaks', () => {
    expect(formatCsv([['a,b', 'say "hi"', 'one\ntwo', 'plain']])).toBe(
      '"a,b","say ""hi""","one\ntwo",plain',
    )
  })

  it('makes fields that a spreadsheet would run as formulas text', () => {
    expect(
      formatCsv([
        ['=HYPERLINK("https://example.org","x")', '+1+1', '-2+3', '@SUM(A1)', '\tx'],
      ]),
    ).toBe(`"'=HYPERLINK(""https://example.org"",""x"")",'+1+1,'-2+3,'@SUM(A1),'\tx`)
    expect(formatCsv([['\r=1', '\n=1']])).toBe(`"'\r=1","'\n=1"`)
  })

  it('leaves numbers, including negative ones, as numbers', () => {
    expect(formatCsv([['-12.5', '+3', '-1e-7', '-.5', '4.', '0']])).toBe(
      '-12.5,+3,-1e-7,-.5,4.,0',
    )
  })

  it('marks a lone sign or a value already starting with a quote', () => {
    expect(formatCsv([['-', "'=1", "'x", 'a=b']])).toBe(`'-,''=1,'x,a=b`)
  })
})

describe('withoutCsvFormulaGuard', () => {
  it('drops the quote an export adds and nothing else', () => {
    expect(withoutCsvFormulaGuard("'=1+1")).toBe('=1+1')
    expect(withoutCsvFormulaGuard("''=1")).toBe("'=1")
    expect(withoutCsvFormulaGuard("'x")).toBe("'x")
    expect(withoutCsvFormulaGuard('-12.5')).toBe('-12.5')
  })

  it('gives back any exported value (property)', () => {
    fc.assert(
      fc.property(
        fc.string({
          unit: fc.constantFrom("'", '=', '+', '-', '@', '\t', '1', '.', 'e', 'x'),
        }),
        (value) => withoutCsvFormulaGuard(withCsvFormulaGuard(value)) === value,
      ),
    )
    fc.assert(
      fc.property(
        fc.string(),
        (value) => withoutCsvFormulaGuard(withCsvFormulaGuard(value)) === value,
      ),
    )
  })
})
