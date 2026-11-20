// Stage 6 review config. Servers on review ports only (4273 to 4276), never
// reused, so no other worktree's server answers:
//   4273  vite preview of the reviewed build (dist/, COOP/COEP as configured)
//   4274  scripts/range-server.mjs over the stage 6 fixtures
//   4275  the release-style build (--base ./) under /sub/ with COOP/COEP
//   4276  the same build under /sub/ without any isolation headers
// S6_FIXTURES and S6_DIST_REL name the scratch folders; S6_GPU=1 uses Metal.
const root = new URL('../../../../../', import.meta.url).pathname
const here = new URL('./', import.meta.url).pathname
const fixtures = process.env.S6_FIXTURES
const distRel = process.env.S6_DIST_REL
const gpu = process.env.S6_GPU === '1'

export default {
  testDir: here,
  testMatch: /.*\.s6\.mjs$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 600_000,
  reporter: [['list']],
  outputDir: process.env.PW_OUT || '/tmp/pw-out-s6',
  use: {
    baseURL: 'http://127.0.0.1:4273',
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    // ForceEagerMeasureMemory makes performance.measureUserAgentSpecificMemory
    // answer at once instead of at the next garbage collection.
    ...(gpu ? { channel: 'chromium' } : {}),
    launchOptions: {
      args: [
        ...(gpu ? ['--enable-gpu', '--use-angle=metal'] : []),
        '--enable-blink-features=ForceEagerMeasureMemory',
      ],
    },
  },
  webServer: [
    {
      command: 'npm run preview -- --host 127.0.0.1 --port 4273 --strictPort',
      cwd: root,
      port: 4273,
      reuseExistingServer: false,
    },
    {
      command: `node scripts/range-server.mjs ${fixtures} --port 4274`,
      cwd: root,
      port: 4274,
      reuseExistingServer: false,
    },
    {
      command: `node ${here}serve-sub.mjs ${distRel} --prefix /sub/ --port 4275 --isolate`,
      port: 4275,
      reuseExistingServer: false,
    },
    {
      command: `node ${here}serve-sub.mjs ${distRel} --prefix /sub/ --port 4276`,
      port: 4276,
      reuseExistingServer: false,
    },
  ],
}
