/**
 * The evidence view behind `/behind-the-data`.
 *
 * The page's whole claim is that a sceptical reader can check it without reading
 * the source, so every number here is one the serving path already computed and
 * every state the profile can be in has a sentence of its own. A mode with no
 * sentence would fall through to whatever the last branch said, which is exactly
 * the kind of quiet lie the page exists to rule out.
 */
import {
  createForecastLocation,
  DEFAULT_FORECAST_LOCATION,
  type ForecastLocation,
} from "./location.ts";
import type { LocalForecastEvidence } from "./localForecast.ts";
import { DEFAULT_PERFORMANCE_POLICY } from "./performance/performance.ts";
import { PERFORMANCE_PROVIDERS } from "./performance/store.ts";
import type {
  LeadTimeSummary,
  PrecipProviderId,
  ProspectiveBenchmark,
  RecentPerformanceProfile,
} from "./performance/types.ts";

const PROVIDER_NAMES: Readonly<Record<PrecipProviderId, string>> = {
  "open-meteo": "Open-Meteo",
  kma: "기상청",
  "pirate-weather": "Pirate Weather",
  "weather-api": "WeatherAPI",
  "visual-crossing": "Visual Crossing",
  "met-norway": "MET Norway",
};

export interface BehindTheDataStatus {
  /** The profile's own mode, never a re-derived one. */
  mode: RecentPerformanceProfile["mode"] | "unavailable";
  /** Whether learned weighting is affecting the served forecast right now. */
  learningApplied: boolean;
  /** What is actually tilting the blend — the seed is not learned weighting. */
  influenceSource: "learned" | "seed" | "none";
  label: string;
  /** One plain sentence a reader with no background can act on. */
  detail: string;
  benchmark: ProspectiveBenchmark["status"] | null;
  benchmarkSampleCount: number | null;
}

export interface BehindTheDataProviderRow {
  provider: PrecipProviderId;
  name: string;
  sampleCount: number;
  wetDays: number;
  dryDays: number;
  /** null when the provider has no scored comparison yet — never a stand-in 0. */
  brierScore: number | null;
  last7DaysBrier: number | null;
  eligible: boolean;
  /** Why an ineligible provider is ineligible — never a verdict on its skill. */
  ineligibleReason: "too-few-samples" | "no-wet-day" | "no-dry-day" | null;
  influence: number | null;
}

export interface BehindTheDataBenchmarkRow {
  label: string;
  brierScore: number;
  /** The benchmark's judgement, not what is served — the banner says that. */
  verdict: "이김" | "짐" | "판정 전" | "기준선" | "참고";
}

export interface BehindTheDataView {
  status: BehindTheDataStatus;
  station: { id: string; name: string; distanceKm: number } | null;
  providers: BehindTheDataProviderRow[];
  /** Empty whenever the benchmark has not been computed on real captures. */
  benchmarkRows: BehindTheDataBenchmarkRow[];
  /**
   * How far ahead the scored captures were really made. The cohort names a
   * scheduled slot and the scheduler is best-effort, so stating the measured
   * spread is the only way the page's own cohort claim stays true.
   */
  leadTime: LeadTimeSummary | null;
  policy: {
    windowDays: number;
    minimumSamples: number;
    fullInfluenceSamples: number;
    halfLifeDays: number;
    scoreSharpness: number;
    weightFloorPercent: number;
    weightCapPercent: number;
    decisionThreshold: number;
    rainThresholdMm: number;
  };
}

