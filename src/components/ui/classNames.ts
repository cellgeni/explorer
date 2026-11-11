// Joins the class names that are set.
export function classNames(
  ...names: readonly (string | false | null | undefined)[]
): string {
  return names.filter(Boolean).join(' ')
}
