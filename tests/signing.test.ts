import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bodyHash, isSignedRoute, pathWithQuery, signRequest, signingString, takesNoAccessToken } from "../src/signing";

/**
 * docs.aureahub.com publishes the algorithm and a reference helper (Authentication › HMAC Request Signing,
 * `signedHeaders()`), not fixed vectors. These vectors were produced by that helper, copied verbatim, with the clock
 * and the environment fixed (example credentials only).
 */
const apiKey = "ak_live_EXAMPLE_key";
const apiSecret = "as_EXAMPLE_secret";
const VECTORS = [
  {
    method: "POST",
    path: "/v1/auth/login",
    body: JSON.stringify({ username: "alice", password: "SecurePass123" }),
    timestamp: "1791297243",
    bodyHash: "bb138e9ad4e441af43f2563f6e1b067449669f0e3b30c202e0606c860a9dbd43",
    signature: "d1d085948cd2e8af37310ff0aa22315799942af1648e17ad557cf2334c6a1f4c",
  },
  {
    method: "GET",
    path: "/v1/tenant/public",
    body: "",
    timestamp: "1791297243",
    bodyHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    signature: "7cce722f4b59dfaa93906008e6dfe9d628f3fde10af3699a2db09820d08ead38",
  },
  {
    method: "GET",
    path: "/v1/tenant/public?lang=en",
    body: "",
    timestamp: "1791297300",
    bodyHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    signature: "b3b4365cf9e096c42c5609d3f689fb4e905db33900d5dedf064961a67e790272",
  },
  {
    method: "post",
    path: "/v1/auth/register",
    body: JSON.stringify({ username: "quickstart_alice", email: "alice@example.com", password: "SecurePass123" }),
    timestamp: "1791297243",
    bodyHash: "3aa22e84a261464d1555b6c84999b953a02950c0c19ef80e750df340f93f87f4",
    signature: "f03e93e4161d3ac47535cf7c33e496f99b7c3e7d608a0ce04006a3fcf0494af0",
  },
];

describe("signRequest — the docs' vectors", () => {
  for (const v of VECTORS) {
    it(`${v.method.toUpperCase()} ${v.path}`, async () => {
      expect(await bodyHash(v.body)).toBe(v.bodyHash);
      const headers = await signRequest({ method: v.method, path: v.path, body: v.body, apiKey, apiSecret, timestamp: v.timestamp });
      expect(headers).toEqual({ "x-tenant-api-key": apiKey, "x-timestamp": v.timestamp, "x-signature": v.signature });
    });
  }

  it("signs no body like an empty body (the SHA-256 of an empty string)", async () => {
    const a = await signRequest({ method: "GET", path: "/v1/tenant/public", apiKey, apiSecret, timestamp: 1791297243 });
    expect(a["x-signature"]).toBe(VECTORS[1].signature);
  });

  it("signs bytes like the same string", async () => {
    const v = VECTORS[0];
    const headers = await signRequest({ ...v, body: new TextEncoder().encode(v.body), apiKey, apiSecret });
    expect(headers["x-signature"]).toBe(v.signature);
  });

  it("signs the path and query of a full URL", async () => {
    const v = VECTORS[2];
    const headers = await signRequest({ ...v, path: `https://api.aureahub.com${v.path}`, apiKey, apiSecret });
    expect(headers["x-signature"]).toBe(v.signature);
  });

  it("matches node:crypto for random inputs (the server's own algorithm)", async () => {
    for (let i = 0; i < 25; i++) {
      const body = JSON.stringify({ n: Math.random(), s: "é✓".repeat(i) });
      const ts = String(1791297243 + i);
      const path = `/v1/auth/login?x=${i}`;
      const hash = createHash("sha256").update(body).digest("hex");
      const expected = createHmac("sha256", apiSecret).update(`POST\n${path}\n${ts}\n${hash}`).digest("hex");
      const headers = await signRequest({ method: "POST", path, body, apiKey, apiSecret, timestamp: ts });
      expect(headers["x-signature"]).toBe(expected);
    }
  });

  it("uses the current Unix time in seconds by default", async () => {
    const before = Math.floor(Date.now() / 1000);
    const headers = await signRequest({ method: "GET", path: "/v1/tenant/public", apiKey, apiSecret });
    const ts = Number(headers["x-timestamp"]);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(before + 2);
  });

  it("refuses missing credentials and a non-integer timestamp", async () => {
    await expect(signRequest({ method: "GET", path: "/", apiKey: "", apiSecret })).rejects.toThrow(/API key/);
    await expect(signRequest({ method: "GET", path: "/", apiKey, apiSecret, timestamp: "1.5" })).rejects.toThrow(/seconds/);
  });

  it("builds METHOD\\nPATH\\nTIMESTAMP\\nbodyHash", () => {
    expect(signingString("post", "/a?b=1", "1", "h")).toBe("POST\n/a?b=1\n1\nh");
    expect(pathWithQuery("https://api.aureahub.com/v1/x?y=1")).toBe("/v1/x?y=1");
  });
});

describe("isSignedRoute — docs › Authentication › Credentials by Route", () => {
  it.each([
    ["POST", "/v1/auth/register"],
    ["POST", "/v1/auth/login"],
    ["POST", "/v1/auth/mfa/verify"],
    ["POST", "/v1/auth/google"],
    ["POST", "/v1/auth/apple"],
    ["POST", "/v1/auth/forgot-password"],
    ["GET", "/v1/tenant/public?lang=en"],
    ["POST", "/v1/mpc/service/token"],
    ["GET", "/v1/ramp/card/customers/c1"],
    ["POST", "/v1/ramp/card/customers/c1/sessions"],
    ["DELETE", "/v1/ramp/card/customers/c1/wallets/evm"],
    ["GET", "/v1/earn/positions"],
    ["PATCH", "/v1/tokenized-assets/users/u/eligibility"],
  ])("%s %s is signed", (method, path) => expect(isSignedRoute(method, path)).toBe(true));

  it.each([
    ["POST", "/v1/auth/refresh"],
    ["POST", "/v1/auth/logout"],
    ["GET", "/v1/wallets/"],
    ["POST", "/v1/transactions/"],
    ["GET", "/v1/auth/login"],
    ["DELETE", "/v1/earn/x"],
  ])("%s %s is not signed", (method, path) => expect(isSignedRoute(method, path)).toBe(false));
});

describe("takesNoAccessToken — the routes a user's token is not sent on", () => {
  it.each([
    ["POST", "/v1/auth/login", true],
    ["GET", "/v1/tenant/public?lang=en", true],
    ["POST", "/v1/auth/refresh", true],
    ["GET", "/v1/auth/reset-password/validate?token=x", true],
    ["GET", "/health", true],
    ["GET", "/v1/admin/tenants/t/reports/r/download", true],
    ["GET", "/v1/earn/positions", false],
    ["GET", "/v1/tokens/meta/chains", false],
    ["GET", "/v1/wallets/", false],
  ])("%s %s → %s", (method, path, expected) => expect(takesNoAccessToken(method as string, path as string)).toBe(expected));
});
