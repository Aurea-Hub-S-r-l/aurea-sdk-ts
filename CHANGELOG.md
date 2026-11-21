# Changelog

## Unreleased

### Added (preview — not available until announced)
- Wallet access with email and PIN: `aurea.walletAccess.getSettings()` and
  `updateSettings({ emailPin, acknowledgedTradeOff })` over `GET`/`PUT /v1/tenant/settings/wallet-access` (a tenant
  admin's session). Allowing it without `acknowledgedTradeOff: true` is refused before the call. The routes answer
  404 until the feature is announced.
- `WALLET_ACCESS_ERROR_STATUS` (17 codes with their status), `isWalletAccessError()`, `walletAccessAttemptsLeft()`,
  `walletAccessNextStep()`, and the types of the end-user routes' answers (`WalletAccessStatus`,
  `WalletAccessCodeSent`, `WalletAccessCodeVerified`, `WalletAccessAuthorized`, `WalletAccessSecured`). Hand-written:
  the routes are not in the published API document yet.

## 0.4.1 — 21 November 2026 — the profile's fields

Generated from the production OpenAPI document of 21 November 2026 (sha256 `8adc3a1b…dd76`). 585 routes, as in 0.4.0.
Nothing is removed and no call changes shape: every change below adds a field, a value or loosens a type.

### Added
- `nextStep.fields` on an account opening (`bankRampAccountOpenings`: open, list, get, questionnaire, next step,
  upgrade), on the customer's USD account (`bankRampUsdAccounts`: the account and its information) and in the
  verification's `account.nextStep` (`bankRampLocal`: `v1RampBankCustomerVerificationGet`/`Post`): the names of the profile's fields to give or correct, for example `["confirmations.address"]` when
  only `subdivisionCode` was sent for an identity document that prints no address. Names only, never values. Show a
  form for them, then save the whole profile again (`v1RampBankCustomerProfilePut`).
