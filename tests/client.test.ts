import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  Aurea,
  AureaConfigurationError,
  AureaConflictError,
  AureaConnectionError,
  AureaRateLimitError,
  AureaServerError,
  createTransport,
  idempotencyKey,
  isValidIdempotencyKey,
  paginateOffset,
  collect,
  wasReplayed,
} from "../src/index";

const apiKey = "ak_live_EXAMPLE_key";
const apiSecret = "as_EXAMPLE_secret";

type Call = { url: string; method: string; headers: Record<string, string>; body: string | undefined };

function fakeFetch(answers: Array<Response | Error | ((call: Call) => Response)>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit = {}) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    const call = { url, method: String(init.method), headers, body: init.body as string | undefined };
    calls.push(call);
    const next = answers.length > 1 ? answers.shift()! : answers[0];
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(call) : next.clone();
  });
  return { fn, calls };
}

const ok = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });
const fail = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const expectedSignature = (method: string, path: string, ts: string, body = "") =>
  createHmac("sha256", apiSecret)
    .update(`${method}\n${path}\n${ts}\n${createHash("sha256").update(body).digest("hex")}`)
    .digest("hex");

describe("Aurea client", () => {
  it("signs the sign-in call of the generated AuthApi exactly as the docs say", async () => {
    const { fn, calls } = fakeFetch([ok({ accessToken: "EXAMPLE_token", refreshToken: "r", expiresIn: 900, user: { id: "u" } })]);
    const aurea = new Aurea({ apiKey, apiSecret, fetch: fn });
    const res = await aurea.auth.v1AuthLoginPost({ v1AuthLoginPostRequest: { username: "alice", password: "SecurePass123" } });
    expect(res.accessToken).toBe("EXAMPLE_token");
    const [call] = calls;
    expect(call.url).toBe("https://api.aureahub.com/v1/auth/login");
    expect(call.method).toBe("POST");
    expect(call.headers["x-tenant-api-key"]).toBe(apiKey);
    expect(call.headers["x-signature"]).toBe(expectedSignature("POST", "/v1/auth/login", call.headers["x-timestamp"], call.body));
    expect(call.headers.authorization).toBeUndefined();
  });

  it("sends the access token, not the signature, on a bearer route", async () => {
    const { fn, calls } = fakeFetch([ok({ data: [], pagination: { total: 0, limit: 50, offset: 0, hasMore: false } })]);
    const user = new Aurea({ apiKey, apiSecret, fetch: fn }).withAccessToken("EXAMPLE_access");
    await user.wallets.v1WalletsGet({ limit: 50 });
    expect(calls[0].url).toBe("https://api.aureahub.com/v1/wallets/?limit=50");
    expect(calls[0].headers.authorization).toBe("Bearer EXAMPLE_access");
    expect(calls[0].headers["x-signature"]).toBeUndefined();
    expect(calls[0].headers["x-tenant-api-key"]).toBeUndefined();
  });

  it("calls an access-token function before each call", async () => {
    const { fn, calls } = fakeFetch([ok({ data: [] })]);
    let n = 0;
    const aurea = new Aurea({ accessToken: async () => `EXAMPLE_${++n}`, fetch: fn });
    await aurea.request("GET", "/v1/wallets/");
    await aurea.request("GET", "/v1/wallets/");
    expect(calls.map((c) => c.headers.authorization)).toEqual(["Bearer EXAMPLE_1", "Bearer EXAMPLE_2"]);
  });

  it("signs a query string as part of the path (request())", async () => {
    const { fn, calls } = fakeFetch([ok({ name: "Tenant" })]);
    const aurea = new Aurea({ apiKey, apiSecret, fetch: fn });
    expect(await aurea.request("GET", "/v1/tenant/public", { query: { lang: "en" } })).toEqual({ name: "Tenant" });
    const c = calls[0];
    expect(c.headers["x-signature"]).toBe(expectedSignature("GET", "/v1/tenant/public?lang=en", c.headers["x-timestamp"]));
  });

  it("refuses a signed route without the API secret", async () => {
    const { fn } = fakeFetch([ok({})]);
    const aurea = new Aurea({ apiKey, fetch: fn });
    await expect(aurea.request("POST", "/v1/auth/login", { body: {} })).rejects.toBeInstanceOf(AureaConfigurationError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("throws the typed error from a generated method", async () => {
    const { fn } = fakeFetch([
      fail(409, { statusCode: 409, error: "ConflictError", message: "This Idempotency-Key was used for a different request.", details: { code: "IDEMPOTENCY_KEY_REUSED" } }, { "x-request-id": "req-abcdefgh" }),
    ]);
    const user = new Aurea({ accessToken: "EXAMPLE", fetch: fn });
    const err = await user.transactions
      .v1TransactionsPost({ idempotencyKey: "k1", v1TransactionsPostRequest: { walletId: "w", toAddress: "0x0", amount: "1" } as never })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AureaConflictError);
    expect(err.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(err.requestId).toBe("req-abcdefgh");
    expect(err.path).toBe("/v1/transactions/");
  });

  it("sends Idempotency-Key and reads idempotency-replayed", async () => {
    const { fn, calls } = fakeFetch([ok({ id: "tx" }, { "idempotency-replayed": "true" })]);
    const user = new Aurea({ accessToken: "EXAMPLE", fetch: fn });
    const key = idempotencyKey();
    expect(isValidIdempotencyKey(key)).toBe(true);
    const res = await user.requestRaw("POST", "/v1/transactions/", { body: { amount: "1" }, idempotencyKey: key });
    expect(calls[0].headers["idempotency-key"]).toBe(key);
    expect(wasReplayed(res)).toBe(true);
    expect(isValidIdempotencyKey("bad key!")).toBe(false);
  });

  it("paginates a generated list method", async () => {
    const total = 3;
    const { fn } = fakeFetch([
      (c) => {
        const offset = Number(new URL(c.url).searchParams.get("offset"));
        return ok({ data: offset < total ? [{ id: `w${offset}` }] : [], pagination: { total, limit: 1, offset, hasMore: offset + 1 < total } });
      },
    ]);
    const user = new Aurea({ accessToken: "EXAMPLE", fetch: fn });
    const wallets = await collect(paginateOffset((p) => user.wallets.v1WalletsGet(p) as Promise<any>, { limit: 1 }));
    expect(wallets.map((w: any) => w.id)).toEqual(["w0", "w1", "w2"]);
  });
});

describe("retries — only where the docs allow them", () => {
  const sleep = vi.fn(async () => undefined);
  const transport = (fetch: any, extra = {}) => createTransport({ apiKey, apiSecret, fetch, sleep, ...extra });

  it("retries 429 after retry-after, signing again with a new timestamp", async () => {
    let t = 1791297243;
    const { fn, calls } = fakeFetch([fail(429, { message: "Rate limit exceeded" }, { "retry-after": "2" }), ok({ ok: true })]);
    const res = await transport(fn, { now: () => t++ })("https://api.aureahub.com/v1/auth/login", { method: "POST", body: "{}" });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(sleep).toHaveBeenLastCalledWith(2000);
    expect(calls[0].headers["x-timestamp"]).not.toBe(calls[1].headers["x-timestamp"]);
    expect(calls[0].headers["x-signature"]).not.toBe(calls[1].headers["x-signature"]);
  });

  it("does not resend a POST without a key after 503 or a dropped connection", async () => {
    const a = fakeFetch([fail(503, { message: "unavailable" }), ok({})]);
    expect((await transport(a.fn)("https://api.aureahub.com/v1/transactions/", { method: "POST", body: "{}" })).status).toBe(503);
    expect(a.calls).toHaveLength(1);

    const b = fakeFetch([new TypeError("fetch failed"), ok({})]);
    const err = await transport(b.fn)("https://api.aureahub.com/v1/transactions/", { method: "POST", body: "{}" }).catch((e) => e);
    expect(err).toBeInstanceOf(AureaConnectionError);
    expect(err.message).toMatch(/Whether it ran is not known/);
    expect(b.calls).toHaveLength(1);
  });

  it("retries a POST with an Idempotency-Key after 503 and a dropped connection", async () => {
    const { fn, calls } = fakeFetch([fail(503, {}), new TypeError("fetch failed"), ok({ id: "tx" })]);
    const res = await transport(fn)("https://api.aureahub.com/v1/transactions/", {
      method: "POST",
      body: "{}",
      headers: { "Idempotency-Key": "k-1" },
    });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.headers["idempotency-key"] === "k-1")).toBe(true);
  });

  it("retries a GET after 502/504", async () => {
    const { fn, calls } = fakeFetch([fail(502, {}), fail(504, {}), ok({})]);
    expect((await transport(fn)("https://api.aureahub.com/v1/wallets/")).status).toBe(200);
    expect(calls).toHaveLength(3);
  });

  it("retries 409 IDEMPOTENCY_IN_PROGRESS, never IDEMPOTENCY_OUTCOME_UNKNOWN", async () => {
    const h = { "Idempotency-Key": "k-2" };
    const a = fakeFetch([fail(409, { details: { code: "IDEMPOTENCY_IN_PROGRESS" } }), ok({})]);
    expect((await transport(a.fn)("https://api.aureahub.com/v1/swap/execute", { method: "POST", body: "{}", headers: h })).status).toBe(200);
    const b = fakeFetch([fail(409, { details: { code: "IDEMPOTENCY_OUTCOME_UNKNOWN" } }), ok({})]);
    expect((await transport(b.fn)("https://api.aureahub.com/v1/swap/execute", { method: "POST", body: "{}", headers: h })).status).toBe(409);
    expect(b.calls).toHaveLength(1);
  });

  it("never retries 500, 423 or other 4xx", async () => {
    for (const status of [500, 423, 400, 401, 403, 404, 422]) {
      const { fn, calls } = fakeFetch([fail(status, {}), ok({})]);
      expect((await transport(fn)("https://api.aureahub.com/v1/wallets/")).status).toBe(status);
      expect(calls).toHaveLength(1);
    }
  });

  it("stops after maxRetries and gives the last answer as its typed error", async () => {
    const { fn, calls } = fakeFetch([fail(429, { statusCode: 429, message: "Rate limit exceeded, retry in 1 minute" }, { "retry-after": "1" })]);
    const aurea = new Aurea({ accessToken: "EXAMPLE", fetch: fn, maxRetries: 2 });
    const err = (await aurea.request("GET", "/v1/wallets/").catch((e) => e)) as AureaRateLimitError;
    expect(err).toBeInstanceOf(AureaRateLimitError);
    expect(err.retryAfterSeconds).toBe(1);
    expect(calls).toHaveLength(3);
  }, 10_000);

  it("does not wait for a retry-after longer than maxRetryDelayMs", async () => {
    const { fn, calls } = fakeFetch([fail(429, {}, { "retry-after": "3600" }), ok({})]);
    expect((await transport(fn)("https://api.aureahub.com/v1/wallets/")).status).toBe(429);
    expect(calls).toHaveLength(1);
  });

  it("maps a final 5xx to AureaServerError", async () => {
    const { fn } = fakeFetch([fail(500, { statusCode: 500, message: "Internal server error" })]);
    const err: unknown = await new Aurea({ fetch: fn }).request("GET", "/health").catch((e) => e);
    expect(err).toBeInstanceOf(AureaServerError);
  });
});
