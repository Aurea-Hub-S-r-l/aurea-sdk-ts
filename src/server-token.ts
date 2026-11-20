/**
 * Server tokens: how a tenant's server signs its calls with a server credential instead of the API key and secret
 * (docs.aureahub.com › Authentication › Server credentials). A server credential is a P-256 key pair the tenant
 * generates; the public key is registered in the console (Developers › Server credentials) and its credential id is
 * the token's `kid`. The private key never leaves the tenant's server.
 *
 * A server token is a compact JWS, signed ES256, valid for one request:
 *
 *   header  {"alg":"ES256","typ":"aurea-server+jwt","kid":"<credential id>"}       (these three members only)
 *   payload {"uri":"<METHOD> <path and query exactly as sent>",
 *            "bodyHash":"<unpadded base64url SHA-256 of the exact body bytes; of the empty string when none>",
 *            "nonce":"<16–128 of A-Z a-z 0-9 _ ->, never used twice",
 *            "iat":<Unix seconds>, "exp":<at most iat + 30>}
 *   signature  ECDSA P-256 / SHA-256 over `base64url(header).base64url(payload)`, as r‖s (64 bytes, JOSE)
 *
 * It travels as `Authorization: Bearer <token>` on the routes the tenant's signature alone opens, and in
 * `X-Aurea-Server-Token` on the routes where `Authorization` carries a signed-in user's access token (Lending, Earn,
 * tokenized assets). Never together with the HMAC headers: the API answers 400 SERVER_AUTH_SCHEMES_CONFLICT.
 *
 * Uses the Web Crypto API (globalThis.crypto.subtle): Node.js 20 or later, Deno, Bun, edge runtimes.
 */
import { AureaConfigurationError } from "./errors";
import { pathWithQuery } from "./signing";

/** The `typ` of a server token's header. */
export const SERVER_TOKEN_TYPE = "aurea-server+jwt";
/** The longest a server token may live: `exp` at most 30 seconds after `iat`. */
export const SERVER_TOKEN_MAX_LIFETIME_SECONDS = 30;
/** The header that carries the server token where `Authorization` is a signed-in user's. */
export const SERVER_TOKEN_HEADER = "X-Aurea-Server-Token";

/** A nonce: 16 to 128 characters of the base64url alphabet. */
export const SERVER_TOKEN_NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A KeyObject of node:crypto, read through its `export()` (the SDK does not import node:crypto). */
interface KeyObjectLike {
  type: string;
  asymmetricKeyType?: string;
  export(options: { format: "jwk" }): JsonWebKey;
}

export interface ServerTokenSignerOptions {
  /** The credential id the console shows after registration (a UUID): the token's `kid`. */
  kid: string;
  /**
   * The credential's P-256 private key, as one of:
   * - a JWK (`{ kty: "EC", crv: "P-256", x, y, d }`),
   * - a PKCS#8 PEM (`-----BEGIN PRIVATE KEY-----`, what `openssl genpkey` writes),
   * - a Web Crypto `CryptoKey` (ECDSA P-256, usage `sign`),
   * - a node:crypto `KeyObject` (`createPrivateKey(...)`).
   */
  privateKey: JsonWebKey | string | CryptoKey | KeyObjectLike;
  /** Seconds between `iat` and `exp`: 1 to 30. Default 30. */
  lifetimeSeconds?: number;
  /** For tests: Unix seconds (may be fractional; `iat` is its whole part). */
  now?: () => number;
  /** For tests: the nonce of each token. Default 32 random bytes in base64url (43 characters). */
  nonce?: () => string;
}

export interface ServerTokenRequest {
  /** HTTP method; upper-cased, as sent. */
  method: string;
  /** The path with its query string exactly as sent, e.g. `/v1/tenant/public?lang=en`. A full URL is reduced to it. */
  path: string;
  /** The exact body bytes or string sent; omitted, null or empty for no body. */
  body?: string | Uint8Array | null;
}

export interface ServerTokenClaims {
  uri: string;
  bodyHash: string;
  nonce: string;
  iat: number;
  exp: number;
}

/** Signs one server token per request. Keep it on your server: it holds the credential's private key. */
export interface ServerTokenSigner {
  /** The credential id (`kid`), lower case. */
  readonly kid: string;
  /** A fresh token for this request: a new nonce and `iat` every call. A retry needs a new token. */
  sign(request: ServerTokenRequest): Promise<string>;
}

