"use client";

import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { CONDITION_LABELS_KO } from "@/lib/conditions";
import { EXAMPLE_FORECAST_LOCATIONS } from "@/lib/exampleLocations";
import { periodNameForHour } from "@/lib/forecast/blocks";
import { readUmbrellaEvidence } from "@/lib/forecast/advisory";
import { kstStamp } from "@/lib/forecast/hourlyComparison";
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
import { ForecastComparisonDetail, HourlyForecastComparison, hourlyProbabilityText, useForecastClock, useHourlyRibbon } from "./HourlyForecastComparison";
import { useLocationCandidateSearch } from "./useLocationCandidateSearch";

type ViewState =
  | { kind: "idle" }
  | { kind: "loading"; label: string }
  | {
      kind: "ready";
      forecast: LocalForecastView;
      selection: ForecastLocationSelection;
      location: ChosenForecastLocation;
      entry: ForecastEntry;
    }
  // Carries the input to retry, or null when retrying can never help — so the
  // view cannot offer a button it has no way to act on.
  | { kind: "error"; message: string; retry: ForecastIntent | null };

interface ChosenForecastLocation {
  name: string;
  latitude: number;
  longitude: number;
  elevationM: number | null;
  selection: ForecastLocationSelection;
}

interface ForecastEntry {
  id: string;
  location: ChosenForecastLocation;
  forecast: LocalForecastView;
  receivedAt: number;
  stored: boolean;
  reading?: { top: number; focus: string; period: number | null };
}

interface ForecastIntent {
  location: ChosenForecastLocation;
  mode: "select" | "restore" | "refresh";
  entry?: ForecastEntry;
  stored?: boolean;
}

// This module is retained during Next navigation in the same tab. History
// carries only an opaque ID; the response and full device fix stay in memory.
const retainedForecasts = new Map<string, ForecastEntry>();
function rememberForecast(entry: ForecastEntry) {
  retainedForecasts.delete(entry.id);
  retainedForecasts.set(entry.id, entry);
  const oldest = retainedForecasts.keys().next().value;
  if (retainedForecasts.size > 8 && oldest !== undefined) retainedForecasts.delete(oldest);
}

function plainClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function writeForecastHistory(view: { raintodayView: "chooser" | "forecast"; forecastEntry?: string; forecastDetail?: boolean }, url: string, replace: boolean) {
  const state = { ...window.history.state, ...view };
  delete state.location;
  if (view.raintodayView === "chooser") delete state.forecastEntry;
  if (!view.forecastDetail) delete state.forecastDetail;
  if (replace) window.history.replaceState(state, "", url);
  else window.history.pushState(state, "", url);
}

