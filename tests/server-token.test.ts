import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  Aurea,
  AureaApiError,
  AureaConfigurationError,
  createApiError,
  createServerTokenSigner,
  createTransport,
  isServerAuthError,
  isServerCredentialError,
  isWalletProtectionError,
  SERVER_AUTH_ERROR_STATUS,
  SERVER_AUTH_NEXT_STEPS,
  serverTokenBodyHash,
  serverTokenSigningInput,
  serverTokenUri,
  takesServerTokenHeader,
  type ServerTokenSigner,
} from "../src/index";
import { serverTokenOf, verifyAsTheApi } from "./reference/hub-verifier.mjs";

/** A test-only P-256 key generated for these vectors: never register it. */
const TEST_PRIVATE_JWK = { kty: "EC", crv: "P-256", x: "4Dv9smesrz0UR27m1IPuaZ8eBr8GLoTnuoXQUNW1xRo", y: "JAQOzfwAzyoiscKmXe_e2nH_FUy8hpworgq97zhFx5I", d: "Hwi0I3B_l3XD3WN6QaB8uz4sbwkS2dDXb6yIXR9ue2U" }; // gitleaks:allow
const TEST_PRIVATE_PEM = [
  "-----BEGIN PRIVATE KEY-----",
  "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgHwi0I3B/l3XD3WN6", // gitleaks:allow
  "QaB8uz4sbwkS2dDXb6yIXR9ue2WhRANCAATgO/2yZ6yvPRRHbubUg+5pnx4GvwYu", // gitleaks:allow
  "hOe6hdBQ1bXFGiQEDs38AM8qIrHCpl3v3tpx/xVMvIacKK4Kve84RceS", // gitleaks:allow
  "-----END PRIVATE KEY-----",
].join("\n");

interface Vector {
  method: string;
  path: string;
  body: string;
  iat: number;
  nonce: string;
  placement: "authorization" | "header";
  bodyHash: string;
  signingInput: string;
  token: string;
}
const VECTORS = JSON.parse(readFileSync(new URL("./vectors/server-token.json", import.meta.url), "utf8")) as {
  kid: string;
  publicKeyJwk: { kty: string; crv: string; x: string; y: string };
  vectors: Vector[];
};
const KID = VECTORS.kid;
const PUBLIC = VECTORS.publicKeyJwk;

const decode = (part: string) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));

function fixedSigner(iat: number, nonces: string[], privateKey: unknown = TEST_PRIVATE_JWK): ServerTokenSigner {
  const queue = [...nonces];
  return createServerTokenSigner({
    kid: KID,
    privateKey: privateKey as JsonWebKey,
    now: () => iat + 0.75,
    nonce: () => queue.shift()!,
  });
}

