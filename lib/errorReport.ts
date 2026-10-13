import { analyticsUrl } from "./analyticsUrl.ts";

/**
 * Where browser errors are reported. A Sentry DSN is a public, write-only
 * address that every visitor's browser receives; it grants no read access.
 */
export const ERROR_REPORT_DSN =
  "https://a5456f12fa18d6c65684b7718366c0d9@o4512208173203456.ingest.us.sentry.io/4512248969756672";
export const ERROR_REPORT_ORIGIN = new URL(ERROR_REPORT_DSN).origin;

/** The only host whose errors are reported; previews and local builds stay silent. */
export const ERROR_REPORT_HOST = "raintoday.vercel.app";

type ErrorReport = {
  request?: { url?: string; headers?: Record<string, string> };
  user?: unknown;
};

/** Removes the chosen place from the reported addresses and drops any visitor identity. */
export function scrubErrorReport<T extends ErrorReport>(report: T): T {
  const scrubbed = { ...report };
  delete scrubbed.user;
  if (scrubbed.request) {
    const { url, headers } = scrubbed.request;
    scrubbed.request = {
      ...scrubbed.request,
      ...(url ? { url: analyticsUrl(url) } : {}),
      ...(headers?.Referer ? { headers: { ...headers, Referer: analyticsUrl(headers.Referer) } } : {}),
    };
  }
  return scrubbed;
}
