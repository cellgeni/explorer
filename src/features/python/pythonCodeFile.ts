// Code from a file for the Python console's input (plan 29): read as text,
// put in the input at the cursor, and run only when the user runs it.

// Larger than any script worth reading in a console.
export const MAX_CODE_FILE_BYTES = 1024 * 1024

export const CODE_FILE_ACCEPT = '.py,.txt,text/x-python,text/plain'

export type CodeFileRead =
  | { readonly ok: true; readonly text: string; readonly note: string }
  | { readonly ok: false; readonly note: string }

export async function readCodeFile(file: File): Promise<CodeFileRead> {
  if (file.size > MAX_CODE_FILE_BYTES) {
    return {
      ok: false,
      note: `${file.name} is ${formatBytes(file.size)}; the input takes code files up to ${formatBytes(MAX_CODE_FILE_BYTES)}.`,
    }
  }
  let text: string
  try {
    text = await file.text()
  } catch (error) {
    return {
      ok: false,
      note: `${file.name} could not be read: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  if (text.includes('\u0000')) {
    return { ok: false, note: `${file.name} is not a text file.` }
  }
  // Windows line ends and a byte-order mark would show in the editor.
  const code = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const lines = code.split('\n').length
  return {
    ok: true,
    text: code,
    note: `${file.name} (${lines.toLocaleString()} ${lines === 1 ? 'line' : 'lines'}) is in the input: press Enter or Run to run it.`,
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString()} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024).toLocaleString()} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
