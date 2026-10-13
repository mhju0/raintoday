import { ERROR_REPORT_DSN, ERROR_REPORT_HOST, scrubErrorReport } from "@/lib/errorReport";

// Browser errors on the production site are reported to Sentry. The SDK loads
// once the page is idle, so it never delays the forecast; errors thrown before
// then are held and reported when it arrives.
if (window.location.hostname === ERROR_REPORT_HOST) {
  const early: unknown[] = [];
  const hold = (event: ErrorEvent | PromiseRejectionEvent) => {
    early.push("reason" in event ? event.reason : event.error);
  };
  window.addEventListener("error", hold);
  window.addEventListener("unhandledrejection", hold);

  const start = async () => {
    const Sentry = await import("@sentry/browser");
    window.removeEventListener("error", hold);
    window.removeEventListener("unhandledrejection", hold);
    Sentry.init({
      dsn: ERROR_REPORT_DSN,
      dataCollection: { userInfo: false, cookies: false, httpBodies: [], urlQueryParams: false },
      defaultIntegrations: false,
      integrations: [
        Sentry.globalHandlersIntegration(),
        Sentry.linkedErrorsIntegration(),
        Sentry.dedupeIntegration(),
        Sentry.httpContextIntegration(),
      ],
      beforeSend: (event) => scrubErrorReport(event),
    });
    for (const error of early) Sentry.captureException(error);
  };
  if ("requestIdleCallback" in window) window.requestIdleCallback(() => void start());
  else setTimeout(() => void start(), 2000);
}
