/**
 * Wallet access with email and PIN (preview — not available until announced).
 *
 * A tenant can let its users protect a new MPC wallet with their email and a PIN, as an option next to the device
 * key. The PIN never reaches your server or this SDK: the native SDK on the user's phone does every PIN step. From
 * your server you only read and change the tenant's setting, and read the answers' types and refusals:
 *
 *   const settings = await admin.walletAccess.getSettings();
 *   await admin.walletAccess.updateSettings({ emailPin: "allowed", acknowledgedTradeOff: true });
 *
 * While the feature is not announced, both routes answer 404 (`AureaNotFoundError`): read it as "not available".
 * Questions: help@aureahub.com.
 */
import { AureaApiError, AureaConfigurationError } from "./errors";
import type { RequestOptions } from "./client";

/** `off`: users cannot choose email and PIN. `allowed`: they can, when they create a wallet. */
export type EmailPinSetting = "off" | "allowed";

/** `GET`/`PUT /v1/tenant/settings/wallet-access`. */
export interface WalletAccessSettings {
  emailPin: EmailPinSetting;
  /** True whenever the route answers (while the feature is not available, the route answers 404). */
  available: boolean;
  /** When an admin acknowledged the trade-off (ISO 8601), or null. */
  acknowledgedAt: string | null;
  /** When the setting last changed (ISO 8601), or null when it was never saved. */
  updatedAt: string | null;
}

/**
 * The new setting. Allowing email and PIN needs `acknowledgedTradeOff: true`: the email inbox becomes one of the
 * factors that open the wallet, so the admin confirms they read the guide's limits. It is recorded and audited.
 */
export type UpdateWalletAccessSettingsInput =
  | { emailPin: "allowed"; acknowledgedTradeOff: true }
  | { emailPin: "off"; acknowledgedTradeOff?: true };

/** The end user's view of one MPC wallet: `GET /v1/mpc/wallets/{walletId}/access` (the wallet's owner only). */
export interface WalletAccessStatus {
  emailPin: {
    /** The tenant allows it and the wallet can use it (a v2 wallet created with email and PIN on the phone). */
    available: boolean;
    /** `none`: not set up. `active`: set up. `locked`: turned off after too many wrong tries. */
    state: "none" | "active" | "locked";
    /** The bound address, masked (for example `a***@example.com`). Only when `active`. */
    emailMasked?: string;
    /** Wrong PIN tries left before the PIN is locked (0..5). Only when `active`. */
    attemptsLeft?: number;
    /** Tries left for the life of this PIN (0..10, never reset). Only when `active`. */
    lifetimeLeft?: number;
  };
}

/** `POST …/access/email-pin/otp` (202). The same shape when a limit on the address applies. */
export interface WalletAccessCodeSent {
  otpId: string;
  /** Where the code went, masked. */
  sentTo: string;
  /** When the code expires (10 minutes; ISO 8601). */
  expiresAt: string;
  /** The earliest time to ask for another code (ISO 8601). */
  resendAfter: string;
}

/** `POST …/access/email-pin/otp/verify`. */
export interface WalletAccessCodeVerified {
  /** Short-lived (10 minutes); the native SDK uses it for the next steps. Never log it. */
  accessToken: string;
  expiresAt: string;
  /** Setting up only: the challenge the wallet's key signs (`authorize`). */
  registerChallenge?: string;
  /** Restoring only, when the wallet has email and PIN: 1 = six digits, 2 = passphrase. */
  pinKind?: 1 | 2;
  regId?: string;
}

/** `POST …/access/email-pin/authorize`. */
export interface WalletAccessAuthorized {
  authorized: true;
  /** The wallet already has email and PIN: the current PIN is proven before it is replaced. */
  existing?: { regId: string; pinKind: 1 | 2 };
}

/** `POST /v1/mpc/access/email-pin/secure` — the restore email's "Secure my wallet" link. */
export interface WalletAccessSecured {
  secured: true;
}

/** The refusals of the wallet access routes, with the HTTP status each is answered with. */
export const WALLET_ACCESS_ERROR_STATUS = {
  /** The tenant does not allow email and PIN: the user keeps the device key. */
  WALLET_ACCESS_NOT_ALLOWED: 403,
  /** The wallet cannot use email and PIN: only a v2 wallet created with it on the phone can. */
  WALLET_ACCESS_WALLET_UNSUPPORTED: 422,
  /** The code is wrong; `details.attemptsLeft` tries are left (5 per code). */
  WALLET_ACCESS_CODE_INVALID: 400,
  /** The code expired (10 minutes) or was already used. */
  WALLET_ACCESS_CODE_EXPIRED: 410,
  /** Too many codes or tries: wait `retryAfterSeconds`. */
  WALLET_ACCESS_CODE_RATE_LIMITED: 429,
  /** The access token expired (10 minutes) or is not for this wallet: start again with a new code. */
  WALLET_ACCESS_TOKEN_INVALID: 401,
  /** A setup is already in progress for this wallet: finish it, or start again after 15 minutes. */
  WALLET_ACCESS_REGISTRATION_EXISTS: 409,
  /** The wallet's key on this phone did not confirm the request. */
  WALLET_ACCESS_APPROVAL_INVALID: 403,
  /** The wallet's key must confirm the setup first (`authorize`). */
  WALLET_ACCESS_APPROVAL_REQUIRED: 403,
  /** The restore email's link was used or expired (24 hours). */
  WALLET_ACCESS_LINK_INVALID: 410,
  /** Changing or removing the PIN needs the current PIN proven first. */
  WALLET_ACCESS_PIN_PROOF_REQUIRED: 403,
  /** The PIN was locked after too many wrong tries: use the current phone, or restore with the backup file. */
  WALLET_ACCESS_PIN_LOCKED: 423,
  /** The PIN is wrong; `details.attemptsLeft` tries are left. */
  WALLET_ACCESS_PIN_PROOF_INVALID: 401,
  /** The wallet is not protected with email and PIN. */
  WALLET_ACCESS_NOT_REGISTERED: 404,
  /** PIN protection is not reachable right now: wait `retryAfterSeconds` (30). Nothing was counted. */
  WALLET_ACCESS_REALM_UNAVAILABLE: 503,
  /** The request is not valid: start the step again. */
  WALLET_ACCESS_REG_INVALID: 400,
  /** `updateSettings({ emailPin: "allowed" })` without `acknowledgedTradeOff: true`. */
  WALLET_ACCESS_ACK_REQUIRED: 400,
} as const;
export type WalletAccessErrorCode = keyof typeof WALLET_ACCESS_ERROR_STATUS;

