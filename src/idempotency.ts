/**
 * Idempotency keys (docs.aureahub.com › Idempotency).
 *
 * The money routes (sends, broadcasts, swaps, approvals, the dApp broadcast) and the bank ramp's create routes take an
 * `Idempotency-Key` header of up to 255 letters, digits, `-` or `_`. Create one key per operation, keep it with the
 * pending operation, and send the same key with the same request on every retry: the first answer comes back
 * (`idempotency-replayed: true`), never a second operation. Never derive a key from the request.
 */

const KEY = /^[A-Za-z0-9_-]{1,255}$/;

/** A new key: a random UUID. */
export function idempotencyKey(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.randomUUID) throw new Error("crypto.randomUUID is not available: use Node.js 20 or later");
  return c.randomUUID();
}

/** Whether a key has the shape the API takes (else it answers 400 IDEMPOTENCY_KEY_INVALID). */
export function isValidIdempotencyKey(key: string): boolean {
  return KEY.test(key);
}

/** Whether an answer is the stored first answer of an earlier request with the same key. */
export function wasReplayed(response: Response | { headers: Headers }): boolean {
  return response.headers.get("idempotency-replayed") === "true";
}

/**
 * An `initOverrides` function for a generated method that adds `Idempotency-Key` to a route whose generated
 * parameters do not have one. Most money routes take `idempotencyKey` as a parameter: pass it there instead.
 */
export function withIdempotencyKey(key: string) {
  if (!isValidIdempotencyKey(key)) throw new Error("An Idempotency-Key is up to 255 letters, digits, - or _");
  return async ({ init }: { init: RequestInit }): Promise<RequestInit> => ({
    headers: { ...(init.headers as Record<string, string>), "Idempotency-Key": key },
  });
}
