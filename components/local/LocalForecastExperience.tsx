"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { CONDITION_LABELS_KO } from "@/lib/conditions";
import { EXAMPLE_FORECAST_LOCATIONS } from "@/lib/exampleLocations";
import { periodNameForHour } from "@/lib/forecast/blocks";
import type { TimelineReading } from "@/lib/forecast/rainWindow";
import {
  RAIN_ONSET_PROBABILITY,
  type LocalForecastTimelineBlock,
  type LocalForecastView,
} from "@/lib/localForecastView";
import {
  describeForecastLocationSelection,
  type ForecastLocationSelection,
} from "@/lib/locationPrecision";
import type { ForecastLocationSearchResult } from "@/lib/locationSearch";

type ViewState =
  | { kind: "idle" }
  | { kind: "loading"; label: string }
  | {
      kind: "ready";
      forecast: LocalForecastView;
      selection: ForecastLocationSelection;
      location: ChosenForecastLocation;
    }
  // Carries the input to retry, or null when retrying can never help — so the
  // view cannot offer a button it has no way to act on.
  | { kind: "error"; message: string; retry: ChosenForecastLocation | null };

interface ChosenForecastLocation {
  name: string;
  latitude: number;
  longitude: number;
  elevationM: number | null;
  selection: ForecastLocationSelection;
}

/**
 * The forecast providers, in the order CLAUDE.md pins them. The chooser states
 * the count before a visitor commits a coordinate, so it counts this list
 * rather than carrying a number that can drift away from it.
 */
export const COMPARED_PROVIDER_NAMES = [
  "Open-Meteo",
  "기상청",
  "Pirate Weather",
  "WeatherAPI",
  "Visual Crossing",
] as const;

/**
 * Stations in the generated ASOS catalog. Held as a literal because the catalog
 * itself is a large generated module that has no business in the client bundle;
 * a test asserts this stays equal to `FALLBACK_STATION_CATALOG.length`.
 */
export const VERIFICATION_STATION_COUNT = 97;

const STORED_LOCATION_KEY = "raintoday.last-location.v1";
/** 한눈에/전체 근거 (design ledger D-09) — remembered per device. */
const DENSITY_KEY = "raintoday.view-density.v1";
/** Pre-rename key. Read once so a returning visitor keeps their place. */
const LEGACY_LOCATION_KEY = "seoulsky.last-location.v1";
/** What the server returns when a device coordinate could not be named. */
const DEVICE_PLACEHOLDER_NAME = "현재 위치";

/**
 * The forecast coordinate was rejected by the service-area check, so the same
 * request can never succeed. Kept distinct from a transient failure so the page
 * does not offer a retry that is guaranteed to fail.
 */
class ForecastOutOfServiceAreaError extends Error {}

