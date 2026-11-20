/**
 * The stable codes of server tokens, server credentials and key protection levels (docs.aureahub.com › Errors &
 * Codes), with the status each is answered with and what to do. Branch on `error.code` of an AureaApiError:
 *
 *   try { … } catch (e) {
 *     if (isServerAuthError(e)) console.error(e.code, SERVER_AUTH_NEXT_STEPS[e.code]);
 *   }
 */
import { AureaApiError } from "./errors";

/** Why a server token was refused (or not accepted), and its HTTP status. */
export const SERVER_AUTH_ERROR_STATUS = {
  /** The request carried a server token and the HMAC headers: send one scheme. */
  SERVER_AUTH_SCHEMES_CONFLICT: 400,
  /** The tenant signs with server credentials: HMAC is not accepted on this route. */
  SERVER_TOKEN_REQUIRED: 401,
  SERVER_TOKEN_MALFORMED: 401,
  SERVER_TOKEN_LIFETIME_INVALID: 401,
  SERVER_TOKEN_NOT_YET_VALID: 401,
  SERVER_TOKEN_EXPIRED: 401,
  SERVER_TOKEN_SIGNATURE_INVALID: 401,
  SERVER_TOKEN_URI_MISMATCH: 401,
  SERVER_TOKEN_BODY_MISMATCH: 401,
  SERVER_TOKEN_REPLAYED: 401,
  SERVER_CREDENTIAL_UNKNOWN: 401,
  SERVER_CREDENTIAL_REVOKED: 401,
  SERVER_CREDENTIAL_EXPIRED: 401,
  SERVER_CREDENTIAL_TENANT_INACTIVE: 401,
  SERVER_CREDENTIAL_TENANT_MISMATCH: 401,
  SERVER_CREDENTIAL_IP_NOT_ALLOWED: 401,
  SERVER_CREDENTIAL_ROLE_NOT_ALLOWED: 403,
  TEST_ONLY_CREDENTIAL: 403,
} as const;
export type ServerAuthErrorCode = keyof typeof SERVER_AUTH_ERROR_STATUS;

/** What to do about each refusal (for your logs; the API's `message` is for developers too, never parsed). */
export const SERVER_AUTH_NEXT_STEPS: Record<ServerAuthErrorCode, string> = {
  SERVER_AUTH_SCHEMES_CONFLICT: "Send either the server token or the HMAC headers (x-tenant-api-key, x-timestamp, x-signature), not both.",
  SERVER_TOKEN_REQUIRED:
    "This tenant signs with a server credential: register one in the console (Developers › Server credentials) and create the client with serverToken instead of apiKey/apiSecret.",
  SERVER_TOKEN_MALFORMED: "The token is not a server token: header {alg ES256, typ aurea-server+jwt, kid}, claims uri, bodyHash, nonce, iat, exp, and a 64-byte r‖s signature.",
  SERVER_TOKEN_LIFETIME_INVALID: "exp must be after iat, by 30 seconds at most.",
  SERVER_TOKEN_NOT_YET_VALID: "iat is in the future: synchronise your server's clock (NTP).",
  SERVER_TOKEN_EXPIRED: "The token expired: sign a new one for each request, just before sending it, and synchronise your server's clock.",
  SERVER_TOKEN_SIGNATURE_INVALID: "The signature does not match the credential's public key: sign with the private key of the credential named in kid.",
  SERVER_TOKEN_URI_MISMATCH: 'uri must be "<METHOD> <path and query exactly as sent>", for example "GET /v1/tenant/public?lang=en".',
  SERVER_TOKEN_BODY_MISMATCH: "bodyHash must be the SHA-256 of the exact body bytes sent (of the empty string when there is none), unpadded base64url.",
  SERVER_TOKEN_REPLAYED: "A token is accepted once: sign a new token, with a new nonce, for every request and every retry.",
  SERVER_CREDENTIAL_UNKNOWN: "kid names no server credential: use the credential id the console shows.",
  SERVER_CREDENTIAL_REVOKED: "The credential was revoked: sign with an active credential, or register a new one.",
  SERVER_CREDENTIAL_EXPIRED: "The credential expired: register a new one and move your server to it.",
  SERVER_CREDENTIAL_TENANT_INACTIVE: "The credential's tenant is not active: write to help@aureahub.com.",
  SERVER_CREDENTIAL_TENANT_MISMATCH: "The server token is another tenant's than the signed-in user's: sign with a credential of the user's tenant.",
  SERVER_CREDENTIAL_IP_NOT_ALLOWED: "This server's address is not in the credential's allowed IPs: add it in the console, or call from an allowed address.",
  SERVER_CREDENTIAL_ROLE_NOT_ALLOWED: "The credential's role does not hold the permission this route needs (details.permission): use a credential with a role that does.",
  TEST_ONLY_CREDENTIAL: "This credential is for test networks only: send the request for a test network, or sign it with a live credential.",
};

