import { describe, expect, it } from "vitest";
import {
  Aurea,
  AureaConfigurationError,
  AureaLockedError,
  AureaNotFoundError,
  WALLET_ACCESS_ERROR_STATUS,
  createApiError,
  isWalletAccessError,
  walletAccessAttemptsLeft,
  walletAccessNextStep,
  type WalletAccessStatus,
} from "../src/index";

type Seen = { method: string; path: string; headers: Headers; body: unknown };

function fakeApi(answer: (seen: Seen) => Response) {
  const seen: Seen[] = [];
  const fetch = async (url: string, init: RequestInit = {}) => {
    const call = {
      method: String(init.method),
      path: new URL(url).pathname,
      headers: new Headers(init.headers),
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    };
    seen.push(call);
    return answer(call);
  };
  return { seen, fetch };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const settings = (emailPin: "off" | "allowed") => ({
  emailPin,
  available: true,
  acknowledgedAt: emailPin === "allowed" ? "2026-11-21T10:00:00.000Z" : null,
  updatedAt: "2026-11-21T10:00:00.000Z",
});

/** The tenant's wallet access setting (preview). */
describe("walletAccess settings", () => {
  it("reads the setting with the admin's session", async () => {
    const { seen, fetch } = fakeApi(() => json(200, settings("off")));
    const admin = new Aurea({ accessToken: "EXAMPLE", fetch });
    const answer = await admin.walletAccess.getSettings();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: "GET", path: "/v1/tenant/settings/wallet-access", body: undefined });
    expect(seen[0].headers.get("authorization")).toBe("Bearer EXAMPLE");
    expect(answer).toEqual(settings("off"));
  });

  it("allows email and PIN with the acknowledgement", async () => {
    const { seen, fetch } = fakeApi(() => json(200, settings("allowed")));
    const admin = new Aurea({ accessToken: "EXAMPLE", fetch });
    const answer = await admin.walletAccess.updateSettings({ emailPin: "allowed", acknowledgedTradeOff: true });
    expect(seen[0]).toMatchObject({
      method: "PUT",
      path: "/v1/tenant/settings/wallet-access",
      body: { emailPin: "allowed", acknowledgedTradeOff: true },
    });
    expect(seen[0].headers.get("content-type")).toBe("application/json");
    expect(answer.emailPin).toBe("allowed");
    expect(answer.acknowledgedAt).toBe("2026-11-21T10:00:00.000Z");
  });

  it("turns it off with exactly { emailPin: 'off' }", async () => {
    const { seen, fetch } = fakeApi(() => json(200, settings("off")));
    const admin = new Aurea({ accessToken: "EXAMPLE", fetch });
    await admin.walletAccess.updateSettings({ emailPin: "off" });
    expect(seen[0].body).toEqual({ emailPin: "off" });
  });

  it("refuses to allow it without the acknowledgement, before any call", async () => {
    const { seen, fetch } = fakeApi(() => json(200, settings("allowed")));
    const admin = new Aurea({ accessToken: "EXAMPLE", fetch });
    await expect(admin.walletAccess.updateSettings({ emailPin: "allowed" } as never)).rejects.toBeInstanceOf(
      AureaConfigurationError,
    );
    await expect(
      admin.walletAccess.updateSettings({ emailPin: "allowed", acknowledgedTradeOff: false } as never),
    ).rejects.toBeInstanceOf(AureaConfigurationError);
    await expect(admin.walletAccess.updateSettings({ emailPin: "on" } as never)).rejects.toBeInstanceOf(
      AureaConfigurationError,
    );
    expect(seen).toHaveLength(0);
  });

  it("drops acknowledgedTradeOff: false when turning it off (the API takes only true)", async () => {
    const { seen, fetch } = fakeApi(() => json(200, settings("off")));
    const admin = new Aurea({ accessToken: "EXAMPLE", fetch });
    await admin.walletAccess.updateSettings({ emailPin: "off", acknowledgedTradeOff: false } as never);
    expect(seen[0].body).toEqual({ emailPin: "off" });
  });

  it("answers 404 while the feature is not available", async () => {
    const { fetch } = fakeApi(() => json(404, { statusCode: 404, error: "Not Found", message: "Route GET:/v1/tenant/settings/wallet-access not found" }));
    const admin = new Aurea({ accessToken: "EXAMPLE", fetch });
    const error = await admin.walletAccess.getSettings().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AureaNotFoundError);
    expect(isWalletAccessError(error)).toBe(false);
  });

  it("keeps one helper per client and a new one per withAccessToken()", () => {
    const aurea = new Aurea({ accessToken: "EXAMPLE" });
    expect(aurea.walletAccess).toBe(aurea.walletAccess);
    expect(aurea.withAccessToken("OTHER").walletAccess).not.toBe(aurea.walletAccess);
  });
});