- Typed refusal of a profile: `isBankRampProfileInvalid(error)` narrows an `AureaApiError` to 400
  `BANK_RAMP_PROFILE_INVALID` with `details.fields` (`string[]`) and `details.nextStep` (`"update_profile"` when the
  profile's values are refused); `profileInvalidFields(error)` returns the names (an empty list for any other error);
  `BANK_RAMP_PROFILE_ERROR_STATUS`, types `BankRampProfileErrorCode` and `BankRampProfileInvalidDetails`.
- Rotating the API key or secret answers until when the old one still works, where a rotation keeps it for a while:
  `previousKeyValidUntil`, `previousSecretValidUntil`.
- The quorum's decisions take the approver's passkey step-up (`stepUpToken`) as well as the password; the requests
  say `awaitingAurea` and `byAurea`, and can carry the action `custody.tier_activation.request` (a new value: an
  exhaustive `switch` on the action needs a case for it).
- An optional `idempotencyKey` (sent as `Idempotency-Key`) on registering a bank ramp customer
  (`v1RampBankCustomerPost`) and on making their wallet (`v1RampBankCustomerWalletsPost`): a repeat with the same key
  answers the first answer.
- The descriptions of the generated calls and models, as the API documents them today.

## 0.4.0 — 20 November 2026 — server credentials

### Added
- Server credentials: `createServerTokenSigner({ kid, privateKey })` signs a server token per request (ES256, header
  `{alg, typ: "aurea-server+jwt", kid}`, claims `uri`, `bodyHash`, `nonce`, `iat`, `exp` ≤ `iat` + 30, r‖s signature);
  `new Aurea({ serverToken })` signs every tenant-signed route with it instead of HMAC — in `Authorization: Bearer` on
  the routes the tenant's signature alone opens, in `X-Aurea-Server-Token` on Earn, Lending and tokenized assets — with
  a new token on every retry. `apiSecret` and `serverToken` together are refused (the API answers 400
  `SERVER_AUTH_SCHEMES_CONFLICT` to both schemes). The key: a PKCS#8 PEM, a JWK, a node:crypto `KeyObject` or a Web
  Crypto `CryptoKey`; refused in a browser page like the API secret. Helpers: `serverTokenBodyHash`, `serverTokenUri`,
  `serverTokenSigningInput`, `takesServerTokenHeader`. Test vectors in `tests/vectors/server-token.json`, checked with
  the API's own verifier.
- Typed codes: `SERVER_AUTH_ERROR_STATUS` + `SERVER_AUTH_NEXT_STEPS` (`SERVER_TOKEN_*`, `SERVER_CREDENTIAL_*`,
  `SERVER_AUTH_SCHEMES_CONFLICT`, `TEST_ONLY_CREDENTIAL`), `SERVER_CREDENTIAL_ERROR_STATUS`, and
  `WALLET_PROTECTION_ERROR_STATUS` (`CUSTODY_TIER_NOT_READY` 409, `MPC_CUSTODY_TIER_NOT_READY` 503,
  `MPC_WALLET_BACKUP_REQUIRED` 409), with `isServerAuthError()`, `isServerCredentialError()`, `isWalletProtectionError()`.

### Fixed
- The Lending routes (`/v1/lending/*`, `aurea.lending`) are now signed: the API checks the tenant's signature there next
  to the user's session, as on Earn, and the OpenAPI document does not say so. A client without `apiKey`/`apiSecret`
  (or `serverToken`) now gets `AureaConfigurationError` before sending, instead of the API's 401.

## 0.3.1 — 17 November 2026 — returned payouts, Open an Account

Generated from the production OpenAPI document of 17 November 2026, after the Accounts API was published and its
Idempotency-Key declared (sha256 `b6156cde…92c1`). 585 routes (577 in 0.3.0, plus the 8 below).

### Added
- `bankRampAccountOpenings`: the Accounts API (docs.aureahub.com › Guides: Bank Ramp › Open an Account), on request:
  open (or read) the customer's account opening, list openings, get one, the questionnaire and its answers, the
  industries, the next step, and an update of the account — `v1RampBankCustomerAccountOpenings*`. Until the Accounts
  API is on for your tenant in an environment, these routes answer 404 (`AureaNotFoundError`).
  `v1RampBankCustomerAccountOpeningsPost()` takes an optional `idempotencyKey` (sent as `Idempotency-Key`): a repeat
  with the same key answers the first opening.
- `AureaApiError.retryAfterSeconds` also reads the answer's `details.retryAfterSeconds` when there is no
  `Retry-After` header (409 `ACCOUNT_OPENING_BUSY`, 503 `ACCOUNT_OPENING_TRY_LATER`, from a browser that cannot read the
  header).

### Changed
- Type names: the body of `bankRampUsdAccounts.v1RampBankCustomerAccountsWalletTransfersIdCancelPost()` (`{ isTestnet? }`)
  is now the shared type `V1RampBankCustomerAccountOpeningsOpeningIdUpgradePostRequest` (the generator names one type
  per shape), passed as `v1RampBankCustomerAccountOpeningsOpeningIdUpgradePostRequest`; the method's parameter type is
  now named `V1RampBankCustomerAccountsWalletTransfersIdCancelPostRequest` (was `…CancelPostOperationRequest`). The call
  and what it sends are unchanged; only code that names these types changes.
- The event types of the webhook endpoints (admin routes: `webhooks.v1AdminTenantsIdWebhookEndpoints*`) add
  `remittance.payout.returned`: a Remittance payout that had completed was returned by the bank and its money came back
  to the customer's account. Its body is the other `remittance.payout.*` events' body with `status` `returned` and
  `failureReason` `ACCOUNT_PAYOUT_RETURNED`; `returned` is final; `finishedAt` is then the time of the return. New value
  in the event-type enums (requests and answers): handle a value you do not know (a `switch` with an exhaustive `never`
  check no longer compiles).
- The Remittance payout's `status` (now also `returned`) is not a type of this SDK: the event bodies are published in
  the OpenAPI document as `WebhookEvent.remittance.payout.<type>.v1`, and no route the SDK calls answers them. Read
  `status` as a string and ignore a value you do not know.
- The quorum requests' `action` filter (`quorum.v1QuorumRequestsGet()`) adds
  `mpc_confirmation.email_code.allow_for_tenant`. New value in the enum: handle a value you do not know.
- Nothing else changes in the existing routes: same methods, same errors.

## 0.3.0 — 16 November 2026 — step-up headers

Generated from the production OpenAPI document of 16 November 2026 (sha256 `14ef3bd6…ce3c5`). 577 routes (as 0.2.0).

### Added
- `xAureaStepUp`, the passkey step-up token, as an optional parameter of the methods whose route requires it when
  Aurea asks for a step-up: the USD account's payouts and wallet transfers, the local rails' off-ramps and
  withdrawals, the desk order's confirmation, the bank ramp payouts (`bank_ramp.payout`) and the pay-in's
  destination change (`bank_ramp.destination_change`). The header set by hand (0.2.0's function form) still works.
  `bankRampPayout.v1RampBankPayoutPayoutsPost()` checks the token before the Idempotency-Key: a retry needs a new one
  (README › Step-up headers).

### Breaking changes (from 0.2.0)
- `bankRampUsdAccounts.v1RampBankCustomerBeneficiariesPost()`: `idempotencyKey` is `string` (was `string | null`). A
  TypeScript caller passing `null` there no longer compiles: leave the key out instead. Nothing changes at run time.

### Changed
- The event types of the webhook endpoints and of the environments' webhooks (admin routes) add
  `mpc.confirmation.required`, `mpc.confirmation.confirmed` and `ramp.accounts.updated` (a customer's account opening
  changed: its state, its accounts' states, the next step asked or an account update offered). New values in answer
  enums: handle a value you do not know (a `switch` with an exhaustive `never` check no longer compiles).
- The client no longer retries `bankRampPayout.v1RampBankPayoutPayoutsPost()` when it carries a step-up token (except
  after a `429`): the API spends the token before the Idempotency-Key, so a retry was refused 403 `STEP_UP_INVALID`
  even when the first request ran. After no answer it throws `AureaConnectionError`: ask a new step-up and send it
  again with the same Idempotency-Key (README › Step-up headers).
- The USD account routes' Idempotency-Key is documented as the API checks it (1–255 letters, digits, `-` or `_`).
- Doc comments: the bank ramp's own field names replaced by what the value is; the profile, lists and terms refusals
  name their `details.nextStep`.
- No new error class: the API's new codes (the Remittance codes such as `REMITTANCE_USE_USD_ACCOUNT`) are not answered
  by the routes this SDK calls; any code still reads as a string through `AureaError.code`.

## 0.2.0 — 15 November 2026 — USD accounts

Generated from the production OpenAPI document of 15 November 2026 (sha256 `a11cd2ef…050af`), the day the API serves
the USD account routes (turned on per tenant, on request). 577 routes (was 530).

### Added
- `aurea.bankRampUsdAccounts`, one class for the customer's USD account (28 routes): `GET /v1/ramp/bank/customer/accounts`
  (the rail that serves the customer's USD, the account's status, capabilities, requirements, next step, USD bank
  details per rail, balances), opening it and answering its requirements (`POST …/accounts`, `…/accounts/information`,
  `…/verification/documents`), the financial profile and its lists (`/v1/ramp/bank/customer/profile`, `…/lists`), the
  terms (`/v1/ramp/bank/customer/terms`), stablecoin deposit addresses, pay-ins, USD beneficiaries, invoices, the
  payout quote and payouts, the custody mode (`GET|PUT …/accounts/custody`) and the transfers to and from the
  customer's wallet (`…/accounts/wallet-transfers`, their quote, `…/{id}/sent`, `…/{id}/cancel`).
- `aurea.identity` and the MPC device preparation, wallet setup and step-up routes the docs added since 0.1.0;
  `GET /v1/ramp/bank/payin/waiting` and its cancel route; `POST /v1/mpc/wallets/{walletId}/preparation` and
  `GET /v1/admin/tenants/{id}/mpc/creation-metrics`.

### Breaking changes (from 0.1.0)
- `mpc.v1MpcWalletsDkgStartPost()` now takes `{ v1MpcWalletsDkgStartPostRequest }` (the request body); it took no
  parameters.
- `mpc.v1MpcWalletsWalletIdSignStartPost()` now requires a body: `{ walletId, v1MpcWalletsWalletIdSignStartPostRequest }`.
- `V1MpcWalletsWalletIdAuxStartPostRequest` and `V1MpcWalletsWalletIdSignStartPostRequest` are now the **body** types;
  the methods' parameters (with `walletId`) are `V1MpcWalletsWalletIdAuxStartPostOperationRequest` and
  `V1MpcWalletsWalletIdSignStartPostOperationRequest`.
- `bankRampLocal.v1RampBankCustomerVerificationPost()` answers `V1RampBankCustomerVerificationPost200Response`
  (was `V1RampBankCustomerVerificationGet200Response`).
- `CardOnrampCustomersApi`: the `xTimestamp` and `xSignature` parameters are `string` (no longer `string | null`).
- Removed `V1MpcWalletsWalletIdBackupProofStartPost200ResponseCommitteeEnum`: the backup proof's `committee` is now
  `Array<string | null>`.
- Removed four error-answer types the API's document no longer names on their own
  (`V1AgentPaymentsStatusGet423Response`, `V1MpcWalletsWalletIdBackupProofStartPost400Response`,
  `V1MpcWalletsWalletIdBackupProofStartPost403Response`, `V1TransactionsAggregatedIdGet400Response`): read errors
  through the typed `AureaError` as before.

## 0.1.0 — first release

- Typed methods for the 530 routes docs.aureahub.com documents, generated with openapi-generator 7.25.0
  (typescript-fetch) from the production OpenAPI document (API 1.0.0), with the API's neutral names (bank ramp and
  EUR account fields, `<field>Neutral` values, `/v1/lending/*`, `/v1/cards/*`).
- `Aurea` client: HMAC request signing on the routes that check the tenant signature, the user's access token on
  the user's routes, retries only where the docs say they are safe, typed errors with `status` and `code`.
- Helpers: `signRequest`, `idempotencyKey`, `wasReplayed`, `paginateOffset`, `paginatePages`, `paginateSkip`.
