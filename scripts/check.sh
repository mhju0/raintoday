#!/bin/sh
# Single gate for local work and PR CI (.github/workflows/ci.yml).
#   scripts/check.sh                 every part
#   scripts/check.sh --fast          lint, typecheck, unit tests only
#   scripts/check.sh --part verify   one CI job: verify | store-contract
#   scripts/check.sh --part audit    live npm advisory audit (weekly workflow; not in PR CI)
# The store-contract part needs PERFORMANCE_STORE_CONTRACT_URL pointing at a
# disposable PostgreSQL database (the suite truncates tables).
set -eu
cd "$(dirname "$0")/.."

FAST=0
PART=""
while [ $# -gt 0 ]; do
  case "$1" in
    --fast) FAST=1 ;;
    --part)
      [ $# -ge 2 ] || { echo "--part needs a name" >&2; exit 2; }
      PART="$2"
      shift
      ;;
    *) echo "usage: scripts/check.sh [--fast] [--part verify|store-contract|audit]" >&2; exit 2 ;;
  esac
  shift
done
case "$PART" in
  ""|verify|store-contract|audit) ;;
  *) echo "unknown part: $PART (verify | store-contract | audit)" >&2; exit 2 ;;
esac

trap 'rc=$?; [ "$rc" -eq 0 ] || echo "GATE: FAIL"' EXIT

want() { [ -z "$PART" ] || [ "$PART" = "$1" ]; }
run() { echo "==> $*"; "$@"; }

if want verify; then
  if [ "$FAST" -eq 0 ]; then
    run npm run test:dependency-audit
    run npm run test:dependency-compatibility
  fi
  run npm run lint
  run npm run typecheck
  run npm test
  if [ "$FAST" -eq 0 ]; then
    run npm run build
    run npm run test:browser
  fi
fi

if want audit && [ "$FAST" -eq 0 ]; then
  run npm run audit:dependencies
fi

if want store-contract && [ "$FAST" -eq 0 ]; then
  if [ -z "${PERFORMANCE_STORE_CONTRACT_URL:-}" ]; then
    echo "store-contract needs PERFORMANCE_STORE_CONTRACT_URL (a disposable PostgreSQL database; it truncates tables). Not set." >&2
    exit 1
  fi
  run node --test lib/performance/storeContract.test.ts
fi

echo "GATE: PASS"