describe("server token — byte-exact vectors", () => {
  for (const v of VECTORS.vectors) {
    it(`${v.method} ${v.path}`, async () => {
      expect(await serverTokenBodyHash(v.body)).toBe(v.bodyHash);
      expect(serverTokenUri(v.method.toLowerCase(), v.path)).toBe(`${v.method} ${v.path}`);
      expect(
        serverTokenSigningInput(KID, { uri: `${v.method} ${v.path}`, bodyHash: v.bodyHash, nonce: v.nonce, iat: v.iat, exp: v.iat + 30 }),
      ).toBe(v.signingInput);

      const token = await fixedSigner(v.iat, [v.nonce]).sign({ method: v.method, path: v.path, body: v.body || undefined });
      const [header, payload, signature] = token.split(".");
      // The same bytes as the vector (signed independently with node:crypto); ECDSA signatures differ each time.
      expect(`${header}.${payload}`).toBe(v.signingInput);
      expect(Object.keys(decode(header!))).toEqual(["alg", "typ", "kid"]);
      expect(decode(header!)).toEqual({ alg: "ES256", typ: "aurea-server+jwt", kid: KID });
      expect(Object.keys(decode(payload!))).toEqual(["uri", "bodyHash", "nonce", "iat", "exp"]);
      expect(signature).toMatch(/^[A-Za-z0-9_-]{86}$/); // 64 bytes r‖s

      // The API's verification accepts the SDK's token and the vector's, for this request, at iat.
      const request = { method: v.method, url: v.path, body: v.body || undefined };
      expect(verifyAsTheApi(token, PUBLIC, request, v.iat).outcome).toBe("accepted");
      expect(verifyAsTheApi(v.token, PUBLIC, request, v.iat).outcome).toBe("accepted");
      expect(takesServerTokenHeader(v.path)).toBe(v.placement === "header");
    });
  }

  it("bodyHash of bytes equals that of the same string, and of no body the empty string's", async () => {
    const text = '{"symbol":"EUR€"}';
    expect(await serverTokenBodyHash(new TextEncoder().encode(text))).toBe(await serverTokenBodyHash(text));
    expect(await serverTokenBodyHash(undefined)).toBe("47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU");
    expect(await serverTokenBodyHash(null)).toBe(await serverTokenBodyHash(""));
  });

  it("reads the key as a JWK, a PKCS#8 PEM, a KeyObject and a CryptoKey: each token verifies", async () => {
    const v = VECTORS.vectors[0]!;
    const cryptoKey = await crypto.subtle.importKey("jwk", TEST_PRIVATE_JWK, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const keyObject = createPrivateKey({ key: TEST_PRIVATE_JWK, format: "jwk" });
    for (const key of [TEST_PRIVATE_JWK, TEST_PRIVATE_PEM, keyObject, cryptoKey]) {
      const token = await fixedSigner(v.iat, [v.nonce], key).sign({ method: v.method, path: v.path, body: v.body });
      expect(verifyAsTheApi(token, PUBLIC, { method: v.method, url: v.path, body: v.body }, v.iat).outcome).toBe("accepted");
    }
  });

  it("a full URL is signed as its path and query", async () => {
    const token = await fixedSigner(1_800_000_000, ["abcdefghijklmnop"]).sign({
      method: "GET",
      path: "https://api.aureahub.com/v1/tenant/public?lang=en&x=%20y",
    });
    expect(decode(token.split(".")[1]!).uri).toBe("GET /v1/tenant/public?lang=en&x=%20y");
  });
});

describe("server token — what the API refuses", () => {
  const v = VECTORS.vectors[0]!;
  const request = { method: v.method, url: v.path, body: v.body };

  it("another body, path or method; a late or early clock; a token after 30 s + skew", async () => {
    const token = await fixedSigner(v.iat, [v.nonce]).sign({ method: v.method, path: v.path, body: v.body });
    expect(verifyAsTheApi(token, PUBLIC, { ...request, body: v.body + " " }, v.iat).outcome).toBe("SERVER_TOKEN_BODY_MISMATCH");
    expect(verifyAsTheApi(token, PUBLIC, { ...request, url: v.path + "?" }, v.iat).outcome).toBe("SERVER_TOKEN_URI_MISMATCH");
    expect(verifyAsTheApi(token, PUBLIC, { ...request, method: "PUT" }, v.iat).outcome).toBe("SERVER_TOKEN_URI_MISMATCH");
    expect(verifyAsTheApi(token, PUBLIC, request, v.iat + 39).outcome).toBe("accepted");
    expect(verifyAsTheApi(token, PUBLIC, request, v.iat + 40).outcome).toBe("SERVER_TOKEN_EXPIRED");
    expect(verifyAsTheApi(token, PUBLIC, request, v.iat - 11).outcome).toBe("SERVER_TOKEN_NOT_YET_VALID");
  });

  it("another key's signature", async () => {
    const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const token = await fixedSigner(v.iat, [v.nonce], other.privateKey).sign({ method: v.method, path: v.path, body: v.body });
    expect(verifyAsTheApi(token, PUBLIC, request, v.iat).outcome).toBe("SERVER_TOKEN_SIGNATURE_INVALID");
  });

  it("the API reads the SDK's Authorization as a server token, and an app session token as none", async () => {
    const token = await fixedSigner(v.iat, [v.nonce]).sign({ method: v.method, path: v.path, body: v.body });
    expect(serverTokenOf(`Bearer ${token}`)).toBe(token);
    expect(serverTokenOf("Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.x")).toBeNull();
  });

  it("random nonces: 43 base64url characters, all different", async () => {
    const signer = createServerTokenSigner({ kid: KID, privateKey: TEST_PRIVATE_JWK });
    const nonces = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const nonce = decode((await signer.sign({ method: "GET", path: "/v1/tenant/public" })).split(".")[1]!).nonce as string;
      expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
      nonces.add(nonce);
    }
    expect(nonces.size).toBe(50);
  });

  it("a signer never signs one nonce twice, and refuses a nonce the API would refuse", async () => {
    const signer = fixedSigner(v.iat, ["same-nonce-0123456789", "same-nonce-0123456789", "short"]);
    await signer.sign({ method: "GET", path: "/v1/tenant/public" });
    await expect(signer.sign({ method: "GET", path: "/v1/tenant/public" })).rejects.toThrow(/used once/);
    await expect(signer.sign({ method: "GET", path: "/v1/tenant/public" })).rejects.toThrow(/16 to 128/);
  });

  it("checks its options before any request", async () => {
    expect(() => createServerTokenSigner({ kid: "not-a-uuid", privateKey: TEST_PRIVATE_JWK })).toThrow(AureaConfigurationError);
    expect(() => createServerTokenSigner({ kid: KID, privateKey: TEST_PRIVATE_JWK, lifetimeSeconds: 31 })).toThrow(/1 to 30/);
    const { d: _d, ...publicOnly } = TEST_PRIVATE_JWK;
    await expect(createServerTokenSigner({ kid: KID, privateKey: publicOnly }).sign({ method: "GET", path: "/" })).rejects.toThrow(
      /private key/,
    );
    await expect(
      createServerTokenSigner({ kid: KID, privateKey: "-----BEGIN EC PRIVATE KEY-----\nAAAA\n-----END EC PRIVATE KEY-----" }).sign({
        method: "GET",
        path: "/",
      }),
    ).rejects.toThrow(/pkcs8/);
    await expect(
      createServerTokenSigner({ kid: KID, privateKey: { kty: "EC", crv: "P-384", x: "a", y: "b", d: "c" } }).sign({ method: "GET", path: "/" }),
    ).rejects.toThrow(/P-256/);
  });

  it("lifetimeSeconds sets exp", async () => {
    const signer = createServerTokenSigner({ kid: KID, privateKey: TEST_PRIVATE_JWK, lifetimeSeconds: 10, now: () => 1_800_000_000.9 });
    const claims = decode((await signer.sign({ method: "GET", path: "/" })).split(".")[1]!);
    expect([claims.iat, claims.exp]).toEqual([1_800_000_000, 1_800_000_010]);
  });
});

