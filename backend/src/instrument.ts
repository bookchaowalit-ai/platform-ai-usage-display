import * as Sentry from "@sentry/node";
import { setErrorReporter } from "./lib/error-reporter.js";
import { sentryOptions } from "./sentry.js";

/**
 * Starts Sentry error reporting when SENTRY_DSN is set (errors only, scrubbed
 * by src/sentry.ts). Without a DSN nothing is initialised and nothing is sent.
 */
export function initErrorReporting(env: Record<string, string | undefined> = process.env): boolean {
  const options = sentryOptions(env);
  if (!options.enabled) return false;
  Sentry.init(options);
  setErrorReporter((err) => {
    Sentry.captureException(err);
  });
  return true;
}
