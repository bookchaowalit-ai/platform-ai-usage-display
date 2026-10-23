/**
 * Where unexpected server errors go besides the console. index.ts installs the
 * Sentry reporter when SENTRY_DSN is set; otherwise (and in tests) it is a no-op.
 * Reporting must never break a request, so reporter failures are swallowed.
 */
export type ErrorReporter = (err: unknown) => void;

let reporter: ErrorReporter | undefined;

export function setErrorReporter(next: ErrorReporter | undefined): void {
  reporter = next;
}

export function reportError(err: unknown): void {
  if (!reporter) return;
  try {
    reporter(err);
  } catch {
    // A broken reporter must not turn a handled error into a crash.
  }
}
