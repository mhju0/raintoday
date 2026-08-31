"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ForecastLocationSearchResult } from "@/lib/locationSearch";

/**
 * Change which station's record the page is showing.
 *
 * The same administrative search the forecast uses, so a reader who wants their
 * own area gets it without going back through the chooser. It navigates rather
 * than fetching evidence itself: the record is server-rendered from the database
 * on each request, and a client-side swap would leave the URL describing a
 * station the page is no longer showing.
 */
export function RecordStationPicker({ stationName }: { stationName: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ForecastLocationSearchResult[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Below the minimum query length there is nothing to show. Deriving that from
  // the query rather than clearing state inside the effect keeps the effect's
  // only job asynchronous, which is also what the compiler's rule is asking for.
  const tooShort = query.trim().length < 2;
  const visibleResults = tooShort ? [] : results;
  const visibleMessage = tooShort ? null : message;

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) return;
    const controller = new AbortController();
    const mine = ++sequence.current;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/locations/search?q=${encodeURIComponent(normalized)}`,
          { signal: controller.signal },
        );
        if (mine !== sequence.current) return;
        if (response.status === 429) {
          setResults([]);
          setMessage("검색 요청이 많아요. 잠시 후 다시 시도해 주세요.");
          return;
        }
        if (!response.ok) {
          // A missing credential is permanent here; anything else may pass.
          const reason = await response.clone().json().then(
            (body: { error?: unknown }) => body?.error,
            () => undefined,
          );
          setResults([]);
          setMessage(
            reason === "search_not_configured"
              ? "이곳에서는 지역 검색을 쓸 수 없어요."
              : "지역을 찾지 못했어요. 잠시 후 다시 시도해 주세요.",
          );
          return;
        }
        const payload = (await response.json()) as { results: ForecastLocationSearchResult[] };
        if (mine !== sequence.current) return;
        setResults(payload.results);
        setMessage(payload.results.length === 0 ? "일치하는 행정구역이 없어요." : null);
      } catch {
        if (controller.signal.aborted || mine !== sequence.current) return;
        setResults([]);
        setMessage("지역을 찾지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  if (!open) {
    return (
      <button type="button" className="btd-picker-open" onClick={() => setOpen(true)}>
        다른 지역의 기록 보기
        {stationName ? <span> · 지금은 {stationName}</span> : null}
      </button>
    );
  }

  return (
    <div className="btd-picker">
      <label className="btd-picker-label" htmlFor="btd-picker-input">
        어느 지역의 채점 기록을 볼까요
      </label>
      <input
        id="btd-picker-input"
        ref={inputRef}
        className="btd-picker-input"
        type="search"
        autoComplete="off"
        placeholder="시·구·동 이름"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {visibleMessage ? <p className="btd-picker-message">{visibleMessage}</p> : null}
      {visibleResults.length > 0 && (
        <ul className="btd-picker-results">
          {visibleResults.map((result) => (
            <li key={result.id}>
              <button
                type="button"
                onClick={() => {
                  // Five decimals, as the forecast's own share link uses. The
                  // full float is an area centroid, not a person, but a URL
                  // carrying twelve decimals of it is noise either way.
                  const params = new URLSearchParams({
                    lat: result.latitude.toFixed(5),
                    lon: result.longitude.toFixed(5),
                    name: result.name,
                  });
                  router.push(`/behind-the-data?${params}`);
                  setOpen(false);
                }}
              >
                <strong>{result.name}</strong>
                <span>{result.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
