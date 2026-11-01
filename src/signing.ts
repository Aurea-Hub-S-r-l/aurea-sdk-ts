/**
 * HMAC request signing, exactly as docs.aureahub.com › Authentication › HMAC Request Signing describes:
 *
 *   bodyHash      = hex( SHA-256( raw request body ) )        // SHA-256 of an empty string when there is no body
 *   signingString = METHOD + "\n" + PATH + "\n" + TIMESTAMP + "\n" + bodyHash
 *   x-signature   = hex( HMAC-SHA256( key = API secret, message = signingString ) )
 *
 * PATH is the request path with its query string, exactly as in the request line; TIMESTAMP is Unix seconds, the same
 * string sent in x-timestamp. A signature is accepted once: a retry is signed again.
 *
 * Uses the Web Crypto API (globalThis.crypto.subtle): Node.js 20 or later, Deno, Bun, edge runtimes. Keep the API
 * secret on your server.
 */

export interface SignInput {
  /** HTTP method; upper-cased for signing. */
  method: string;
  /** The path with its query string, e.g. `/v1/tenant/public?lang=en`. A full URL is reduced to its path and query. */
  path: string;
  /** The exact body bytes or string sent; omitted or empty for no body. */
  body?: string | Uint8Array | null;
  /** Your tenant API key (x-tenant-api-key). */
  apiKey: string;
  /** Your tenant API secret. */
  apiSecret: string;
  /** Unix seconds; defaults to now. */
  timestamp?: number | string;
}

export interface SignedHeaders {
  "x-tenant-api-key": string;
  "x-timestamp": string;
  "x-signature": string;
}

const encoder = new TextEncoder();

function subtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) {
    throw new Error("Web Crypto (globalThis.crypto.subtle) is not available: use Node.js 20 or later");
  }
  return c.subtle;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

function toBytes(value: string | Uint8Array | null | undefined): Uint8Array {
  if (value == null) return new Uint8Array(0);
  return typeof value === "string" ? encoder.encode(value) : value;
}

/** The path and query of a path or URL, as the request line carries them. */
export function pathWithQuery(pathOrUrl: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(pathOrUrl)) {
    const url = new URL(pathOrUrl);
    return url.pathname + url.search;
  }
  return pathOrUrl;
}

/** hex(SHA-256(body)). */
export async function bodyHash(body?: string | Uint8Array | null): Promise<string> {
  return toHex(await subtle().digest("SHA-256", toBytes(body) as BufferSource));
}

/** METHOD\nPATH\nTIMESTAMP\nbodyHash */
export function signingString(method: string, path: string, timestamp: string, hash: string): string {
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${hash}`;
}

/** hex(HMAC-SHA256(secret, message)). */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await subtle().importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await subtle().sign("HMAC", key, encoder.encode(message)));
}

/** The three headers of a signed request. */
export async function signRequest(input: SignInput): Promise<SignedHeaders> {
  if (!input.apiKey || !input.apiSecret) throw new Error("Signing needs your tenant API key and API secret");
  const timestamp = String(input.timestamp ?? Math.floor(Date.now() / 1000));
  if (!/^\d+$/.test(timestamp)) throw new Error("The timestamp is Unix time in whole seconds");
  const path = pathWithQuery(input.path);
  const hash = await bodyHash(input.body);
  const signature = await hmacSha256Hex(input.apiSecret, signingString(input.method, path, timestamp, hash));
  return { "x-tenant-api-key": input.apiKey, "x-timestamp": timestamp, "x-signature": signature };
}

/**
 * The routes that check the tenant signature (docs › Authentication › Credentials by Route). Operations whose
 * OpenAPI security names `tenantSignature` are signed as well (the generated client sets x-tenant-api-key on them).
 */
const SIGNED_ROUTES: Array<[RegExp, RegExp]> = [
  [/^POST$/, /^\/v1\/auth\/(register|login|mfa\/verify|google|apple|forgot-password)$/],
  [/^GET$/, /^\/v1\/tenant\/public$/],
  [/^POST$/, /^\/v1\/mpc\/service\/token$/],
  [/^(GET|PUT)$/, /^\/v1\/ramp\/card\/customers\/[^/]+$/],
  [/^(GET|POST)$/, /^\/v1\/ramp\/card\/customers\/[^/]+\/sessions$/],
  [/^GET$/, /^\/v1\/ramp\/card\/customers\/[^/]+\/sessions\/[^/]+$/],
  [/^(PUT|DELETE)$/, /^\/v1\/ramp\/card\/customers\/[^/]+\/wallets\/[^/]+$/],
  [/^(GET|POST)$/, /^\/v1\/earn(\/.*)?$/],
  [/^(GET|POST|PATCH)$/, /^\/v1\/tokenized-assets(\/.*)?$/],
];

/** Whether a route checks the tenant signature. `path` may carry a query string. */
export function isSignedRoute(method: string, path: string): boolean {
  const m = method.toUpperCase();
  const p = pathWithQuery(path).split("?")[0].replace(/\/+$/, "") || "/";
  return SIGNED_ROUTES.some(([methods, route]) => methods.test(m) && route.test(p));
}

/**
 * The routes whose only credential is something else than a user's access token (docs › Credentials by Route):
 * the routes the tenant signature opens on its own, the refresh/logout/reset routes (the token is in the body or the
 * link) and the signed report download. A client with an access token sends it on every other route.
 */
export function takesNoAccessToken(method: string, path: string): boolean {
  const p = pathWithQuery(path).split("?")[0].replace(/\/+$/, "") || "/";
  if (/^\/v1\/(earn|tokenized-assets)(\/|$)/.test(p)) return false;
  if (isSignedRoute(method, p)) return true;
  return (
    /^\/v1\/auth\/(refresh|logout|reset-password(\/validate)?)$/.test(p) ||
    /^\/health(\/ready)?$/.test(p) ||
    /^\/v1\/admin\/tenants\/[^/]+\/reports\/[^/]+\/download$/.test(p)
  );
}
