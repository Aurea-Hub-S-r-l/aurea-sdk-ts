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
export {
  createServerTokenSigner,
  serverTokenBodyHash,
  serverTokenUri,
  serverTokenSigningInput,
  randomServerTokenNonce,
  takesServerTokenHeader,
  SERVER_TOKEN_TYPE,
  SERVER_TOKEN_HEADER,
  SERVER_TOKEN_MAX_LIFETIME_SECONDS,
  SERVER_TOKEN_NONCE_PATTERN,
} from "./server-token";
export type { ServerTokenSigner, ServerTokenSignerOptions, ServerTokenRequest, ServerTokenClaims } from "./server-token";
export {
  SERVER_AUTH_ERROR_STATUS,
  SERVER_AUTH_NEXT_STEPS,
  SERVER_CREDENTIAL_ERROR_STATUS,
  WALLET_PROTECTION_ERROR_STATUS,
  BANK_RAMP_PROFILE_ERROR_STATUS,
  isServerAuthError,
  isServerCredentialError,
  isWalletProtectionError,
  isBankRampProfileInvalid,
  profileInvalidFields,
} from "./error-codes";
export type {
  ServerAuthErrorCode,
  ServerCredentialErrorCode,
  WalletProtectionErrorCode,
  BankRampProfileErrorCode,
  BankRampProfileInvalidDetails,
} from "./error-codes";
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
export const VERSION = "0.4.1";
