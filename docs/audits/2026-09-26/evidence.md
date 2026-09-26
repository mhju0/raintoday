# Audit evidence · September 26, 2026

Frozen source: `be4120f9ed1f2b38b98cc8d8d058d69d34c0d503`. This was an audit, not implementation or penetration testing. No production database writes, collection dispatches, credential changes, or GitHub publication.

## Source reproductions

KMA reader: `lib/performance/kma.ts:164–177,269–280`. Synthetic HTTP 200 JSON envelope: `response.header.resultCode: "00"`, `response.body.items.item: [row]`. Requested station `108`, date `2026-09-25`:

| Returned row | Actual result |
| --- | --- |
| `{tm:"2026-09-25", stnId:"108"}` | observed, 0 mm |
| `{tm:"2026-09-25", stnId:"108", sumRn:"not-a-number"}` | absent |
| `{tm:"2026-09-24", stnId:"999", sumRn:"12.4"}` | observed, assigned requested station 108 / September 25 |

Provider-contract clarification: the [official ASOS specification](https://www.data.go.kr/data/15059093/openapi.do) marks `sumRn` optional. An omission is unusable for this scoring pipeline, not an API-schema violation. Keep legitimate explicit `sumRn: ""` dry-day handling. Missing properties, invalid values and mismatched identities need separate fault handling. These synthetic cases do not establish production corruption.

Logging: `lib/performance/errorDetail.ts:96–100`:

```ts
failureDetail(new Error("connect https://example.test?serviceKey=SYNTHETICSECRET"))
// Returns the message unchanged, including SYNTHETICSECRET.
```

A populated message bypasses the fallback redactor. Reachable logging paths include `lib/performance/batch.ts:155` and `scripts/local-performance.ts:27,81`. No real leaked credential was found. Exposure requires an error message containing a credential.

## Verification

- Node 24.15.0, `npm run verify`: lint, typecheck and production build passed. Library: 399 passed / 1 skipped; UI: 78 passed; routes: 2 passed. Total: 479 passed, 1 skipped, 0 failed. Skip: local PostgreSQL contract without a disposable URL.
- [Exact-head CI](https://github.com/mhju0/raintoday/actions/runs/36208747122): `verify` and disposable PostgreSQL 17 `store-contract` succeeded. CodeQL and Scorecard current-head checks also succeeded.
- Independent security review: 36 focused request/response-bound, rate-limit, PostgreSQL retry/redaction and KMA-reader tests passed. Passing existing tests did not cover the two synthetic gaps above.
- `npm audit`: 0 reported vulnerabilities across 510 dependency entries. GitHub: 0 open Dependabot alerts, 0 secret-scanning alerts; intentional LicenseID code-scanning alert remains.
- Branch protection checked live: strict required verify/store-contract/Dependency review, administrator enforcement, no force push/deletion. Selected Actions with mandatory SHA pinning.
- Production deployment ID `6673165546`: success, reviewed SHA, created `2026-09-26T01:32:29Z`. The public alias was exercised separately; no deployment was made.
- Root README Git blob equals GitHub README blob: `08e951383015daf83f0f8a3a19441f4f6bb7710e`.
- [Latest scheduled cohort](https://github.com/mhju0/raintoday/actions/runs/36202853080): first attempt succeeded, remaining attempts skipped; 97 observations stored, 96 captures inserted, 1 provider-faulted station. No live-outage proof for the new breaker.

## Live forecast snapshot

Seoul POST `/api/local-forecast`, around 10:54 KST: HTTP 200, five providers, `blendMode: learned`, evidence active, benchmark passing with 32 samples. The record page identifies ramping. Public `learned` includes ramping; do not claim fully learned weighting.

Provider counts: KMA 31, Open-Meteo 32, Pirate Weather 32, Visual Crossing 15, WeatherAPI 32. Minimum displayed count 15 is not the benchmark count or a violation of provider eligibility. Ineligible providers retain neutral influence. Rounded adaptive/equal Brier both display 0.041; this does not prove raw equality or improvement.

## UX and limitations

See [audit 005](../antislop/audit-005-2026-09-26.md) for numbered accessibility findings and browser coverage. Source-level security strengths are not fresh verification of production SQL grants/TLS, private backups, Vercel edge enforcement, quotas or notification delivery. No new physical-device, VoiceOver or full cross-browser conformance test was performed.

Operations documentation still describes two/three attempts and old retry boundaries. The current workflow has five attempts; `postgres.ts:141–150` includes initialize/listStations/syncStations recovery. Correct the current runbook and mark superseded diagnoses, preserving historical evidence.