/**
 * The forecast providers, in the order AGENTS.md pins them. The chooser states
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

function probabilityLabel(probability: number | null): string {
  if (probability === null) return "미발표";
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

/** GPS links carry only the public matched station; searched areas remain shareable. */
function recordHrefFor(input: ChosenForecastLocation, stationId: string | undefined, entry: string): string {
  if (input.selection.kind === "device") {
    return `/behind-the-data?${new URLSearchParams({ station: stationId ?? "none", entry })}`;
  }
  const params = new URLSearchParams({
    lat: input.latitude.toFixed(5),
    lon: input.longitude.toFixed(5),
    name: input.name,
    area: input.selection.areaKind === "legal-area" ? "b" : "h",
    entry,
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
  if (["lat", "lon", "name", "area"].some((key) => params.getAll(key).length > 1)) return null;
  if (area !== null && area !== "b" && area !== "h") return null;
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
}, signal: AbortSignal): Promise<LocalForecastView> {
  const response = await fetch("/api/local-forecast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
    signal,
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

// The no-break space ties each dot to the name before it, so a wrapped list
// never opens its next line with a separator.
// Keep provider names together in the shared source list.
const keepWhole = (text: string): string => text.replace(/ /g, "\u00a0");
const providerList = COMPARED_PROVIDER_NAMES.map(keepWhole).join("\u00a0· ");

export function LocationChooser({ onChoose, autoFocus = false, busy = false }: {
  onChoose(input: ChosenForecastLocation): void;
  autoFocus?: boolean;
  /** A forecast is loading over this view; dim it and take it out of the tab order. */
  busy?: boolean;
}) {
  const search = useLocationCandidateSearch();
  const { query, results } = search;
  const [expanded, setExpanded] = useState(true);
  const [notice, setMessage] = useState<string | null>(null);
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const [locating, setLocating] = useState(false);
  const listboxId = useId();
  const searching = search.status === "searching";
  const retryAvailable = expanded && search.retryAvailable;
  const searchMessages = {
    "too-short": "지역 이름을 두 글자 이상 입력해 주세요.",
    invalid: "검색어를 인식하지 못했어요. 시\u2060·\u2060구\u2060·\u2060동 이름으로 더 짧게 입력해 주세요.",
    "rate-limited": "검색 요청이 많아요. 잠시 후 다시 시도해 주세요.",
    "not-configured": "이곳에서는 지역 검색을 쓸 수 없어요. 아래 예시나 위의 ‘\u2060내\u00a0위치로\u00a0보기’를 사용해 주세요.",
    unavailable: "지역 검색이 잠시 원활하지 않아요. 다시 시도해 주세요.",
    empty: "대한민국 안에서 일치하는 행정구역을 찾지 못했어요. 시\u2060·\u2060구\u2060·\u2060동을 함께 입력해 보세요.",
  };
  const message = notice ?? (expanded && search.status in searchMessages
    ? searchMessages[search.status as keyof typeof searchMessages]
    : null);
  const messageShown = !searching && message !== null;
  const [messageHeld, setMessageHeld] = useState(false);
  if (messageShown && !messageHeld) setMessageHeld(true);
  if (!messageShown && messageHeld && query.trim() === "") setMessageHeld(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resultsRef = useRef<HTMLUListElement | null>(null);
  const revealKeyboardResult = useRef(false);
  const fixGeneration = useRef(0);
  const composing = useRef(false);
  const [composition, setComposition] = useState<string | null>(null);
  useEffect(() => () => { fixGeneration.current += 1; }, []);

  // Returning from a forecast puts the user back here on purpose, so land them
  // on the control they came back to use. Never on first paint — auto-focusing
  // a search field on load pops the keyboard on a phone.
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const visibleResults = expanded ? results : [];

  useLayoutEffect(() => {
    const revealInViewport = revealKeyboardResult.current;
    revealKeyboardResult.current = false;
    const list = resultsRef.current;
    const option = list?.children[activeResultIndex];
    if (!expanded || !list || !option) return;
    const bounds = list.getBoundingClientRect();
    const selected = option.getBoundingClientRect();
    const top = bounds.top + list.clientTop;
    const bottom = top + list.clientHeight;
    // Typing and refreshed matches scroll only the popup. Explicit arrow
    // navigation may also reveal an option below the phone's visible screen.
    if (selected.top < top) list.scrollTop += selected.top - top;
    else if (selected.bottom > bottom) list.scrollTop += selected.bottom - bottom;
    if (revealInViewport) {
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const visibleOption = option.getBoundingClientRect();
      if (visibleOption.bottom > viewportBottom) {
        window.scrollBy({ top: visibleOption.bottom - viewportBottom, behavior: "instant" });
      } else if (visibleOption.top < viewportTop) {
        window.scrollBy({ top: visibleOption.top - viewportTop, behavior: "instant" });
      }
    }
  }, [activeResultIndex, expanded, results]);

  // An in-flight search must not land on top of a coordinate the visitor has
  // already committed, whichever of the two ways in they took.
  const commitChoice = (choice: ChosenForecastLocation) => {
    fixGeneration.current += 1;
    search.cancel();
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
    const fix = ++fixGeneration.current;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (fix !== fixGeneration.current) return;
        setLocating(false);
        commitChoice({
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
        });
      },
      () => {
        if (fix !== fixGeneration.current) return;
        setLocating(false);
        setMessage("위치를 확인하지 못했어요. 권한을 확인하거나 아래에서 지역을 골라 주세요.");
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 },
    );
  };

  return (
    <main
      className={`local-chooser${busy ? " is-busy" : ""}`}
      aria-labelledby="location-heading"
      inert={busy || undefined}
    >
      <div className="local-chooser-copy">
        <p className="local-eyebrow">대한민국 로컬 강수 예보</p>
        {/* Day-agnostic on purpose: the forecast now opens on today and carries
            tomorrow beside it, so naming one day in the promise would be wrong
            again the moment the other is on screen. */}
        <h1 id="location-heading">오늘 <b>우산이 필요할까요?</b></h1>
        <p>
          지역을 고르면 오늘 비 오는 시간대와 우산 안내를 볼 수 있어요.
        </p>
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
            if (composing.current) return;
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
            value={composition ?? query}
            onChange={(event) => {
              if (composing.current) {
                setComposition(event.target.value);
                return;
              }
              if (event.target.value === query) return;
              revealKeyboardResult.current = false;
              search.updateQuery(event.target.value);
              setExpanded(true);
              setActiveResultIndex(0);
              setMessage(null);
            }}
            onCompositionStart={(event) => {
              composing.current = true;
              search.cancel();
              setExpanded(false);
              setComposition(event.currentTarget.value);
            }}
            onCompositionEnd={(event) => {
              composing.current = false;
              setComposition(null);
              search.updateQuery(event.currentTarget.value);
              setActiveResultIndex(0);
              setExpanded(true);
              setMessage(null);
            }}
            placeholder="동네, 도시 이름 검색"
            autoComplete="off"
            maxLength={80}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={visibleResults.length > 0}
            aria-controls={listboxId}
            aria-activedescendant={
              visibleResults[activeResultIndex] ? `${listboxId}-option-${activeResultIndex}` : undefined
            }
            aria-busy={searching}
            onKeyDown={(event) => {
              if (composing.current || event.nativeEvent.isComposing) return;
              if (event.key === "ArrowDown" && results.length > 0) {
                event.preventDefault();
                revealKeyboardResult.current = !expanded || activeResultIndex !== (activeResultIndex + 1) % results.length;
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
                revealKeyboardResult.current = !expanded || activeResultIndex !== (activeResultIndex <= 0 ? results.length - 1 : activeResultIndex - 1);
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
                setMessage(null);
              }
            }}
          />
          <button type="submit" disabled={searching || !visibleResults[activeResultIndex]}>
            {searching ? "찾는 중" : "선택"}
          </button>
        </form>

        <div className="local-search-popup">
        {searching && (
          <p className="local-form-message" role="status">지역 검색 중…</p>
        )}

        <ul
          id={listboxId}
          ref={resultsRef}
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

        {/* In the flow, unlike the result list: these messages send the reader
            to the shortcuts below, so they must not cover them. The room stays
            reserved while the field has text, so the page is resized once and
            not on every keystroke. */}
        {(messageShown || messageHeld) && (
          <div className="local-form-slot">
            {messageShown && (
              <div className="local-form-status">
                <p className="local-form-message" role="status">{keepQuoted(message)}</p>
                {retryAvailable && (
                  <button
                    type="button"
                    onClick={() => {
                      setMessage(null);
                      search.retry();
                    }}
                  >
                    다시 시도
                  </button>
                )}
              </div>
            )}
          </div>
        )}

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
          <p>검색 결과는 행정구역 또는 법정구역 대표 위치&nbsp;· 지역 검색 Kakao Map</p>
        </div>
      </div>

      {/* The details sit after the actions in source order, so a phone reaches
          the location controls on the first screen instead of after them. */}
      <div className="local-chooser-details">
        {/* The same three facts the dashboard's evidence cards end on, said
            before the visitor commits a coordinate rather than only after. */}
        <dl className="local-chooser-facts">
          <div>
            <dt>비교하는 서비스</dt>
            <dd>{COMPARED_PROVIDER_NAMES.length}곳<small>{providerList}</small></dd>
          </div>
          <div>
            <dt>검증 관측소</dt>
            <dd>{VERIFICATION_STATION_COUNT}개<small>기상청 ASOS&nbsp;· 익일 예보만 채점합니다</small></dd>
          </div>
          <div>
            <dt>시간축</dt>
            <dd>24시간<small>3시간 블록 8개로 보는 비 예상 시간대</small></dd>
          </div>
        </dl>

        {/* The instrument the visitor is about to fill: the dashboard's
            timeline frame, empty. A preview of the product that claims no
            data — gridlines and a sentence, nothing else. */}
        <div className="local-instrument-empty" aria-hidden>
          <div className="local-instrument-empty-lab">
            <span>시간대 강수확률&nbsp;· 강수량</span>
            <span>0–100%&nbsp;· MM</span>
          </div>
          <div className="local-instrument-empty-grid">
            <span>위치를 고르면 여기 그려집니다</span>
          </div>
        </div>
      </div>
    </main>
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
  if (score.wetDays <= 0) return "기록 없음";
  return `비 온 ${score.wetDays}일 중 ${score.misses}일`;
}

function benchmarkVerdict(
  benchmark: NonNullable<LocalForecastView["evidence"]["benchmark"]>,
): string | null {
  const { adaptiveBrier, equalBrier } = benchmark;
  if (benchmark.status === "insufficient") return "두 계산법을 판정할 비교 기록이 더 필요합니다.";
  if (adaptiveBrier === null || equalBrier === null) return null;
  return benchmark.status === "passing"
    ? "성능 반영 방식의 점수가 단순 평균보다 나쁘지 않아 비교 기준을 통과했습니다."
    : "성능 반영 방식의 점수가 단순 평균보다 나빠 비교 기준에 미달했습니다.";
}

function PerformanceEvidence({ evidence, cohortLabel, recordHref, onRecord }: {
  evidence: LocalForecastView["evidence"];
  cohortLabel: string;
  recordHref: string;
  onRecord(event: MouseEvent<HTMLAnchorElement>): void;
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
          <p className="local-kicker">기록&nbsp;<span>: {evidence.proximity === "regional" ? "광역 관측소로 채점한 성적" : "근처 관측소로 채점한 성적"}</span></p>
          <h2 id="evidence-heading">
            {seedRanked.length > 0
              ? <>과거 기록에서<br />누가 더 잘 맞았나</>
              : <>{evidence.proximity === "regional" ? "최근 광역 관측 기록에서" : "최근 이 지역에서"}<br />누가 더 잘 맞았나</>}
          </h2>
        </div>
        {/* The status is the sentence people do not understand, so it is the
            way in: it opens the record that explains it, for this station. */}
        <Link className={`local-status-pill is-${status}`} id="forecast-evidence-status" href={recordHref} onClick={onRecord} prefetch={false}>
          {statusLabel}
        </Link>
      </div>

      <div className="local-evidence-meta">
        <div>
          <span>{evidence.proximity === "regional" ? "광역 비교 관측소" : "비교 관측소"}</span>
          <strong>{station ? `${station.name}\u00a0· ${station.distanceKm.toFixed(1)}km` : "아직 연결되지 않음"}</strong>
        </div>
        <div>
          <span>채점 기간</span>
          {/* The recency half-life applies to live captures only. Seed evidence is
              a flat retrospective sample, so claiming it here would be false. */}
          <strong>
            {seedRanked.length > 0
              ? "과거 예보 기록\u00a0· 기간 전체를 같은 비중으로 반영"
              : "최근 60일\u00a0· 최근 예보일수록 크게 반영"}
          </strong>
        </div>
        <div>
          <span>{seedRanked.length > 0 ? "과거 비교 기록\u00a0· 서비스별 최소" : "비교한 예보\u00a0· 서비스별 최소"}</span>
          <strong>
            {seedRanked.length > 0
              ? `${Math.min(...seedRanked.map((row) => row.sampleCount))}일`
              : comparisonSampleCount > 0 ? `${comparisonSampleCount}회\u00a0· ${cohortLabel}` : "수집 전"}
          </strong>
        </div>
      </div>

      {station && (
        <p className="local-method-note">
          {evidence.proximity === "regional" ? "25\u00a0km보다 먼 관측소의 광역 기록으로 채점합니다." : "25\u00a0km 이내 관측소의 기록으로 채점합니다."} 선택한 위치의 실제 날씨와 다를 수 있으며,
          기상청 예보 격자는 5&nbsp;km 단위입니다.
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
                <strong role="cell">{provider.name}<br /><small>전체 {provider.sampleCount}일 비교</small></strong>
                <span role="cell">{seedMissLabel(provider)}</span>
                <span role="cell">{provider.falseAlarms}일</span>
              </div>
            ))}
          </div>
          <p className="local-method-note">
            과거 모델 예보의 강수량을 실제 관측과 비교했습니다. <span className="local-keep">‘비를 놓친 날’은</span> 비가
            왔지만 모델이 비를 예보하지 않은 날이며, <span className="local-keep">‘헛예보’는</span> 비를 예보했지만 오지 않은
            날입니다. 최근 예보와 관측의 비교 기록이 충분해지면 이 추정을 대체합니다.
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
                  <span role="columnheader">누락&nbsp;· 오보</span>
                  <span role="columnheader">비 온 날 강수량 오차</span>
                </div>
                {ranked.map((provider) => (
                  <div className="local-score-row" role="row" key={provider.id}>
                    <strong role="cell">{provider.name}</strong>
                    <span role="cell">{provider.last7DaysBrier?.toFixed(3) ?? "기록 없음"}</span>
                    <span role="cell">{provider.windowBrier.toFixed(3)}</span>
                    <span role="cell">누락 {provider.misses}&nbsp;· 오보 {provider.falseAlarms}</span>
                    <span role="cell">
                      {provider.rainyAmountMae === null ? "기록 없음" : `${provider.rainyAmountMae.toFixed(1)}mm`}
                      {provider.rainyAmountSampleCount > 0 && `\u00a0· ${provider.rainyAmountSampleCount}일`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <p className="local-method-note">
              Brier 점수는 예보 확률이 실제와 얼마나 어긋났는지를 0에 가까울수록 좋게
              나타냅니다. <span className="local-keep">‘누락’은</span> 비가 왔는데 낮게 본 날, <span className="local-keep">‘오보’는</span> 비가 오지 않았는데
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
            별도 사전 저장 예보 비교&nbsp;· {benchmark?.sampleCount}건&nbsp;· Brier <span className="local-keep">(낮을수록 좋음)</span>&nbsp;· 성능 반영{" "}
            {benchmark?.adaptiveBrier?.toFixed(3) ?? "기록 없음"}&nbsp;· 단순 평균{" "}
            {benchmark?.equalBrier?.toFixed(3) ?? "기록 없음"}. 판정은 반올림하기 전 점수를 사용합니다.
          </span>
        </p>
      )}
    </section>
  );
}

/** "31° / 23°", with an em dash wherever a provider published no value. */
function formatRange(high: number | null, low: number | null): string {
  const one = (value: number | null) => (value === null ? "미발표" : `${Math.round(value)}°`);
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
function amountMeta(amountProviderCount: number, comparedProviderCount?: number): string {
  if (amountProviderCount <= 0) return "양을 발표한 서비스 없음";
  return comparedProviderCount === undefined || amountProviderCount === comparedProviderCount
    ? `${amountProviderCount}곳 평균`
    : `${amountProviderCount}곳 평균\u00a0· 확률은 ${comparedProviderCount}곳`;
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
  if (block.precipMax === null) return "강수확률이 발표되지 않았습니다.";
  if (role === "onset") return "비가 예상되는 구간의 시작입니다.";
  if (role === "peak") return "가장 높은 시간대입니다.";
  if (role === "wet") return "비가 예상되는 시간대입니다.";
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

/**
 * Hours the series covers, or null when any block is unpublished or the blocks
 * are not back to back. Only an unbroken, fully published series may name its
 * length: "앞으로 24시간 비 예상 없음" over a blank block would claim a dry
 * stretch nobody forecast.
 */
function publishedHours(blocks: LocalForecastTimelineBlock[]): number | null {
  if (blocks.length === 0 || blocks.some((block) => block.precipMax === null)) return null;
  if (blocks.some((block, index) => index > 0 && block.startHour !== blocks[index - 1].endHour)) return null;
  return blocks.reduce((hours, block) => hours + ((block.endHour - block.startHour + 24) % 24 || 24), 0);
}

/** Safari breaks right after an opening quote even with a word joiner there, so a quoted term is kept whole. */
function keepQuoted(text: string | null) {
  return text?.split(/(‘[^’]*’)/).map((part, index) => (
    index % 2 === 1 ? <span key={index} className="local-keep">{part}</span> : part
  ));
}

/** "지금부터" / "내일 새벽 3시부터", and the end "밤 9시까지" when the series saw one. */
function windowWords(run: NonNullable<TimelineReading["firstRun"]>, endsTomorrow: boolean) {
  const onset = run.startIndex === 0
    ? "지금부터"
    : `${run.startsTomorrow ? "내일 " : ""}${clockLabel(run.startHour)}부터`;
  const end = run.endsWithinWindow
    ? `${endsTomorrow && !run.startsTomorrow ? "내일 " : ""}${clockLabel(run.endHour)}까지`
    : null;
  return { onset, end };
}

/**
 * The umbrella line answers for the rest of today (now until midnight KST), the
 * way a person reads the question when they check before heading out:
 *
 * - rain in today's remaining blocks → take one, firmly when it is likely;
 * - before noon, a blended day total of 10mm or more also means take one,
 *   even when the hourly source is dry — most of the day is still ahead;
 * - after noon the day total may already have fallen, so today's remaining
 *   hours decide;
 * - dry today but rain in the series tomorrow → today is fine, and says when.
 */
function umbrellaAdvice({ blocks, dayOffsets, threshold, run, endsTomorrow, today }: {
  blocks: LocalForecastTimelineBlock[];
  dayOffsets: number[];
  threshold: number;
  run: TimelineReading["firstRun"];
  endsTomorrow: boolean;
  today: { precipitationAmountMm: number | null } | null;
}): string {
  const rest = blocks.filter((block, index) => dayOffsets[index] === 0 && block.precipMax !== null);
  if (rest.length === 0) return "강수 정보를 충분히 모으지 못했어요.";
  const restPeak = Math.max(...rest.map((block) => block.precipMax ?? 0));
  const restMm = rest.reduce((sum, block) => sum + (block.precipSumMm ?? 0), 0);
  if (restPeak >= threshold) {
    return restPeak >= 70 || restMm >= 10 ? "오늘 우산을 꼭 챙기세요." : "오늘 작은 우산을 챙기면 마음이 놓여요.";
  }
  const dayMm = today?.precipitationAmountMm ?? null;
  if (blocks[0].startHour < 12 && dayMm !== null && dayMm >= 10) {
    return `시간대별 예보에는 없지만 여러 서비스가 오늘 ${formatMm(dayMm)}mm를 예상해요. 우산을 챙기세요.`;
  }
  if (run && dayOffsets[run.startIndex] > 0) return `오늘은 우산 없이 괜찮아요. ${windowWords(run, endsTomorrow).onset}는 챙기세요.`;
  return "우산 없이 나서도 괜찮아 보여요.";
}

/**
 * The rain window as the sentence the page leads with: when, then "비 예상".
 * One span per clause and no punctuation between them, so a phone sets each
 * clause on its own line.
 */
function RainSentence({ run, endsTomorrow, peak, hours }: {
  run: TimelineReading["firstRun"];
  endsTomorrow: boolean;
  peak: TimelineReading["peak"];
  hours: number | null;
}) {
  // Natural spaces allow larger text to wrap at word boundaries.
  if (!peak) return <>시간대별 <span className="local-probability-label">강수확률 <b className="local-keep">미발표</b></span></>;
  if (!run) {
    return (
      <>
        <span className="local-answer-clause">{hours === null ? "발표된 시간대에" : `앞으로 ${hours}시간`}</span>{" "}
        <span className="local-answer-clause"><b>비 예상 없음</b></span>
      </>
    );
  }
  if (!run.endsWithinWindow && run.startIndex === 0 && hours !== null) {
    return (
      <>
        <span className="local-answer-clause">앞으로 <b>{hours}시간</b></span>{" "}
        <span className="local-answer-clause"><b>내내</b> 비 예상</span>
      </>
    );
  }
  const { onset, end } = windowWords(run, endsTomorrow);
  if (end === null) {
    return (
      <>
        <span className="local-answer-clause"><b>{onset}</b></span>{" "}
        <span className="local-answer-clause">비 예상</span>
      </>
    );
  }
  return (
    <>
      <span className="local-answer-clause"><b>{onset}</b></span>{" "}
      <span className="local-answer-clause">
        <b>{end}</b> 비 예상
      </span>
    </>
  );
}

/** The daily headline states the day's own probability. */
function HeadlineDay({ day, label }: { day: { precipitationProbability: number | null }; label: string }) {
  return day.precipitationProbability === null
    ? <>{label} <span className="local-probability-label">강수확률 <b className="local-keep">미발표</b></span></>
    : <>{label} <span className="local-probability-label">강수확률 <b className="local-keep">{Math.round(day.precipitationProbability)}%</b></span></>;
}

function advisoryClock(stamp: number): string {
  return kstStamp(stamp).slice(11);
}

function modernAnswer({ data, hourly, forecast }: {
  data: NonNullable<LocalForecastView["hourlyComparison"]>;
  hourly: NonNullable<ReturnType<typeof useHourlyRibbon>>;
  forecast: LocalForecastView;
}) {
  const evidence = readUmbrellaEvidence(data, hourly.blocks, hourly.viewedAt, forecast.timeline?.sourceName,
    forecast.today?.precipitationAmountMm ?? null, RAIN_ONSET_PROBABILITY);
  const { current, date, first, disagreement, primaryWet, primaryStrong, morning, dry, comparedHours, remainingHours } = evidence;
  const wetToday = first && kstStamp(first.start).startsWith(date);
  const title = primaryWet && primaryStrong || morning ? "오늘 우산을 꼭 챙기세요"
    : primaryWet ? "오늘 작은 우산을 챙기세요"
    : disagreement ? "오늘 비 예보가 엇갈려요"
    : wetToday ? "오늘 비가 올 수 있어요"
    : dry ? "오늘 비 가능성이 낮아요"
    : "오늘 우산을 판단할 자료가 부족해요";
  const primary = forecast.timeline?.sourceName;
  const averageWet = first && (first.chance ?? -1) >= RAIN_ONSET_PROBABILITY;
  const firstAmount = first && (averageWet ? first.amount : first.primaryAmount);
  return {
    current,
    title,
    note: current && (
      <>
        {morning && <span>오늘 하루 예상 강수량 {forecastAmount(forecast.today!.precipitationAmountMm!)}입니다. </span>}
        {first && <span>
          {wetToday ? "오늘" : formatDate(kstStamp(first.start).slice(0, 10))}{" "}
          <b>{advisoryClock(first.start)}–{advisoryClock(first.end)}</b>에 비 가능성{firstAmount != null &&
            ` · ${averageWet ? "평균 강수량" : `${primary} 강수량`} ${forecastAmount(firstAmount)}`}.
        </span>}
        {disagreement && <span>
          {" "}{advisoryClock(disagreement.start)}–{advisoryClock(disagreement.end)} · {primary} {hourlyProbabilityText(disagreement.primary)},
          {" "}서비스 평균 {hourlyProbabilityText(disagreement.chance)} ({disagreement.members.map(({ source }) => source.name).join(", ")}).
        </span>}
        {!disagreement && primaryWet && primary && <span>{" "}{primary}의 남은 시간대 예보를 참고했습니다.</span>}
      </>
    ),
    coverage: remainingHours > 0 && comparedHours < remainingHours
      ? `오늘 남은 온전한 ${remainingHours}시간 중 ${comparedHours}시간 비교 가능` : null,
  };
}

function forecastAmount(value: number): string {
  return value > 0 && value < 0.01 ? "0.01 mm 미만" : `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(value)} mm`;
}

function ForecastDashboard({ forecast, receivedAt, selection, onReset, onRefresh, recordHref, onRecord, onCompare, onSelectPeriod, selectedPeriod, refreshFailed }: {
  forecast: LocalForecastView;
  receivedAt: number;
  selection: ForecastLocationSelection;
  onReset(): void;
  onRefresh(): void;
  recordHref: string;
  onRecord(event: MouseEvent<HTMLAnchorElement>): void;
  onCompare(event: MouseEvent<HTMLAnchorElement>, start: number): void;
  onSelectPeriod(start: number): void;
  selectedPeriod: number | null;
  refreshFailed: boolean;
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
  const comparison = forecast.hourlyComparison;
  const now = useForecastClock();
  const hourly = useHourlyRibbon(comparison, now);
  const answer = comparison && hourly ? modernAnswer({ data: comparison, hourly, forecast }) : null;
  const currentDate = kstStamp(hourly?.viewedAt ?? Math.max(now, receivedAt)).slice(0, 10);
  const dateChanged = answer ? !answer.current : currentDate !== kstStamp(receivedAt).slice(0, 10);
  const laterOutlook = forecast.outlook.filter((reading) => reading.date !== forecast.targetDate);
  const refreshReason = dateChanged ? "날짜가 바뀌어 이전 응답을 표시합니다." : hourly?.refreshReason;
  const timeline = !hourly && dateChanged ? null : forecast.timeline;
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

  // The mm lane exists only when the ribbon's own provider published amounts.
  // Its scale is the lane's, never the probability's: capped to the wettest
  // block, floored at 2mm so a drizzle day doesn't render 0.2mm as a tower.
  const laneAmounts = blocks.map((block) => block.precipSumMm ?? null);
  const laneVisible = laneAmounts.some((amount) => amount !== null);
  const laneCapMm = laneVisible
    ? Math.max(2, Math.ceil(Math.max(...laneAmounts.filter((a): a is number => a !== null))))
    : 0;

  const hours = publishedHours(blocks);
  const runEndsTomorrow = run !== null && dayOffsets[run.endIndex] > 0;

  const amountRange = forecast.tomorrowAmountRange ?? null;

  // The scrub readout (D-08): a lens over one block — every value it shows is
  // already printed in that block's column, so the floating card is a reading
  // aid, not the only access, and stays aria-hidden. Pointer sweeps it along
  // the grid; arrow keys walk it; Escape (or leaving) clears it.
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const readoutRef = useRef<HTMLDivElement | null>(null);
  const scrubbedByKey = useRef(false);
  const scrubTo = (event: ReactPointerEvent<HTMLDivElement>) => {
    scrubbedByKey.current = false;
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
    scrubbedByKey.current = true;
    const delta = event.key === "ArrowRight" ? 1 : -1;
    setScrubIndex((current) => {
      const base = current ?? (delta === 1 ? -1 : blocks.length);
      return Math.min(blocks.length - 1, Math.max(0, base + delta));
    });
  };
  const scrubbed = scrubIndex !== null ? blocks[scrubIndex] ?? null : null;

  // The lens is centred on its block but held inside the visible chart, which
  // scrolls sideways on a phone. A block reached by arrow key is scrolled into
  // view first; one under a pointer is already there.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const readout = readoutRef.current;
    if (!scroller || !readout || scrubIndex === null || blocks.length === 0) return;
    const columnWidth = scroller.scrollWidth / blocks.length;
    const start = scrubIndex * columnWidth;
    if (scrubbedByKey.current) {
      if (start < scroller.scrollLeft) scroller.scrollLeft = start;
      else if (start + columnWidth > scroller.scrollLeft + scroller.clientWidth) {
        scroller.scrollLeft = start + columnWidth - scroller.clientWidth;
      }
    }
    const half = readout.offsetWidth / 2;
    const least = scroller.scrollLeft + half;
    const most = Math.max(least, scroller.scrollLeft + scroller.clientWidth - half);
    readout.style.left = `${Math.min(Math.max(start + columnWidth / 2, least), most)}px`;
  });

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
              : `${locationDescription.source}\u00a0· ${locationDescription.precision}`}
          </span>
        </div>
        <div className="local-strip-now">
          {forecast.current && (
            <>
              <span className="local-strip-temp">{Math.round(forecast.current.temperature)}°</span>
              <span className="local-strip-meta">
                {CONDITION_LABELS_KO[forecast.current.condition]}
              </span>
              {answer && Number.isFinite(Date.parse(forecast.current.observedAt)) && <time className="local-strip-meta" dateTime={forecast.current.observedAt}>
                관측 {kstStamp(Date.parse(forecast.current.observedAt)).replace("T", " ")} KST
              </time>}
            </>
          )}
          <button type="button" id="forecast-switch" onClick={onReset}>위치 바꾸기</button>
        </div>
      </div>

      <section className="local-answer" aria-labelledby="forecast-heading">
        <p className="local-kicker">{answer || dateChanged ? "오늘 자정까지 · 우산 안내" : "비 예보"}</p>
        <h1 id="forecast-heading" ref={headingRef} tabIndex={-1}>
          {dateChanged ? "오늘 우산 안내를 새로 확인하세요" : answer ? answer.title : timeline
            ? <RainSentence run={run} endsTomorrow={runEndsTomorrow} peak={peak} hours={hours} />
            : <HeadlineDay day={today ?? tomorrow} label={today ? "오늘" : "내일"} />}
        </h1>
        {!hourly && timeline && (
          <p className="local-answer-sub">
            {peak && <span>최대 <b className="is-wet">{Math.round(peak.probability)}%</b>&nbsp;· {peak.rangeLabel}</span>}
            {run && <span>지속 <b>{run.durationHours}시간</b></span>}
            {/* The total is the run's own sum from the ribbon's provider — the same
                claim as the window itself. It appears only when the series saw the
                rain stop AND every block in the run published an amount: an open run
                or a partial sum would claim a total the data never stated. */}
            {run?.endsWithinWindow && run.sumMm != null && (
              <span className="local-answer-total">구간 합계 <b>{
                // A total that rounds to 0 would read "비 예상 … 0mm", which
                // contradicts itself; state it as the bound it is.
                formatMm(run.sumMm) === "0" ? "0.1mm 미만" : `${formatMm(run.sumMm)}mm`
              }</b></span>
            )}
            {tomorrow.precipitationAmountMm !== null && (
              <span>내일 예상 강수량 <b>{formatMm(tomorrow.precipitationAmountMm)}mm</b></span>
            )}
            <span>{timeline.threshold}% 이상인 시간대를 비 예상 구간으로 봅니다</span>
          </p>
        )}
        {answer ? <p className="local-answer-action">{answer.note}</p> : !dateChanged && <p className="local-answer-action">
          {timeline
            ? umbrellaAdvice({ blocks, dayOffsets, threshold: timeline.threshold, run, endsTomorrow: runEndsTomorrow, today })
            : rainAction(
              (today ?? tomorrow).precipitationProbability,
              (today ?? tomorrow).precipitationAmountMm,
              RAIN_ONSET_PROBABILITY,
            )}
          {!hourly && laterRun && run && !run.startsTomorrow && (
            <> 이후 <span className="local-keep">{laterRun.startsTomorrow ? "내일 " : ""}{clockLabel(laterRun.startHour)}부터</span> 다시 비가 예상됩니다.</>
          )}
        </p>}
        {comparison && <p className="local-hourly-note">예보 응답 시각{" "}
          <time dateTime={new Date(comparison.asOf).toISOString()}>{kstStamp(comparison.asOf).replace("T", " ")} KST</time>
          {answer?.coverage && <> · {answer.coverage}</>}
        </p>}
        {!comparison && dateChanged && <p className="local-hourly-note">이 화면에서 받은 시각{" "}
          <time dateTime={new Date(receivedAt).toISOString()}>{kstStamp(receivedAt).replace("T", " ")} KST</time>
        </p>}
        {(refreshReason || refreshFailed) && <div className="local-error-actions">
          <p className="local-hourly-note" role="status">{refreshFailed ? "새 예보를 불러오지 못해 이전 예보를 표시합니다." : refreshReason}</p>
          <button type="button" id="forecast-refresh" onClick={onRefresh}>{refreshFailed ? "다시 시도" : "예보 다시 불러오기"}</button>
        </div>}
      </section>

      {comparison && hourly && <HourlyForecastComparison {...hourly}
        onCompare={onCompare} onSelectPeriod={onSelectPeriod} selectedStart={selectedPeriod} />}
      {!hourly && timeline && (
        <section className="local-ribbon" aria-labelledby="ribbon-heading">
          <div className="local-ribbon-head">
            <h2 id="ribbon-heading" className="local-ribbon-src">
              <i aria-hidden />시간대 강수확률&nbsp;· {timeline.sourceName} 단독 예보
            </h2>
            <span className="local-ribbon-note">
              3시간 블록 {blocks.length}개
            </span>
          </div>

          <div className="local-ribbon-scroll" ref={scrollerRef}>
            {/* is-sweeping: the one arrival animation (D-08) — the recorder
                prints its trace left→right in block steps, then never moves
                again. CSS-driven, so prefers-reduced-motion strips it whole. */}
            <div
              className={`local-ribbon-grid is-sweeping${laneVisible ? " has-mm" : ""}`}
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
                  ref={readoutRef}
                >
                  <b>{scrubbed.label} {scrubbed.rangeLabel}{scrubbed.wet ? "\u00a0· 비 구간" : ""}</b>
                  <span>
                    {scrubbed.precipMax === null ? "확률 미발표" : `확률 ${Math.round(scrubbed.precipMax)}%`}
                    {scrubbed.precipSumMm != null && `\u00a0· 강수 ${formatMm(scrubbed.precipSumMm)}mm`}
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
                        {probability === null ? "미발표" : <>{Math.round(probability)}<span>%</span></>}
                      </span>
                      <span className="local-ribbon-hint">{blockHint(block, role)}</span>
                    </span>
                    {laneVisible && (
                      <span className="local-ribbon-mm">
                        <span className={`local-ribbon-mmval${block.precipSumMm == null ? " is-na" : ""}`}>
                          {block.precipSumMm == null ? "미발표" : formatMm(block.precipSumMm)}
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
                <span><i aria-hidden />강수량 mm&nbsp;· 같은 출처&nbsp;· 확률과 다른 축</span>
                <span>0–{laneCapMm}mm</span>
              </div>
            )}
          </div>
          <p className="local-ribbon-swipe">← 옆으로 밀어 24시간 전체 보기</p>
        </section>
      )}

      <p className="local-kicker">하루 예보 <span>· 여러 서비스의 예보</span></p>
      <div className="local-days">
        {today && (
          <section className="local-day" aria-labelledby="today-heading">
            <div className="local-day-head">
              <h2 id="today-heading" className="local-day-when">
                {dateChanged || (answer && today.date !== currentDate) ? "이전 예보" : "오늘"} <span>{formatDate(today.date)}</span>
              </h2>
              <span className="local-tag">{today.probabilityProviderCount != null && `확률 ${today.probabilityProviderCount}곳 · `}동일 비중</span>
            </div>
            <div className="local-day-nums">
              <p className="local-day-value">
                <small className="local-day-metric-label">하루 강수확률</small>
                {today.precipitationProbability === null
                  ? <span className="local-missing-value">미발표</span>
                  : <>{Math.round(today.precipitationProbability)}<span>%</span></>}
              </p>
              <p className="local-day-mm">
                <small className="local-day-metric-label">하루 강수량</small>
                {today.precipitationAmountMm === null
                  ? <b className="is-na">미발표</b>
                  : <b>{answer ? forecastAmount(today.precipitationAmountMm) : `${formatMm(today.precipitationAmountMm)}mm`}</b>}
                <small>{amountMeta(today.amountProviderCount, today.probabilityProviderCount)}</small>
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
              이 날짜는 응답한 서비스의 예보를 <b>같은 비중으로 평균했습니다.</b>
            </p>
          </section>
        )}

        <section
          className={`local-day${weighted ? " is-weighted" : ""}`}
          aria-labelledby="tomorrow-heading"
        >
          <div className="local-day-head">
            <h2 id="tomorrow-heading" className="local-day-when">
              {dateChanged ? "응답 기준" : "내일"} <span>{formatDate(forecast.targetDate)}</span>
            </h2>
            <span className={`local-tag${weighted ? " is-weighted" : ""}`}>
              {forecast.comparedProviderCount}개 서비스{" "}
              {weighted ? (seeded ? "과거 기록 가중" : "성능 가중") : "동일 비중"}
            </span>
          </div>
          <div className="local-day-nums">
            <p className="local-day-value">
              <small className="local-day-metric-label">하루 강수확률</small>
              {tomorrow.precipitationProbability === null
                ? <span className="local-missing-value">미발표</span>
                : <>{Math.round(tomorrow.precipitationProbability)}<span>%</span></>}
            </p>
            <p className="local-day-mm">
              <small className="local-day-metric-label">하루 강수량</small>
              {tomorrow.precipitationAmountMm === null
                ? <b className="is-na">미발표</b>
                : <b>{answer ? forecastAmount(tomorrow.precipitationAmountMm) : `${formatMm(tomorrow.precipitationAmountMm)}mm`}</b>}
              <small>
                {/* The extremes are named members, not percentiles — n≤4 cannot
                    honestly support interval language. Each separator sits
                    inside the phrase before it, so no line starts with one. */}
                {amountRange ? <>
                  <span className="local-amount-bound">{amountMeta(tomorrow.amountProviderCount, forecast.comparedProviderCount)}{"\u00a0·"}</span>{" "}
                  <span className="local-amount-bound">많으면{"\u00a0"}{formatMm(amountRange.maxMm)}mm <span className="local-amount-last"><span className="local-amount-provider">({amountRange.maxName})</span>{"\u00a0·"}</span></span>{" "}
                  <span className="local-amount-bound">적으면{"\u00a0"}{formatMm(amountRange.minMm)}mm <span className="local-amount-provider">({amountRange.minName})</span></span>
                </> : amountMeta(tomorrow.amountProviderCount, forecast.comparedProviderCount)}
              </small>
            </p>
          </div>
          <p className="local-day-row">
            <span>{formatRange(tomorrow.temperatureMax, tomorrow.temperatureMin)}</span>
            <span>{CONDITION_LABELS_KO[tomorrow.condition]}</span>
          </p>
          <p className="local-day-why">
            {seeded
              ? "최근 비교 기록이 부족해 과거 모델 예보와 관측을 비교한 결과를 일부 반영했습니다."
              : learned
                ? <>관측소 {forecast.evidence.station?.name ?? "근처 관측소"}의 <b>비교 기록 {forecast.evidence.benchmark?.sampleCount ?? forecast.evidence.comparisonSampleCount}건</b>을 반영했습니다.</>
                : "응답한 서비스를 같은 비중으로 평균했습니다."}
          </p>
        </section>
      </div>

        {laterOutlook.length > 0 && (
          <section className="local-card local-outlook" aria-labelledby="outlook-heading">
            <div className="local-card-head">
              <h2 id="outlook-heading">{dateChanged ? "이전 응답의 이후 전망" : "모레부터의 전망"}</h2>
              <b>동일 비중</b>
            </div>
            <div
              className="local-week"
              style={{ "--cols": laterOutlook.length, "--cols-narrow": Math.ceil(laterOutlook.length / 2) } as CSSProperties}
            >
              {laterOutlook.map((day) => (
                <div className="local-wd" key={day.date}>
                  <time className="local-wd-d" dateTime={day.date}>{formatDate(day.date)}</time>
                  <span className="local-wd-b">
                    <i style={{ "--h": `${Math.round(day.precipitationProbability ?? 0)}%` } as CSSProperties} />
                  </span>
                  <span className="local-wd-v">{probabilityLabel(day.precipitationProbability)}</span>
                </div>
              ))}
            </div>
            <p className="local-card-why">
              서비스별 강수확률을 같은 비중으로 평균했습니다.
            </p>
          </section>
        )}

      <div className="local-receipts">
      <p className="local-kicker">근거&nbsp;<span>: 이 숫자가 나온 방식</span></p>
      <div className="local-evidence-cards">
        <section className="local-card" aria-labelledby="influence-heading">
          <div className="local-card-head">
            <h2 id="influence-heading">{dateChanged ? "이전 응답의 익일 예보 비중" : "내일 예보에 적용한 비중"}</h2>
            {spread.length > 1 && (
              <b>편차 {Math.round(Math.min(...spread))}–{Math.round(Math.max(...spread))}%</b>
            )}
          </div>
          <p className="local-card-why">{formatDate(forecast.targetDate)} · 강수확률과 예보에 적용한 비중</p>
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
              ? <>막대는 각 서비스의 내일 강수확률입니다. 비중은 이 예보에 반영된 몫이며, {seeded ? "과거 모델 예보와 관측의 비교 결과" : "최근 확률 예보의 채점 결과"}에 따라 조정합니다.</>
              : "막대는 서비스별 강수확률입니다. 비중은 이 예보에 반영된 몫입니다."}
          </p>
          {!weighted && forecast.evidence.emptyMessage && <p className="local-card-why">{forecast.evidence.emptyMessage}</p>}
          <Link id="forecast-station" className="local-compare-link" href={recordHref} onClick={onRecord} prefetch={false}>관측소 채점 기록</Link>
        </section>

      </div>

      <PerformanceEvidence
        evidence={forecast.evidence}
        cohortLabel={forecast.cohortLabel}
        recordHref={recordHref}
        onRecord={onRecord}
      />
      </div>

      <footer className="local-footer">
        <p>출처 Open-Meteo&nbsp;· 기상청&nbsp;· Pirate Weather&nbsp;· WeatherAPI&nbsp;· Visual Crossing 중 응답한 서비스&nbsp;· 모든 시각&nbsp;KST</p>
        <p>관측 검증: 기상청 ASOS&nbsp;· 사용자 좌표는 성능 기록 DB에 저장하지 않습니다.</p>
        {!hourly && timeline && (
          <p>
            시간대 확률은 {timeline.sourceName} 한 곳의 값이고, <span className="local-keep">오늘·내일</span> 확률은 여러 곳을 섞은
            값입니다.
          </p>
        )}
        {/* The only way into the scoring record. A page nothing links to is a
            page nobody reads, and the claim it carries is the product's. */}
        <p>
          <Link className="local-footer-link" id="forecast-record" href={recordHref} onClick={onRecord} prefetch={false}>
            이 예보를 어떻게 채점하는가{"\u00a0"}→
          </Link>
        </p>
      </footer>
    </main>
  );
}

export default function LocalForecastExperience() {
  const [state, setState] = useState<ViewState>({ kind: "idle" });
  const [returningToChooser, setReturningToChooser] = useState(false);
  const chooseRef = useRef<((intent: ForecastIntent) => void) | null>(null);
  const generation = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const lastEntry = useRef<ForecastEntry | null>(null);
  const [hasRetainedForecast, setHasRetainedForecast] = useState(false);
  const returnReading = useRef<ForecastEntry["reading"]>(undefined);
  const [detailStart, setDetailStart] = useState<number | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [contextWarning, setContextWarning] = useState<string | null>(null);

  function cancelRequest() {
    generation.current += 1;
    pending.current?.abort();
    pending.current = null;
  }

  function showEntry(entry: ForecastEntry, restoreReading = false) {
    lastEntry.current = entry;
    setHasRetainedForecast(true);
    returnReading.current = restoreReading ? entry.reading : undefined;
    setState({ kind: "ready", forecast: entry.forecast, selection: entry.location.selection, location: entry.location, entry });
  }

  const chooseLocation = async (intent: ForecastIntent) => {
    if (pending.current && intent.mode !== "restore") return;
    cancelRequest();
    const attempt = generation.current;
    const controller = new AbortController();
    pending.current = controller;
    setRefreshFailed(false);
    const { location: input, mode } = intent;
    setState({ kind: "loading", label: input.name });
    try {
      const { name, latitude, longitude, elevationM } = input;
      const forecast = await loadForecast({ name, latitude, longitude, elevationM }, controller.signal);
      if (attempt !== generation.current || controller.signal.aborted) return;
      const entry = {
        id: intent.entry?.id ?? crypto.randomUUID(),
        forecast,
        receivedAt: Date.now(),
        location: input,
        stored: mode === "select" || intent.stored === true || intent.entry?.stored === true,
        reading: intent.entry?.reading,
      };
      rememberForecast(entry);
      const url = mode === "select" ? shareableSearch(input) ?? "/"
        : window.location.hash.startsWith("#forecast=") ? window.location.pathname + window.location.search
        : window.location.href;
      writeForecastHistory({ raintodayView: "forecast", forecastEntry: entry.id }, url, mode !== "select");
      if (mode === "select") {
        setDetailStart(null);
        setContextWarning(null);
        writeStoredLocation(input);
      }
      showEntry(entry, mode === "refresh");
    } catch (error) {
      if (attempt !== generation.current || controller.signal.aborted) return;
      if (mode === "refresh" && intent.entry && !(error instanceof ForecastOutOfServiceAreaError)) {
        showEntry(intent.entry, true);
        setRefreshFailed(true);
        return;
      }
      setState(error instanceof ForecastOutOfServiceAreaError
        ? { kind: "error", message: "이 위치는 대한민국 서비스 지역 밖이에요. 대한민국 안의 지역을 고르면 바로 예보를 볼 수 있어요.", retry: null }
        : { kind: "error", message: "이 위치의 예보를 불러오지 못했어요.", retry: intent });
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  };

  useEffect(() => {
    chooseRef.current = (intent) => void chooseLocation(intent);
  });

  function retainReading(id: string, focus?: string, period?: number) {
    const entry = retainedForecasts.get(id);
    if (!entry) return;
    const next = { ...entry, reading: {
      top: focus ? window.scrollY : entry.reading?.top ?? 0,
      focus: focus ?? entry.reading?.focus ?? "forecast-compare",
      period: period ?? entry.reading?.period ?? null,
    } };
    rememberForecast(next);
    lastEntry.current = next;
    return next;
  }

  const returnToChooser = (push: boolean, forget = false) => {
    cancelRequest();
    if (state.kind === "ready") {
      const retained = retainReading(state.entry.id, "forecast-switch");
      if (forget && state.entry.stored) {
        clearStoredLocation();
        if (retained) rememberForecast({ ...retained, stored: false });
      }
    }
    if (push) writeForecastHistory({ raintodayView: "chooser" }, "/", false);
    setDetailStart(null);
    setContextWarning(null);
    setRefreshFailed(false);
    setReturningToChooser(true);
    setState({ kind: "idle" });
  };

  const cancelSwitch = () => {
    cancelRequest();
    setRefreshFailed(false);
    const entry = lastEntry.current;
    if (entry && window.history.state?.raintodayView === "chooser") {
      window.history.back();
      return;
    }
    if (entry) showEntry(entry, true);
    else returnToChooser(false);
  };

  useEffect(() => {
    function restore(initial: boolean) {
      cancelRequest();
      setRefreshFailed(false);
      const history = window.history.state;
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const period = hash.get("compare");
      const detail = period !== null && hash.getAll("compare").length === 1 && /^\d{13}$/.test(period) && Number(period) % 10_800_000 === 0
        ? Number(period) : null;
      setDetailStart(detail);
      setContextWarning(period !== null && detail === null ? "링크의 시간대를 확인할 수 없어요. 리본에서 시간대를 골라 주세요." : null);
      const returnId = hash.get("forecast");
      const id = returnId ?? (history?.raintodayView === "forecast" ? history.forecastEntry : undefined);
      const fromLink = locationFromSearch(window.location.search);
      const params = new URLSearchParams(window.location.search);
      const explicitChooser = params.get("choose") === "1";
      const requestedArea = ["lat", "lon", "name", "area"].some((key) => params.has(key));
      const entry = typeof id === "string" ? retainedForecasts.get(id) : undefined;
      if (entry && (fromLink ? shareableSearch(entry.location) === shareableSearch(fromLink) : !requestedArea)) {
        if (returnId) {
          writeForecastHistory({ raintodayView: "forecast", forecastEntry: entry.id }, shareableSearch(entry.location) ?? "/", true);
        }
        showEntry(entry, detail === null);
        return;
      }
      const stored = initial && !requestedArea && !explicitChooser && !returnId && period === null ? readStoredLocation() : null;
      const target = fromLink ?? stored;
      if (target) chooseRef.current?.({ location: target, mode: "restore", stored: stored !== null });
      else {
        if (requestedArea || returnId || period !== null) setContextWarning("링크의 예보 위치를 확인할 수 없어요. 이 화면에서 위치를 골라 주세요.");
        setReturningToChooser(!initial);
        setState({ kind: "idle" });
      }
    }
    restore(true);
    const onPopState = () => restore(false);
    window.addEventListener("popstate", onPopState);
    return () => {
      cancelRequest();
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  const viewKey = state.kind === "ready" ? state.forecast : state.kind;
  useEffect(() => {
    const id = state.kind === "loading" ? "forecast-cancel" : state.kind === "error" ? "forecast-error" : null;
    if (id) document.getElementById(id)?.focus({ preventScroll: true });
  }, [state.kind]);
  useLayoutEffect(() => {
    if (viewKey === "loading") return;
    const reading = returnReading.current;
    returnReading.current = undefined;
    window.scrollTo({ top: reading?.top ?? 0, behavior: "instant" });
    if (reading) {
      const frame = window.requestAnimationFrame(() => {
        window.scrollTo({ top: reading.top, behavior: "instant" });
        document.getElementById(reading.focus)?.focus({ preventScroll: true });
      });
      return () => window.cancelAnimationFrame(frame);
    }
  }, [viewKey, detailStart]);

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
          onClick={() => returnToChooser(true, true)}
          aria-label="처음으로 · 위치 다시 선택"
        >
          <span className="local-wordmark">오늘비</span>
          <small>전국 로컬 예보</small>
        </button>
        <span className="local-live-mark"><i /> 시각 기준&nbsp;· KST</span>
      </header>
      {contextWarning && <p className="local-journey-return" role="status">{contextWarning}</p>}

      {(state.kind === "idle" || state.kind === "loading") && (
        <LocationChooser
          autoFocus={returningToChooser}
          onChoose={(location) => void chooseLocation({ location, mode: "select" })}
          busy={state.kind === "loading"}
        />
      )}
      {state.kind === "idle" && hasRetainedForecast && <div className="local-journey-return">
        <button type="button" onClick={cancelSwitch}>이전 예보로 돌아가기</button>
      </div>}

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
          <p className="local-loading-names">{providerList}</p>
          {/* The empty instrument, pulsing as one whole: the response arrives
              once, so the only honest animation is the frame waiting — never a
              per-provider progress row. */}
          <div className="local-instrument-empty is-waiting" aria-hidden>
            <div className="local-instrument-empty-lab">
              <span>시간대 강수확률&nbsp;· 강수량</span>
              <span>0–100%&nbsp;· MM</span>
            </div>
            <div className="local-instrument-empty-grid">
              <span>응답한 서비스를 한 번에 그립니다</span>
            </div>
          </div>
          <p className="local-loading-note">
            응답하지 않는 서비스는 비교에서 빠집니다.
          </p>
          <div className="local-error-actions">
            <button type="button" id="forecast-cancel" onClick={cancelSwitch}>{hasRetainedForecast ? "취소하고 이전 예보 보기" : "취소하고 위치 선택"}</button>
          </div>
        </div>
      )}

      {state.kind === "error" && (
        <main className="local-state-card">
          {/* Two failures, two shapes. `retry` is null exactly when the same
              request can never succeed, so that card offers no retry and says
              why rather than leaving a button that is guaranteed to fail. */}
          <p className="local-state-kicker">
            {errorRetry ? "예보를 불러오지 못함" : "서비스 지역 밖"}
          </p>
          <h1 id="forecast-error" className="local-state-heading" tabIndex={-1}>{state.message}</h1>
          <p className="local-state-body">
            {errorRetry
              ? "네트워크나 예보 서비스 쪽 문제일 수 있습니다. 다시 시도하면 같은 좌표로 다시 요청합니다."
              : "대한민국 안의 지역을 다시 골라 주세요."}
          </p>
          <div className="local-error-actions">
            {/* A provider being briefly down says nothing about the location,
                so retrying the same one is the first thing to offer. */}
            {errorRetry && (
              <button
                type="button"
                className="is-primary"
                onClick={() => void chooseLocation(errorRetry)}
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
            {hasRetainedForecast && <button type="button" onClick={cancelSwitch}>이전 예보로 돌아가기</button>}
          </div>
          <p className="local-state-why">
            {errorRetry
              ? "저장된 위치는 지우지 않았습니다."
              : "이 좌표는 기기에 저장하지 않았습니다."}
          </p>
        </main>
      )}

      {state.kind === "ready" && detailStart !== null && (
        <ForecastComparisonDetail data={state.forecast.hourlyComparison} start={detailStart} place={state.forecast.locationName}
          home={shareableSearch(state.location) ?? "/"} onReturn={(event) => {
            if (!plainClick(event)) return;
            event.preventDefault();
            if (window.history.state?.forecastDetail) {
              window.history.back();
              return;
            }
            showEntry(retainedForecasts.get(state.entry.id) ?? state.entry, true);
            writeForecastHistory({ raintodayView: "forecast", forecastEntry: state.entry.id }, shareableSearch(state.location) ?? "/", true);
            setDetailStart(null);
          }} />
      )}
      {state.kind === "ready" && detailStart === null && (
        <ForecastDashboard
          forecast={state.forecast}
          receivedAt={state.entry.receivedAt}
          selection={state.selection}
          onReset={() => returnToChooser(true)}
          onRefresh={() => {
            const entry = retainReading(state.entry.id, "forecast-refresh") ?? state.entry;
            void chooseLocation({ location: state.location, mode: "refresh", entry });
          }}
          recordHref={recordHrefFor(state.location, state.forecast.evidence.station?.id, state.entry.id)}
          onRecord={(event) => retainReading(state.entry.id, event.currentTarget.id || "forecast-record")}
          onCompare={(event, start) => {
            if (!plainClick(event)) return;
            event.preventDefault();
            setContextWarning(null);
            retainReading(state.entry.id, "forecast-compare", start);
            writeForecastHistory({ raintodayView: "forecast", forecastEntry: state.entry.id, forecastDetail: true }, `#compare=${start}`, false);
            setDetailStart(start);
          }}
          onSelectPeriod={(start) => retainReading(state.entry.id, undefined, start)}
          selectedPeriod={state.entry.reading?.period ?? null}
          refreshFailed={refreshFailed}
        />
      )}
    </div>
  );
}
