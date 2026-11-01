# Changelog

## 0.1.0 — first release

- Typed methods for the 530 routes docs.aureahub.com documents, generated with openapi-generator 7.25.0
  (typescript-fetch) from the production OpenAPI document (API 1.0.0), with the API's neutral names (bank ramp and
  EUR account fields, `<field>Neutral` values, `/v1/lending/*`, `/v1/cards/*`).
- `Aurea` client: HMAC request signing on the routes that check the tenant signature, the user's access token on
  the user's routes, retries only where the docs say they are safe, typed errors with `status` and `code`.
- Helpers: `signRequest`, `idempotencyKey`, `wasReplayed`, `paginateOffset`, `paginatePages`, `paginateSkip`.
