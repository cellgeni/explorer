# Review working notes (2026-11-19)

Working notes behind the review in `docs/review/2026-11-19/`. Since 2026-11-20 the review runs in eight stages (`stages.md`), with the coordinator doing most of the work and at most four Sonnet workers. Files from the first attempt's area reviewers are leads only; `../evidence/triage/README.md` records them. The consolidated outputs are `../REVIEW_REPORT.md`, `../REVIEW_TASKS.md`, `../DOC_CODE_MATRIX.csv` and `../COVERAGE.md`.

## Reviewed version

- Repository: `cellgeni/explorer`, worktree `.claude/worktrees/type-support-question-5174cf`
- Commit: `6a9a736a26fc1b095ed7c1bbfbace97ab4eddf10` (origin/main, merge of PR 197, 2026-11-19 20:28 UTC), clean working tree apart from this review folder. A first baseline started on the older `5b55715` was stopped and discarded when the user pointed out it was stale.
- Host: macOS 26.7.3 (Apple silicon), Node 25.8.1, npm 11.11.1, Playwright 1.60.0 with Chromium build 1223 installed. CI uses Node 24 on Ubuntu 24.04; no Node 24 was available locally.
- Review plan: `REVIEW.md` supplied by the user (prepared 2026-11-19), sections R0–R7.

## Brief given to every area reviewer

You are reviewing one area of Spatial Omics Explorer as part of the review plan. Read sections 1, 4 (your R-steps) and 5 of the plan before starting.

Rules:

1. Review only. Do not edit anything under `src/`, `tests/`, `docs/` (except `docs/review/2026-11-19/`), `examples/`, `public/`, `scripts/`, config files, `package*.json` or `patches/`. Do not run `npm ci`, `npm install`, any `--write`/`--fix` command, or anything that regenerates baselines or examples.
2. Write your notes to `docs/review/2026-11-19/notes/<area>.md`. Put reproductions in `docs/review/2026-11-19/evidence/repro/<area>/` named `*.repro.ts` (never `*.test.*` or `*.spec.*`, so `npm test` does not pick them up) and run them with `npx vitest run --config docs/review/2026-11-19/evidence/repro/vitest.repro.config.ts <path>`. Small fixtures go in `docs/review/2026-11-19/evidence/fixtures/<area>/`, command logs in `docs/review/2026-11-19/evidence/<area>/`. Make each `.repro.ts` independent of the code under test for its expected values (no production helper as the oracle).
3. The coordinator has already run the repository-wide checks (install, format, lint, typecheck, `npm test`, build, `@smoke` E2E, coverage, audits; results in `../COVERAGE.md`). Do not rerun them. Do not run Playwright on ports 4173 or 4273, or `npm run build` into `dist/`. Targeted `npx vitest run <file>` is fine. If you need a build, use `npx vite build --outDir <your evidence or scratch dir>` and serve it on a port of your own.
   Do not launch other agents. Stop after 12 turns and return what you have.
4. Prefer local fixtures. Small Range reads against public test datasets are acceptable when a finding depends on real data; never download whole large files.
5. Evidence standards are in section 1 of the plan: observed behaviour, static proof (complete call path plus triggering conditions, marked "execution unverified"), expected behaviour with its source, historical context as leads only. A `Map`, broad `catch` or worker is a lead, not a finding. Do not invent issues to fill a quota.
6. Before reporting a finding, check its callers and guards, the tests, `docs/plan/open-items.md` and the relevant phase file, so known items are linked rather than rediscovered.
7. Run `npx prettier --write` only on files you created under `docs/review/2026-11-19/`. Keep each inline code span on one line.

Notes file layout:

1. **Scope and coverage ledger**: table of `file | depth (reviewed / sampled / not reviewed) | notes`, covering every authored file in your area.
2. **Findings**: the section 5 format, provisional IDs `<AREA>-NN`, ordered by severity, each with confidence and evidence paths.
3. **Hypotheses and follow-ups**: unproven leads, kept apart from findings.
4. **Existing-item reconciliation**: `lead | still present / partly resolved / resolved / superseded / not verified | evidence`.
5. **Scenario coverage**: which success, failure and unsupported cases you exercised, statically or by execution.
6. **Proposed tasks**: optional, in the plan's task format.

Final reply to the coordinator: at most 500 words, listing each finding as `ID | severity | confidence | one line`, then the main coverage gaps.
