// Whether a click, such as the one React reports a checkbox change from,
// was made with Alt (Option on a Mac) held.
export function altClick(event: Event): boolean {
  return 'altKey' in event && event.altKey === true
}

// "Show only this" on a class's checkbox: Alt-click, or Shift-click where the
// desktop takes Alt-click to move windows (KDE, XFCE). Enter is the keyboard's
// route, as Space has neither key.
export function showOnlyClick(event: Event): boolean {
  return altClick(event) || ('shiftKey' in event && event.shiftKey === true)
}

export const SHOW_ONLY_HINT = 'Alt- or Shift-click, or Enter: show only this'
