/**
 * Shared provider cache lifetime.
 *
 * This file was lib/seoul.ts, holding a fixed Seoul coordinate from when the app
 * served one city. The forecast has been nationwide since the redesign — every
 * coordinate is validated and converted per request in lib/location.ts — and the
 * last readers of that constant (the AirKorea station and the 기상특보 지점번호)
 * went with the retired scene. Only the TTL was ever shared.
 */

/** Cache TTL for provider data — keeps us well inside free-tier limits. */
export const CACHE_TTL_MS = 5 * 60 * 1000;
