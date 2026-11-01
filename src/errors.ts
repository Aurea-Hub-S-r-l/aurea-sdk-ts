/**
 * Typed errors, following docs.aureahub.com › Errors & Codes:
 * - branch on `status` first, then on `code` where the error has one (`details.code`, else the top-level `code`);
 * - `message` is for developers: never parse it;
 * - the sign-in routes' bodies keep only `error` and `message`: their code is read from `WWW-Authenticate`
 *   (`error_description="<CODE>"`);
 * - every answer carries `X-Request-ID`: quote it to help@aureahub.com.
 */

export const SUPPORT_EMAIL = "help@aureahub.com";

/** Base class of every error this SDK throws. */
export class AureaError extends Error {
  override name = "AureaError";
}

export interface ApiErrorInit {
  status: number;
  message: string;
  code: string | null;
  error?: string;
  details?: unknown;
  body?: unknown;
  requestId?: string | null;
  retryAfterSeconds?: number | null;
  method?: string;
  path?: string;
  headers?: Headers;
}

/** The API answered with a status outside 2xx. */
export class AureaApiError extends AureaError {
  override name = "AureaApiError";
  /** The HTTP status. Branch on it first. */
  readonly status: number;
  /** The stable code (`details.code ?? code`), or null when the error has none. */
  readonly code: string | null;
  /** The answer's `error` field (an error class name or label). */
  readonly error?: string;
  /** The answer's `details`, when there is one (validation problems, ids…). */
  readonly details?: unknown;
  /** The parsed body, or its text when it is not JSON. */
  readonly body?: unknown;
  /** X-Request-ID: quote it when you write to help@aureahub.com. */
  readonly requestId: string | null;
  /** On 429 (and some 503): seconds to wait, from `retry-after`. */
  readonly retryAfterSeconds: number | null;
  readonly method?: string;
  readonly path?: string;
  readonly headers?: Headers;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.status = init.status;
    this.code = init.code;
    this.error = init.error;
    this.details = init.details;
    this.body = init.body;
    this.requestId = init.requestId ?? null;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
    this.method = init.method;
    this.path = init.path;
    this.headers = init.headers;
  }
}

/** 400 or 422: fix the request (see `details`); sending it again fails the same way. */
export class AureaValidationError extends AureaApiError {
  override name = "AureaValidationError";
}
/** 401: a missing or expired access token, a failed tenant signature or server token. */
export class AureaAuthenticationError extends AureaApiError {
  override name = "AureaAuthenticationError";
}
/** 403: not allowed, or a module that is off for your tenant (`MODULE_NOT_ENABLED`). */
export class AureaPermissionError extends AureaApiError {
  override name = "AureaPermissionError";
}
/** 404: not found. */
export class AureaNotFoundError extends AureaApiError {
  override name = "AureaNotFoundError";
}
/** 409: a conflict, including the Idempotency-Key codes. */
export class AureaConflictError extends AureaApiError {
  override name = "AureaConflictError";
}
/** 410: a link, token or file past its time: ask for a new one. */
export class AureaGoneError extends AureaApiError {
  override name = "AureaGoneError";
}
/** 413: the body is larger than the route takes. */
export class AureaPayloadTooLargeError extends AureaApiError {
  override name = "AureaPayloadTooLargeError";
}
/** 423: frozen or quarantined; it answers the same until lifted: don't retry. */
export class AureaLockedError extends AureaApiError {
  override name = "AureaLockedError";
}
/** 429: too many requests; wait `retryAfterSeconds`. */
export class AureaRateLimitError extends AureaApiError {
  override name = "AureaRateLimitError";
}
/** 5xx: a server-side failure or a service temporarily unavailable. */
export class AureaServerError extends AureaApiError {
  override name = "AureaServerError";
}

/** The request did not get an answer: network failure or timeout. Whether it ran is not known. */
export class AureaConnectionError extends AureaError {
  override name = "AureaConnectionError";
  readonly method?: string;
  readonly path?: string;
  constructor(message: string, options?: { cause?: unknown; method?: string; path?: string }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.method = options?.method;
    this.path = options?.path;
  }
}

/** The client is not configured for this call (for example a signed route without an API secret). */
export class AureaConfigurationError extends AureaError {
  override name = "AureaConfigurationError";
}

const BY_STATUS: Record<number, typeof AureaApiError> = {
  400: AureaValidationError,
  401: AureaAuthenticationError,
  403: AureaPermissionError,
  404: AureaNotFoundError,
  409: AureaConflictError,
  410: AureaGoneError,
  413: AureaPayloadTooLargeError,
  422: AureaValidationError,
  423: AureaLockedError,
  429: AureaRateLimitError,
};

/** The code in `WWW-Authenticate: Bearer error="…", error_description="<CODE>"`, when it is one. */
export function codeFromWwwAuthenticate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /error_description="([A-Z0-9_]+)"/.exec(value);
  return match ? match[1] : null;
}

/** Seconds from a `retry-after` header (seconds or an HTTP date), or null. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  if (value == null || value.trim() === "") return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - now) / 1000));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The stable code of an error body: `details.code ?? code`, else null. */
export function errorCode(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const details = body.details;
  if (isRecord(details) && typeof details.code === "string") return details.code;
  return typeof body.code === "string" ? body.code : null;
}

/** Builds the typed error for a status, a parsed body and the answer's headers. */
export function createApiError(
  status: number,
  body: unknown,
  headers: Headers = new Headers(),
  request: { method?: string; path?: string } = {},
): AureaApiError {
  const record = isRecord(body) ? body : {};
  const code = errorCode(body) ?? (status === 401 || status === 403 ? codeFromWwwAuthenticate(headers.get("www-authenticate")) : null);
  const message =
    (typeof record.message === "string" && record.message) ||
    (typeof record.error === "string" && record.error) ||
    (typeof body === "string" && body.trim() && body.trim().slice(0, 500)) ||
    `HTTP ${status}`;
  const Ctor = BY_STATUS[status] ?? (status >= 500 ? AureaServerError : AureaApiError);
  return new Ctor({
    status,
    message,
    code,
    error: typeof record.error === "string" ? record.error : undefined,
    details: record.details,
    body,
    requestId: headers.get("x-request-id"),
    retryAfterSeconds: parseRetryAfter(headers.get("retry-after")),
    method: request.method,
    path: request.path,
    headers,
  });
}

/** Reads a non-2xx Response into its typed error (the body is consumed). */
export async function apiErrorFromResponse(response: Response, request: { method?: string; path?: string } = {}): Promise<AureaApiError> {
  const text = await response.text().catch(() => "");
  let body: unknown = text;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  } else {
    body = null;
  }
  return createApiError(response.status, body, response.headers, request);
}
