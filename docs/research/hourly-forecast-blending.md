# Blending the hourly forecast across providers

Research for the owner's request of 2026-10-28: replace the single-provider hourly ribbon with an
equal blend now and learned hourly weights later, and design the data collection first so it is
right the first time.

This document is evidence and a recommendation. It is **not** a decision. Each choice below needs
a `docs/DECISIONS.md` entry, because the blend reverses the "single-source on purpose" rule in
`lib/localForecast.ts` (`LocalForecastResponse.hourly`).

Tags: [Verified] read this session in the cited source; [Inferred] reasoning from what was read;
[Unknown] not found in a primary source. Literature claims marked *(abstract)* were read at abstract
level only.

## 1. What exists today

- **Serving.** The ribbon draws the first provider in registry order that has an hourly series,
  in practice Open-Meteo (`lib/localForecast.ts`, `hourlySource`). All five adapters already
  return a now-anchored hourly series cut to 24 points (`.slice(0, 24)` in each of
  `lib/providers/*.ts`), so a blend needs no new provider calls. [Verified]
- **Blocks.** The ribbon folds hours into now-anchored 3-hour blocks; a block's chance is its
  highest hour (`precipMax`, `lib/forecast/blocks.ts`); a block is wet at ≥ 40
  (`RAIN_ONSET_PROBABILITY`), and the headline run, peak and umbrella line read from blocks.
  [Verified]
- **Hourly amounts** come only from Open-Meteo, Visual Crossing and Pirate Weather; KMA and
  WeatherAPI omit `precipitationAmount`. [Verified]
- **Captured evidence.** The Morning Capture (07:00 KST, `lib/performance/morning.ts`) stores each
  provider's hourly chance and amount for today's hours 07–23, without Pirate Weather. The 06 and
  18 cohorts store tomorrow's **daily** chance and amount only, no hours
  (`lib/performance/capture.ts`, `CapturedProviderForecast`). Hourly ASOS rainfall is collected
  for today−3 and today−2. Nothing grades any of it yet. [Verified]

So the only hourly forecast evidence is one issue time per day, covering 0–16 hours ahead, and
lead time is tied to hour of day (an afternoon hour is always ~8 h ahead). [Inferred]

## 2. Combination method

- **Equal weights are hard to beat.** Simple averages repeatedly beat fitted weights because weight
  estimation error eats the gain (Smith & Wallis 2009, doi:10.1111/j.1468-0084.2008.00541.x).
  In five-model seasonal hindcasts, equal weights could not be rejected over 90% of land for
  precipitation (DelSole, Yang & Tippett 2013, doi:10.1002/qj.1961). Weights that misstate true
  skill do worse than equal (Weigel et al. 2010, doi:10.1175/2010JCLI3594.1). [Verified]
