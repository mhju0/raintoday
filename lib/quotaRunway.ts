/**
 * Whether a metered provider quota still covers the rest of its billing period.
 *
 * Pirate Weather is the only upstream with a hard monthly ceiling low enough to
 * reach: 10,000 calls against a scheduled pipeline that spends two calls per
 * station per day. A plain "warn under N left" threshold cannot express that,
 * because the same number is comfortable on the last day of a period and fatal
 * on the first. What matters is runway — does what is left cover the burn still
 * to come, with something held back for visitors.
 *
 * Held back deliberately: the pipeline is background work and a visitor is the
 * product, so the reserve exists to make the check fire while there is still
 * time to act, rather than once the served forecast has already lost a source.
 */

export interface QuotaRunwayInput {
  /** Calls left in the current period, from the provider's own header. */
  readonly remaining: number;
  /** Seconds until the period resets, from the provider's own header. */
  readonly resetSeconds: number;
  /** Calls the scheduled pipeline is expected to spend per day. */
  readonly dailyBurn: number;
  /** Calls held back for visitor traffic on top of the projected burn. */
  readonly reserve: number;
}

export interface QuotaRunway {
  readonly ok: boolean;
  readonly remaining: number;
  /** Projected pipeline burn for the rest of the period, plus the reserve. */
  readonly needed: number;
  readonly daysLeft: number;
  /** How far short the remaining quota falls; 0 when ok. */
  readonly shortfall: number;
}

const SECONDS_PER_DAY = 86_400;

function requireFiniteAtLeastZero(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite number >= 0`);
  }
  return value;
}

export function evaluateQuotaRunway(input: QuotaRunwayInput): QuotaRunway {
  const remaining = requireFiniteAtLeastZero(input.remaining, "remaining");
  const resetSeconds = requireFiniteAtLeastZero(input.resetSeconds, "resetSeconds");
  const dailyBurn = requireFiniteAtLeastZero(input.dailyBurn, "dailyBurn");
  const reserve = requireFiniteAtLeastZero(input.reserve, "reserve");

  const daysLeft = resetSeconds / SECONDS_PER_DAY;
  // Round the projection up. A partial day still runs a full cohort, so rounding
  // down would under-reserve on exactly the day the check needs to be right.
  const needed = Math.ceil(dailyBurn * daysLeft) + reserve;

  return {
    ok: remaining >= needed,
    remaining,
    needed,
    daysLeft,
    shortfall: Math.max(0, needed - remaining),
  };
}
