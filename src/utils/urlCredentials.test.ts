import { describe, expect, it } from 'vitest'
import { urlWithoutCredentials } from './urlCredentials'

describe('urlWithoutCredentials', () => {
  it('drops a query that signs the request, and keeps any other', () => {
    expect(
      urlWithoutCredentials(
        'https://bucket.s3.amazonaws.com/run/?X-Amz-Credential=AKIA&X-Amz-Signature=abc',
      ),
    ).toEqual({ url: 'https://bucket.s3.amazonaws.com/run/', signed: true })
    expect(urlWithoutCredentials('https://example.test/run?sig=1&sv=2')).toEqual({
      url: 'https://example.test/run',
      signed: true,
    })
    expect(urlWithoutCredentials('https://example.test/run?version=2')).toEqual({
      url: 'https://example.test/run?version=2',
      signed: false,
    })
    expect(urlWithoutCredentials('not a url')).toEqual({
      url: 'not a url',
      signed: false,
    })
  })
})
