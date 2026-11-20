// The unchanged @smoke suite at another viewport (S6_W x S6_H), on review
// port 4273 with no server reuse. Same as ../baseline/pw.review.config.mjs
// apart from the viewport and output folder.
import base from '../baseline/pw.review.config.mjs'

const width = Number(process.env.S6_W ?? 1024)
const height = Number(process.env.S6_H ?? 768)
export default {
  ...base,
  outputDir: process.env.PW_OUT || '/tmp/pw-out-s6-smoke',
  use: { ...base.use, viewport: { width, height } },
}