const encoder = new TextEncoder();

function subtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) {
    throw new AureaConfigurationError("Web Crypto (globalThis.crypto.subtle) is not available: use Node.js 20 or later");
  }
  return c.subtle;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlText(text: string): string {
  return base64url(encoder.encode(text));
}

function toBytes(value: string | Uint8Array | null | undefined): Uint8Array {
  if (value == null) return new Uint8Array(0);
  return typeof value === "string" ? encoder.encode(value) : value;
}

/** `bodyHash`: unpadded base64url of SHA-256 of the exact body bytes (of the empty string when there is none). */
export async function serverTokenBodyHash(body?: string | Uint8Array | null): Promise<string> {
  return base64url(new Uint8Array(await subtle().digest("SHA-256", toBytes(body) as BufferSource)));
}

/** `uri`: the method, one space, the path and query exactly as sent. */
export function serverTokenUri(method: string, path: string): string {
  return `${method.toUpperCase()} ${pathWithQuery(path)}`;
}

/** A nonce of 32 random bytes in base64url (43 characters). */
export function randomServerTokenNonce(): string {
  const bytes = new Uint8Array(32);
  (globalThis as { crypto: Crypto }).crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/**
 * The routes where `Authorization` carries a signed-in user's access token and the tenant's server token goes in
 * `X-Aurea-Server-Token` instead: Lending, Earn and tokenized assets (docs › Server credentials › Where the token goes).
 */
export function takesServerTokenHeader(path: string): boolean {
  const p = pathWithQuery(path).split("?")[0]!;
  return /^\/v1\/(lending|earn|tokenized-assets)(\/|$)/.test(p);
}

function isKeyObject(value: unknown): value is KeyObjectLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as KeyObjectLike).export === "function" &&
    typeof (value as KeyObjectLike).type === "string"
  );
}

function isCryptoKey(value: unknown): value is CryptoKey {
  const Ctor = (globalThis as { CryptoKey?: abstract new () => CryptoKey }).CryptoKey;
  return Ctor !== undefined && value instanceof Ctor;
}

function pemToPkcs8(pem: string): Uint8Array {
  const match = /-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/.exec(pem);
  if (!match) {
    if (/-----BEGIN EC PRIVATE KEY-----/.test(pem)) {
      throw new AureaConfigurationError(
        "The server credential's key is a SEC1 PEM (BEGIN EC PRIVATE KEY): convert it to PKCS#8 with `openssl pkcs8 -topk8 -nocrypt -in key.pem -out key.p8.pem`, or pass it as a JWK or KeyObject.",
      );
    }
    throw new AureaConfigurationError("The server credential's key must be a PKCS#8 PEM (-----BEGIN PRIVATE KEY-----), a JWK, a CryptoKey or a KeyObject.");
  }
  const binary = atob(match[1]!.replace(/\s+/g, ""));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function checkJwk(jwk: JsonWebKey): JsonWebKey {
  if (jwk.kty !== "EC" || jwk.crv !== "P-256") {
    throw new AureaConfigurationError('The server credential\'s key must be a P-256 key (kty "EC", crv "P-256").');
  }
  if (typeof jwk.d !== "string" || typeof jwk.x !== "string" || typeof jwk.y !== "string") {
    throw new AureaConfigurationError("The server credential's key must be the private key (a JWK with d, x and y): the public key is what you register in the console.");
  }
  // Only what Web Crypto needs; `alg`, `use`, `key_ops`, `kid` of a generator are dropped.
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d, ext: false };
}

async function importSigningKey(key: ServerTokenSignerOptions["privateKey"]): Promise<CryptoKey> {
  const algorithm = { name: "ECDSA", namedCurve: "P-256" };
  if (isCryptoKey(key)) {
    const alg = key.algorithm as EcKeyAlgorithm;
    if (key.type !== "private" || alg.name !== "ECDSA" || alg.namedCurve !== "P-256" || !key.usages.includes("sign")) {
      throw new AureaConfigurationError("The server credential's CryptoKey must be an ECDSA P-256 private key with the usage sign.");
    }
    return key;
  }
  try {
    if (typeof key === "string") {
      return await subtle().importKey("pkcs8", pemToPkcs8(key) as BufferSource, algorithm, false, ["sign"]);
    }
    if (isKeyObject(key)) {
      if (key.type !== "private" || key.asymmetricKeyType !== "ec") {
        throw new AureaConfigurationError("The server credential's KeyObject must be an EC P-256 private key.");
      }
      return await subtle().importKey("jwk", checkJwk(key.export({ format: "jwk" })), algorithm, false, ["sign"]);
    }
    return await subtle().importKey("jwk", checkJwk(key as JsonWebKey), algorithm, false, ["sign"]);
  } catch (error) {
    if (error instanceof AureaConfigurationError) throw error;
    throw new AureaConfigurationError(`The server credential's private key could not be read as a P-256 key: ${(error as Error)?.message ?? error}`);
  }
}

