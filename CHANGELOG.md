# Changelog

## Unreleased — USD accounts (not released: published only once the API serves them in production)

- `aurea.bankRampAccounts`: the customer's USD account — `GET /v1/ramp/bank/customer/accounts` (the rail that
  serves the customer's USD, the account's status, capabilities, requirements, next step, USD bank details per rail,
  balances), its custody mode, stablecoin deposit addresses, pay-ins, USD beneficiaries, payouts and the documents
  its requirements ask for.
- `aurea.bankRampUsdAccounts`: the USD account's financial profile (`/v1/ramp/bank/customer/profile`, `…/lists`) and
  terms (`/v1/ramp/bank/customer/terms`).
- `aurea.identity` and the MPC device preparation, wallet setup and step-up routes the docs added since 0.1.0;
  `GET /v1/ramp/bank/payin/waiting` and its cancel route. 564 routes (was 530).
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
