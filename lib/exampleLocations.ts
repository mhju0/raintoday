import type { ForecastLocationSelection } from "./locationPrecision.ts";

/**
 * One worked example the chooser can commit without typing.
 *
 * The chooser's two ways in both assume something a visitor may not have: a
 * device inside the service area, or a Korean place name they can type. Kakao's
 * administrative search matches Hangul only — `seoul`, `Seoul` and `busan` all
 * return nothing — so a visitor with neither was left with two errors that
 * pointed at each other (#121).
 */
export interface ExampleForecastLocation {
  /** What the chip reads. The short leaf, because the chip is a shortcut. */
  short: string;
  /**
   * What is committed. The fully qualified label, for the same reason
   * `chooseSearchResult` commits one: dozens of Korean places share a leaf name.
   */
  name: string;
  latitude: number;
  longitude: number;
  selection: ForecastLocationSelection;
}

/**
 * Kakao's own administrative representative points, taken from
 * `/api/locations/search` rather than typed by hand, so an example commits the
 * identical coordinate the same place would commit through the search. A test
 * asserts every one of them is inside the generated service area.
 *
 * Four, spread across the peninsula and off it: the point of the set is that
 * somewhere in it forecasts differently from Seoul today.
 */
export const EXAMPLE_FORECAST_LOCATIONS: readonly ExampleForecastLocation[] = [
  {
    short: "서울",
    name: "서울특별시",
    latitude: 37.5668260046608,
    longitude: 126.978652258309,
    selection: { kind: "area", areaKind: "administrative-area" },
  },
  {
    short: "부산",
    name: "부산광역시",
    latitude: 35.1797374828769,
    longitude: 129.075067831231,
    selection: { kind: "area", areaKind: "administrative-area" },
  },
  {
    short: "제주",
    name: "제주특별자치도 제주시",
    latitude: 33.4995342411967,
    longitude: 126.531171087132,
    selection: { kind: "area", areaKind: "administrative-area" },
  },
  {
    short: "강릉",
    name: "강원특별자치도 강릉시",
    latitude: 37.7521116823526,
    longitude: 128.875906235799,
    selection: { kind: "area", areaKind: "administrative-area" },
  },
] as const;
