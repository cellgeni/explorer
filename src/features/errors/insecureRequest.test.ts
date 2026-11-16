import { describe, expect, it } from 'vitest'
import { addressScope, firstUrlIn, insecureRequestAction } from './insecureRequest'

const HOSTED = 'https://cellgeni.github.io/explorer/'

describe('insecureRequest', () => {
  it('groups hosts as loopback, local network, or public', () => {
    const hostname = (url: string) => new URL(url).hostname

    expect(addressScope(hostname('http://localhost:8080/'))).toBe('loopback')
    expect(addressScope(hostname('http://data.localhost/'))).toBe('loopback')
    expect(addressScope(hostname('http://127.0.0.1:4173/'))).toBe('loopback')
    expect(addressScope(hostname('http://127.1.2.3/'))).toBe('loopback')
    expect(addressScope(hostname('http://[::1]:8080/'))).toBe('loopback')

    expect(addressScope(hostname('http://10.1.2.3/'))).toBe('local')
    expect(addressScope(hostname('http://172.16.0.1/'))).toBe('local')
    expect(addressScope(hostname('http://172.31.255.1/'))).toBe('local')
    expect(addressScope(hostname('http://192.168.1.20/'))).toBe('local')
    expect(addressScope(hostname('http://169.254.0.9/'))).toBe('local')
    expect(addressScope(hostname('http://workstation.local/'))).toBe('local')
    expect(addressScope(hostname('http://[fd12:3456::1]/'))).toBe('local')
    expect(addressScope(hostname('http://[fe80::1]/'))).toBe('local')

    expect(addressScope(hostname('http://172.32.0.1/'))).toBe('public')
    expect(addressScope(hostname('http://8.8.8.8/'))).toBe('public')
    expect(addressScope(hostname('http://[fd::1]/'))).toBe('public')
    expect(addressScope(hostname('http://example.org/'))).toBe('public')
  })

  it('advises only when an HTTPS page reads a plain-http address', () => {
    const loopback = insecureRequestAction('http://127.0.0.1:8080/a.h5ad', HOSTED)
    expect(loopback).toContain('on this computer')
    expect(loopback).toContain('apps and services on this device')
    expect(loopback).toContain('Safari')

    expect(insecureRequestAction('http://192.168.1.20:8080/a.h5ad', HOSTED)).toContain(
      'local network',
    )
    expect(insecureRequestAction('http://example.org/a.h5ad', HOSTED)).toContain(
      'mixed content',
    )

    expect(insecureRequestAction('https://example.org/a.h5ad', HOSTED)).toBeUndefined()
    expect(
      insecureRequestAction('http://127.0.0.1:8080/a.h5ad', 'http://localhost:5173/'),
    ).toBeUndefined()
    expect(insecureRequestAction(undefined, HOSTED)).toBeUndefined()
    expect(insecureRequestAction('not a url', HOSTED)).toBeUndefined()
    expect(insecureRequestAction('http://127.0.0.1/a', undefined)).toBeUndefined()
  })

  it('finds the first address in an error message', () => {
    expect(
      firstUrlIn(
        'Confirm CORS allows GET and the Range request header for http://127.0.0.1:8080.',
      ),
    ).toBe('http://127.0.0.1:8080')
    expect(firstUrlIn('Failed to fetch')).toBeUndefined()
  })
})
