"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ForecastLocationSearchResult } from "@/lib/locationSearch";

type SearchStatus =
  | "idle" | "too-short" | "searching" | "ready" | "empty"
  | "invalid" | "rate-limited" | "not-configured" | "unavailable";

interface SearchState {
  query: string;
  status: SearchStatus;
  results: ForecastLocationSearchResult[];
}

function normalize(query: string): string {
  return query.normalize("NFKC").trim().replace(/\s+/g, " ");
}

async function readResults(query: string, signal: AbortSignal): Promise<Pick<SearchState, "status" | "results">> {
  const response = await fetch(`/api/locations/search?q=${encodeURIComponent(query)}`, { signal });
  if (response.status === 400) return { status: "invalid", results: [] };
  if (response.status === 429) return { status: "rate-limited", results: [] };
  if (!response.ok) {
    const reason = await response.json().then(
      (body: { error?: unknown }) => body?.error,
      () => undefined,
    );
    return { status: reason === "search_not_configured" ? "not-configured" : "unavailable", results: [] };
  }
  const payload = await response.json() as { results: ForecastLocationSearchResult[] };
  return { status: payload.results.length ? "ready" : "empty", results: payload.results };
}

/** Own the entire request lifetime, including error-body decoding and same-query retries. */
export function useLocationCandidateSearch() {
  const [state, setState] = useState<SearchState>({ query: "", status: "idle", results: [] });
  const [revision, setRevision] = useState(0);
  const stopRequest = useRef<(() => void) | null>(null);
  const query = state.query;

  const cancel = useCallback(() => {
    stopRequest.current?.();
    setState((current) => current.status === "searching" ? { ...current, status: "idle" } : current);
  }, []);

  const updateQuery = (nextQuery: string) => {
    cancel();
    const length = normalize(nextQuery).length;
    setState({ query: nextQuery, results: [], status: length >= 2 ? "searching" : length ? "too-short" : "idle" });
    setRevision((current) => current + 1);
  };

  useEffect(() => {
    const normalized = normalize(query);
    if (normalized.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const result = await readResults(normalized, controller.signal);
        if (!controller.signal.aborted) setState({ query, ...result });
      } catch {
        if (!controller.signal.aborted) setState({ query, status: "unavailable", results: [] });
      }
    }, 250);
    const stop = () => {
      controller.abort();
      window.clearTimeout(timer);
    };
    stopRequest.current = stop;
    return stop;
  }, [query, revision]);

  return {
    ...state,
    retryAvailable: state.status === "rate-limited" || state.status === "unavailable",
    updateQuery,
    retry: () => updateQuery(query),
    cancel,
  };
}