function statusOf(evidence: LocalForecastEvidence): BehindTheDataStatus {
  const profile = evidence.profile;
  if (!profile) {
    return {
      mode: "unavailable",
      learningApplied: false,
      influenceSource: "none",
      label: "성능 기록을 읽을 수 없음",
      detail: evidence.reason === "no-eligible-station"
        ? "이 위치에는 대조할 수 있는 관측소가 없어, 모든 예보 서비스를 똑같은 비중으로 평균합니다."
        : "성능 기록 저장소에 닿지 못했습니다. 예보는 그대로 동작하며, 모든 예보 서비스를 똑같은 비중으로 평균합니다.",
      benchmark: null,
      benchmarkSampleCount: null,
    };
  }
  const benchmark = profile.prospectiveBenchmark.status;
  const benchmarkSampleCount = profile.prospectiveBenchmark.sampleCount;
  const base = { benchmark, benchmarkSampleCount };
  switch (profile.mode) {
    case "learned":
      return {
        ...base,
        mode: "learned",
        learningApplied: true,
        influenceSource: "learned",
        label: "학습 가중치 사용 중",
        detail: "최근 이 지역에서 더 잘 맞은 서비스에 더 큰 비중을 주고 있습니다. 이 방식이 단순 평균을 이기고 있다고 판정된 상태입니다.",
      };
    case "ramping":
      return {
        ...base,
        mode: "ramping",
        learningApplied: true,
        influenceSource: "learned",
        label: "학습 가중치 적용 중 · 아직 절반의 세기",
        detail: "증거가 쌓이는 만큼만 단순 평균에서 학습 쪽으로 옮겨가는 중입니다. 표본이 늘수록 반영 폭이 커집니다.",
      };
    case "seed":
      return {
        ...base,
        mode: "seed",
        // Not learned weighting: retrospective, amount-only, capped, and it can
        // never rescue a suspension. Reporting it as learning would be the exact
        // overstatement this page exists to rule out.
        learningApplied: false,
        influenceSource: "seed",
        // The seed is deliberately not described as learning: it is retrospective,
        // scored on amount only, capped, and it can never rescue a suspension.
        label: "과거 기록으로 임시 가중 중",
        detail: "이 지역의 라이브 채점 표본이 아직 부족해, 공개 아카이브로 만든 과거 기록을 절반의 세기로만 쓰고 있습니다. 라이브 증거가 자라면 이 값은 완전히 대체됩니다.",
      };
    case "suspended":
      return {
        ...base,
        mode: "suspended",
        learningApplied: false,
        influenceSource: "none",
        label: "학습 정지됨",
        detail: profile.reason === "benchmark-regression"
          ? "학습한 가중치가 단순 평균보다 나빴습니다. 그래서 지금은 모든 예보 서비스를 똑같은 비중으로 평균합니다."
          : "학습이 이기고 있는지 판정할 만큼 비교 표본이 모이지 않았습니다. 판정 전까지는 모든 예보 서비스를 똑같은 비중으로 평균합니다.",
      };
    default:
      return {
        ...base,
        mode: "equal-fallback",
        learningApplied: false,
        influenceSource: "none",
        label: "똑같은 비중으로 평균 중",
        detail: "이 지역에는 아직 채점된 기록이 없습니다. 모든 예보 서비스를 똑같은 비중으로 평균합니다.",
      };
  }
}

function ineligibleReasonOf(
  row: RecentPerformanceProfile["providers"][number],
): BehindTheDataProviderRow["ineligibleReason"] {
  if (row.eligible) return null;
  if (row.wetDays === 0) return "no-wet-day";
  if (row.dryDays === 0) return "no-dry-day";
  return "too-few-samples";
}

function benchmarkRowsOf(profile: RecentPerformanceProfile): BehindTheDataBenchmarkRow[] {
  const benchmark = profile.prospectiveBenchmark;
  // A benchmark with nothing comparable in it has no rows to show. Printing an
  // empty table with dashes would look like a measurement that came back null.
  if (benchmark.adaptiveBrier === null || benchmark.equalBrier === null) return [];
  // The verdict is the benchmark's, not the server's: with too few comparable
  // captures it has not ruled at all, and calling the adaptive row "in use" then
  // would claim a judgement that has not happened.
  const adaptiveVerdict = benchmark.status === "passing"
    ? "이김"
    : benchmark.status === "regression"
      ? "짐"
      : "판정 전";
  const rows: BehindTheDataBenchmarkRow[] = [
    { label: "성능 반영 평균", brierScore: benchmark.adaptiveBrier, verdict: adaptiveVerdict },
    { label: "단순 평균", brierScore: benchmark.equalBrier, verdict: "기준선" },
  ];
  // Only the two single-source scores the benchmark actually computes. The
  // comparison is offered because it can go against us, which is the point.
  if (benchmark.openMeteoBrier !== null) {
    rows.push({ label: "Open-Meteo 단독", brierScore: benchmark.openMeteoBrier, verdict: "참고" });
  }
  if (benchmark.kmaBrier !== null) {
    rows.push({ label: "기상청 단독", brierScore: benchmark.kmaBrier, verdict: "참고" });
  }
  return rows;
}