function normalizeLocationQuery(query: string): string {
  return query.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function probabilityLabel(probability: number | null): string {
  if (probability === null) return "—";
  return `${Math.round(probability)}%`;
}

/**
 * The advice sits under the 24-hour headline, so it is read against the same
 * threshold the headline and the ribbon use. Suggesting an umbrella below that
 * line contradicts the sentence directly above it.
 */
function rainAction(
  probability: number | null,
  amountMm: number | null,
  threshold: number,
): string {
  if (probability === null) return "강수 정보를 충분히 모으지 못했어요.";
  if (probability >= 70 || (amountMm ?? 0) >= 10) return "우산을 꼭 챙기세요.";
  if (probability >= threshold) return "작은 우산을 챙기면 마음이 놓여요.";
  return "우산 없이 나서도 괜찮아 보여요.";
}

function formatDate(date: string | null): string {
  if (!date) return "내일";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${date}T12:00:00+09:00`));
}

/**
 * "20 목" — six of these share one card, so the month is dropped. The card
 * already says these are the days after tomorrow, and a full "8. 20. (목)"
 * overflows its column at every width.
 */
function formatOutlookDate(date: string): string {
  const weekday = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    weekday: "narrow",
  }).format(new Date(`${date}T12:00:00+09:00`));
  // Off the ISO date rather than Intl: ko-KR renders `day: "numeric"` as "20일",
  // and "20일 목" is a third wider than the column it has to sit in.
  return `${Number(date.slice(8, 10))} ${weekday}`;
}

/** GPS links carry only the public matched station; searched areas remain shareable. */
function recordHrefFor(input: ChosenForecastLocation, stationId: string | undefined): string {
  if (input.selection.kind === "device") {
    return `/behind-the-data?${new URLSearchParams({ station: stationId ?? "none" })}`;
  }
  const params = new URLSearchParams({
    lat: input.latitude.toFixed(5),
    lon: input.longitude.toFixed(5),
    name: input.name,
  });
  return `/behind-the-data?${params}`;
}

/** Device fixes stay out of shared URLs; only searched administrative areas belong here. */
function shareableSearch(input: ChosenForecastLocation): string | null {
  if (input.selection.kind !== "area") return null;
  const params = new URLSearchParams({
    lat: input.latitude.toFixed(5),
    lon: input.longitude.toFixed(5),
    name: input.name,
    area: input.selection.areaKind === "legal-area" ? "b" : "h",
  });
  return `?${params}`;
}

function locationFromSearch(search: string): ChosenForecastLocation | null {
  const params = new URLSearchParams(search);
  const rawLat = params.get("lat");
  const rawLon = params.get("lon");
  const name = params.get("name")?.trim();
  const area = params.get("area");
  // Bail on absent coordinates before Number(), which turns null and "" into 0
  // and would send a link stripped by a chat client to the Gulf of Guinea —
  // surfacing a dead-end "outside the service area" error as the first screen.
  if (!rawLat?.trim() || !rawLon?.trim()) return null;
  const latitude = Number(rawLat);
  const longitude = Number(rawLon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  // Coarse Korea bounding box. The server still validates against the real
  // service-area geometry; this only keeps a malformed link out of the loading
  // state and on the chooser, where the user can do something about it.
  if (latitude < 32 || latitude > 39.5 || longitude < 124 || longitude > 132) return null;
  if (!name || name.length > 80) return null;
  return {
    name,
    latitude,
    longitude,
    elevationM: null,
    selection: {
      kind: "area",
      areaKind: area === "b" ? "legal-area" : "administrative-area",
    },
  };
}

function readStoredLocation(): ChosenForecastLocation | null {
  try {
    const raw = window.localStorage.getItem(STORED_LOCATION_KEY)
      ?? window.localStorage.getItem(LEGACY_LOCATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ChosenForecastLocation>;
    if (
      typeof parsed.name !== "string" ||
      typeof parsed.latitude !== "number" ||
      typeof parsed.longitude !== "number" ||
      !Number.isFinite(parsed.latitude) ||
      !Number.isFinite(parsed.longitude) ||
      !parsed.selection
    ) {
      return null;
    }
    return {
      name: parsed.name,
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      elevationM: typeof parsed.elevationM === "number" ? parsed.elevationM : null,
      selection: parsed.selection,
    };
  } catch {
    // Private-mode storage throws on read; a first run is the right fallback.
    return null;
  }
}

/**
 * Persist no more precision than the forecast can use.
 *
 * A raw device fix is accurate to a few metres, which is enough to identify a
 * dwelling, and browser storage is readable by anything running on this origin.
 * Three decimals is about 110 m — far finer than the 5 km KMA grid the forecast
 * is read on, so the restored forecast is identical while what sits on disk no
 * longer points at a front door.
 */
function coarsenForStorage(input: ChosenForecastLocation): ChosenForecastLocation {
  const round = (value: number): number => Math.round(value * 1_000) / 1_000;
  return { ...input, latitude: round(input.latitude), longitude: round(input.longitude) };
}

function writeStoredLocation(input: ChosenForecastLocation): void {
  try {
    window.localStorage.setItem(
      STORED_LOCATION_KEY,
      JSON.stringify(coarsenForStorage(input)),
    );
  } catch {
    // Persistence is a convenience; losing it must not break the forecast.
  }
}

function clearStoredLocation(): void {
  try {
    window.localStorage.removeItem(STORED_LOCATION_KEY);
    window.localStorage.removeItem(LEGACY_LOCATION_KEY);
  } catch {
    // Nothing to recover from — the next visit simply starts at the chooser.
  }
}

async function loadForecast(input: {
  name: string;
  latitude: number;
  longitude: number;
  elevationM: number | null;
}): Promise<LocalForecastView> {
  const response = await fetch("/api/local-forecast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  // A 400 means the coordinate itself was rejected — almost always a position
  // outside the Korean service area. Telling that user to wait and retry would
  // send them round a loop that cannot end.
  if (response.status === 400) throw new ForecastOutOfServiceAreaError();
  if (!response.ok) throw new Error("forecast request failed");
  return response.json() as Promise<LocalForecastView>;
}

function LocationMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      <circle cx="12" cy="12" r="7" />
    </svg>
  );
}

function SearchMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

export function LocationChooser({ onChoose, autoFocus = false, busy = false }: {
  onChoose(input: ChosenForecastLocation): void;
  autoFocus?: boolean;
  /** A forecast is loading over this view; dim it and take it out of the tab order. */
  busy?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ForecastLocationSearchResult[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const [activeResultIndex, setActiveResultIndex] = useState(-1);
  const [locating, setLocating] = useState(false);
  const listboxId = useId();
  const requestSequence = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Returning from a forecast puts the user back here on purpose, so land them
  // on the control they came back to use. Never on first paint — auto-focusing
  // a search field on load pops the keyboard on a phone.
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const visibleResults = expanded ? results : [];

  useEffect(() => {
    const normalized = normalizeLocationQuery(query);
    const sequence = requestSequence.current;
    if (normalized.length < 2) return;

    const controller = new AbortController();
    activeRequest.current = controller;

    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/locations/search?q=${encodeURIComponent(normalized)}`,
          { signal: controller.signal },
        );
        if (response.status === 429) {
          if (sequence !== requestSequence.current) return;
          setResults([]);
          setActiveResultIndex(-1);
          setRetryAvailable(true);
          setMessage("검색 요청이 많아요. 잠시 후 다시 시도해 주세요.");
          return;
        }
        if (response.status === 400) {
          // The server rejected the query itself, so retrying it unchanged
          // cannot succeed. Saying "temporarily unavailable" here would be
          // dishonest and would offer a retry that never helps.
          if (sequence !== requestSequence.current) return;
          setResults([]);
          setActiveResultIndex(-1);
          setRetryAvailable(false);
          setMessage("검색어를 인식하지 못했어요. 시·구·동 이름으로 더 짧게 입력해 주세요.");
          return;
        }
        if (response.status === 503) {
          // Distinguish "this deployment has no search credential" from a
          // passing upstream failure: only one of them is worth retrying.
          const reason = await response.clone().json().then(
            (body: { error?: unknown }) => body?.error,
            () => undefined,
          );
          if (sequence !== requestSequence.current) return;
          if (reason === "search_not_configured") {
            setResults([]);
            setActiveResultIndex(-1);
            setRetryAvailable(false);
            setMessage("이곳에서는 지역 검색을 쓸 수 없어요. 아래 예시나 위의 ‘내 위치로 보기’를 사용해 주세요.");
            return;
          }
        }
        if (!response.ok) throw new Error("unavailable");
        const payload = (await response.json()) as { results: ForecastLocationSearchResult[] };
        if (sequence !== requestSequence.current) return;
        setResults(payload.results);
        setExpanded(true);
        setActiveResultIndex(payload.results.length > 0 ? 0 : -1);
        setRetryAvailable(false);
        setMessage(
          payload.results.length === 0
            ? "대한민국 안에서 일치하는 행정구역을 찾지 못했어요. 시·구·동을 함께 입력해 보세요."
            : null,
        );
      } catch {
        if (controller.signal.aborted || sequence !== requestSequence.current) return;
        setResults([]);
        setActiveResultIndex(-1);
        setRetryAvailable(true);
        setMessage("지역 검색이 잠시 원활하지 않아요. 다시 시도해 주세요.");
      } finally {
        if (sequence === requestSequence.current) setSearching(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query, retryVersion]);

  // An in-flight search must not land on top of a coordinate the visitor has
  // already committed, whichever of the two ways in they took.
  const commitChoice = (choice: ChosenForecastLocation) => {
    requestSequence.current += 1;
    activeRequest.current?.abort();
    onChoose(choice);
  };

  const chooseSearchResult = (result: ForecastLocationSearchResult) => {
    commitChoice({
      // The fully qualified label, not the bare leaf: dozens of Korean towns
      // share a 동 name, and "중앙동" alone cannot confirm the right place.
      name: result.label || result.name,
      latitude: result.latitude,
      longitude: result.longitude,
      elevationM: result.elevationM,
      selection: { kind: "area", areaKind: result.kind },
    });
  };

  const useCurrentLocation = () => {
    setMessage(null);
    if (!navigator.geolocation) {
      setMessage("이 브라우저에서는 위치 기능을 사용할 수 없어요. 아래에서 지역을 고르거나 검색해 주세요.");
      return;
    }
    // A high-accuracy fix can take the full 12s timeout. Without this the button
    // itself gave no sign it had been pressed, and the only feedback was muted
    // text under a different control.
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => onChoose({
        name: DEVICE_PLACEHOLDER_NAME,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        elevationM:
          position.coords.altitude !== null && Number.isFinite(position.coords.altitude)
            ? position.coords.altitude
            : null,
        selection: {
          kind: "device",
          accuracyM:
            Number.isFinite(position.coords.accuracy) && position.coords.accuracy >= 0
              ? position.coords.accuracy
              : null,
        },
      }),
      () => {
        setLocating(false);
        setMessage("위치를 확인하지 못했어요. 권한을 확인하거나 아래에서 지역을 골라 주세요.");
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 },
    );
  };

  return (
    <section
      className={`local-chooser${busy ? " is-busy" : ""}`}
      aria-labelledby="location-heading"
      inert={busy || undefined}
    >
      <div className="local-chooser-copy">
        <p className="local-eyebrow">대한민국 로컬 강수 예보</p>
        {/* Day-agnostic on purpose: the forecast now opens on today and carries
            tomorrow beside it, so naming one day in the promise would be wrong
            again the moment the other is on screen. */}
        <h1 id="location-heading">비, <b>여기서는</b><br />어떨까요?</h1>
        <p>
          여러 날씨 서비스를 한곳에서 비교하고, 가까운 관측소에서 최근 실제로
          얼마나 맞았는지에 따라 예보의 영향을 조정합니다.
        </p>

        {/* The same three facts the dashboard's evidence cards end on, said
            before the visitor commits a coordinate rather than only after. */}
        <dl className="local-chooser-facts">
          <div>
            <dt>비교하는 서비스</dt>
            <dd>{COMPARED_PROVIDER_NAMES.length}곳</dd>
            <small>{COMPARED_PROVIDER_NAMES.join(" · ")}</small>
          </div>
          <div>
            <dt>검증 관측소</dt>
            <dd>{VERIFICATION_STATION_COUNT}개</dd>
            <small>기상청 ASOS · 익일 예보만 채점합니다</small>
          </div>
          <div>
            <dt>시간축</dt>
            <dd>24시간</dd>
            <small>3시간 블록 8개로 비가 시작되고 그치는 때</small>
          </div>
        </dl>

        {/* The instrument the visitor is about to fill: the dashboard's
            timeline frame, empty. A preview of the product that claims no
            data — gridlines and a sentence, nothing else. */}
        <div className="local-instrument-empty" aria-hidden>
          <div className="local-instrument-empty-lab">
            <span>시간대 강수확률 · 강수량</span>
            <span>0–100% · MM</span>
          </div>
          <div className="local-instrument-empty-grid">
            <span>위치를 고르면 여기 그려집니다</span>
          </div>
        </div>
      </div>

      <div className="local-location-actions">
        <p className="local-panel-title">어디의 비를 볼까요</p>
        <button
          className="local-primary-button"
          type="button"
          onClick={useCurrentLocation}
          disabled={locating}
          aria-busy={locating}
        >
          <span className="local-button-icon"><LocationMark /></span>
          {locating ? "위치 확인 중…" : "내 위치로 보기"}
        </button>

        <div className="local-divider"><span>또는 지역 직접 찾기</span></div>

        {/* The combobox and its popup share a positioning context so the result
            list can leave the flow. In the flow it resized the document on every
            keystroke, and iOS Safari answered that by rescrolling under the
            keyboard — the page visibly walked while you typed. */}
        <div className="local-search">
        <form
          className="local-search-form"
          onSubmit={(event) => {
            event.preventDefault();
            const selected = visibleResults[activeResultIndex];
            if (selected) {
              chooseSearchResult(selected);
            } else if (query.trim().length < 2) {
              setMessage("지역 이름을 두 글자 이상 입력해 주세요.");
            }
          }}
        >
          <label htmlFor="location-search" className="sr-only">대한민국 지역 검색</label>
          <SearchMark />
          <input
            id="location-search"
            ref={inputRef}
            value={query}
            onChange={(event) => {
              const nextQuery = event.target.value;
              const normalized = normalizeLocationQuery(nextQuery);
              requestSequence.current += 1;
              activeRequest.current?.abort();
              setQuery(nextQuery);
              setResults([]);
              setExpanded(true);
              setActiveResultIndex(-1);
              setSearching(normalized.length >= 2);
              setRetryAvailable(false);
              setMessage(
                normalized.length === 1 ? "지역 이름을 두 글자 이상 입력해 주세요." : null,
              );
            }}
            placeholder="동네, 도시 이름 검색"
            autoComplete="off"
            maxLength={80}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={visibleResults.length > 0}
            aria-controls={listboxId}
            aria-activedescendant={
              activeResultIndex >= 0 ? `${listboxId}-option-${activeResultIndex}` : undefined
            }
            aria-busy={searching}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && results.length > 0) {
                event.preventDefault();
                // Re-opening a list the user dismissed is the whole point of
                // collapsing rather than discarding it.
                if (!expanded) {
                  setExpanded(true);
                  setActiveResultIndex(0);
                  return;
                }
                setActiveResultIndex((current) => (current + 1) % results.length);
              } else if (event.key === "ArrowUp" && results.length > 0) {
                event.preventDefault();
                if (!expanded) {
                  setExpanded(true);
                  setActiveResultIndex(results.length - 1);
                  return;
                }
                setActiveResultIndex((current) => current <= 0 ? results.length - 1 : current - 1);
              } else if (event.key === "Enter" && visibleResults[activeResultIndex]) {
                event.preventDefault();
                chooseSearchResult(visibleResults[activeResultIndex]);
              } else if (event.key === "Escape") {
                // Collapse the popup and keep the matches, per the combobox
                // pattern — discarding them left no way back but retyping.
                setExpanded(false);
                setActiveResultIndex(-1);
                setRetryAvailable(false);
                setMessage(null);
              }
            }}
          />
          <button type="submit" disabled={searching || activeResultIndex < 0}>
            {searching ? "찾는 중" : "선택"}
          </button>
        </form>

        <div className="local-search-popup">
        {searching && (
          <p className="local-form-message" role="status">지역 검색 중…</p>
        )}

        {!searching && message && (
          <div className="local-form-status">
            <p className="local-form-message" role="status">{message}</p>
            {retryAvailable && (
              <button
                type="button"
                onClick={() => {
                  requestSequence.current += 1;
                  setSearching(true);
                  setRetryAvailable(false);
                  setMessage(null);
                  setRetryVersion((current) => current + 1);
                }}
              >
                다시 시도
              </button>
            )}
          </div>
        )}

        <ul
          id={listboxId}
          className="local-search-results"
          aria-label="대한민국 행정구역 검색 결과"
          role="listbox"
          hidden={visibleResults.length === 0}
        >
          {visibleResults.map((result, index) => (
            <li
              id={`${listboxId}-option-${index}`}
              key={result.id}
              role="option"
              aria-selected={index === activeResultIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseSearchResult(result)}
              onMouseEnter={() => setActiveResultIndex(index)}
            >
              <span>{result.label}</span>
              <small>
                {result.alternateName ? `법정동 ${result.alternateName}` : "대표 위치"}
              </small>
            </li>
          ))}
        </ul>
        </div>
        </div>

        {/* The third way in. Both of the two above assume something a visitor
            may not have — a device inside Korea, or a place name they can type
            in Hangul, which is the only script Kakao's administrative search
            matches. Without these the two failure paths pointed at each other
            and there was no way through (#121). Achromatic on purpose: colour
            here belongs to the chance of rain, the amount, and the window. */}
        <div className="local-examples">
          <p className="local-examples-label" id="location-examples">바로 보기</p>
          <ul aria-labelledby="location-examples">
            {EXAMPLE_FORECAST_LOCATIONS.map((example) => (
              <li key={example.name}>
                <button
                  type="button"
                  onClick={() => commitChoice({
                    name: example.name,
                    latitude: example.latitude,
                    longitude: example.longitude,
                    // As with a search result: an area representative point
                    // carries no elevation, and inventing one would feed the
                    // station gate a number nobody measured.
                    elevationM: null,
                    selection: example.selection,
                  })}
                >
                  {example.short}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="local-privacy-note">
          <p>
            현재 위치 좌표는 예보를 위해 서버와 날씨 제공사에 전송되며, 계정이나 DB에
            저장하지 않습니다. 다시 열었을 때 바로 보여드리려고 마지막으로 선택한 위치만
            이 기기에 저장합니다. 예보 데이터는 좌표 기반으로 서버 메모리에 잠시 캐시될
            수 있습니다. 지역 검색어는 Kakao에 전달되며, 검색 응답은 저장하지 않습니다.
          </p>
          <p>검색 결과는 행정구역 또는 법정구역 대표 위치 · 지역 검색 Kakao Map</p>
        </div>
      </div>
    </section>
  );
}

/** Days the provider called wrong, over the days it was scored. */
function missedDays(score: LocalForecastView["evidence"]["scores"][number]): string {
  const missed = score.misses + score.falseAlarms;
  if (score.windowSampleCount <= 0) return `${missed}일`;
  return `${score.windowSampleCount}일 중 ${missed}일`;
}

/** The wet-day miss rate — where the real difference between services lives. */
function seedMissLabel(score: LocalForecastView["evidence"]["seedScores"][number]): string {
  if (score.wetDays <= 0) return "—";
  return `비 온 ${score.wetDays}일 중 ${score.misses}일`;
}

function benchmarkVerdict(
  benchmark: NonNullable<LocalForecastView["evidence"]["benchmark"]>,
): string | null {
  const { adaptiveBrier, equalBrier } = benchmark;
  if (adaptiveBrier === null || equalBrier === null) return null;
  if (adaptiveBrier < equalBrier) {
    return "최근 기록에서는 성능을 반영한 예보가 단순 평균보다 더 잘 맞았습니다.";
  }
  if (adaptiveBrier > equalBrier) {
    return "최근 기록에서는 단순 평균이 더 잘 맞아, 지금은 가중치를 세게 적용하지 않습니다.";
  }
  return "최근 기록에서는 두 방식이 비슷하게 맞았습니다.";
}

function PerformanceEvidence({ evidence, cohortLabel, recordHref }: {
  evidence: LocalForecastView["evidence"];
  cohortLabel: string;
  recordHref: string;
}) {
  const {
    status,
    statusLabel,
    station,
    comparisonSampleCount,
    emptyMessage,
    emptyDetail,
    scores,
    seedScores,
    benchmark,
  } = evidence;
  // Best-first by wet-day miss rate, matching the live table's "가장 잘 맞음" order.
  const seedRanked = [...seedScores].sort(
    (a, b) => a.misses / Math.max(1, a.wetDays) - b.misses / Math.max(1, b.wetDays),
  );
  // Rank only the providers that actually have a seven-day record, and only
  // against each other. Falling back to the 60-day score let a provider with no
  // recent history be labelled "가장 잘 맞음" under a 최근 7일 heading.
  const recent = scores
    .filter((score) => score.last7DaysBrier !== null)
    .sort((a, b) => (a.last7DaysBrier ?? 0) - (b.last7DaysBrier ?? 0));
  const unranked = scores.filter((score) => score.last7DaysBrier === null);
  const ranked = [...recent, ...unranked];
  const rankLabel = (score: LocalForecastView["evidence"]["scores"][number]): string => {
    const position = recent.indexOf(score);
    if (position < 0) return "최근 7일 기록 없음";
    return position === 0 ? "가장 잘 맞음" : `${position + 1}번째`;
  };
  const verdict = benchmark ? benchmarkVerdict(benchmark) : null;

  return (
    <section className="local-evidence-section" aria-labelledby="evidence-heading">
      <div className="local-section-heading">
        <div>
          <p className="local-kicker">기록 <span>— 근처 관측소로 채점한 성적</span></p>
          <h2 id="evidence-heading" tabIndex={-1}>
            {seedRanked.length > 0
              ? <>과거 기록에서<br />누가 더 잘 맞았나</>
              : <>최근 이 지역에서<br />누가 더 잘 맞았나</>}
          </h2>
        </div>
        {/* The status is the sentence people do not understand, so it is the
            way in: it opens the record that explains it, for this station. */}
        <a className={`local-status-pill is-${status}`} href={recordHref}>
          {statusLabel}
        </a>
      </div>

      <div className="local-evidence-meta">
        <div>
          <span>비교 관측소</span>
          <strong>{station ? `${station.name} · ${station.distanceKm.toFixed(1)}km` : "아직 연결되지 않음"}</strong>
        </div>
        <div>
          <span>채점 기간</span>
          {/* The recency half-life applies to live captures only. Seed evidence is
              a flat retrospective sample, so claiming it here would be false. */}
          <strong>
            {seedRanked.length > 0
              ? "과거 예보 기록 · 기간 전체를 같은 비중으로 반영"
              : "최근 60일 · 최근 예보일수록 크게 반영"}
          </strong>
        </div>
        <div>
          <span>비교한 예보</span>
          <strong>
            {comparisonSampleCount > 0
              ? seedRanked.length > 0
                ? `${comparisonSampleCount}일`
                : `${comparisonSampleCount}회 · ${cohortLabel}`
              : "수집 전"}
          </strong>
        </div>
      </div>

      {station && (
        <p className="local-method-note">
          관측소는 근처 기록일 뿐, 당신이 서 있는 위치가 아닙니다. 기상청 예보 격자는 5 km
          단위입니다.
        </p>
      )}

      {emptyMessage === null && seedRanked.length > 0 ? (
        <>
          <div className="local-score-table" role="table" aria-label="서비스별 과거 강수 예보 기록">
            <div className="local-score-row local-score-header" role="row">
              <span role="columnheader">서비스</span>
              <span role="columnheader">비를 놓친 날</span>
              <span role="columnheader">헛예보</span>
            </div>
            {seedRanked.map((provider) => (
              <div className="local-score-row" role="row" key={provider.id}>
                <strong role="cell">{provider.name}</strong>
                <span role="cell">{seedMissLabel(provider)}</span>
                <span role="cell">{provider.falseAlarms}일</span>
              </div>
            ))}
          </div>
          <p className="local-method-note">
            이 지역의 실시간 비교가 쌓이기 전이라, 과거 예보 기록으로 각 서비스를
            채점했습니다. ‘비를 놓친 날’은 실제로 비가 온 날 중 그 서비스가 비를
            예보하지 않은 날입니다. 확률이 아닌 예상 강수량으로만 채점했고, 이 지역에서
            실제 관측이 쌓이면 이 추정을 대체합니다.
          </p>
        </>
      ) : emptyMessage === null ? (
        <>
          <div className="local-score-table" role="table" aria-label="서비스별 최근 강수 예보 성능">
            <div className="local-score-row local-score-header" role="row">
              <span role="columnheader">서비스</span>
              <span role="columnheader">최근 7일</span>
              <span role="columnheader">빗나간 날</span>
            </div>
            {ranked.map((provider) => (
              <div className="local-score-row" role="row" key={provider.id}>
                <strong role="cell">{provider.name}</strong>
                <span role="cell">{rankLabel(provider)}</span>
                <span role="cell">{missedDays(provider)}</span>
              </div>
            ))}
          </div>

          <details className="local-score-detail">
            <summary>채점 원자료 자세히 보기</summary>
            <div className="local-score-scroll">
              <div className="local-score-table is-raw" role="table" aria-label="서비스별 채점 원자료">
                <div className="local-score-row local-score-header" role="row">
                  <span role="columnheader">서비스</span>
                  <span role="columnheader">최근 7일 Brier</span>
                  <span role="columnheader">60일 Brier</span>
                  <span role="columnheader">누락 · 오보</span>
                  <span role="columnheader">비 온 날 강수량 오차</span>
                </div>
                {ranked.map((provider) => (
                  <div className="local-score-row" role="row" key={provider.id}>
                    <strong role="cell">{provider.name}</strong>
                    <span role="cell">{provider.last7DaysBrier?.toFixed(3) ?? "—"}</span>
                    <span role="cell">{provider.windowBrier.toFixed(3)}</span>
                    <span role="cell">누락 {provider.misses} · 오보 {provider.falseAlarms}</span>
                    <span role="cell">
                      {provider.rainyAmountMae === null ? "—" : `${provider.rainyAmountMae.toFixed(1)} mm`}
                      {provider.rainyAmountSampleCount > 0 && ` · ${provider.rainyAmountSampleCount}일`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <p className="local-method-note">
              Brier 점수는 예보 확률이 실제와 얼마나 어긋났는지를 0에 가까울수록 좋게
              나타냅니다. ‘누락’은 비가 왔는데 낮게 본 날, ‘오보’는 비가 오지 않았는데
              높게 본 날입니다. 오전·오후 발표를 섞지 않고, 비가 오지 않은 날도 모두
              포함합니다. 최근 성능은 확률 예보의 영향만 조정하며 정확성을 보장하지
              않습니다.
            </p>
          </details>
        </>
      ) : (
        <div className="local-empty-evidence">
          <strong>{emptyMessage}</strong>
          {emptyDetail && <p>{emptyDetail}</p>}
        </div>
      )}

      {verdict && (
        <p className="local-benchmark-line">
          <b>{verdict}</b>
          <span>
            미리 정해둔 방식으로 두 계산법을 나란히 채점했습니다 · 성능 반영{" "}
            {benchmark?.adaptiveBrier?.toFixed(3) ?? "—"} · 단순 평균{" "}
            {benchmark?.equalBrier?.toFixed(3) ?? "—"}
          </span>
        </p>
      )}
    </section>
  );
}

/** "31° / 23°", with an em dash wherever a provider published no value. */
function formatRange(high: number | null, low: number | null): string {
  const one = (value: number | null) => (value === null ? "—" : `${Math.round(value)}°`);
  return `${one(high)} / ${one(low)}`;
}

/**
 * The amount, marked with its own provider count when that is not the card's.
 *
 * Not every compared service publishes a daily amount, so the amount is a mean of
 * fewer of them than the probability printed above it. The card's tag names the
 * probability's count, and letting it stand over both numbers claims a consensus
 * the amount does not have. When the two counts agree the tag is already accurate,
 * so the marker would be noise.
 */
/**
 * The small print under a card's mm figure. The provider count is the amount's
 * own — fewer services publish an amount than a probability, and one count
 * printed over both numbers would claim a consensus the amount does not have.
 */
function amountMeta(amountProviderCount: number, comparedProviderCount: number): string {
  if (amountProviderCount <= 0) return "양을 발표한 서비스 없음";
  return amountProviderCount === comparedProviderCount
    ? `${amountProviderCount}곳 평균`
    : `${amountProviderCount}곳 평균 · 확률은 ${comparedProviderCount}곳`;
}

/**
 * One block's one-line reading. Kept factual rather than advisory: the umbrella
 * advice belongs to the day, and repeating it eight times would assert an
 * hourly recommendation the daily blend never made.
 */
function blockHint(
  block: LocalForecastTimelineBlock,
  role: "onset" | "peak" | "wet" | "dry",
): string {
  if (block.precipMax === null) return "아직 발표되지 않았습니다. 0%가 아니라 값이 없는 것입니다.";
  if (role === "onset") return "여기서 비가 시작됩니다.";
  if (role === "peak") return "가장 높은 시간대입니다.";
  if (role === "wet") return "비 구간입니다.";
  if (block.precipMax === 0) return "비 예보 없음.";
  return "기준 아래입니다.";
}

/**
 * "오후 1시", "자정" — a Korean period name pairs with a 12-hour number, so the
 * raw 24-hour clock the blocks carry ("오후 13시") reads as a mistake.
 */
function clockLabel(hour: number): string {
  if (hour === 0) return "자정";
  const period = periodNameForHour(hour);
  return `${period} ${hour % 12 === 0 ? 12 : hour % 12}시`;
}

/** "2.6", "0", "12" — one decimal at most, no trailing zero, for mm figures. */
function formatMm(mm: number): string {
  return String(Math.round(mm * 10) / 10);
}

/** The rain window as the sentence the page leads with. */
function RainSentence({ run, endsTomorrow }: {
  run: TimelineReading["firstRun"];
  endsTomorrow: boolean;
}) {
  if (!run) return <>앞으로 24시간, <b>비 소식은 없습니다</b></>;
  const onset = run.startIndex === 0
    ? "지금부터"
    : `${run.startsTomorrow ? "내일 " : ""}${clockLabel(run.startHour)}부터`;
  if (!run.endsWithinWindow) {
    return <>비는 <b>{onset}</b><span className="local-answer-dim">, </span>예보 끝까지 이어집니다</>;
  }
  return (
    <>
      비는 <b>{onset}</b>
      <span className="local-answer-dim">, </span>
      <b>{endsTomorrow && !run.startsTomorrow ? "내일 " : ""}{clockLabel(run.endHour)}까지</b>
      {/* The total is the run's own sum from the ribbon's provider — the same
          claim as the window itself. It appears only when the series saw the
          rain stop AND every block in the run published an amount: an open run
          or a partial sum would claim a total the data never stated. */}
      {run.sumMm != null && (
        <span className="local-answer-mm">{" — 모두 "}<b>{formatMm(run.sumMm)}mm</b></span>
      )}
    </>
  );
}

function ForecastDashboard({ forecast, selection, onReset, recordHref }: {
  forecast: LocalForecastView;
  selection: ForecastLocationSelection;
  onReset(): void;
  recordHref: string;
}) {
  const locationDescription = describeForecastLocationSelection(selection);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const learned = forecast.blendMode === "learned";
  // Seed influence is real influence, so the bars are shown — but it comes from
  // past archives, not from measured skill at this station, and must not be
  // described as "최근 관측 성능".
  const seeded = forecast.blendMode === "seed";
  const weighted = learned || seeded;
  // Normalise first: an absent field is not the same as an explicit null, and
  // testing the raw value would report "오늘" while rendering tomorrow's numbers.
  const today = forecast.today ?? null;
  const tomorrow = forecast.recommendation;
  const timeline = forecast.timeline;
  const blocks = timeline?.blocks ?? [];
  const run = timeline?.reading.firstRun ?? null;
  const laterRun = timeline?.reading.laterRun ?? null;
  const peak = timeline?.reading.peak ?? null;

  // Which KST day each block belongs to, counted off the date dividers the view
  // model already marked. Lets the sentence say "내일 6시" when the run opens
  // today and closes after midnight.
  const dayOffsets: number[] = [];
  let dayOffset = 0;
  for (const block of blocks) {
    if (block.dayTag) dayOffset += 1;
    dayOffsets.push(dayOffset);
  }

  const spread = forecast.influence
    .map((provider) => provider.probability)
    .filter((probability): probability is number => probability !== null);
  const influenceMax = Math.max(...forecast.influence.map((p) => p.influence), 0);
  // The comparison stub repeats the influence card's header spread — the same
  // rounding, the same values, never a new claim.
  const spreadStub = spread.length > 1
    ? Math.round(Math.min(...spread)) === Math.round(Math.max(...spread))
      ? `내일 확률 모두 ${Math.round(spread[0])}%`
      : `내일 확률 ${Math.round(Math.min(...spread))}–${Math.round(Math.max(...spread))}%`
    : null;

  // The mm lane exists only when the ribbon's own provider published amounts.
  // Its scale is the lane's, never the probability's: capped to the wettest
  // block, floored at 2mm so a drizzle day doesn't render 0.2mm as a tower.
  const laneAmounts = blocks.map((block) => block.precipSumMm ?? null);
  const laneVisible = laneAmounts.some((amount) => amount !== null);
  const laneCapMm = laneVisible
    ? Math.max(2, Math.ceil(Math.max(...laneAmounts.filter((a): a is number => a !== null))))
    : 0;

  // 한눈에/전체 근거 (D-09). The toggle lives in the pinned mini-ribbon, so a
  // page with no timeline has no toggle and simply shows everything.
  const [glance, setGlance] = useState<boolean>(() => {
    // D-11: an unset preference opens at 한눈에 — the first visit gets the
    // answer before the receipts. A stored choice is never overridden, and a
    // browser that blocks storage is treated as always a first visit.
    try {
      const stored = window.localStorage.getItem(DENSITY_KEY);
      return stored === null ? true : stored === "glance";
    } catch {
      return true;
    }
  });
  const toggleGlance = () => {
    setGlance((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(DENSITY_KEY, next ? "glance" : "full");
      } catch {
        // Persistence is a convenience; losing it must not break the toggle.
      }
      return next;
    });
  };
  // A fold with no unfold control would be a locked door: the toggle lives in
  // the minibar, the minibar needs a timeline, so without one nothing folds.
  const folded = glance && timeline != null;
  // A stub unfolds to the section it summarizes. The scroll waits out the
  // render — the section exists only after the state flips.
  const revealTarget = useRef<string | null>(null);
  const unfold = (targetId: string) => {
    revealTarget.current = targetId;
    setGlance(false);
    try {
      window.localStorage.setItem(DENSITY_KEY, "full");
    } catch {
      // Same convenience contract as the toggle.
    }
  };
  useEffect(() => {
    if (glance || revealTarget.current === null) return;
    const target = document.getElementById(revealTarget.current);
    // The stub the user activated just unmounted; without this, focus falls to
    // <body> and a keyboard user re-tabs the whole page to reach the section
    // they asked for — the same failure the heading focus above guards against.
    target?.focus?.({ preventScroll: true });
    target?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    revealTarget.current = null;
  }, [glance]);

  // What the pinned bar says while the big graph is off screen: the run's own
  // numbers, already derived — never a new claim.
  const minibarSummary = run
    ? `${Math.round(run.peakProbability)}%${
        run.endsWithinWindow ? ` · ${clockLabel(run.endHour)}까지` : " · 예보 끝까지"
      }${run.sumMm != null ? ` · ${formatMm(run.sumMm)}mm` : ""}`
    : "비 소식 없음";

  const amountRange = forecast.tomorrowAmountRange ?? null;

  // The scrub readout (D-08): a lens over one block — every value it shows is
  // already printed in that block's column, so the floating card is a reading
  // aid, not the only access, and stays aria-hidden. Pointer sweeps it along
  // the grid; arrow keys walk it; Escape (or leaving) clears it.
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const scrubTo = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || blocks.length === 0) return;
    const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width - 1);
    setScrubIndex(Math.min(blocks.length - 1, Math.floor((x / rect.width) * blocks.length)));
  };
  const scrubByKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      setScrubIndex(null);
      return;
    }
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    setScrubIndex((current) => {
      const base = current ?? (delta === 1 ? -1 : blocks.length);
      return Math.min(blocks.length - 1, Math.max(0, base + delta));
    });
  };
  const scrubbed = scrubIndex !== null ? blocks[scrubIndex] ?? null : null;

  // The chooser this replaced is gone from the DOM, so without this the whole
  // swap leaves focus on <body> and a keyboard user restarts from the top.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <main className="local-dashboard">
      <div className="local-strip">
        <div className="local-strip-place">
          <span className="local-strip-pin" aria-hidden><LocationMark /></span>
          <b>{forecast.locationName}</b>
          {/* With a resolved place name, the source says how we got it. Without
              one it only repeats the name — "현재 위치 · 현재 기기 위치" tells the
              reader nothing — so show the accuracy instead.

              The phone strip hides this line to stay short across a sticky
              scroll. That is right while a name carries the location, and wrong
              without one: "현재 위치" alone qualifies nothing, so mark the case
              where this text is the only qualifier and let it through. */}
          <span
            className={`local-strip-meta${
              forecast.locationName === DEVICE_PLACEHOLDER_NAME ? " is-sole-qualifier" : ""
            }`}
          >
            {forecast.locationName === DEVICE_PLACEHOLDER_NAME
              ? locationDescription.precision
              : `${locationDescription.source} · ${locationDescription.precision}`}
          </span>
        </div>
        <div className="local-strip-now">
          {forecast.current && (
            <>
              <span className="local-strip-temp">{Math.round(forecast.current.temperature)}°</span>
              <span className="local-strip-meta">
                {CONDITION_LABELS_KO[forecast.current.condition]} · KST
              </span>
            </>
          )}
          <button type="button" onClick={onReset}>위치 바꾸기</button>
        </div>
      </div>

      <section className="local-answer" aria-labelledby="forecast-heading">
        <p className="local-kicker">결론 <span>— 앞으로 24시간, 한 문장으로</span></p>
        <h1 id="forecast-heading" ref={headingRef} tabIndex={-1}>
          {timeline
            ? <RainSentence run={run} endsTomorrow={run !== null && dayOffsets[run.endIndex] > 0} />
            : <>{today ? "오늘" : "내일"} 비가 올까요?</>}
        </h1>
        {timeline && (
          <p className="local-answer-sub">
            {peak && <span>최대 <b className="is-wet">{Math.round(peak.probability)}%</b> · {peak.rangeLabel}</span>}
            {run && <span>지속 <b>{run.durationHours}시간</b></span>}
            {tomorrow.precipitationAmountMm !== null && (
              <span>내일 예상 강수량 <b>{tomorrow.precipitationAmountMm.toFixed(1)} mm</b></span>
            )}
            <span>{timeline.threshold}% 넘는 시간대를 비 구간으로 봅니다</span>
          </p>
        )}
        <p className="local-answer-action">
          {rainAction(
            // The section is the timeline's, so the advice follows the timeline's
            // peak where there is one; the blended day probability is a different
            // number from a different set of sources and would contradict it.
            timeline ? (peak?.probability ?? null) : (today ?? tomorrow).precipitationProbability,
            (today ?? tomorrow).precipitationAmountMm,
            timeline?.threshold ?? RAIN_ONSET_PROBABILITY,
          )}
          {laterRun && ` 이후 ${laterRun.startsTomorrow ? "내일 " : ""}${laterRun.startHour}시부터 다시 비 구간입니다.`}
        </p>
      </section>

      {/* The graph is the nav (D-09): a miniature of the ribbon pins to the top
          while the page scrolls, with the density toggle riding beside it. */}
      {timeline && (
        <div className="local-minibar">
          <div className="local-minibar-in">
            <span className="local-minibar-k" aria-hidden>24H</span>
            <button
              type="button"
              className="local-minibar-spark"
              aria-label="맨 위 타임라인으로 이동"
              onClick={() => headingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              {blocks.map((block) => block.precipMax === null
                ? <i key={block.rangeLabel} className="is-na" />
                : (
                  <i
                    key={block.rangeLabel}
                    className={block.wet ? "is-wet" : undefined}
                    style={{ "--h": `${Math.max(8, Math.round(block.precipMax))}%` } as CSSProperties}
                  />
                ))}
            </button>
            <span className="local-minibar-sum">{minibarSummary}</span>
            <button
              type="button"
              className="local-minibar-tgl"
              aria-pressed={glance}
              onClick={toggleGlance}
            >
              {glance
                ? <>전체 근거 보기<span className="local-minibar-tgl-cargo"> · 비교 + 기록</span></>
                : "한눈에 보기"}
            </button>
          </div>
        </div>
      )}

      {timeline && (
        <section className="local-ribbon" aria-labelledby="ribbon-heading">
          <div className="local-ribbon-head">
            <h2 id="ribbon-heading" className="local-ribbon-src">
              <i aria-hidden />시간대 강수확률 · {timeline.sourceName} 단독 예보
            </h2>
            <span className="local-ribbon-note">
              3시간 블록 {blocks.length}개
            </span>
          </div>

          <div className="local-ribbon-scroll">
            {/* is-sweeping: the one arrival animation (D-08) — the recorder
                prints its trace left→right in block steps, then never moves
                again. CSS-driven, so prefers-reduced-motion strips it whole. */}
            <div
              className="local-ribbon-grid is-sweeping"
              style={{ "--cols": blocks.length } as CSSProperties}
              tabIndex={0}
              aria-label="시간대 블록 탐색 · 좌우 화살표로 이동"
              onPointerMove={scrubTo}
              onPointerDown={scrubTo}
              onPointerLeave={() => setScrubIndex(null)}
              onKeyDown={scrubByKey}
              onBlur={() => setScrubIndex(null)}
            >
              {scrubbed && scrubIndex !== null && (
                <div
                  className="local-ribbon-readout"
                  aria-hidden
                  style={{ left: `${((scrubIndex + 0.5) / blocks.length) * 100}%` }}
                >
                  <b>{scrubbed.label} {scrubbed.rangeLabel}{scrubbed.wet ? " · 비 구간" : ""}</b>
                  <span>
                    {scrubbed.precipMax === null ? "확률 미발표" : `확률 ${Math.round(scrubbed.precipMax)}%`}
                    {scrubbed.precipSumMm != null && ` · 강수 ${formatMm(scrubbed.precipSumMm)}mm`}
                  </span>
                </div>
              )}
              {blocks.map((block, index) => {
                const probability = block.precipMax;
                const empty = probability === null;
                const isOnset = run !== null && index === run.startIndex;
                const isPeak = probability !== null && peak !== null && probability === peak.probability;
                const role = empty ? "dry" : isOnset ? "onset" : isPeak ? "peak" : block.wet ? "wet" : "dry";
                return (
                  <div
                    className={`local-ribbon-col${block.wet ? " is-wet" : ""}${block.dayTag ? " is-daybreak" : ""}${scrubIndex === index ? " is-scrubbed" : ""}`}
                    key={block.rangeLabel}
                  >
                    {block.dayTag && <span className="local-ribbon-daytag">{block.dayTag}</span>}
                    <span className="local-ribbon-chead">
                      <span className="local-ribbon-per">{block.label}</span>
                      <span className="local-ribbon-rng">{block.rangeLabel}</span>
                    </span>
                    <span
                      className={`local-ribbon-track${empty ? " is-na" : ""}`}
                      style={{ "--threshold": `${timeline.threshold}%` } as CSSProperties}
                    >
                      {index === 0 && (
                        <span className="local-ribbon-rule" aria-hidden>{timeline.threshold}%</span>
                      )}
                      {probability === null
                        ? <span className="local-ribbon-na">미발표</span>
                        : (
                          <span
                            className={`local-ribbon-bar${probability === 0 ? " is-zero" : ""}`}
                            style={{ "--h": `${Math.round(probability)}%` } as CSSProperties}
                          />
                        )}
                    </span>
                    <span className="local-ribbon-cfoot">
                      <span className={`local-ribbon-val${empty ? " is-na" : ""}`}>
                        {probability === null ? "—" : <>{Math.round(probability)}<span>%</span></>}
                      </span>
                      <span className="local-ribbon-hint">{blockHint(block, role)}</span>
                    </span>
                    {laneVisible && (
                      <span className="local-ribbon-mm">
                        <span className={`local-ribbon-mmval${block.precipSumMm == null ? " is-na" : ""}`}>
                          {block.precipSumMm == null ? "—" : formatMm(block.precipSumMm)}
                        </span>
                        <span
                          className={`local-ribbon-mmtrack${block.precipSumMm == null ? " is-na" : ""}`}
                          aria-hidden
                        >
                          {block.precipSumMm != null && (
                            <i
                              className={block.precipSumMm === 0 ? "is-zero" : undefined}
                              style={{ "--h": `${Math.min(100, Math.round((block.precipSumMm / laneCapMm) * 100))}%` } as CSSProperties}
                            />
                          )}
                        </span>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="local-ribbon-axis" aria-hidden>
              {blocks.map((block) => <span key={block.rangeLabel}>{block.startHour}</span>)}
              <span>{blocks[blocks.length - 1].endHour}시</span>
            </div>
            {laneVisible && (
              <div className="local-ribbon-mmlab">
                <span><i aria-hidden />강수량 mm · 같은 출처 · 확률과 다른 축</span>
                <span>0–{laneCapMm}mm</span>
              </div>
            )}
          </div>
          <p className="local-ribbon-swipe">← 옆으로 밀어 24시간 전체 보기</p>
        </section>
      )}

      <p className="local-kicker">{today ? "오늘 · 내일" : "내일"} <span>— 여러 서비스를 섞은 하루 숫자</span></p>
      <div className="local-days">
        {today && (
          <section className="local-day" aria-labelledby="today-heading">
            <div className="local-day-head">
              <h2 id="today-heading" className="local-day-when">
                오늘 <span>{formatDate(today.date)}</span>
              </h2>
              <span className="local-tag">{forecast.comparedProviderCount}개 서비스 동일 비중</span>
            </div>
            <div className="local-day-nums">
              <p className="local-day-value">
                {today.precipitationProbability === null
                  ? "—"
                  : <>{Math.round(today.precipitationProbability)}<span>%</span></>}
              </p>
              <p className="local-day-mm">
                {today.precipitationAmountMm === null
                  ? <b className="is-na">—</b>
                  : <b>{formatMm(today.precipitationAmountMm)}mm</b>}
                <small>{amountMeta(today.amountProviderCount, forecast.comparedProviderCount)}</small>
              </p>
            </div>
            <p className="local-day-row">
              <span>{formatRange(today.temperatureMax, today.temperatureMin)}</span>
              <span>{CONDITION_LABELS_KO[today.condition]}</span>
            </p>
            {/* The learned profile scores next-day forecasts only, so today's
                number is always a plain average — claiming otherwise would
                assert an accuracy nothing has measured. */}
            <p className="local-day-why">
              오늘은 <b>성능 가중을 쓰지 않습니다.</b> 관측소 기록은 익일 예보만 채점하므로,
              오늘 숫자에 얹으면 검증되지 않은 정확도 주장이 됩니다.
            </p>
          </section>
        )}

        <section
          className={`local-day${weighted ? " is-weighted" : ""}`}
          aria-labelledby="tomorrow-heading"
        >
          <div className="local-day-head">
            <h2 id="tomorrow-heading" className="local-day-when">
              내일 <span>{formatDate(forecast.targetDate)}</span>
            </h2>
            <span className={`local-tag${weighted ? " is-weighted" : ""}`}>
              {forecast.comparedProviderCount}개 서비스{" "}
              {weighted ? (seeded ? "과거 기록 가중" : "성능 가중") : "동일 비중"}
            </span>
          </div>
          <div className="local-day-nums">
            <p className="local-day-value">
              {tomorrow.precipitationProbability === null
                ? "—"
                : <>{Math.round(tomorrow.precipitationProbability)}<span>%</span></>}
            </p>
            <p className="local-day-mm">
              {tomorrow.precipitationAmountMm === null
                ? <b className="is-na">—</b>
                : <b>{formatMm(tomorrow.precipitationAmountMm)}mm</b>}
              <small>
                {amountMeta(tomorrow.amountProviderCount, forecast.comparedProviderCount)}
                {/* The extremes are named members, not percentiles — n≤4 cannot
                    honestly support interval language. */}
                {amountRange &&
                  ` · 많으면 ${formatMm(amountRange.maxMm)}mm (${amountRange.maxName}) · 적으면 ${formatMm(amountRange.minMm)}mm (${amountRange.minName})`}
              </small>
            </p>
          </div>
          <p className="local-day-row">
            <span>{formatRange(tomorrow.temperatureMax, tomorrow.temperatureMin)}</span>
            <span>{CONDITION_LABELS_KO[tomorrow.condition]}</span>
          </p>
          <p className="local-day-why">
            {seeded
              ? "이 지역의 실시간 비교가 쌓이기 전이라, 과거 예보 기록으로 추정한 적중률을 일부만 반영했습니다."
              : learned
                ? <>관측소 {forecast.evidence.station?.name ?? "근처 관측소"}의 <b>{forecast.evidence.comparisonSampleCount}일 기록</b>을 반영했습니다.</>
                : "아직 이 지역의 성능 기록이 없어 서비스를 동일 비중으로 평균했습니다."}
            {timeline && " 위 리본과는 계산도 출처도 다릅니다."}
          </p>
        </section>
      </div>

      <div className="local-receipts">
      {folded ? (
        <div className="local-stubs">
          <button type="button" className="local-stub" aria-expanded={false} onClick={() => unfold("influence-heading")}>
            <span><b>서비스 {forecast.comparedProviderCount}곳 비교</b>{spreadStub && <> — {spreadStub}</>}</span>
            <span className="local-stub-go">펼치기</span>
          </button>
          {forecast.outlook.length > 1 && (
            <button type="button" className="local-stub" aria-expanded={false} onClick={() => unfold("outlook-heading")}>
              <span><b>{forecast.outlook.length}일 전망</b> — 모레부터는 동일 비중 평균</span>
              <span className="local-stub-go">펼치기</span>
            </button>
          )}
          <button type="button" className="local-stub" aria-expanded={false} onClick={() => unfold("evidence-heading")}>
            <span><b>과거 기록</b> — {forecast.evidence.statusLabel}</span>
            <span className="local-stub-go">펼치기</span>
          </button>
        </div>
      ) : (<>
      <p className="local-kicker">근거 <span>— 이 숫자가 나온 방식</span></p>
      <div className="local-evidence-cards">
        <section className="local-card" aria-labelledby="influence-heading">
          <div className="local-card-head">
            <h2 id="influence-heading" tabIndex={-1}>서비스 {forecast.comparedProviderCount}곳 · 내일</h2>
            {spread.length > 1 && (
              <b>편차 {Math.round(Math.min(...spread))}–{Math.round(Math.max(...spread))}%</b>
            )}
          </div>
          <div className="local-prov">
            {forecast.influence.map((provider) => (
              <div
                className={`local-prow${weighted && provider.influence === influenceMax ? " is-best" : ""}`}
                key={provider.id}
              >
                <span className="local-prow-n">{provider.name}</span>
                {/* The bar is the provider's own probability, so it tracks the
                    number beside it. Drawing the blend weight here instead made
                    four near-equal bars sit next to four very different
                    percentages. */}
                <span
                  className="local-meter"
                  style={{ "--w": `${provider.probability ?? 0}%` } as CSSProperties}
                  aria-hidden
                >
                  <i />
                </span>
                <span className="local-prow-v">{probabilityLabel(provider.probability)}</span>
                <span className="local-prow-w">비중 {Math.round(provider.influence * 100)}%</span>
              </div>
            ))}
          </div>
          <p className="local-card-why">
            {weighted
              ? <>막대는 각 서비스가 내다본 내일 강수확률입니다. 비중은 이 예보에서 그 값이 차지한 몫으로, {seeded ? "과거 기록으로 추정한 적중률" : "최근 이 지역의 적중률"}에 따라 다릅니다.</>
              : "막대는 각 서비스가 내다본 내일 강수확률입니다. 아직 이 지역의 성능 기록이 없어, 모든 서비스를 똑같은 비중으로 평균했습니다."}
          </p>
        </section>

        {forecast.outlook.length > 1 && (
          <section className="local-card" aria-labelledby="outlook-heading">
            <div className="local-card-head">
              <h2 id="outlook-heading" tabIndex={-1}>{forecast.outlook.length}일 전망</h2>
              <b>동일 비중</b>
            </div>
            <div className="local-week">
              {forecast.outlook.map((day) => (
                <div className="local-wd" key={day.date}>
                  <span className="local-wd-d">{formatOutlookDate(day.date)}</span>
                  <span className="local-wd-b">
                    <i style={{ "--h": `${Math.round(day.precipitationProbability ?? 0)}%` } as CSSProperties} />
                  </span>
                  <span className="local-wd-v">{probabilityLabel(day.precipitationProbability)}</span>
                </div>
              ))}
            </div>
            <p className="local-card-why">
              성능 가중은 <b>내일 하루에만</b> 적용됩니다. 모레부터는 서비스를 그대로 평균한 값입니다.
            </p>
          </section>
        )}
      </div>

      <PerformanceEvidence
        evidence={forecast.evidence}
        cohortLabel={forecast.cohortLabel}
        recordHref={recordHref}
      />
      </>)}
      </div>

      <footer className="local-footer">
        <p>출처 Open-Meteo · 기상청 · Pirate Weather · WeatherAPI · Visual Crossing 중 응답한 서비스 · 모든 시각 KST</p>
        <p>관측 검증: 기상청 ASOS · 사용자 위치는 서버에 저장하지 않음</p>
        {timeline && (
          <p>
            시간대 확률은 {timeline.sourceName} 한 곳의 값이고, 오늘·내일 확률은 여러 곳을 섞은
            값입니다. 같은 주장이 아닙니다.
          </p>
        )}
        {/* The only way into the scoring record. A page nothing links to is a
            page nobody reads, and the claim it carries is the product's. */}
        <p>
          <a className="local-footer-link" href={recordHref}>
            이 예보를 어떻게 채점하는가 →
          </a>
        </p>
      </footer>
    </main>
  );
}

export default function LocalForecastExperience() {
  const [state, setState] = useState<ViewState>({ kind: "idle" });
  const [returningToChooser, setReturningToChooser] = useState(false);
  const chooseRef = useRef<((input: ChosenForecastLocation, push: boolean) => void) | null>(null);
  // Every path out of the loading screen bumps this. A response that arrives
  // after the user has left must not paint a dashboard over the view they went
  // to, leaving the URL and stored location describing something else.
  const generation = useRef(0);
  // Whether what is on screen is the place this device saved. A forecast opened
  // from someone else's share link is not, so dismissing it must not delete the
  // user's own saved location.
  const showingStoredLocation = useRef(false);

  const chooseLocation = async (input: ChosenForecastLocation, push = true) => {
    const attempt = (generation.current += 1);
    setState({ kind: "loading", label: input.name });
    try {
      const { selection, ...forecastInput } = input;
      const forecast = await loadForecast(forecastInput);
      if (attempt !== generation.current) return;
      // Commit to history and storage only once the coordinate is known to
      // work. Saving first meant a permanently rejected coordinate reproduced
      // its own error screen on every later visit.
      if (push && typeof window !== "undefined") {
        const search = shareableSearch(input);
        window.history.pushState(
          { raintodayView: "forecast", location: input },
          "",
          search ?? window.location.pathname,
        );
        writeStoredLocation(input);
        showingStoredLocation.current = true;
      }
      setState({ kind: "ready", forecast, selection, location: input });
    } catch (error) {
      if (attempt !== generation.current) return;
      setState(
        error instanceof ForecastOutOfServiceAreaError
          ? {
              kind: "error",
              message: "이 위치는 대한민국 서비스 지역 밖이에요. 대한민국 안의 지역을 고르면 바로 예보를 볼 수 있어요.",
              retry: null,
            }
          : {
              kind: "error",
              message: "이 위치의 예보를 불러오지 못했어요.",
              retry: input,
            },
      );
    }
  };
  // Declared before the mount effect so it has already run when the restore
  // below fires, and re-run every render so popstate always calls the current
  // closure rather than the one captured on mount.
  useEffect(() => {
    chooseRef.current = (input, push) => void chooseLocation(input, push);
  });

  const returnToChooser = (push: boolean) => {
    generation.current += 1;
    // Dismissing the saved place is a statement that it is not the place, so it
    // clears the restore. Dismissing someone else's share link is not, and must
    // leave this device's own saved location alone.
    if (showingStoredLocation.current) {
      clearStoredLocation();
      showingStoredLocation.current = false;
    }
    if (push && typeof window !== "undefined") {
      window.history.pushState({ raintodayView: "chooser" }, "", window.location.pathname);
    }
    setReturningToChooser(true);
    setState({ kind: "idle" });
  };

  // Restore on arrival: a link with coordinates wins, then whatever this device
  // last looked at. Without either, the chooser is the honest first screen.
  useEffect(() => {
    const fromLink = locationFromSearch(window.location.search);
    const stored = fromLink ? null : readStoredLocation();
    const restored = fromLink ?? stored;
    if (restored) {
      showingStoredLocation.current = stored !== null;
      // Stamp the entry the user landed on, so going Back to it later restores
      // this forecast instead of falling through to the chooser.
      window.history.replaceState(
        { raintodayView: "forecast", location: restored },
        "",
        window.location.href,
      );
      chooseRef.current?.(restored, false);
    }

    const onPopState = (event: PopStateEvent) => {
      const entry = event.state as
        | { raintodayView?: string; location?: ChosenForecastLocation }
        | null;
      // A device fix carries no query string, so its history entry is
      // indistinguishable from the chooser's by URL alone. The pushed state is
      // what tells them apart.
      if (entry?.raintodayView === "chooser") {
        generation.current += 1;
        setReturningToChooser(true);
        setState({ kind: "idle" });
        return;
      }
      const target = locationFromSearch(window.location.search)
        ?? (entry?.raintodayView === "forecast" ? entry.location ?? null : null);
      if (target) {
        chooseRef.current?.(target, false);
      } else {
        generation.current += 1;
        setReturningToChooser(true);
        setState({ kind: "idle" });
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Lifted out of the JSX so the narrowing survives into the click handler.
  const errorRetry = state.kind === "error" ? state.retry : null;

  const announcement = state.kind === "loading"
    ? `${state.label}의 예보를 불러오는 중입니다.`
    : state.kind === "ready"
      ? `${state.forecast.locationName}의 ${state.forecast.today ? "오늘" : "내일"} 예보를 표시했습니다.`
      : state.kind === "error"
        ? state.message
        : "";

  return (
    <div className="local-forecast-page">

      {/* One region that outlives every view swap. Mounting the status inside
          the view that replaces it meant the arrival was never announced. */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      <header className="local-site-header">
        <button
          type="button"
          onClick={() => returnToChooser(true)}
          aria-label="처음으로 · 위치 다시 선택"
        >
          <span className="local-wordmark">오늘비</span>
          <small>전국 로컬 예보</small>
        </button>
        <span className="local-live-mark"><i /> KST · LIVE SOURCES</span>
      </header>

      {(state.kind === "idle" || state.kind === "loading") && (
        <LocationChooser
          autoFocus={returningToChooser}
          onChoose={(input) => void chooseLocation(input)}
          busy={state.kind === "loading"}
        />
      )}

      {/* An overlay, not a replacement: unmounting the whole page left a black
          screen with one line on it, which reads as a crash on a slow phone.
          No role here — the persistent region above already announces this, and
          two announcers read one change out twice. */}
      {state.kind === "loading" && (
        <div className="local-loading is-overlay">
          <p className="local-loading-place">{state.label}</p>
          <p className="local-loading-lead">
            예보 <b>{COMPARED_PROVIDER_NAMES.length}곳</b>을 불러오는 중입니다
          </p>
          {/* Names, not a spinner: the wait is spent contacting exactly these, and
              a neutral spinner hides the one honest thing happening. No
              per-provider state — the API answers once, so a row that claimed
              to know which of them had replied would be inventing it. */}
          <p className="local-loading-names">{COMPARED_PROVIDER_NAMES.join(" · ")}</p>
          {/* The empty instrument, pulsing as one whole: the response arrives
              once, so the only honest animation is the frame waiting — never a
              per-provider progress row. */}
          <div className="local-instrument-empty is-waiting" aria-hidden>
            <div className="local-instrument-empty-lab">
              <span>시간대 강수확률 · 강수량</span>
              <span>0–100% · MM</span>
            </div>
            <div className="local-instrument-empty-grid">
              <span>응답한 서비스를 한 번에 그립니다</span>
            </div>
          </div>
          <p className="local-loading-note">
            응답하지 않는 서비스는 비교에서 빠집니다. 값을 지어내지 않습니다.
          </p>
        </div>
      )}

      {state.kind === "error" && (
        <div className="local-state-card">
          {/* Two failures, two shapes. `retry` is null exactly when the same
              request can never succeed, so that card offers no retry and says
              why rather than leaving a button that is guaranteed to fail. */}
          <p className="local-state-kicker">
            {errorRetry ? "예보를 불러오지 못함" : "서비스 지역 밖"}
          </p>
          <h1 className="local-state-heading">{state.message}</h1>
          <p className="local-state-body">
            {errorRetry
              ? "네트워크나 예보 서비스 쪽 문제일 수 있습니다. 다시 시도하면 같은 좌표로 다시 요청합니다."
              : "오늘비는 대한민국 행정구역 안의 좌표만 예보합니다. 같은 좌표로 다시 요청해도 결과는 같으므로, 지역을 다시 고르는 것만 보여드립니다."}
          </p>
          <div className="local-error-actions">
            {/* A provider being briefly down says nothing about the location,
                so retrying the same one is the first thing to offer. */}
            {errorRetry && (
              <button
                type="button"
                className="is-primary"
                onClick={() => void chooseLocation(errorRetry, false)}
              >
                다시 시도
              </button>
            )}
            <button
              type="button"
              className={errorRetry ? undefined : "is-primary"}
              onClick={() => returnToChooser(false)}
            >
              {errorRetry ? "위치 바꾸기" : "지역 다시 고르기"}
            </button>
          </div>
          <p className="local-state-why">
            {errorRetry
              ? "저장된 위치는 지우지 않았습니다."
              : "이 좌표는 기기에 저장하지 않았습니다."}
          </p>
        </div>
      )}

      {state.kind === "ready" && (
        <ForecastDashboard
          forecast={state.forecast}
          selection={state.selection}
          onReset={() => returnToChooser(true)}
          recordHref={recordHrefFor(state.location, state.forecast.evidence.station?.id)}
        />
      )}
    </div>
  );
}
