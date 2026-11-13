// Serves dataset files over HTTP with byte ranges and CORS, for profiling
// and testing the viewer without a remote host (see docs/profiling.md).
//
//   node scripts/range-server.mjs <folder> [--port 4199]
//     Serves the files in <folder>.
//   node scripts/range-server.mjs --mirror <url> <file> [--port 4197]
//     Serves a sparse local copy of the remote file <url> at any path. Ranges
//     not copied yet are fetched from <url>, written into <file> and recorded
//     in <file>.ranges.json, so a dataset is downloaded once and later loads
//     read only local bytes. <file> is created at the remote size; on APFS and
//     ext4 only the copied ranges take disk space.
import {
  createReadStream,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { open } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve, sep } from 'node:path'
import { Readable } from 'node:stream'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Range, Content-Type',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Accept-Ranges': 'bytes',
}

const args = process.argv.slice(2)
const portIndex = args.indexOf('--port')
const mirrorIndex = args.indexOf('--mirror')
const usage =
  'Usage: node scripts/range-server.mjs <folder> [--port N]\n' +
  '       node scripts/range-server.mjs --mirror <url> <file> [--port N]'

if (args.length === 0 || args.includes('--help')) {
  console.log(usage)
  process.exit(args.length === 0 ? 1 : 0)
}

const port = portIndex < 0 ? (mirrorIndex < 0 ? 4199 : 4197) : Number(args[portIndex + 1])
const source =
  mirrorIndex < 0
    ? await folderSource(resolve(args[0]))
    : await mirrorSource(args[mirrorIndex + 1], resolve(args[mirrorIndex + 2]))

createServer((request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, CORS)
    response.end()
    return
  }

  serve(request, response).catch((error) => {
    console.error(`${request.method} ${request.url}: ${error.message}`)

    if (!response.headersSent) {
      response.writeHead(502, CORS)
    }

    response.end()
  })
}).listen(port, '127.0.0.1', () => {
  console.log(`${source.description} on http://127.0.0.1:${port}/`)
})

async function serve(request, response) {
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
  const file = await source.file(path)

  if (file === null) {
    response.writeHead(404, CORS)
    response.end()
    return
  }

  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '')

  if (range === null) {
    response.writeHead(200, { ...CORS, 'Content-Length': file.size })

    if (request.method === 'HEAD') {
      response.end()
    } else {
      ;(await file.read(0, file.size - 1)).pipe(response)
    }

    return
  }

  const start =
    range[1] === '' ? Math.max(0, file.size - Number(range[2])) : Number(range[1])
  const end =
    range[1] === '' || range[2] === ''
      ? file.size - 1
      : Math.min(Number(range[2]), file.size - 1)

  if (start > end || start >= file.size) {
    response.writeHead(416, { ...CORS, 'Content-Range': `bytes */${file.size}` })
    response.end()
    return
  }

  const body = request.method === 'HEAD' ? null : await file.read(start, end)
  response.writeHead(206, {
    ...CORS,
    'Content-Length': end - start + 1,
    'Content-Range': `bytes ${start}-${end}/${file.size}`,
  })

  if (body === null) {
    response.end()
  } else {
    body.pipe(response)
  }
}

// Files under `root`; directories and paths outside it are not found.
async function folderSource(root) {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`${root} is not a folder.\n${usage}`)
  }

  return {
    description: `Serving ${root}`,
    async file(path) {
      const full = resolve(root, `.${path}`)

      if (full !== root && !full.startsWith(root + sep)) {
        return null
      }

      const stats = existsSync(full) ? statSync(full) : null

      return stats?.isFile() === true
        ? {
            size: stats.size,
            read: async (start, end) => createReadStream(full, { start, end }),
          }
        : null
    },
  }
}

// One remote file, copied into a sparse local file range by range.
async function mirrorSource(url, path) {
  if (url === undefined || path === undefined) {
    throw new Error(usage)
  }

  const head = await fetch(url, { method: 'HEAD' })
  const size = Number(head.headers.get('content-length'))

  if (!head.ok || !Number.isFinite(size) || size <= 0) {
    throw new Error(`HEAD ${url} gave status ${head.status} and no size.`)
  }

  const handle = await open(path, existsSync(path) ? 'r+' : 'w+')

  if ((await handle.stat()).size !== size) {
    await handle.truncate(size)
  }

  const coveragePath = `${path}.ranges.json`
  let covered = existsSync(coveragePath)
    ? JSON.parse(readFileSync(coveragePath, 'utf8'))
    : []
  let fetched = 0

  const isCovered = (start, end) => {
    let next = start

    for (const [from, to] of covered) {
      if (from > next) {
        break
      }

      next = Math.max(next, to + 1)
    }

    return next > end
  }

  const cover = (start, end) => {
    const merged = []

    for (const [from, to] of [...covered, [start, end]].sort((a, b) => a[0] - b[0])) {
      const last = merged.at(-1)

      if (last !== undefined && from <= last[1] + 1) {
        last[1] = Math.max(last[1], to)
      } else {
        merged.push([from, to])
      }
    }

    covered = merged
    writeFileSync(coveragePath, JSON.stringify(covered))
  }

  return {
    description: `Mirroring ${url} (${size.toLocaleString()} bytes, ${covered.length} ranges copied) into ${path}`,
    async file() {
      return {
        size,
        async read(start, end) {
          if (!isCovered(start, end)) {
            const remote = await fetch(url, {
              headers: { Range: `bytes=${start}-${end}` },
            })

            if (remote.status !== 206) {
              throw new Error(`the origin answered a range request with ${remote.status}`)
            }

            const bytes = new Uint8Array(await remote.arrayBuffer())
            await handle.write(bytes, 0, bytes.length, start)
            cover(start, start + bytes.length - 1)
            fetched += bytes.length
            console.log(
              `fetched bytes ${start}-${end} from the origin (${(fetched / 1e6).toFixed(1)} MB so far)`,
            )
          }

          const body = Buffer.alloc(end - start + 1)
          await handle.read(body, 0, body.length, start)
          return Readable.from([body])
        },
      }
    },
  }
}
