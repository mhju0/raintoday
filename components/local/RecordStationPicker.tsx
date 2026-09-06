"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useLocationCandidateSearch } from "./useLocationCandidateSearch";

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
  const search = useLocationCandidateSearch();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const messages = {
    searching: "지역을 찾는 중이에요. 잠시만 기다려 주세요.",
    invalid: "검색어를 인식하지 못했어요. 시·구·동 이름으로 더 짧게 입력해 주세요.",
    "rate-limited": "검색 요청이 많아요. 잠시 후 다시 시도해 주세요.",
    "not-configured": "이곳에서는 지역 검색을 쓸 수 없어요.",
    unavailable: "지역을 찾지 못했어요. 잠시 후 다시 시도해 주세요.",
    empty: "일치하는 행정구역이 없어요.",
  };
  const message = search.status === "ready"
    ? `지역 ${search.results.length}곳을 찾았어요. 아래에서 골라 주세요.`
    : search.status in messages ? messages[search.status as keyof typeof messages] : null;

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
        aria-busy={search.status === "searching"}
        aria-describedby="btd-picker-status"
        value={search.query}
        onChange={(event) => search.updateQuery(event.target.value)}
      />
      <p id="btd-picker-status" className="btd-picker-message" role="status" aria-live="polite" aria-atomic="true">{message}</p>
      {search.results.length > 0 && (
        <ul className="btd-picker-results">
          {search.results.map((result) => (
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
                  search.cancel();
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
