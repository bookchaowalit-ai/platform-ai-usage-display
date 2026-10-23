import { describe, expect, it } from "vitest";
import { REDACTED, safeMessage, scrubEvent, secretValues, sentryOptions } from "../src/sentry.js";

describe("sentryOptions", () => {
  it("stays disabled when SENTRY_DSN is unset or blank", () => {
    expect(sentryOptions({}).enabled).toBe(false);
    expect(sentryOptions({ SENTRY_DSN: "  " }).dsn).toBe(undefined);
  });

  it("reports errors only: no PII, tracing, trace headers or breadcrumbs", () => {
    const options = sentryOptions({ SENTRY_DSN: "https://key@o0.ingest.sentry.io/1" });
    expect(options.enabled).toBe(true);
    expect(options.sendDefaultPii).toBe(false);
    expect(options.tracesSampleRate).toBe(undefined);
    expect(options.tracePropagationTargets).toEqual([]);
    expect(options.maxBreadcrumbs).toBe(0);
    expect(options.beforeSendTransaction()).toBe(null);
  });

  it("redacts the configured tokens and keys inside beforeSend", () => {
    const env = {
      SENTRY_DSN: "https://key@o0.ingest.sentry.io/1",
      DEVICE_TOKEN: "device-token-1234567890",
      XAI_API_KEY: "xai-abcdefghijklmnop",
    };
    const event = options(env).beforeSend({
      exception: {
        values: [{ type: "Error", mechanism: { type: "generic", handled: true }, stacktrace: { frames: [{ function: "xai-abcdefghijklmnop" }] } }],
      },
      contexts: { runtime: { name: "node", note: "Bearer device-token-1234567890" } },
    });
    const text = JSON.stringify(event);
    expect(text).not.toContain("device-token-1234567890");
    expect(text).not.toContain("xai-abcdefghijklmnop");
    expect(text).toContain(REDACTED);
  });
});

function options(env: Record<string, string>) {
  return sentryOptions(env);
}

describe("secretValues", () => {
  it("collects only the known secret variables that are set", () => {
    expect(
      secretValues({ DEVICE_TOKEN: " dev ", RELAY_PUSH_TOKEN: "", PORT: "8787", OPENAI_ADMIN_API_KEY: "sk-admin" }),
    ).toEqual(["dev", "sk-admin"]);
  });
});

describe("safeMessage", () => {
  it("keeps the app's own fixed messages", () => {
    expect(safeMessage("Claude usage HTTP 429")).toBe("Claude usage HTTP 429");
    expect(safeMessage("local CLI timed out after 8000ms")).toBe("local CLI timed out after 8000ms");
    expect(safeMessage("md5 mismatch")).toBe("md5 mismatch");
  });

  it("redacts upstream text, paths and anything unknown", () => {
    expect(safeMessage("invalid x-api-key sk-ant-admin01-secret")).toBe(REDACTED);
    expect(safeMessage("ENOENT: no such file '/home/me/.claude/.credentials.json'")).toBe(REDACTED);
    expect(safeMessage("Claude usage HTTP 429 token=abc")).toBe(REDACTED);
    expect(safeMessage(undefined)).toBe(REDACTED);
  });
});

describe("scrubEvent", () => {
  it("rebuilds the event from the allowlist: no request, user, tags, extra or breadcrumbs", () => {
    const event = scrubEvent({
      event_id: "e1",
      level: "error",
      request: { url: "https://x/api/ai-usage", headers: { authorization: "Bearer secret" } },
      user: { ip_address: "1.2.3.4" },
      tags: { url: "https://x" },
      extra: { body: "secret" },
      breadcrumbs: [{ message: "fetch" }],
      server_name: "my-host",
      contexts: { runtime: { name: "node" }, os: { name: "linux" }, trace: { trace_id: "t" }, app: { x: 1 } },
    } as Record<string, unknown>);
    expect(event).toEqual({
      event_id: "e1",
      level: "error",
      contexts: { runtime: { name: "node" }, os: { name: "linux" } },
    });
  });

  it("keeps only location fields on stack frames and normalises the mechanism", () => {
    const event = scrubEvent({
      exception: {
        values: [
          {
            type: "Error",
            value: "upstream said: key sk-live-123 rejected",
            mechanism: { type: "generic", handled: false, data: { url: "https://x" } },
            stacktrace: {
              frames: [
                {
                  filename: "/app/dist/server.js",
                  function: "handle",
                  lineno: 10,
                  colno: 2,
                  in_app: true,
                  vars: { token: "secret" },
                  context_line: "const key = 'sk-live-123';",
                  pre_context: ["a"],
                },
              ],
            },
          },
        ],
      },
    });
    const value = event.exception?.values?.[0];
    expect(value?.value).toBe(REDACTED);
    expect(value?.mechanism).toEqual({ type: "generic", handled: false });
    expect(value?.stacktrace?.frames?.[0]).toEqual({
      filename: "/app/dist/server.js",
      function: "handle",
      lineno: 10,
      colno: 2,
      in_app: true,
    });
    expect(JSON.stringify(event)).not.toContain("sk-live-123");
  });

  it("drops the message of linked cause errors and redacts a free-text event message", () => {
    const event = scrubEvent({
      message: "fetch https://api.x.ai/?key=abc failed",
      exception: { values: [{ type: "TypeError", value: "fetch failed", mechanism: { type: "chained", source: "cause" } }] },
    });
    expect(event.message).toBe(REDACTED);
    expect(event.exception?.values?.[0]).toEqual({ type: "TypeError", mechanism: { type: "chained", handled: undefined } });
  });

  it("ignores secrets too short to redact safely", () => {
    const event = scrubEvent({ level: "error" }, ["e"]);
    expect(event).toEqual({ level: "error" });
  });
});