/** The refusals, as the Hub answers them (`details.code`, `details.nextStep`, `details.attemptsLeft`). */
describe("WALLET_ACCESS_* codes", () => {
  it("lists every code the API declares, with its status", () => {
    expect(Object.keys(WALLET_ACCESS_ERROR_STATUS).sort()).toEqual(
      [
        "WALLET_ACCESS_NOT_ALLOWED",
        "WALLET_ACCESS_WALLET_UNSUPPORTED",
        "WALLET_ACCESS_CODE_INVALID",
        "WALLET_ACCESS_CODE_EXPIRED",
        "WALLET_ACCESS_CODE_RATE_LIMITED",
        "WALLET_ACCESS_TOKEN_INVALID",
        "WALLET_ACCESS_REGISTRATION_EXISTS",
        "WALLET_ACCESS_APPROVAL_INVALID",
        "WALLET_ACCESS_APPROVAL_REQUIRED",
        "WALLET_ACCESS_LINK_INVALID",
        "WALLET_ACCESS_PIN_PROOF_REQUIRED",
        "WALLET_ACCESS_PIN_LOCKED",
        "WALLET_ACCESS_PIN_PROOF_INVALID",
        "WALLET_ACCESS_NOT_REGISTERED",
        "WALLET_ACCESS_REALM_UNAVAILABLE",
        "WALLET_ACCESS_REG_INVALID",
        "WALLET_ACCESS_ACK_REQUIRED",
      ].sort(),
    );
    expect(WALLET_ACCESS_ERROR_STATUS.WALLET_ACCESS_PIN_LOCKED).toBe(423);
    expect(WALLET_ACCESS_ERROR_STATUS.WALLET_ACCESS_WALLET_UNSUPPORTED).toBe(422);
    expect(WALLET_ACCESS_ERROR_STATUS.WALLET_ACCESS_REALM_UNAVAILABLE).toBe(503);
  });

  it("reads a wrong PIN's tries left and next step", () => {
    const error = createApiError(401, {
      statusCode: 401,
      error: "UnauthorizedError",
      message: "The PIN is not right.",
      details: { code: "WALLET_ACCESS_PIN_PROOF_INVALID", attemptsLeft: 2, nextStep: { action: "enter_pin_again" } },
    });
    expect(isWalletAccessError(error)).toBe(true);
    expect(walletAccessAttemptsLeft(error)).toBe(2);
    expect(walletAccessNextStep(error)).toBe("enter_pin_again");
  });

  it("reads a lock as 423 with the backup file as next step", () => {
    const error = createApiError(423, {
      statusCode: 423,
      error: "LockedError",
      message: "PIN protection was turned off after too many wrong tries.",
      details: { code: "WALLET_ACCESS_PIN_LOCKED", nextStep: { action: "restore_with_backup" } },
    });
    expect(error).toBeInstanceOf(AureaLockedError);
    expect(isWalletAccessError(error)).toBe(true);
    expect(walletAccessNextStep(error)).toBe("restore_with_backup");
    expect(walletAccessAttemptsLeft(error)).toBeNull();
  });

  it("reads the wait of a 503 from Retry-After", async () => {
    const { fetch } = fakeApi(() =>
      json(
        503,
        {
          statusCode: 503,
          error: "ServiceUnavailableError",
          message: "PIN protection is not reachable right now: try again in a minute.",
          details: { code: "WALLET_ACCESS_REALM_UNAVAILABLE", retryAfterSeconds: 30, nextStep: { action: "wait_and_retry", retryAfterSeconds: 30 } },
        },
        { "retry-after": "30" },
      ),
    );
    const user = new Aurea({ accessToken: "EXAMPLE", fetch, maxRetries: 0 });
    const error = await user
      .request("GET", "/v1/mpc/wallets/6f1d2c9e-4b7a-4e43-9a51-2f0c8d7e1a10/access")
      .catch((e: unknown) => e);
    expect(isWalletAccessError(error)).toBe(true);
    if (isWalletAccessError(error)) {
      expect(error.code).toBe("WALLET_ACCESS_REALM_UNAVAILABLE");
      expect(error.retryAfterSeconds).toBe(30);
    }
  });

  it("is not a wallet access error with another code, another status, or no details", () => {
    expect(isWalletAccessError(createApiError(400, { details: { code: "BANK_RAMP_PROFILE_INVALID" } }))).toBe(false);
    expect(isWalletAccessError(createApiError(400, { details: { code: "WALLET_ACCESS_PIN_LOCKED" } }))).toBe(false);
    expect(isWalletAccessError(createApiError(403, { code: "WALLET_ACCESS_NOT_ALLOWED" }))).toBe(false);
    expect(isWalletAccessError(new Error("WALLET_ACCESS_PIN_LOCKED"))).toBe(false);
    expect(walletAccessAttemptsLeft(new Error("x"))).toBeNull();
    expect(walletAccessNextStep(null)).toBeNull();
  });
});

/** The end user's status view (read by the app with the user's session; typed here for your server). */
describe("WalletAccessStatus", () => {
  it("types the status view as the API answers it", async () => {
    const view: WalletAccessStatus = {
      emailPin: { available: true, state: "active", emailMasked: "a***@example.com", attemptsLeft: 5, lifetimeLeft: 10 },
    };
    const { seen, fetch } = fakeApi(() => json(200, view));
    const user = new Aurea({ accessToken: "EXAMPLE", fetch });
    const answer = await user.request<WalletAccessStatus>("GET", "/v1/mpc/wallets/6f1d2c9e-4b7a-4e43-9a51-2f0c8d7e1a10/access");
    expect(seen[0].method).toBe("GET");
    expect(answer.emailPin.state).toBe("active");
    expect(answer.emailPin.attemptsLeft).toBe(5);
  });
});
