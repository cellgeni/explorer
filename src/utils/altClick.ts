// Whether a click, such as the one React reports a checkbox change from,
// was made with Alt (Option on a Mac) held.
export function altClick(event: Event): boolean {
  return 'altKey' in event && event.altKey === true
}