type Call = { url: string; method: string; headers: Record<string, string>; body: string | undefined };
function recorder(answer: () => Response = () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => (headers[key] = value));
    calls.push({ url, method: String(init.method), headers, body: init.body as string | undefined });
    return answer();
  });
  return { fetch, calls };
}

describe("the client with a server credential", () => {
  const NOW = 1_800_000_000;
  const signer = () => createServerTokenSigner({ kid: KID, privateKey: TEST_PRIVATE_JWK, now: () => NOW });

  it("signs a tenant-signed route with Authorization: Bearer <token>, and no HMAC header", async () => {
    const { fetch, calls } = recorder();
    const aurea = new Aurea({ serverToken: signer(), fetch });
    const body = { username: "alice", password: "SecurePass123" };
    await aurea.request("POST", "/v1/auth/login", { body });
    const [call] = calls;
    expect(Object.keys(call!.headers).filter((h) => h.startsWith("x-"))).toEqual([]);
    const token = call!.headers.authorization!.replace(/^Bearer /, "");
    expect(verifyAsTheApi(token, PUBLIC, { method: "POST", url: "/v1/auth/login", body: call!.body }, NOW).outcome).toBe("accepted");
  });

  it("accepts the signer's options in place of a signer", async () => {
    const { fetch, calls } = recorder();
    const aurea = new Aurea({ serverToken: { kid: KID, privateKey: TEST_PRIVATE_PEM, now: () => NOW }, fetch });
    await aurea.request("GET", "/v1/tenant/public", { query: { lang: "en" } });
    const token = calls[0]!.headers.authorization!.replace(/^Bearer /, "");
    expect(verifyAsTheApi(token, PUBLIC, { method: "GET", url: "/v1/tenant/public?lang=en" }, NOW).outcome).toBe("accepted");
  });

  it("a generated method of a tenant-signed operation is signed too (x-tenant-api-key is never sent)", async () => {
    const { fetch, calls } = recorder();
    const aurea = new Aurea({ serverToken: signer(), fetch });
    await aurea.tenants.v1TenantPublicGet().catch(() => undefined);
    expect(calls[0]!.headers["x-tenant-api-key"]).toBeUndefined();
    expect(calls[0]!.headers.authorization).toMatch(/^Bearer eyJ/);
  });

  it("on a route with the user's session (Earn, tokenized assets, Lending) the token goes in X-Aurea-Server-Token", async () => {
    const { fetch, calls } = recorder();
    const user = new Aurea({ serverToken: signer(), fetch }).withAccessToken("EXAMPLE_user_token");
    await user.request("GET", "/v1/earn/products", { query: { limit: 5 } });
    const { headers } = calls[0]!;
    expect(headers.authorization).toBe("Bearer EXAMPLE_user_token");
    expect(verifyAsTheApi(headers["x-aurea-server-token"]!, PUBLIC, { method: "GET", url: "/v1/earn/products?limit=5" }, NOW).outcome).toBe(
      "accepted",
    );
    expect(headers["x-signature"]).toBeUndefined();
  });

  it("a user's call on any other route carries no server token", async () => {
    const { fetch, calls } = recorder();
    const user = new Aurea({ serverToken: signer(), fetch }).withAccessToken("EXAMPLE_user_token");
    await user.request("GET", "/v1/wallets/");
    expect(calls[0]!.headers.authorization).toBe("Bearer EXAMPLE_user_token");
    expect(calls[0]!.headers["x-aurea-server-token"]).toBeUndefined();
  });

  it("each attempt carries a new token (a retry after 503 on a GET)", async () => {
    let n = 0;
    const { fetch, calls } = recorder(() =>
      n++ === 0 ? new Response("{}", { status: 503 }) : new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    const transport = createTransport({ serverToken: signer(), fetch, sleep: async () => undefined });
    await transport("https://api.aureahub.com/v1/tenant/public", { method: "GET" });
    expect(calls).toHaveLength(2);
    const nonces = calls.map((c) => decode(c.headers.authorization!.replace(/^Bearer /, "").split(".")[1]!).nonce);
    expect(nonces[0]).not.toBe(nonces[1]);
  });

  it("never both schemes: apiSecret with serverToken, or HMAC headers on a request, is refused before sending", async () => {
    expect(() => new Aurea({ apiKey: "ak", apiSecret: "as", serverToken: signer() })).toThrow(/SERVER_AUTH_SCHEMES_CONFLICT/);
    expect(() => createTransport({ apiKey: "ak", apiSecret: "as", serverToken: signer() })).toThrow(/not both/);
    const { fetch, calls } = recorder();
    const aurea = new Aurea({ serverToken: signer(), fetch });
    await expect(aurea.request("GET", "/v1/tenant/public", { headers: { "x-signature": "abc", "x-timestamp": "1" } })).rejects.toThrow(
      /one scheme/,
    );
    expect(calls).toHaveLength(0);
  });

  it("an apiKey next to serverToken is not sent on a signed route", async () => {
    const { fetch, calls } = recorder();
    const aurea = new Aurea({ apiKey: "ak_live_EXAMPLE", serverToken: signer(), fetch });
    await aurea.tenants.v1TenantPublicGet().catch(() => undefined);
    expect(calls[0]!.headers["x-tenant-api-key"]).toBeUndefined();
  });

  it("is refused in a browser without dangerouslyAllowSecretInBrowser", () => {
    const g = globalThis as { document?: unknown };
    g.document = {};
    try {
      expect(() => new Aurea({ serverToken: signer() })).toThrow(/server only/);
    } finally {
      delete g.document;
    }
  });

  it("Lending takes the user's session and the tenant's signature (HMAC or server token), as the API requires", async () => {
    const hmac = recorder();
    const viaHmac = new Aurea({ apiKey: "ak_live_EXAMPLE_key", apiSecret: "as_EXAMPLE_secret", fetch: hmac.fetch }).withAccessToken("EXAMPLE_user_token");
    await viaHmac.lending.v1LendingPositionsGet({} as never).catch(() => undefined);
    expect(hmac.calls[0]!.headers.authorization).toBe("Bearer EXAMPLE_user_token");
    expect(hmac.calls[0]!.headers["x-signature"]).toMatch(/^[0-9a-f]{64}$/);
    const token = recorder();
    const viaToken = new Aurea({ serverToken: signer(), fetch: token.fetch }).withAccessToken("EXAMPLE_user_token");
    await viaToken.request("POST", "/v1/lending/supply", { body: {} });
    const sent = token.calls[0]!;
    expect(sent.headers.authorization).toBe("Bearer EXAMPLE_user_token");
    expect(verifyAsTheApi(sent.headers["x-aurea-server-token"]!, PUBLIC, { method: "POST", url: "/v1/lending/supply", body: sent.body }, NOW).outcome).toBe(
      "accepted",
    );
  });

  it("the HMAC client is unchanged: same three headers, no server token", async () => {
    const { fetch, calls } = recorder();
    const aurea = new Aurea({ apiKey: "ak_live_EXAMPLE_key", apiSecret: "as_EXAMPLE_secret", fetch });
    await aurea.request("GET", "/v1/tenant/public");
    expect(Object.keys(calls[0]!.headers).sort()).toEqual(["x-signature", "x-tenant-api-key", "x-timestamp"]);
  });
});

describe("typed codes", () => {
  it("SERVER_TOKEN_REQUIRED (401) is a server auth error, with its next step", () => {
    const error = createApiError(401, { statusCode: 401, error: "UnauthorizedError", message: "m", details: { code: "SERVER_TOKEN_REQUIRED" } });
    expect(isServerAuthError(error)).toBe(true);
    expect(error.code).toBe("SERVER_TOKEN_REQUIRED");
    expect(SERVER_AUTH_NEXT_STEPS.SERVER_TOKEN_REQUIRED).toMatch(/Developers › Server credentials/);
  });

  it("the code from WWW-Authenticate when the body has none (the sign-in routes)", () => {
    const error = createApiError(
      401,
      { statusCode: 401, error: "Unauthorized", message: "m" },
      new Headers({ "www-authenticate": 'Bearer error="invalid_token", error_description="SERVER_TOKEN_EXPIRED"' }),
    );
    expect(isServerAuthError(error) && error.code).toBe("SERVER_TOKEN_EXPIRED");
  });

  it("the same code on another status is told apart (401 token vs 409 change)", () => {
    const onToken = createApiError(401, { details: { code: "SERVER_CREDENTIAL_REVOKED" } });
    const onChange = createApiError(409, { details: { code: "SERVER_CREDENTIAL_REVOKED" } });
    expect([isServerAuthError(onToken), isServerCredentialError(onToken)]).toEqual([true, false]);
    expect([isServerAuthError(onChange), isServerCredentialError(onChange)]).toEqual([false, true]);
  });

  it("the key protection and wallet setup codes", () => {
    expect(isWalletProtectionError(createApiError(503, { details: { code: "MPC_CUSTODY_TIER_NOT_READY" } }))).toBe(true);
    expect(isWalletProtectionError(createApiError(409, { details: { code: "MPC_WALLET_BACKUP_REQUIRED", walletId: "w", nextStep: "confirm_backup" } }))).toBe(
      true,
    );
    expect(isWalletProtectionError(createApiError(409, { details: { code: "CUSTODY_TIER_NOT_READY" } }))).toBe(true);
    expect(isWalletProtectionError(new Error("x"))).toBe(false);
    expect(createApiError(503, { details: { code: "MPC_CUSTODY_TIER_NOT_READY" } })).toBeInstanceOf(AureaApiError);
  });

  it("every refusal of the API's verifier has a status and a next step", () => {
    for (const code of Object.keys(SERVER_AUTH_ERROR_STATUS) as Array<keyof typeof SERVER_AUTH_ERROR_STATUS>) {
      expect(SERVER_AUTH_NEXT_STEPS[code].length).toBeGreaterThan(10);
    }
  });
});
