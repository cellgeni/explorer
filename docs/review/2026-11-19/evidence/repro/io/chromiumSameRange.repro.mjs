// IO-01 trigger probe: do two concurrent Range fetches of the same bytes of
// one URL, made without `cache: 'no-store'` (as hyparquet's asyncBufferFromUrl
// makes them), ever get a short or wrong 206 body in Chromium?
//
// Run: node docs/review/2026-11-19/evidence/repro/io/chromiumSameRange.repro.mjs [trials]
// Serves its own page and file on 127.0.0.1:4391 (a port no other check uses).
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { chromium } from 'playwright'

const PORT = 4391
const SIZE = 6 * 1024 * 1024
const FOOTER = 512 * 1024
const TRIALS = Number(process.argv[2] ?? 30)
const file = randomBytes(SIZE)
const etag = `"${createHash('sha1').update(file).digest('hex').slice(0, 16)}"`
const lastModified = new Date(Date.now() - 86_400_000).toUTCString()
let fileRequests = 0

const page = `<!doctype html><meta charset="utf-8"><title>probe</title><script>
const workerSource = \`onmessage = async (event) => {
  const { url, range, cache } = event.data
  const init = { headers: { Range: range } }
  if (cache) init.cache = cache
  const response = await fetch(url, init)
  const body = new Uint8Array(await response.arrayBuffer())
  let sum = 0
  for (let i = 0; i < body.length; i += 1) sum = (sum * 31 + body[i]) >>> 0
  postMessage({ status: response.status, length: body.length, sum })
}\`
const worker = new Worker(URL.createObjectURL(new Blob([workerSource])))
function inWorker(url, range, cache) {
  return new Promise((resolve) => {
    worker.onmessage = (event) => resolve(event.data)
    worker.postMessage({ url, range, cache })
  })
}
async function inPage(url, range, cache) {
  const init = { headers: { Range: range } }
  if (cache) init.cache = cache
  const response = await fetch(url, init)
  const body = new Uint8Array(await response.arrayBuffer())
  let sum = 0
  for (let i = 0; i < body.length; i += 1) sum = (sum * 31 + body[i]) >>> 0
  return { status: response.status, length: body.length, sum }
}
window.probe = async ({ trial, size, footer, cache, where, staggerMs }) => {
  const url = '/data.bin?t=' + trial
  const range = 'bytes=' + (size - footer) + '-' + (size - 1)
  const first = inPage(url, range, cache)
  await new Promise((r) => setTimeout(r, staggerMs))
  const second = where === 'worker' ? inWorker(url, range, cache) : inPage(url, range, cache)
  return Promise.all([first, second])
}
</script>`

function checksum(bytes) {
  let sum = 0
  for (let i = 0; i < bytes.length; i += 1) sum = (sum * 31 + bytes[i]) >>> 0
  return sum
}

const expectedFooterSum = checksum(file.subarray(SIZE - FOOTER))

const server = createServer(async (request, response) => {
  if (request.url === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end(page)
    return
  }

  if (!request.url.startsWith('/data.bin')) {
    response.writeHead(404)
    response.end()
    return
  }

  fileRequests += 1
  const headers = {
    ETag: etag,
    'Last-Modified': lastModified,
    'Accept-Ranges': 'bytes',
    'Content-Type': 'application/octet-stream',
  }
  const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? '')

  if (match === null) {
    response.writeHead(200, { ...headers, 'Content-Length': SIZE })
    response.end(file)
    return
  }

  const start = Number(match[1])
  const end = Math.min(Number(match[2]), SIZE - 1)
  response.writeHead(206, {
    ...headers,
    'Content-Length': end - start + 1,
    'Content-Range': `bytes ${start}-${end}/${SIZE}`,
  })

  // Stream slowly so the two requests overlap.
  for (let offset = start; offset <= end; offset += 32 * 1024) {
    response.write(file.subarray(offset, Math.min(end + 1, offset + 32 * 1024)))
    await new Promise((resolve) => setTimeout(resolve, 15))
  }

  response.end()
})

await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))
const browser = await chromium.launch()
const context = await browser.newContext()
const tab = await context.newPage()
await tab.goto(`http://127.0.0.1:${PORT}/`)

const results = []

for (const cache of [undefined, 'no-store']) {
  for (const where of ['page', 'worker']) {
    for (const staggerMs of [0, 30, 120]) {
      let bad = 0
      const samples = []

      for (let trial = 0; trial < TRIALS; trial += 1) {
        const answers = await tab.evaluate((args) => window.probe(args), {
          trial: `${cache ?? 'default'}-${where}-${staggerMs}-${trial}`,
          size: SIZE,
          footer: FOOTER,
          cache,
          where,
          staggerMs,
        })
        const wrong = answers.filter(
          (answer) => answer.length !== FOOTER || answer.sum !== expectedFooterSum,
        )

        if (wrong.length > 0) {
          bad += 1
          if (samples.length < 3) samples.push(answers)
        }
      }

      results.push({
        cache: cache ?? 'default',
        where,
        staggerMs,
        trials: TRIALS,
        bad,
        samples,
      })
    }
  }
}

console.log(
  JSON.stringify(
    {
      chromium: browser.version(),
      fileBytes: SIZE,
      footerBytes: FOOTER,
      fileRequests,
      results,
    },
    null,
    2,
  ),
)
await browser.close()
server.close()
