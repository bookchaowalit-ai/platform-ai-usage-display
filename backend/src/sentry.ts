/**
 * Sentry settings for the backend. Adapted from the shared reference
 * (~/work/b-tier-b/sentry-ref/sentry.ts); this repository owns its copy.
 *
 * Errors only: no tracing, no trace headers, no breadcrumbs, no request data.
 * Events are rebuilt from an allowlist so nothing that can carry provider API
 * keys, OAuth/quota tokens, the device or relay push token, upstream response
 * text, file paths or host names leaves the process:
 * - only the top-level keys in EVENT_KEYS survive (no request, user, tags, extra);
 * - error messages are kept only when they match the app's own fixed messages,
 *   everything else becomes "[redacted]";
 * - stack frames keep location fields only (no vars, no source context lines);
 * - known secret values from the environment are redacted wherever they appear.
 * Off when SENTRY_DSN is unset.
 */

const EVENT_KEYS = new Set([
  "event_id",
  "timestamp",
  "platform",
  "level",
  "logger",
  "release",
  "environment",
  "exception",
  "message",
  "sdk",
  "contexts",
]);
const CONTEXT_KEYS = new Set(["runtime", "os"]);
const FRAME_KEYS = new Set(["filename", "function", "module", "lineno", "colno", "in_app"]);

export const REDACTED = "[redacted]";

/** The app's own error messages (adapters, lib, routes). Anything else is redacted. */
const APP_MESSAGES: readonly RegExp[] = [
  /^(Claude|Kimi) usage HTTP \d{3}$/,
  /^Kimi OAuth refresh HTTP \d{3}; sign in again$/,
  /^Solo Empire API HTTP \d{3}$/,
  /^(Codex quota|Grok billing) request failed$/,
  /^local CLI timed out after \d{1,7}ms$/,
  /^local CLI (exited before responding|stdio unavailable|protocol failed)$/,
  /^timed out waiting for Kimi OAuth refresh lock$/,
  /^Kimi Code OAuth login not found$/,
  /^Kimi OAuth refresh returned invalid credentials$/,
  /^(invalid version|invalid size|not an ESP32 image|md5 mismatch)$/,
  /^usage aggregation failed$/,
];

/** Environment variables whose values must never appear in an event. */
export const SECRET_ENV_KEYS = [
  "DEVICE_TOKEN",
  "RELAY_PUSH_TOKEN",
  "ANTHROPIC_ADMIN_API_KEY",
  "OPENAI_ADMIN_API_KEY",
  "XAI_API_KEY",
  "SOLO_EMPIRE_USAGE_API_TOKEN",
  "SENTRY_DSN",
] as const;

/** Keeps a message only if it is one of the app's own error messages; else "[redacted]". */
export function safeMessage(message: unknown): string {
  return typeof message === "string" && APP_MESSAGES.some((pattern) => pattern.test(message))
    ? message
    : REDACTED;
}

type Frame = Record<string, unknown>;
type ExceptionValue = {
  type?: unknown;
  value?: unknown;
  mechanism?: unknown;
  stacktrace?: { frames?: Frame[] };
};
export type SentryLikeEvent = Record<string, unknown> & {
  message?: unknown;
  contexts?: Record<string, unknown>;
  exception?: { values?: ExceptionValue[] };
};

function redactSecrets(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") {
    let out = value;
    for (const secret of secrets) out = out.split(secret).join(REDACTED);
    return out;
  }
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, secrets));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) record[key] = redactSecrets(record[key], secrets);
  }
  return value;
}

export function scrubEvent<T extends object>(input: T, secrets: readonly string[] = []): T {
  const event = input as SentryLikeEvent;
  for (const key of Object.keys(event)) if (!EVENT_KEYS.has(key)) delete event[key];
  if (event.message !== undefined) event.message = safeMessage(event.message);
  if (event.contexts) {
    for (const key of Object.keys(event.contexts)) if (!CONTEXT_KEYS.has(key)) delete event.contexts[key];
  }
  for (const value of event.exception?.values ?? []) {
    const mechanism = (value.mechanism ?? {}) as { type?: unknown; handled?: unknown; source?: unknown };
    // Linked cause errors keep their type only.
    if (mechanism.type === "chained" || mechanism.source !== undefined) delete value.value;
    else value.value = safeMessage(value.value);
    if (value.mechanism !== undefined) value.mechanism = { type: mechanism.type, handled: mechanism.handled };
    for (const frame of value.stacktrace?.frames ?? []) {
      for (const key of Object.keys(frame)) if (!FRAME_KEYS.has(key)) delete frame[key];
    }
  }
  // Last line of defence: secrets that are only 1-3 chars long would redact noise, skip them.
  const usable = secrets.filter((secret) => secret.length >= 4);
  if (usable.length) redactSecrets(event, usable);
  return input;
}

export function secretValues(env: Record<string, string | undefined>): string[] {
  return SECRET_ENV_KEYS.map((key) => (env[key] ?? "").trim()).filter(Boolean);
}

export function sentryOptions(env: Record<string, string | undefined>) {
  const dsn = (env.SENTRY_DSN ?? "").trim() || undefined;
  const secrets = secretValues(env);
  return {
    dsn,
    enabled: Boolean(dsn),
    environment: env.SENTRY_ENVIRONMENT || "production",
    sendDefaultPii: false,
    tracesSampleRate: undefined,
    tracePropagationTargets: [] as string[],
    maxBreadcrumbs: 0,
    beforeSend: <T extends object>(event: T): T => scrubEvent(event, secrets),
    beforeSendTransaction: () => null,
  };
}
