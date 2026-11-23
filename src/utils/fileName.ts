// A part of a downloaded file's name: the text's letters and digits in any
// script, accents dropped, lowercase, with dashes between words; `fallback`
// when nothing is left.
export function fileNamePart(value: string, fallback: string): string {
  const part = value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return part === '' ? fallback : part
}
