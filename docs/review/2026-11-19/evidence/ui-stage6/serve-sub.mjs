// Stage 6 review server: serves a built app folder under a URL prefix, with
// or without the cross-origin isolation headers the deployment guide asks
// for. Review-only; not a production server.
//
//   node serve-sub.mjs <folder> --prefix /sub/ --port 4275 [--isolate]
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index === -1 ? fallback : args[index + 1]
}
const folder = args[0]
const prefix = option('--prefix', '/sub/')
const port = Number(option('--port', '4275'))
const isolate = args.includes('--isolate')
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
}

createServer(async (request, response) => {
  const url = new URL(request.url, 'http://x')
  const headers = isolate
    ? {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      }
    : {}
  if (!url.pathname.startsWith(prefix)) {
    response.writeHead(404, headers).end('outside prefix')
    return
  }
  let path = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html'
  if (path.endsWith('/')) path += 'index.html'
  const file = join(folder, normalize(path).replace(/^(\.\.[/\\])+/, ''))
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file')
    const body = await readFile(file)
    response.writeHead(200, {
      ...headers,
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Content-Length': body.length,
    })
    response.end(request.method === 'HEAD' ? undefined : body)
  } catch {
    response.writeHead(404, headers).end('not found')
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`serving ${folder} at http://127.0.0.1:${port}${prefix} isolate=${isolate}`)
})
