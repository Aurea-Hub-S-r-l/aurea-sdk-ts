/**
 * @aureahub/sdk — TypeScript SDK for the Aurea API (https://docs.aureahub.com).
 * Questions: help@aureahub.com.
 */
export { Aurea, DEFAULT_BASE_URL } from "./client";
export type { AureaOptions, AccessToken, RequestOptions } from "./client";
export {
  signRequest,
  bodyHash,
  signingString,
  hmacSha256Hex,
  isSignedRoute,
  pathWithQuery,
  takesNoAccessToken,
} from "./signing";
export type { SignInput, SignedHeaders } from "./signing";
export { idempotencyKey, isValidIdempotencyKey, wasReplayed, withIdempotencyKey } from "./idempotency";
export { paginateOffset, paginatePages, paginateSkip, collect } from "./pagination";
export type { PaginateOptions, ItemOf } from "./pagination";
export {
  AureaError,
  AureaApiError,
  AureaValidationError,
  AureaAuthenticationError,
  AureaPermissionError,
  AureaNotFoundError,
  AureaConflictError,
  AureaGoneError,
  AureaPayloadTooLargeError,
  AureaLockedError,
  AureaRateLimitError,
  AureaServerError,
  AureaConnectionError,
  AureaConfigurationError,
  createApiError,
  apiErrorFromResponse,
  errorCode,
  parseRetryAfter,
  SUPPORT_EMAIL,
} from "./errors";
export type { ApiErrorInit } from "./errors";
export { createTransport, backoffMs } from "./transport";
export type { TransportOptions, FetchLike } from "./transport";
// The generated API classes and models (from the production OpenAPI document).
export * from "./generated/apis/index";
export * from "./generated/models/index";
export { Configuration, BASE_PATH, RequiredError } from "./generated/runtime";
export type { ConfigurationParameters, Middleware, InitOverrideFunction, ApiResponse } from "./generated/runtime";
export const VERSION = "0.1.0";
