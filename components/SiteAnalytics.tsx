"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import { analyticsUrl } from "@/lib/analyticsUrl";

/**
 * Vercel Web Analytics and Speed Insights, production only: outside production
 * the packages load debug scripts from another origin, which the content
 * security policy blocks. Both report the address without the chosen place.
 */
export function SiteAnalytics() {
  if (process.env.NODE_ENV !== "production") return null;
  return (
    <>
      <Analytics
        beforeSend={(event) => ({ ...event, url: analyticsUrl(event.url) })}
      />
      <SpeedInsights
        beforeSend={(event) => ({ ...event, url: analyticsUrl(event.url) })}
      />
    </>
  );
}
