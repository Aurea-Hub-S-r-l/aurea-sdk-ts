/**
 * The API's own verification of a server token, for the SDK's tests: the pure steps of aurea_api
 * src/modules/server-credentials/server-token.ts (commit c032f9a5), with the TypeScript types removed and nothing
 * else changed — the same regular expressions, the same order, the same refusal codes. The full verifier (credential
 * lookup, nonce, allow-list) was also run against this SDK's tokens in the API's own repository (see the PR).
 */
import { createHash, createPublicKey, timingSafeEqual, verify } from "node:crypto";

export const SERVER_TOKEN_TYPE = "aurea-server+jwt";
export const SERVER_TOKEN_MAX_LIFETIME_SECONDS = 30;
export const SERVER_TOKEN_CLOCK_SKEW_SECONDS = 10;
export const SERVER_TOKEN_MAX_LENGTH = 4096;
export const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_BASE64URL = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const HEADER_MEMBERS = new Set(["alg", "typ", "kid"]);
const BEARER = /^Bearer[ ]+([^\s]+)[ ]*$/i;

export class ServerAuthRefusal extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function decodePart(part) {
  const bytes = Buffer.from(part, "base64url");
  return bytes.toString("base64url") === part ? bytes : null;
}

export function jsonObject(part) {
  const bytes = decodePart(part);
  if (bytes === null) return null;
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function isServerTokenType(typ) {
  if (typeof typ !== "string") return false;
  const lower = typ.toLowerCase();
  return lower === SERVER_TOKEN_TYPE || lower === `application/${SERVER_TOKEN_TYPE}`;
}

export function serverTokenOf(authorization) {
  if (typeof authorization !== "string") return null;
  const match = BEARER.exec(authorization);
  if (!match) return null;
  const token = match[1];
  const dot = token.indexOf(".");
  if (dot <= 0 || dot > 1024) return null;
  const header = jsonObject(token.slice(0, dot));
  return header !== null && isServerTokenType(header["typ"]) ? token : null;
}

const malformed = () => new ServerAuthRefusal("SERVER_TOKEN_MALFORMED");

function isSeconds(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function parseServerToken(token) {
  if (token.length > SERVER_TOKEN_MAX_LENGTH) throw malformed();
  const parts = token.split(".");
  if (parts.length !== 3) throw malformed();
  const [headerPart = "", payloadPart = "", signaturePart = ""] = parts;
  const header = jsonObject(headerPart);
  if (header === null) throw malformed();
  for (const member of Object.keys(header)) {
    if (!HEADER_MEMBERS.has(member)) throw malformed();
  }
  if (header["alg"] !== "ES256") throw malformed();
  if (!isServerTokenType(header["typ"])) throw malformed();
  const kid = header["kid"];
  if (typeof kid !== "string" || !UUID.test(kid)) throw malformed();
  const payload = jsonObject(payloadPart);
  if (payload === null) throw malformed();
  const { uri, bodyHash, nonce, iat, exp } = payload;
  if (typeof uri !== "string" || uri.length === 0 || uri.length > 2048) throw malformed();
  if (typeof bodyHash !== "string" || !SHA256_BASE64URL.test(bodyHash)) throw malformed();
  if (typeof nonce !== "string" || !NONCE_PATTERN.test(nonce)) throw malformed();
  if (!isSeconds(iat) || !isSeconds(exp)) throw malformed();
  const signature = decodePart(signaturePart);
  if (signature === null || signature.length !== 64) throw malformed();
  return {
    kid: kid.toLowerCase(),
    claims: { uri, bodyHash, nonce, iat, exp },
    signingInput: Buffer.from(`${headerPart}.${payloadPart}`, "ascii"),
    signature,
  };
}

export function checkTokenTime(claims, nowSeconds) {
  const { iat, exp } = claims;
  if (exp <= iat || exp - iat > SERVER_TOKEN_MAX_LIFETIME_SECONDS) {
    throw new ServerAuthRefusal("SERVER_TOKEN_LIFETIME_INVALID");
  }
  if (iat > nowSeconds + SERVER_TOKEN_CLOCK_SKEW_SECONDS) {
    throw new ServerAuthRefusal("SERVER_TOKEN_NOT_YET_VALID");
  }
  if (nowSeconds >= exp + SERVER_TOKEN_CLOCK_SKEW_SECONDS) {
    throw new ServerAuthRefusal("SERVER_TOKEN_EXPIRED");
  }
}

export function signatureValid(token, key) {
  try {
    return verify("sha256", token.signingInput, { key, dsaEncoding: "ieee-p1363" }, token.signature);
  } catch {
    return false;
  }
}

export function requestUri(method, url) {
  return `${method} ${url}`;
}

export function bodyHashOf(rawBody) {
  return createHash("sha256").update(rawBody ?? Buffer.alloc(0)).digest("base64url");
}

export function checkRequestBinding(claims, request) {
  if (claims.uri !== requestUri(request.method, request.url)) {
    throw new ServerAuthRefusal("SERVER_TOKEN_URI_MISMATCH");
  }
  const expected = Buffer.from(bodyHashOf(request.rawBody));
  const given = Buffer.from(claims.bodyHash);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new ServerAuthRefusal("SERVER_TOKEN_BODY_MISMATCH");
  }
}

/**
 * Steps 2–5, 7, 12–13 for one request, as the API runs them: the refusal code, or "accepted".
 * `request` is { method, url (path and query as received), body (string, or undefined for none) }.
 */
export function verifyAsTheApi(token, publicJwk, request, nowSeconds) {
  try {
    const parsed = parseServerToken(token);
    checkTokenTime(parsed.claims, nowSeconds);
    const key = createPublicKey({ key: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y }, format: "jwk" });
    if (!signatureValid(parsed, key)) throw new ServerAuthRefusal("SERVER_TOKEN_SIGNATURE_INVALID");
    checkRequestBinding(parsed.claims, {
      method: request.method,
      url: request.url,
      rawBody: request.body === undefined ? undefined : Buffer.from(request.body, "utf8"),
    });
    return { outcome: "accepted", kid: parsed.kid, claims: parsed.claims };
  } catch (error) {
    if (error instanceof ServerAuthRefusal) return { outcome: error.code };
    throw error;
  }
}
