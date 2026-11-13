// Links into the documentation on GitHub, which renders the Markdown and
// follows `main` like the example index (plan 15.3).
export const DOCS_BASE_URL = 'https://github.com/cellgeni/explorer/blob/main/docs/'

export const USER_GUIDE_URL = `${DOCS_BASE_URL}user-guide.md`

// "What can I open?": the sources the viewer reads.
export const USER_GUIDE_LOADING_DATA_URL = `${USER_GUIDE_URL}#loading-data`

export const UI_REFERENCE_URL = `${DOCS_BASE_URL}ui-reference.md`

export const HOST_YOUR_OWN_DATA_URL = `${DOCS_BASE_URL}host-your-own-data.md`

// The Help popover's links (15.3-B).
export const HELP_LINKS: readonly { readonly label: string; readonly href: string }[] = [
  { label: 'User guide', href: USER_GUIDE_URL },
  { label: 'What can I open?', href: USER_GUIDE_LOADING_DATA_URL },
  { label: 'Hosting your own data', href: HOST_YOUR_OWN_DATA_URL },
  { label: 'Every control (UI reference)', href: UI_REFERENCE_URL },
]
