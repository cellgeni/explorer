#!/bin/zsh
# Run from anywhere: moves to the repository root. SP is a scratch directory
# for logs, outside the repository.
cd "$(dirname "$0")/../../../../.." || exit 1
SP=${SP:?set SP to a scratch directory}
OUT=$SP/baseline
: > $OUT/summary.tsv
run() {
  local name=$1; shift
  local start=$(date +%s)
  echo "### $(date -u +%FT%TZ) $*" > $OUT/$name.log
  "$@" >> $OUT/$name.log 2>&1
  local code=$?
  local end=$(date +%s)
  printf "%s\t%s\t%ss\t%s\n" "$name" "$code" "$((end-start))" "$*" >> $OUT/summary.tsv
}
run 01-npm-ci npm ci
run 02-format-check npm run format:check
run 03-lint npm run lint
run 04-typecheck npm run typecheck
run 05-test npm test
run 06-build npm run build
run 07-playwright-dry npx playwright install --dry-run chromium
PW_OUT=$SP/pw-smoke run 08-e2e-smoke npx playwright test --config docs/review/2026-11-19/evidence/baseline/pw.review.config.mjs --grep @smoke
run 09-coverage npm run test:coverage
run 10-audit-prod npm audit --omit=dev
run 11-audit-critical npm audit --audit-level=critical
run 12-git-status git status --porcelain --ignored=no
echo DONE >> $OUT/summary.tsv