- **Operational practice agrees.** The NWS National Blend of Models weighted PoP inputs equally
  until v5.0 (2026), which moves to fixed expert weights; learned (MAE) weights are used only
  where a gridded analysis exists, over 60–120 days
  ([SCN 26-24](https://www.weather.gov/media/notification/pdf_2026/scn26-24_Updated_NBM_V5.0_aac.pdf);
  [Weighting v5.0](https://vlab.noaa.gov/documents/6609493/50344717/Weighting_v5_0.pdf)). Its
  calibrated precipitation probabilities start at 6-hour windows
  ([QMD v5.0](https://vlab.noaa.gov/documents/6609493/50324694/Blend_Precip_QMD_v5_0_Configuration_and_Technical_Details.pdf)).
  How its 1-hour PoP is made in v5.0 is [Unknown].
- **A weighted mean is never calibrated on its own.** Any non-trivial average of distinct
  calibrated forecasts is uncalibrated and less sharp; the beta-transformed linear pool (BLP) fixes
  this with two fitted parameters (Ranjan & Gneiting 2010, doi:10.1111/j.1467-9868.2009.00726.x).
  [Verified] The correction's direction must be fitted, not assumed: the daily blend currently
  over-forecasts mid-range chances (`docs/DECISIONS.md` 2026-10-21), so a default "extremizer"
  would make it worse. [Inferred]
- Not suited here: BMA (Sloughter et al. 2007) models amounts per member and needs more than PoP;
  a log pool is sharper but breaks on a provider stating 0% or 100%. [Inferred]

## 3. Timing disagreement

Averaging hour by hour flattens peaks when providers place the same rain an hour or two apart.
[Inferred]

- Practitioners handle timing error with **space-time neighbourhoods**, not weights (Theis et al.
  2005, doi:10.1017/S1350482705001763; Ebert 2008, doi:10.1002/met.25; Roberts & Lean 2008,
  doi:10.1175/2007MWR2123.1). The NBM used a 3×3 stencil because "ensembles frequently have
  small-to-moderate position errors" (Hamill et al. 2017, doi:10.1175/MWR-D-16-0331.1). [Verified]
- The event must be stated: "rain at this point-hour" and "rain somewhere in the window" give
  different verdicts (Schwartz & Sobash 2017, doi:10.1175/MWR-D-16-0400.1). For raintoday the
  user's question is the second. [Inferred]
- **Order matters.** Take each provider's highest hour in a block first, then blend across
  providers. Blending hours first and then taking the block maximum brings the flattening back.
  [Inferred, arithmetic] This keeps the ribbon's existing `precipMax` meaning.
- Several providers' hourly figures are already window figures (section 5): blocks fit the data
  as well as the reader. [Inferred]

## 4. Grading and learning weights

- **Unit.** Grade fixed KST 3-hour blocks (00–03, 03–06, …) against "any ASOS hour ≥ threshold
  in the block"; grade single hours as a secondary view to show how much skill is lost at
  hourly scale (fuzzy-verification style, Ebert 2008). Split by lead-time bucket. [Inferred]
- **Base rate.** Most hours are dry, so raw Brier is dominated by dry hours and rewards providers
  that post low numbers. That is the failure recorded on 2026-10-12. Compute skill against each
  station-and-season climatology (Hamill & Juras 2006, doi:10.1256/qj.06.25) and report wet and
  dry blocks separately. [Verified source; application Inferred]
- **Judge** with CORP reliability diagrams (Dimitriadis, Gneiting & Jordan 2021,
  doi:10.1073/pnas.2016191118), which answer "does 30% mean 30%" directly, plus Brier skill vs
  climatology and the log score. Use the bias-corrected Brier decomposition for small samples
  (Ferro & Fricker 2012, doi:10.1002/qj.1924). [Verified]
- **Fit** learned parameters on the *blend's own* out-of-sample log score (stacking), never by
  weighting each provider by its own Brier. [Inferred; log score: Benedetti 2010,
  doi:10.1175/2009MWR2945.1]
- **Learned method.** BLP pooled across all 97 stations, one weight set per lead-time bucket
  (3–4 buckets, not 24 hours), shrunk toward equal: `w = (1−λ)/n + λ·ŵ`, λ chosen by rolling-origin
  cross-validation, refit on a rolling window. [Inferred]
- **Switch rule** (heuristic; no source gives a number): ≥ 60 days of hourly captures at several
  lead times, ~100 wet station-days per lead bucket, the learned blend beats equal out of sample
  (DelSole-style or date-block bootstrap), and is no worse on wet blocks or in reliability.
  Re-check after 장마, which is not yet in the data. [Inferred]

## 5. What each provider's hourly chance means, and when it is fresh

| Provider | Hourly chance definition | Stamp `HH:00` means | New data (KST) |
|---|---|---|---|
| Open-Meteo | Share of ECMWF ENS members ≥ 0.1 mm/h over each 3-h step (≥ 0.3 mm/3 h), interpolated to hours | hour **ending** HH:00 | 12z run ≈ 06:40; 00z run after 18:50 (observed 2026-10-28) |
| KMA 단기예보 | POP; guide gives no threshold or period ("0.1 mm" only in press) | hour **ending** HH:00 | issues 02, 05, …, 23 + 10 min; adapter waits 70 min |
| Pirate Weather | ECMWF ENS 00z/12z, > 0.3 mm/3 h; GEFS fallback, chosen per hour | hour **starting** HH:00 | ingest 05:00 and 17:00 |
| WeatherAPI | "Chance of rain"; blend of GFS, HRRR, ECMWF | [Unknown] | every 4–6 h, times unknown |
| Visual Crossing | Agreement across its blend | [Unknown] | every 6 h, times unknown |

Sources: Open-Meteo [docs](https://open-meteo.com/en/docs) and source
(`Sources/App/Gfs/PrecipitationProbability.swift`, `ForecastapiController.swift`); KMA 단기예보
활용가이드 (data.go.kr 15084084) and the
[날씨누리 glossary](https://www.weather.go.kr/wnuri_help/html/weather/short-term.jsp);
[ECMWF dissemination schedule](https://confluence.ecmwf.int/display/DAC/Dissemination+schedule);
Pirate Weather `docs/DataSources.md`, `docs/API/data-blocks.md` and ingest code;
[WeatherAPI docs](https://www.weatherapi.com/docs/forecast-api/) and FAQ;
[Visual Crossing method](https://www.visualcrossing.com/resources/documentation/how-do-we-create-our-weather-forecast/).
Open-Meteo run arrival is one day's measurement. [Verified for the cited pages]

Consequences:

- **The planned grading hour mapping is wrong for two providers.** `.memory/handoff.md` and
  `docs/DECISIONS.md` 2026-10-21 assume a provider hour stamped HH:00 *starts* then. Open-Meteo and
  KMA stamp the hour that *ends* then and match ASOS row HH directly; Pirate Weather's matches
  row HH+1. WeatherAPI and Visual Crossing can be settled from stored Morning Captures with a
  lag-0 vs lag-1 test against ASOS. [Inferred from Verified docs]
- **The Morning window drops a real hour.** The date filter keeps stamps 07..23, so hour-ending
  providers contribute 06–07 and lose 23–24. [Inferred from `morningWindowHours`]
- **The 18:10 cohort is unfair to Open-Meteo.** Its newest ECMWF run was not available at 18:49
  on 2026-10-28, so at 18:10 it runs ~6 h behind Pirate Weather. 07:00 is fair, with ~20 minutes
  of slack for Open-Meteo. [Verified one day; general Inferred]
- **Capturing every 3 hours mostly re-reads unchanged runs.** Only KMA changes every 3 h. [Inferred]

## 6. Capture schedule and quota

Calls per extra run of 97 stations: Visual Crossing 97 (1,000/day; ~291 already used), WeatherAPI
97 (100K/month free), KMA 194–485 (10,000/day development account), Open-Meteo ~340 weighted
(10,000/day), Pirate Weather 97 (10,000/month; **no room** for any extra run). The owner's actual
plans for WeatherAPI and KMA are [Unknown]. (Repo docs and provider pricing pages.)

Recommended:

| KST | Providers | Covers | Lead |
|---|---|---|---|
| 07:00 Morning (exists) | OM, KMA, WA, VC | today 07–24 | 0–17 h |
| ~19:30 Evening hourly (new) | OM, KMA, WA, VC | tomorrow 00–24 | 5–29 h |
| 18:10 cohort (exists, daily) | all five | tomorrow, daily | unchanged |
| ~13:10 (optional) | OM, KMA, WA, VC | today 13–24 and tomorrow | 0–35 h |

The evening capture needs adapters to keep more than 24 hours (the `.slice(0, 24)` cut). Each
captured hour should store its provider's issue or run time where the API exposes it (KMA
`base_time`, Open-Meteo run initialisation) so freshness can be checked later. [Inferred]

## 7. Display

- No product checked puts a probability **range** on its main hourly strip: Met Office, NWS and
  KMA show one number per hour; uncertainty appears as an amount range (Yr), a predictability label
  (Meteoblue) or a separate comparison view (Windy Compare, Meteoblue MultiModel, Naver 예보 비교,
  which Korean users already know). [Verified for Met Office (search snippets), NWS, KMA, Meteoblue,
  Naver article; Apple and Kakao Unknown]
- Drawn intervals get read as a real swing in the value; the same interval as text caused almost no
  errors (Savelli & Joslyn 2013; Joslyn & Savelli 2021) *(abstract)*. Counts of discrete outcomes
  beat densities (Kay et al. 2016, doi:10.1145/2858036.2858558; Fernandes et al. 2018,
  doi:10.1145/3173574.3173718) *(abstract)*. "30% chance of rain" is misread unless its reference
  class is stated (Gigerenzer et al. 2005, doi:10.1111/j.1539-6924.2005.00608.x) *(abstract)*.
- ADR 0009 already bans quartiles and percentile wording at this provider count.

Recommended: blended block bars (section 3) plus a per-block agreement count ("4 of 5 services
≥ 40%") as discrete ticks; the per-provider quilt as a receipt in the evidence shelf. Mockups for
the owner: M1 bars + ticks, M2 bars + min–max whisker (to rule out), M3 quilt receipt under M1.

## 8. Open questions

1. How the 40% threshold behaves on a blended value: replay stored Morning Captures for hit and
   false-alarm rates before shipping.
2. WeatherAPI and Visual Crossing hour convention (lag test on stored data).
3. KMA POP threshold and period; ASOS gauge minimum reportable amount.
4. Open-Meteo 12z arrival vs 07:00: record run initialisation for a week.
5. The owner's WeatherAPI and KMA plan tiers.
6. Display blocks are now-anchored; grading blocks are fixed KST. Whether to align the ribbon to
   fixed KST blocks.
