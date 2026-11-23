// A part of a downloaded file's name: the text's letters and digits in any
// script, accents dropped, lowercase, with dashes between words; `fallback`
// when nothing is left. Accents are the marks on Latin, Greek and Cyrillic
// letters; marks that belong to a letter elsewhere (kana voicing, Indic and
// Thai vowel signs) stay, and the result is composed again (NFC), so がん
// stays がん and Hangul stays as typed.
export function fileNamePart(value: string, fallback: string): string {
  const part = value
    .normalize('NFKD')
    .replace(/(?<=[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}])\p{M}+/gu, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return part === '' ? fallback : part
}
