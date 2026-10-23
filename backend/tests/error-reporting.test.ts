import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reportError, setErrorReporter } from "../src/lib/error-reporter.js";
import { buildRoutes, handleRequest } from "../src/server.js";
import { initErrorReporting } from "../src/instrument.js";

const ok = (_req: http.IncomingMessage, res: http.ServerResponse) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end("{}");
};

async function serve(usage: Parameters<typeof buildRoutes>[0]["usage"]) {
  const routes = buildRoutes({ usage, health: ok, ready: ok, firmwareManifest: ok, firmwareBinary: ok });
  const server = http.createServer((req, res) => handleRequest(routes, req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

afterEach(() => {
  setErrorReporter(undefined);
  vi.restoreAllMocks();
});

describe("reportError", () => {
  it("is a no-op without a reporter", () => {
    expect(() => reportError(new Error("x"))).not.toThrow();
  });

  it("passes the error to the installed reporter and swallows reporter failures", () => {
    const seen: unknown[] = [];
    setErrorReporter((err) => seen.push(err));
    const err = new Error("boom");
    reportError(err);
    expect(seen).toEqual([err]);

    setErrorReporter(() => {
      throw new Error("reporter down");
    });
    expect(() => reportError(err)).not.toThrow();
  });
});

describe("handleRequest", () => {
  it("answers 500 and reports when a handler rejects (was an unhandled rejection and a hung request)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const seen: unknown[] = [];
    setErrorReporter((err) => seen.push(err));
    const failure = new Error("adapter exploded with sk-secret");
    const { server, url } = await serve(async () => {
      throw failure;
    });
    try {
      const res = await fetch(`${url}/api/ai-usage`, { signal: AbortSignal.timeout(2000) });
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toEqual({ error: "internal_error" });
      expect(JSON.stringify(body)).not.toContain("sk-secret");
      expect(seen).toEqual([failure]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("answers 500 when a handler throws synchronously", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { server, url } = await serve(() => {
      throw new Error("sync");
    });
    try {
      const res = await fetch(`${url}/api/ai-usage`, { signal: AbortSignal.timeout(2000) });
      expect(res.status).toBe(500);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("initErrorReporting", () => {
  it("does nothing without SENTRY_DSN", () => {
    expect(initErrorReporting({})).toBe(false);
  });
});
