import { describe, expect, it, vi } from 'vitest'
import { AnnotationUrlTooLargeError, readAnnotationUrlText } from './annotationUrlText'

// A body sent in the given chunks, counting how many were read.
function chunkedBody(chunks: readonly Uint8Array[]) {
  const stream = { pulled: 0, cancel: vi.fn() }
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[stream.pulled]
      stream.pulled += 1

      if (chunk === undefined) {
        controller.close()
      } else {
        controller.enqueue(chunk)
      }
    },
    cancel: stream.cancel,
  })

  return { body, stream }
}

describe('readAnnotationUrlText', () => {
  it('reads the text, with characters split across chunks', async () => {
    const bytes = new TextEncoder().encode('cell_id,label\ncell-1,Épithélium')
    const split = bytes.length - 3
    const { body } = chunkedBody([bytes.slice(0, split), bytes.slice(split)])

    await expect(readAnnotationUrlText(new Response(body), 'labels.csv')).resolves.toBe(
      'cell_id,label\ncell-1,Épithélium',
    )
  })

  it('refuses a file whose Content-Length is over the limit without reading it', async () => {
    const { body, stream } = chunkedBody([new Uint8Array(10)])
    const response = new Response(body, {
      headers: { 'content-length': String(Math.round(250.5 * 1024 * 1024)) },
    })

    await expect(readAnnotationUrlText(response, 'labels.csv')).rejects.toThrow(
      'labels.csv is 250.5 MB, above the 100 MB limit for annotation URLs.',
    )
    expect(stream.cancel).toHaveBeenCalled()
    expect(stream.pulled).toBeLessThanOrEqual(1)
  })

  it('stops reading a file without Content-Length once it passes the limit', async () => {
    const { body, stream } = chunkedBody(
      Array.from({ length: 10 }, () => new Uint8Array(40)),
    )

    const error: unknown = await readAnnotationUrlText(
      new Response(body),
      'labels.csv',
      100,
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AnnotationUrlTooLargeError)
    expect(error).toMatchObject({ sourceName: 'labels.csv', byteLength: null })
    // The third 40-byte chunk passes 100 bytes; the rest are not read.
    expect(stream.pulled).toBeLessThan(5)
    expect(stream.cancel).toHaveBeenCalled()
  })

  it('reads a file at the limit', async () => {
    const { body } = chunkedBody([new TextEncoder().encode('a'.repeat(100))])

    await expect(
      readAnnotationUrlText(new Response(body), 'labels.csv', 100),
    ).resolves.toBe('a'.repeat(100))
  })
})
