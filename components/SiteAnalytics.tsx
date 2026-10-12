"use client";

import { Analytics } from "@vercel/analytics/next";

import { analyticsUrl } from "@/lib/analyticsUrl";

/**
 * Vercel Web Analytics, production only: outside production the package loads
 * a debug script from another origin, which the content security policy blocks.
 */
export function SiteAnalytics() {
  if (process.env.NODE_ENV !== "production") return null;
  return (
    <Analytics
      beforeSend={(event) => ({ ...event, url: analyticsUrl(event.url) })}
    />
  );
}
