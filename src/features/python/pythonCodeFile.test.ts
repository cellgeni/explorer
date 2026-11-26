import { describe, expect, it } from 'vitest'
import { MAX_CODE_FILE_BYTES, readCodeFile } from './pythonCodeFile'

describe('code files for the input', () => {
  it('reads a script, with plain line ends and no byte-order mark', async () => {
    const read = await readCodeFile(
      new File(['﻿def near(r):\r\n    return r\r\n'], 'near.py'),
    )

    expect(read).toEqual({
      ok: true,
      text: 'def near(r):\n    return r\n',
      note: 'near.py (3 lines) is in the input: press Enter or Run to run it.',
    })
  })

  it('refuses a file too large for the input, or one that is not text', async () => {
    const large = await readCodeFile(
      new File([new Uint8Array(MAX_CODE_FILE_BYTES + 1)], 'big.py'),
    )
    expect(large).toEqual({
      ok: false,
      note: 'big.py is 1.0 MB; the input takes code files up to 1.0 MB.',
    })

    const binary = await readCodeFile(new File([Uint8Array.of(1, 0, 2)], 'data.bin'))
    expect(binary).toEqual({ ok: false, note: 'data.bin is not a text file.' })
  })
})
