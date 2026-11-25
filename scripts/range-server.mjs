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
//     ext4 only the copied ranges take disk space. Requests without a Range
//     header are refused (416), so a browser tab on the mirror does not copy
//     the whole file.
//   --delay <ms>
//     Answers each request this long after it arrives, as a distant host
//     would. Requests wait in parallel.
//   --log
//     Prints a line per request: method, path, range, status, bytes and time.
//   --fail <share>[:<status>]
//     Answers this share of range requests (0 to 1) with <status> (503).
//   --stall <share>[:<ms>]
//     Holds this share of range requests for <ms> (90000) before answering,
//     as the BioImage Archive sometimes does.
//   --stall-body <share>[:<ms>]
//     Sends the headers and half the body of this share of range requests,
//     then waits <ms> (90000) before the rest.
//   --seed <n>
//     Seeds the choice of failed and stalled requests (1), so that a run can
//     be repeated.
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

// Zenodo refuses Node's default user agent ("node") with 403.
const ORIGIN_HEADERS = { 'User-Agent': 'explorer-range-server' }

const args = process.argv.slice(2)
const portIndex = args.indexOf('--port')
const mirrorIndex = args.indexOf('--mirror')
const delayIndex = args.indexOf('--delay')
const delayMs = delayIndex < 0 ? 0 : Number(args[delayIndex + 1])
const logRequests = args.includes('--log')
const failure = shareOption('--fail', 503)
const stall = shareOption('--stall', 90_000)
const bodyStall = shareOption('--stall-body', 90_000)
const seedIndex = args.indexOf('--seed')
const random = seededRandom(seedIndex < 0 ? 1 : Number(args[seedIndex + 1]))
const options =
  '[--port N] [--delay MS] [--log] [--fail SHARE[:STATUS]] [--stall SHARE[:MS]] ' +
  '[--stall-body SHARE[:MS]] [--seed N]'
const usage =
  `Usage: node scripts/range-server.mjs <folder> ${options}\n` +
  `       node scripts/range-server.mjs --mirror <url> <file> ${options}`

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

  const started = Date.now()
  const fault = chooseFault(request)

  if (logRequests) {
    response.on('close', () => {
      console.log(
        `${request.method} ${request.url} ${request.headers.range ?? '-'} ` +
          `${response.statusCode} ${bodyBytes.get(response) ?? 0} bytes ` +
          `${Date.now() - started} ms${fault === null ? '' : ` (${fault.kind})`}`,
      )
    })
  }

  delay(delayMs + (fault?.kind === 'stall' ? fault.value : 0))
    .then(() => {
      if (fault?.kind === 'fail') {
        response.writeHead(fault.value, CORS)
        response.end()
        return
      }

      return serve(request, response, fault?.kind === 'stall-body' ? fault.value : 0)
    })
    .catch((error) => {
      console.error(`${request.method} ${request.url}: ${error.message}`)

      if (!response.headersSent) {
        response.writeHead(502, CORS)
      }

      response.end()
    })
}).listen(port, '127.0.0.1', () => {
  console.log(`${source.description} on http://127.0.0.1:${port}/`)
})

// The body length of each response, for --log.
const bodyBytes = new WeakMap()

function delay(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
}

// `--fail 0.1:500` gives { share: 0.1, value: 500 }; the value is optional.
function shareOption(name, defaultValue) {
  const index = args.indexOf(name)

  if (index < 0) {
    return null
  }

  const [share, value] = (args[index + 1] ?? '').split(':').map(Number)

  if (!(share >= 0 && share <= 1)) {
    throw new Error(`${name} takes a share from 0 to 1, not ${args[index + 1]}`)
  }

  return { share, value: Number.isFinite(value) ? value : defaultValue }
}

// Only GETs with a Range header can fail or stall: the reads the viewer
// retries, not its HEAD probes or whole-file reads.
function chooseFault(request) {
  if (request.method !== 'GET' || request.headers.range === undefined) {
    return null
  }

  for (const [kind, option] of [
    ['fail', failure],
    ['stall', stall],
    ['stall-body', bodyStall],
  ]) {
    if (option !== null && random() < option.share) {
      return { kind, value: option.value }
    }
  }

  return null
}

// mulberry32: a small seeded generator, so a run's faults can be repeated.
function seededRandom(seed) {
  let state = seed >>> 0

  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

// Sends half the body, waits, then sends the rest.
async function pipeWithStall(body, response, stallMs) {
  const chunks = []

  for await (const chunk of body) {
    chunks.push(chunk)
  }

  const bytes = Buffer.concat(chunks)
  const half = Math.floor(bytes.length / 2)
  response.write(bytes.subarray(0, half))
  await delay(stallMs)

  if (!response.destroyed) {
    response.end(bytes.subarray(half))
  }
}

async function serve(request, response, bodyStallMs = 0) {
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
  const file = await source.file(path)

  if (file === null) {
    response.writeHead(404, CORS)
    response.end()
    return
  }

  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '')

  if (range === null) {
    // A mirror would copy the whole remote file to answer this.
    if (source.rangesOnly === true && request.method !== 'HEAD') {
      response.writeHead(416, { ...CORS, 'Content-Range': `bytes */${file.size}` })
      response.end()
      return
    }

    response.writeHead(200, { ...CORS, 'Content-Length': file.size })
    bodyBytes.set(response, request.method === 'HEAD' ? 0 : file.size)

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
  bodyBytes.set(response, body === null ? 0 : end - start + 1)

  if (body === null) {
    response.end()
  } else if (bodyStallMs > 0) {
    await pipeWithStall(body, response, bodyStallMs)
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

  const head = await fetch(url, { method: 'HEAD', headers: ORIGIN_HEADERS })
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
    rangesOnly: true,
    async file() {
      return {
        size,
        async read(start, end) {
          if (!isCovered(start, end)) {
            const remote = await fetch(url, {
              headers: { ...ORIGIN_HEADERS, Range: `bytes=${start}-${end}` },
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
