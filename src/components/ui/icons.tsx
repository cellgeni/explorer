// Inline icons for the primitives. They inherit the text colour.

export function CloseIcon() {
  return (
    <svg className="ui-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  )
}

export function ChevronDownIcon() {
  return (
    <svg className="ui-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M4 6l4 4 4-4" />
    </svg>
  )
}

export function ChevronRightIcon() {
  return (
    <svg className="ui-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M6 4l4 4-4 4" />
    </svg>
  )
}

// Tool and top bar icons (UNIFIED_PLAN.md, 15.2-B).

export function PanIcon() {
  return (
    <svg className="ui-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 2v12M2 8h12M6 4l2-2 2 2M6 12l2 2 2-2M4 6l-2 2 2 2M12 6l2 2-2 2" />
    </svg>
  )
}

export function BoxSelectIcon() {
  return (
    <svg className="ui-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M2.5 2.5h11v11h-11z" strokeDasharray="2.2 1.8" />
    </svg>
  )
}

export function LassoIcon() {
  return (
    <svg className="ui-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M5.5 11.5C3 10.6 2 9 2 7.2 2 4.3 4.7 2.5 8 2.5s6 1.8 6 4.7-2.7 4.7-6 4.7c-.9 0-1.7-.1-2.5-.4" />
      <path d="M5.5 11.5c-.4 1-.2 1.8.6 2.2" />
    </svg>
  )
}

export function RulerIcon() {
  return (
    <svg className="ui-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M2 11.5 11.5 2 14 4.5 4.5 14z" />
      <path d="M5 8.5l1.5 1.5M7 6.5l1 1M9 4.5l1.5 1.5" />
    </svg>
  )
}

export function LensIcon() {
  return (
    <svg className="ui-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14M7 5v4M5 7h4" />
    </svg>
  )
}

export function InfoIcon() {
  return (
    <svg className="ui-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.5v3.5M8 5h.01" />
    </svg>
  )
}

export function LinkIcon() {
  return (
    <svg className="ui-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1" />
    </svg>
  )
}

export function HelpIcon() {
  return (
    <svg className="ui-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6" />
      <path d="M6.3 6.3a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1v.4M8 11.5h.01" />
    </svg>
  )
}

export function SettingsIcon() {
  return (
    <svg className="ui-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M2.5 4.5h7M12.5 4.5h1M2.5 11.5h1M6.5 11.5h7" />
      <circle cx="11" cy="4.5" r="1.5" />
      <circle cx="5" cy="11.5" r="1.5" />
    </svg>
  )
}

// Canvas navigation (UNIFIED_PLAN.md, 15.2-E).

export function PlusIcon() {
  return (
    <svg className="ui-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 3v10M3 8h10" />
    </svg>
  )
}

export function MinusIcon() {
  return (
    <svg className="ui-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3 8h10" />
    </svg>
  )
}

export function FitIcon() {
  return (
    <svg className="ui-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
    </svg>
  )
}

// Selection rows (UNIFIED_PLAN.md, 15.4-A).

export function PencilIcon() {
  return (
    <svg className="ui-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3 13l1-3.5L10.5 3 13 5.5 6.5 12z" />
      <path d="M9 4.5l2.5 2.5" />
    </svg>
  )
}

export function TargetIcon() {
  return (
    <svg className="ui-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="4.5" />
      <path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" />
    </svg>
  )
}
