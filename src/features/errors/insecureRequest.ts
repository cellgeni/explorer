// An HTTPS page that reads from a plain-http address gets no response, which
// the load errors would otherwise put down to CORS. Safari blocks such reads
// as mixed content. Chrome asks for a permission first when the address is on
// this computer or the local network, and even with it, local network reads
// from workers still fail. Measured with Chrome 157 and WebKit; see
// docs/host-your-own-data.md#serve-data-from-your-computer.

export type AddressScope = 'loopback' | 'local' | 'public'

const LOOPBACK_ACTION =
  'This HTTPS page is reading from a plain-http server on this computer. Chrome asks first: allow access to other apps and services on this device (or allow Apps on device in the site settings), then reload. Safari blocks it. The server must also send CORS headers (npx http-server --cors). Or serve the explorer from the same server as the data.'

const LOCAL_ACTION =
  'This HTTPS page is reading from a plain-http server on the local network. Safari blocks it, and Chrome allows only part of it even with the Local network permission. Serve the data over HTTPS, forward the server to this computer with ssh -L and open it through http://localhost in Chrome, or serve the explorer from the same server as the data.'

const PUBLIC_ACTION =
  'This HTTPS page cannot read from plain-http addresses: browsers block them as mixed content. Serve the data over HTTPS, or serve the explorer from the same server as the data.'

// What to do about a read of `targetUrl` that got no response, when the page
// at `pageUrl` is HTTPS and the target is plain http.
export function insecureRequestAction(
  targetUrl: string | undefined,
  pageUrl: string | undefined,
): string | undefined {
  const target = parseUrl(targetUrl)
  const page = parseUrl(pageUrl)

  if (target?.protocol !== 'http:' || page?.protocol !== 'https:') {
    return undefined
  }

  switch (addressScope(target.hostname)) {
    case 'loopback':
      return LOOPBACK_ACTION
    case 'local':
      return LOCAL_ACTION
    case 'public':
      return PUBLIC_ACTION
  }
}

// Where a host is, as browsers group addresses for local network access.
// Takes URL.hostname, so IPv4 is already normalized and IPv6 is bracketed.
export function addressScope(hostname: string): AddressScope {
  const host = hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1')

  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') {
    return 'loopback'
  }

  if (host.endsWith('.local')) {
    return 'local'
  }

  const ipv4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host)

  if (ipv4 !== null) {
    const first = Number(ipv4[1])
    const second = Number(ipv4[2])

    if (first === 127) {
      return 'loopback'
    }

    return first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254)
      ? 'local'
      : 'public'
  }

  // Unique local (fc00::/7) and link-local (fe80::/10) IPv6.
  return /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)
    ? 'local'
    : 'public'
}

// The first web address in an error message, without trailing punctuation.
export function firstUrlIn(message: string): string | undefined {
  return /\bhttps?:\/\/[^\s"'<>]+/i.exec(message)?.[0].replace(/[.,;:)]+$/, '')
}

function parseUrl(value: string | undefined): URL | undefined {
  if (value === undefined) {
    return undefined
  }

  try {
    return new URL(value)
  } catch {
    return undefined
  }
}