/** Why registering or changing a server credential was refused (the console's and the admin routes' answers). */
export const SERVER_CREDENTIAL_ERROR_STATUS = {
  SERVER_CREDENTIAL_KEY_INVALID: 400,
  SERVER_CREDENTIAL_PRIVATE_KEY: 400,
  SERVER_CREDENTIAL_NAME_INVALID: 400,
  SERVER_CREDENTIAL_ROLE_INVALID: 400,
  SERVER_CREDENTIAL_IP_INVALID: 400,
  SERVER_CREDENTIAL_EXPIRY_INVALID: 400,
  SERVER_CREDENTIAL_NOTHING_TO_CHANGE: 400,
  SERVER_CREDENTIAL_CURSOR_INVALID: 400,
  SERVER_CREDENTIAL_ROLE_ABOVE_OWN: 403,
  TEST_ONLY_CREDENTIALS_OFF: 403,
  SERVER_CREDENTIAL_NOT_FOUND: 404,
  SERVER_CREDENTIAL_KEY_IN_USE: 409,
  SERVER_CREDENTIAL_LIMIT: 409,
  SERVER_CREDENTIAL_REVOKED: 409,
  SERVER_CREDENTIAL_EXPIRED: 409,
} as const;
export type ServerCredentialErrorCode = keyof typeof SERVER_CREDENTIAL_ERROR_STATUS;

/** Key protection levels and wallet setup. */
export const WALLET_PROTECTION_ERROR_STATUS = {
  /** A key protection level that is not available yet for the tenant's wallet type (saving the configuration). */
  CUSTODY_TIER_NOT_READY: 409,
  /** A new MPC wallet could not be started: the tenant's key protection level is not available yet. Nothing was created. */
  MPC_CUSTODY_TIER_NOT_READY: 503,
  /** The MPC wallet cannot receive yet: the user has not kept its backup (`details.walletId`, `details.nextStep`). */
  MPC_WALLET_BACKUP_REQUIRED: 409,
} as const;
export type WalletProtectionErrorCode = keyof typeof WALLET_PROTECTION_ERROR_STATUS;

function hasCode<T extends string>(error: unknown, table: Record<T, number>): error is AureaApiError & { code: T } {
  return (
    error instanceof AureaApiError &&
    typeof error.code === "string" &&
    Object.prototype.hasOwnProperty.call(table, error.code) &&
    // SERVER_CREDENTIAL_REVOKED / _EXPIRED are 401 on a token and 409 on a change: the status tells which.
    table[error.code as T] === error.status
  );
}

/** A refused server token (or HMAC where the tenant must use one), with a code of SERVER_AUTH_ERROR_STATUS. */
export function isServerAuthError(error: unknown): error is AureaApiError & { code: ServerAuthErrorCode } {
  return hasCode(error, SERVER_AUTH_ERROR_STATUS);
}

/** A refused server credential registration or change. */
export function isServerCredentialError(error: unknown): error is AureaApiError & { code: ServerCredentialErrorCode } {
  return hasCode(error, SERVER_CREDENTIAL_ERROR_STATUS);
}

/** CUSTODY_TIER_NOT_READY, MPC_CUSTODY_TIER_NOT_READY or MPC_WALLET_BACKUP_REQUIRED. */
export function isWalletProtectionError(error: unknown): error is AureaApiError & { code: WalletProtectionErrorCode } {
  return hasCode(error, WALLET_PROTECTION_ERROR_STATUS);
}

/**
 * The bank ramp's customer profile (`PUT /v1/ramp/bank/customer/profile`, `aurea.bankRampUsdAccounts`): a profile the API refuses
 * answers 400 `BANK_RAMP_PROFILE_INVALID` with `details.fields`, the names (never the values) of the fields to give or
 * correct — for example `["confirmations.address"]` when only `subdivisionCode` was sent for an identity document that
 * prints no address — and, when the profile's values are refused, `details.nextStep` `"update_profile"`. Show a form for
 * the named fields, then save the whole profile again. The same names come in an account opening's or a USD account's
 * `nextStep.fields` (action `complete_profile`).
 */
export const BANK_RAMP_PROFILE_ERROR_STATUS = {
  BANK_RAMP_PROFILE_INVALID: 400,
} as const;
export type BankRampProfileErrorCode = keyof typeof BANK_RAMP_PROFILE_ERROR_STATUS;

/** The `details` of a 400 `BANK_RAMP_PROFILE_INVALID`. */
export interface BankRampProfileInvalidDetails {
  code: "BANK_RAMP_PROFILE_INVALID";
  /** The fields to give or correct, by name (`confirmations.address`, `parties.0.confirmations.address`…); a name in parentheses, such as `(body)`, means the request as a whole. */
  fields: string[];
  /** `"update_profile"` when the profile's values are refused. */
  nextStep?: string;
}

/** A refused profile: 400 `BANK_RAMP_PROFILE_INVALID` whose `details.fields` lists the fields by name. */
export function isBankRampProfileInvalid(
  error: unknown,
): error is AureaApiError & { code: BankRampProfileErrorCode; details: BankRampProfileInvalidDetails } {
  if (!hasCode(error, BANK_RAMP_PROFILE_ERROR_STATUS)) return false;
  const details = error.details;
  if (typeof details !== "object" || details === null || Array.isArray(details)) return false;
  const fields = (details as { fields?: unknown }).fields;
  return Array.isArray(fields) && fields.every((f) => typeof f === "string");
}

/** The field names a refused profile names (`details.fields`), or an empty list when the error is not one. */
export function profileInvalidFields(error: unknown): string[] {
  if (!isBankRampProfileInvalid(error)) return [];
  return [...error.details.fields];
}