/** Assemble everything `/behind-the-data` renders from one evidence read. */
export function buildBehindTheDataView(evidence: LocalForecastEvidence): BehindTheDataView {
  const profile = evidence.profile;
  const compared = new Set<PrecipProviderId>(PERFORMANCE_PROVIDERS);
  const scored = (profile?.providers ?? []).filter((row) => compared.has(row.provider));
  const providers = scored.map((row): BehindTheDataProviderRow => ({
    provider: row.provider,
    name: PROVIDER_NAMES[row.provider],
    sampleCount: row.sampleCount,
    wetDays: row.wetDays,
    dryDays: row.dryDays,
    brierScore: row.brierScore,
    last7DaysBrier: row.last7Days.brierScore,
    eligible: row.eligible,
    ineligibleReason: ineligibleReasonOf(row),
    influence: profile?.effectiveWeights[row.provider] ?? null,
  }));

  // A provider that holds influence but has produced no comparison yet still gets
  // a row. Omitting it left the influence column summing to 80% with nothing on
  // the page to say where the rest went — and this is the page whose whole claim
  // is that a sceptical reader can check it. A newly added source is in exactly
  // this state for its first month: weighted neutrally (#122), scored not at all.
  const shown = new Set(scored.map((row) => row.provider));
  for (const provider of PERFORMANCE_PROVIDERS) {
    if (shown.has(provider)) continue;
    const influence = profile?.effectiveWeights[provider];
    if (typeof influence !== "number") continue;
    providers.push({
      provider,
      name: PROVIDER_NAMES[provider],
      sampleCount: 0,
      wetDays: 0,
      dryDays: 0,
      // Not zero. Zero is a perfect score, and this provider has no score at all.
      brierScore: null,
      last7DaysBrier: null,
      eligible: false,
      ineligibleReason: "too-few-samples",
      influence,
    });
  }
  const policy = DEFAULT_PERFORMANCE_POLICY;
  return {
    status: statusOf(evidence),
    station: evidence.station,
    leadTime: profile?.leadTime ?? null,
    providers,
    benchmarkRows: profile ? benchmarkRowsOf(profile) : [],
    policy: {
      windowDays: policy.windowDays,
      minimumSamples: policy.minimumSamples,
      fullInfluenceSamples: policy.fullInfluenceSamples,
      halfLifeDays: policy.halfLifeDays,
      scoreSharpness: policy.scoreSharpness,
      weightFloorPercent: Math.round(policy.weightFloor * 100),
      weightCapPercent: Math.round(policy.weightCap * 100),
      decisionThreshold: policy.decisionThreshold,
      rainThresholdMm: policy.rainThresholdMm,
    },
  };
}

/**
 * Which coordinate the scoring record should describe.
 *
 * The link out of the forecast carries the visitor's own coordinate, so someone
 * who clicked because their forecast said "기록 없음" lands on the station that
 * said it rather than on Seoul. Anything unusable — absent, malformed, offshore,
 * outside the service area — falls back to the default rather than erroring: the
 * page's job is to explain the system, and it can still do that from Seoul.
 */
export function resolveRecordLocation(
  params: Record<string, string | string[] | undefined>,
): { location: ForecastLocation; requested: boolean } {
  const single = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const latitude = Number(single("lat"));
  const longitude = Number(single("lon"));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { location: DEFAULT_FORECAST_LOCATION, requested: false };
  }
  const name = (single("name") ?? "").slice(0, 60);
  try {
    return { location: createForecastLocation({ name, latitude, longitude }), requested: true };
  } catch {
    // createForecastLocation rejects anything outside the validated service area.
    return { location: DEFAULT_FORECAST_LOCATION, requested: false };
  }
}