/**
 * The header and payload of a server token, as the bytes are signed: `base64url(header).base64url(payload)`.
 * The header has exactly the members alg, typ, kid, in that order; the payload uri, bodyHash, nonce, iat, exp.
 */
export function serverTokenSigningInput(kid: string, claims: ServerTokenClaims): string {
  const header = JSON.stringify({ alg: "ES256", typ: SERVER_TOKEN_TYPE, kid });
  const payload = JSON.stringify({
    uri: claims.uri,
    bodyHash: claims.bodyHash,
    nonce: claims.nonce,
    iat: claims.iat,
    exp: claims.exp,
  });
  return `${base64urlText(header)}.${base64urlText(payload)}`;
}

/**
 * A signer of server tokens for one server credential.
 *
 *   const signer = createServerTokenSigner({ kid: process.env.AUREA_CREDENTIAL_ID, privateKey: jwk });
 *   const aurea = new Aurea({ serverToken: signer });              // the client signs every tenant-signed call
 *   // or, by hand:
 *   const token = await signer.sign({ method: 'GET', path: '/v1/tenant/public' });
 *   await fetch('https://api.aureahub.com/v1/tenant/public', { headers: { Authorization: `Bearer ${token}` } });
 */
export function createServerTokenSigner(options: ServerTokenSignerOptions): ServerTokenSigner {
  if (typeof options?.kid !== "string" || !UUID.test(options.kid)) {
    throw new AureaConfigurationError(
      "kid must be the server credential's id (a UUID), as the console shows it under Developers › Server credentials.",
    );
  }
  const kid = options.kid.toLowerCase();
  const lifetime = options.lifetimeSeconds ?? SERVER_TOKEN_MAX_LIFETIME_SECONDS;
  if (!Number.isInteger(lifetime) || lifetime < 1 || lifetime > SERVER_TOKEN_MAX_LIFETIME_SECONDS) {
    throw new AureaConfigurationError(`lifetimeSeconds must be a whole number from 1 to ${SERVER_TOKEN_MAX_LIFETIME_SECONDS}.`);
  }
  const now = options.now ?? (() => Date.now() / 1000);
  const nextNonce = options.nonce ?? randomServerTokenNonce;
  const keyPromise = importSigningKey(options.privateKey);
  // Unhandled until the first sign(): a bad key surfaces there, not as an unhandled rejection.
  keyPromise.catch(() => undefined);
  // The nonces of tokens that may still be live (until exp + a margin): never sign one twice from this signer.
  const recent = new Map<string, number>();

  return {
    kid,
    async sign(request: ServerTokenRequest): Promise<string> {
      const key = await keyPromise;
      const iat = Math.floor(now());
      const exp = iat + lifetime;
      for (const [nonce, until] of recent) if (until < iat) recent.delete(nonce);
      const nonce = nextNonce();
      if (typeof nonce !== "string" || !SERVER_TOKEN_NONCE_PATTERN.test(nonce)) {
        throw new AureaConfigurationError("A server token's nonce must be 16 to 128 characters of A-Z, a-z, 0-9, _ and -.");
      }
      if (recent.has(nonce)) {
        throw new AureaConfigurationError("A server token's nonce is used once: this signer already signed this nonce.");
      }
      recent.set(nonce, exp + 90);
      const claims: ServerTokenClaims = {
        uri: serverTokenUri(request.method, request.path),
        bodyHash: await serverTokenBodyHash(request.body),
        nonce,
        iat,
        exp,
      };
      const input = serverTokenSigningInput(kid, claims);
      // Web Crypto's ECDSA signature is already r‖s (IEEE P1363), the JOSE form: 64 bytes for P-256.
      const signature = new Uint8Array(
        await subtle().sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(input) as BufferSource),
      );
      return `${input}.${base64url(signature)}`;
    },
  };
}
