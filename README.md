# @aureahub/sdk

TypeScript SDK for the [Aurea API](https://docs.aureahub.com): a typed method for every route the docs document,
generated from the API's OpenAPI document, with a small client around it that

- signs your server's calls with your tenant API key and secret (HMAC-SHA256, exactly as the docs describe),
- sends a user's access token on the user's calls,
- creates idempotency keys for the routes that move funds,
- throws typed errors carrying the HTTP status and the stable error code,
- walks paginated lists,
- retries only where the docs say a retry is safe.

ESM and CommonJS, with type declarations. No runtime dependencies: it uses the runtime's `fetch` and Web Crypto
(Node.js 20 or later, Deno, Bun, edge runtimes).

Documentation: [docs.aureahub.com](https://docs.aureahub.com) · the SDK page: [docs.aureahub.com/#sdk](https://docs.aureahub.com/#sdk) ·
questions: [help@aureahub.com](mailto:help@aureahub.com) (we reply within one business day).

## Install

```bash
npm install @aureahub/sdk
```

## Quickstart

From your API key to a first transaction on a test network — the same six steps as the docs'
[Quickstart](https://docs.aureahub.com/#quickstart). Run it on your server: the API secret never leaves it.

```ts
import { Aurea, idempotencyKey } from '@aureahub/sdk';

// 1. Your server signs the tenant's calls (register, sign-in, …) with your API key and secret.
const aurea = new Aurea({
  apiKey: process.env.AUREA_TENANT_API_KEY,
  apiSecret: process.env.AUREA_TENANT_API_SECRET,
});

// 2. Register a test user: the answer signs the user in.
const { accessToken } = await aurea.auth.v1AuthRegisterPost({
  v1AuthRegisterPostRequest: { username: 'quickstart_alice', email: 'alice@example.com', password: 'SecurePass123' },
});
const user = aurea.withAccessToken(accessToken!); // every other call uses the user's access token

// 3. A wallet on one of the test networks your tenant can use
const { chains } = await user.tokens.v1TokensMetaChainsGet({ isTestnet: 'true' });
const wallet = await user.wallets.v1WalletsPost({
  v1WalletsPostRequest: { chain: chains![0].id!, isTestnet: true, name: 'Quickstart' },
});

// 4. Fund wallet.address from a faucet of that test network, then read the balance
const balance = await user.wallets.v1WalletsIdBalanceGet({ id: wallet.id! });

// 5. Send 0.001 of an 18-decimal coin. Keep the key: a retry sends the same key, never a second transfer.
const key = idempotencyKey();
const tx = await user.transactions.v1TransactionsPost({
  idempotencyKey: key,
  v1TransactionsPostRequest: {
    walletId: wallet.id!,
    toAddress: '0x52908400098527886E0F7030069857D2E4169EE7',
    amount: '1000000000000000', // an integer string in the smallest unit
  },
});

// 6. Follow it to the end (in production, a webhook tells your server instead)
const status = await user.transactions.v1TransactionsIdStatusGet({ id: tx.id! });
```

Amounts you send are integer strings in a token's smallest unit; balances are decimal strings for display
([Amount Units](https://docs.aureahub.com/#amounts)). Test networks and the sandbox use the production base URL.

### The API classes

Every generated API class is a property of the client, created on first use: `aurea.auth`, `aurea.wallets`,
`aurea.transactions`, `aurea.swap`, `aurea.accounts`, `aurea.webhooks`, `aurea.agentPayments`… Method names follow
the route: `GET /v1/wallets/{id}/balance` is `wallets.v1WalletsIdBalanceGet({ id })`. Each method has a `…Raw`
twin answering the `Response` as well (headers such as `idempotency-replayed`).

A route newer than this SDK, or one you prefer to call by its path:

```ts
const answer = await user.request('GET', '/v1/wallets/', { query: { limit: 50 } });
await user.request('POST', '/v1/transactions/', { body: { walletId, toAddress, amount }, idempotencyKey: key });
```

## Request signing

The routes that check your tenant's signature are signed for you, on every attempt (a signature is accepted once):
registration and sign-in, `GET /v1/tenant/public`, and the others the docs list under
[Authentication › Credentials by Route](https://docs.aureahub.com/#authentication). A signed request carries:

| Header | Value |
| --- | --- |
| `x-tenant-api-key` | Your tenant API key |
| `x-timestamp` | Unix time in seconds; within 300 seconds of the server's clock |
| `x-signature` | `hex(HMAC-SHA256(API secret, METHOD + "\n" + PATH with query + "\n" + TIMESTAMP + "\n" + hex(SHA-256(body))))` |

To sign a request you send yourself:

```ts
import { signRequest } from '@aureahub/sdk';

const body = JSON.stringify({ username: 'alice', password: 'SecurePass123' });
const headers = await signRequest({ method: 'POST', path: '/v1/auth/login', body, apiKey, apiSecret });
await fetch('https://api.aureahub.com/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body, // the same string that was signed
});
```

The client refuses the API secret in a browser page. Keep it on your server; the user's apps call with the user's
access token.

## Errors

A non-2xx answer throws an `AureaApiError` — one subclass per kind — with what the docs tell you to branch on:

```ts
import { AureaApiError, AureaRateLimitError } from '@aureahub/sdk';

try {
  await user.transactions.v1TransactionsPost({ idempotencyKey: key, v1TransactionsPostRequest: request });
} catch (err) {
  if (err instanceof AureaApiError) {
    err.status;     // branch on this first
    err.code;       // the stable code (details.code, else code), or null: 'IDEMPOTENCY_IN_PROGRESS', 'WALLET_FROZEN'…
    err.details;    // validation problems and ids, when returned
    err.requestId;  // X-Request-ID: quote it to help@aureahub.com
    if (err instanceof AureaRateLimitError) err.retryAfterSeconds;
  }
  throw err;
}
```

| Status | Class |
| --- | --- |
| 400, 422 | `AureaValidationError` |
| 401 | `AureaAuthenticationError` (on the sign-in routes the code is read from `WWW-Authenticate`) |
| 403 | `AureaPermissionError` |
| 404 | `AureaNotFoundError` |
| 409 | `AureaConflictError` |
| 410 | `AureaGoneError` |
| 413 | `AureaPayloadTooLargeError` |
| 423 | `AureaLockedError` |
| 429 | `AureaRateLimitError` |
| 5xx | `AureaServerError` |

`AureaConnectionError`: no answer came (network failure or timeout). `AureaConfigurationError`: the client cannot
make the call as configured (for example a signed route without the API secret). All of them extend `AureaError`.
Show `message` to a developer; never parse it. The codes: [Errors & Codes](https://docs.aureahub.com/#errors).

## Idempotency

The money routes take an `Idempotency-Key` ([Idempotency](https://docs.aureahub.com/#idempotency)). Create one key
per operation with `idempotencyKey()`, store it with the pending operation, and send the same key with the same
request on every retry: the first answer comes back, never a second operation. `wasReplayed(response)` tells you
when an answer is the stored one.

## Retries

The client retries, at most `maxRetries` times (default 2), only where a retry cannot run anything twice:

- `429`: after `retry-after` seconds;
- `409` `IDEMPOTENCY_IN_PROGRESS`: a moment later, with the same key;
- `502`, `503`, `504` and a request that got no answer: for `GET`, or for a request that carries an `Idempotency-Key`.

A `POST` without a key is never sent again: check whether it went through first. `409`
`IDEMPOTENCY_OUTCOME_UNKNOWN`, `423`, `500` and the other `4xx` are never retried. Set `maxRetries: 0` to turn
retries off, `timeoutMs` (default 60,000) for each attempt's timeout.

## Pagination

List routes use one of three styles ([Pagination](https://docs.aureahub.com/#pagination)); each helper yields the
items one by one:

```ts
import { paginateOffset, paginatePages, paginateSkip } from '@aureahub/sdk';

for await (const wallet of paginateOffset((p) => user.wallets.v1WalletsGet(p), { limit: 100 })) { /* limit + offset */ }
for await (const tx of paginatePages((p) => user.transactions.v1TransactionsGet(p), { limit: 100 })) { /* page + limit */ }
for await (const n of paginateSkip((p) => user.notifications.v1NotificationsInboxGet(p))) { /* limit + skip */ }
```

## Options

```ts
new Aurea({
  apiKey, apiSecret,          // your server's tenant credentials (signed routes)
  accessToken,                // a user's token, or () => a fresh one (called before each call)
  baseUrl,                    // default https://api.aureahub.com
  maxRetries: 2, timeoutMs: 60_000, maxRetryDelayMs: 60_000,
  fetch,                      // your own fetch
  headers,                    // sent with every call
});
```

## Versions

The SDK is generated from the production OpenAPI document
([https://api.aureahub.com/v1/docs/json](https://api.aureahub.com/v1/docs/json)) for the routes
docs.aureahub.com documents, with the API's neutral names: the bank ramp's `bankRampStatus`, `bankRampDepositId`…,
the EUR account's `eurAccountIban`…, the `<field>Neutral` values (`typeNeutral`…), and the routes `/v1/lending/*`
(`aurea.lending`) and `/v1/cards/*` (`aurea.cards`). The bank ramp's USD account per customer is `aurea.bankRampAccounts` (the account, beneficiaries,
payouts) and `aurea.bankRampUsdAccounts` (its profile and terms). The neutral fields are in the answers once neutral codes are on
for your tenant ([Errors & Codes › Neutral Codes](https://docs.aureahub.com/#errors)): ask for them when your tenant
is set up, or write to [help@aureahub.com](mailto:help@aureahub.com). This is a 0.x release: method and type names
may still change between minor versions.

## Support

[help@aureahub.com](mailto:help@aureahub.com), with the request's `X-Request-ID`, the time, the route and the answer
you received — never a secret, a token or a password.

## Licence

MIT