/** `details.nextStep.action` of a wallet access refusal: what the app offers next. */
export type WalletAccessNextAction =
  | "use_device_key"
  | "enter_code_again"
  | "send_new_code"
  | "wait_and_retry"
  | "use_original_device"
  | "authorize"
  | "contact_support"
  | "enter_current_pin"
  | "restore_with_backup"
  | "enter_pin_again"
  | "start_again"
  | "acknowledge_trade_off";

/** The `details` of a wallet access refusal. */
export interface WalletAccessErrorDetails {
  code: WalletAccessErrorCode;
  nextStep?: { action: WalletAccessNextAction | (string & {}); retryAfterSeconds?: number };
  /** WALLET_ACCESS_CODE_INVALID and WALLET_ACCESS_PIN_PROOF_INVALID. */
  attemptsLeft?: number;
  /** WALLET_ACCESS_CODE_RATE_LIMITED and WALLET_ACCESS_REALM_UNAVAILABLE. */
  retryAfterSeconds?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A refusal of the wallet access routes: a code of WALLET_ACCESS_ERROR_STATUS answered with its status. */
export function isWalletAccessError(
  error: unknown,
): error is AureaApiError & { code: WalletAccessErrorCode; details: WalletAccessErrorDetails } {
  return (
    error instanceof AureaApiError &&
    typeof error.code === "string" &&
    Object.prototype.hasOwnProperty.call(WALLET_ACCESS_ERROR_STATUS, error.code) &&
    WALLET_ACCESS_ERROR_STATUS[error.code as WalletAccessErrorCode] === error.status &&
    isRecord(error.details)
  );
}

/** The tries left that a wrong code or a wrong PIN names, else null. */
export function walletAccessAttemptsLeft(error: unknown): number | null {
  if (!isWalletAccessError(error)) return null;
  const left = error.details.attemptsLeft;
  return typeof left === "number" && Number.isFinite(left) && left >= 0 ? left : null;
}

/** The next step a wallet access refusal names (`details.nextStep.action`), else null. */
export function walletAccessNextStep(error: unknown): string | null {
  if (!isWalletAccessError(error)) return null;
  const action = error.details.nextStep?.action;
  return typeof action === "string" ? action : null;
}

/** The part of the client the helpers use. */
export interface WalletAccessRequester {
  request<T = unknown>(method: string, path: string, options?: RequestOptions): Promise<T>;
}

export const WALLET_ACCESS_SETTINGS_PATH = "/v1/tenant/settings/wallet-access";

/**
 * The tenant's wallet access setting, for a tenant admin's session (`aurea.walletAccess`). Reading needs
 * `tenant.policies.read`, changing it `tenant.policies.write`.
 */
export class WalletAccess {
  constructor(private readonly client: WalletAccessRequester) {}

  /** `GET /v1/tenant/settings/wallet-access`. */
  getSettings(options: Pick<RequestOptions, "headers" | "signal"> = {}): Promise<WalletAccessSettings> {
    return this.client.request<WalletAccessSettings>("GET", WALLET_ACCESS_SETTINGS_PATH, options);
  }

  /** `PUT /v1/tenant/settings/wallet-access`. Turning it off keeps the wallets already set up working. */
  updateSettings(
    input: UpdateWalletAccessSettingsInput,
    options: Pick<RequestOptions, "headers" | "signal"> = {},
  ): Promise<WalletAccessSettings> {
    const emailPin = (input as { emailPin?: unknown } | null)?.emailPin;
    if (emailPin !== "off" && emailPin !== "allowed") {
      return Promise.reject(new AureaConfigurationError('emailPin must be "off" or "allowed".'));
    }
    const acknowledged = (input as { acknowledgedTradeOff?: unknown }).acknowledgedTradeOff === true;
    if (emailPin === "allowed" && !acknowledged) {
      return Promise.reject(
        new AureaConfigurationError(
          "Allowing email and PIN needs acknowledgedTradeOff: true (the API answers 400 WALLET_ACCESS_ACK_REQUIRED without it).",
        ),
      );
    }
    const body = acknowledged ? { emailPin, acknowledgedTradeOff: true as const } : { emailPin };
    return this.client.request<WalletAccessSettings>("PUT", WALLET_ACCESS_SETTINGS_PATH, { ...options, body });
  }
}
