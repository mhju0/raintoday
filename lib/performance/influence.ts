import { blendPrecipProbability } from "./performance.ts";
import type { CapturedProviderForecast, RecentPerformanceProfile } from "./types.ts";

/**
 * One derivation of Effective Influence and the blend it produces.
 *
 * Influence was previously derived separately at capture time and at serving
 * time. The Prospective Benchmark scores a probability frozen by the capture
 * path against the blend served by the serving path, so those two must agree by
 * construction rather than by coincidence.
 */
export interface PrecipitationBlend {
  /** Effective Influence: normalized over the providers present in this call. */
  influence: Record<string, number>;
  probability: number | null;
  amountMm: number | null;
  /**
   * How many providers the amount is a mean of.
   *
   * Not always the same as the number behind `probability`. A provider that
   * publishes a probability but no amount is dropped from the amount alone, and a
   * card that prints one provider count over both numbers claims a consensus the
   * amount does not have.
   */
  amountProviderCount: number;
}

/**
 * Weighted influence applies only while the profile is earning or holding it.
 * `seed` counts: its weights are already capped toward equal, and the page shows
 * the retrospective record beside them — displaying that evidence while blending
 * equally would claim a weighting that is not being applied.
 * Every other mode — including a suspended benchmark — is Equal Fallback.
 */
function learnedWeights(
  profile: RecentPerformanceProfile | null,
): Readonly<Record<string, number>> | null {
  if (!profile) return null;
  return profile.mode === "learned" || profile.mode === "ramping" || profile.mode === "seed"
    ? profile.effectiveWeights
    : null;
}

function equalInfluence(
  forecasts: readonly CapturedProviderForecast[],
): Record<string, number> {
  const share = forecasts.length > 0 ? 1 / forecasts.length : 0;
  return Object.fromEntries(forecasts.map((forecast) => [forecast.provider, share]));
}

function effectiveInfluence(
  forecasts: readonly CapturedProviderForecast[],
  profile: RecentPerformanceProfile | null,
): Record<string, number> {
  const learned = learnedWeights(profile);
  if (!learned) return equalInfluence(forecasts);
  // Give a provider with no history the mean weight of the scored providers
  // present in this forecast. After normalization it holds exactly 1/n, while
  // the scored providers retain their relative weights. Exclude absent providers
  // so an outage cannot reward or demote a provider that has no evidence yet.
  const scoredWeights = forecasts.flatMap((forecast) => {
    const weight = learned[forecast.provider];
    return weight === undefined ? [] : [Math.max(0, weight)];
  });
  const neutralWeight = scoredWeights.length > 0
    ? scoredWeights.reduce((sum, weight) => sum + weight, 0) / scoredWeights.length
    : 0;
  const raw = Object.fromEntries(
    forecasts.map((forecast) => [
      forecast.provider,
      Math.max(0, learned[forecast.provider] ?? neutralWeight),
    ]),
  );
  const total = Object.values(raw).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return equalInfluence(forecasts);
  return Object.fromEntries(
    Object.entries(raw).map(([provider, value]) => [provider, value / total]),
  );
}

function blendAmount(
  forecasts: readonly CapturedProviderForecast[],
  influence: Readonly<Record<string, number>>,
): { amountMm: number | null; providerCount: number } {
  const reporting = forecasts.filter((forecast) => forecast.amountMm !== null);
  const totalWeight = reporting.reduce(
    (sum, forecast) => sum + (influence[forecast.provider] ?? 0),
    0,
  );
  if (totalWeight <= 0) return { amountMm: null, providerCount: 0 };
  return {
    amountMm: reporting.reduce(
      (sum, forecast) =>
        sum + forecast.amountMm! * (influence[forecast.provider] ?? 0) / totalWeight,
      0,
    ),
    providerCount: reporting.length,
  };
}

/**
 * Blend one set of provider forecasts under a Recent Performance Profile.
 *
 * Pass `null` for the profile to get the Equal Fallback blend — the same call
 * the capture path uses for its prospective equal-weight benchmark.
 */
export function blendPrecipitation(
  forecasts: readonly CapturedProviderForecast[],
  profile: RecentPerformanceProfile | null,
): PrecipitationBlend {
  const influence = effectiveInfluence(forecasts, profile);
  const amount = blendAmount(forecasts, influence);
  return {
    influence,
    probability: blendPrecipProbability(forecasts, influence),
    amountMm: amount.amountMm,
    amountProviderCount: amount.providerCount,
  };
}
