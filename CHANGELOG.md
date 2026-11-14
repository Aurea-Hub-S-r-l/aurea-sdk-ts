# Changelog

## Unreleased — USD accounts (not released: published only once the API serves them in production)

- `aurea.bankRampUsdAccounts`, one class for the customer's USD account (28 routes): `GET /v1/ramp/bank/customer/accounts`
  (the rail that serves the customer's USD, the account's status, capabilities, requirements, next step, USD bank
  details per rail, balances), opening it and answering its requirements (`POST …/accounts`, `…/accounts/information`,
  `…/verification/documents`), the financial profile and its lists (`/v1/ramp/bank/customer/profile`, `…/lists`), the
  terms (`/v1/ramp/bank/customer/terms`), stablecoin deposit addresses, pay-ins, USD beneficiaries, invoices, the
  payout quote and payouts, the custody mode (`GET|PUT …/accounts/custody`) and the transfers to and from the
  customer's wallet (`…/accounts/wallet-transfers`, their quote, `…/{id}/sent`, `…/{id}/cancel`).
- `aurea.identity` and the MPC device preparation, wallet setup and step-up routes the docs added since 0.1.0;
  `GET /v1/ramp/bank/payin/waiting` and its cancel route; `POST /v1/mpc/wallets/{walletId}/preparation` and
  `GET /v1/admin/tenants/{id}/mpc/creation-metrics`. 577 routes (was 530).
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
