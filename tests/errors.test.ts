import { describe, expect, it } from "vitest";
import {
  AureaApiError,
  AureaAuthenticationError,
  AureaConflictError,
  AureaLockedError,
  AureaNotFoundError,
  AureaPermissionError,
  AureaRateLimitError,
  AureaServerError,
  AureaValidationError,
  apiErrorFromResponse,
  createApiError,
  errorCode,
  parseRetryAfter,
} from "../src/errors";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

describe("error mapping — docs › Errors & Codes", () => {
  it("reads the code from details.code", async () => {
    const err = await apiErrorFromResponse(
      json(409, { statusCode: 409, error: "ConflictError", message: "this backup proof was already used: start another", details: { code: "BACKUP_PROOF_USED" } }, { "x-request-id": "req-12345678" }),
      { method: "POST", path: "/v1/mpc/x" },
    );
    expect(err).toBeInstanceOf(AureaConflictError);
    expect(err).toBeInstanceOf(AureaApiError);
    expect(err.status).toBe(409);
    expect(err.code).toBe("BACKUP_PROOF_USED");
    expect(err.message).toBe("this backup proof was already used: start another");
    expect(err.error).toBe("ConflictError");
    expect(err.requestId).toBe("req-12345678");
    expect(err.method).toBe("POST");
    expect(err.path).toBe("/v1/mpc/x");
  });

  it("reads the top-level code (primary wallet, blockchain errors)", () => {
    const err = createApiError(409, { statusCode: 409, error: "Conflict", message: "A primary wallet already exists", code: "PRIMARY_WALLET_EXISTS" });
    expect(err.code).toBe("PRIMARY_WALLET_EXISTS");
  });

  it("prefers details.code over code", () => {
    expect(errorCode({ code: "A", details: { code: "B" } })).toBe("B");
    expect(errorCode({ details: [{ path: "x" }] })).toBeNull();
    expect(errorCode(null)).toBeNull();
  });

  it("has a null code when the error has none", () => {
    const err = createApiError(401, { statusCode: 401, error: "UnauthorizedError", message: "Authentication required" });
    expect(err).toBeInstanceOf(AureaAuthenticationError);
    expect(err.code).toBeNull();
  });

  it("reads the sign-in routes' code from WWW-Authenticate", () => {
    const headers = new Headers({ "www-authenticate": 'Bearer error="invalid_request", error_description="SERVER_TOKEN_REQUIRED"' });
    const err = createApiError(401, { error: "UnauthorizedError", message: "Invalid credentials" }, headers);
    expect(err.code).toBe("SERVER_TOKEN_REQUIRED");
    expect(err.message).toBe("Invalid credentials");
  });

  it.each([
    [400, AureaValidationError],
    [422, AureaValidationError],
    [401, AureaAuthenticationError],
    [403, AureaPermissionError],
    [404, AureaNotFoundError],
    [423, AureaLockedError],
    [429, AureaRateLimitError],
    [500, AureaServerError],
    [503, AureaServerError],
  ])("maps %i to its class", (status, Ctor) => {
    expect(createApiError(status, { message: "x" })).toBeInstanceOf(Ctor);
  });

  it("keeps validation details", () => {
    const details = [{ path: "/amount", message: "must be string" }];
    const err = createApiError(400, { statusCode: 400, error: "Bad Request", message: "Request validation failed", details });
    expect(err.details).toEqual(details);
    expect(err.code).toBeNull();
  });

  it("reads retry-after on 429", async () => {
    const err = await apiErrorFromResponse(json(429, { statusCode: 429, error: "Error", message: "Rate limit exceeded, retry in 1 minute" }, { "retry-after": "60" }));
    expect(err).toBeInstanceOf(AureaRateLimitError);
    expect(err.retryAfterSeconds).toBe(60);
  });

  it("falls back to error, then the text, then the status", async () => {
    expect(createApiError(400, { error: "Too many requests. Please try again later." }).message).toBe("Too many requests. Please try again later.");
    expect((await apiErrorFromResponse(new Response("Bad gateway", { status: 502 }))).message).toBe("Bad gateway");
    expect((await apiErrorFromResponse(new Response(null, { status: 500 }))).message).toBe("HTTP 500");
  });

  it("reads the framework's unknown-route body", () => {
    const err = createApiError(404, { message: "Route GET:/v1/unknown not found", error: "Not Found", statusCode: 404 });
    expect(err).toBeInstanceOf(AureaNotFoundError);
    expect(err.message).toBe("Route GET:/v1/unknown not found");
  });

  it("parses retry-after as seconds or a date", () => {
    expect(parseRetryAfter("5")).toBe(5);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 0)).toBe(10);
    expect(parseRetryAfter("soon")).toBeNull();
  });
});
