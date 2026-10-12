/**
 * The address reported with a page view. A shared forecast link carries the
 * chosen place in its query (`lat`, `lon`, `name`), and visitor counting has no
 * use for it, so only the path and any `utm_*` campaign tags are sent.
 */
export function analyticsUrl(href: string): string {
  const url = new URL(href);
  const kept = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (key.startsWith("utm_")) kept.append(key, value);
  }
  url.search = kept.toString();
  url.hash = "";
  return url.toString();
}
