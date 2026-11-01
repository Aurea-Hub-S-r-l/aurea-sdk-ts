/**
 * The fetch every call goes through: signs the routes that check the tenant signature (again on every attempt: a
 * signature is accepted once), applies a timeout, and retries only where docs.aureahub.com says a retry is safe:
 *
 * - 429: after `retry-after` seconds (nothing ran). Any method.
 * - 409 IDEMPOTENCY_IN_PROGRESS: the first request with this key is still running; same key, a moment later.
 * - 502, 503, 504, and a request that got no answer: only GET/HEAD/OPTIONS, or a request that carries an
 *   Idempotency-Key (a retry with the same key and request cannot run twice). A POST without a key is never resent:
 *   check whether it went through first (docs › Idempotency › Retrying Safely).
 * - Never: 409 IDEMPOTENCY_OUTCOME_UNKNOWN, 423, any other 4xx, 500.
 */
import { AureaConfigurationError, AureaConnectionError, parseRetryAfter } from "./errors";
import { isSignedRoute, pathWithQuery, signRequest } from "./signing";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface TransportOptions {
  apiKey?: string;
  apiSecret?: string;
  /** Retries where they are safe (above). Default 2; 0 turns retries off. */
  maxRetries?: number;
  /** Per-attempt timeout in milliseconds. Default 60,000; 0 for none. */
  timeoutMs?: number;
  /** The longest wait before a retry, in milliseconds; a longer `retry-after` is not waited for. Default 60,000. */
  maxRetryDelayMs?: number;
  fetch?: FetchLike;
  /** For tests: how to wait. */
  sleep?: (ms: number) => Promise<void>;
  /** For tests: Unix seconds. */
  now?: () => number;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const RETRY_STATUSES = new Set([502, 503, 504]);

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  new Headers(headers).forEach((value, key) => {
    if (value !== "") out[key] = value;
  });
  return out;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with jitter; at least one second when the request is signed (a new timestamp). */
export function backoffMs(attempt: number, signed: boolean): number {
  const base = Math.min(8000, 500 * 2 ** attempt);
  const delay = base / 2 + Math.random() * (base / 2);
  return Math.ceil(signed ? Math.max(1000, delay) : delay);
}

function anySignal(signals: Array<AbortSignal | undefined | null>): AbortSignal | undefined {
  const list = signals.filter((s): s is AbortSignal => !!s);
  if (list.length <= 1) return list[0];
  const any = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (any) return any(list);
  const controller = new AbortController();
  for (const s of list) {
    if (s.aborted) controller.abort(s.reason);
    else s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

async function idempotencyInProgress(response: Response): Promise<boolean> {
  try {
    const body = (await response.clone().json()) as { details?: { code?: unknown }; code?: unknown };
    return (body?.details?.code ?? body?.code) === "IDEMPOTENCY_IN_PROGRESS";
  } catch {
    return false;
  }
}

export function createTransport(options: TransportOptions): FetchLike {
  const maxRetries = Math.max(0, options.maxRetries ?? 2);
  const timeoutMs = options.timeoutMs ?? 60_000;
  const maxRetryDelayMs = options.maxRetryDelayMs ?? 60_000;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));

  return async function aureaFetch(input: string, init: RequestInit = {}): Promise<Response> {
    const doFetch: FetchLike = options.fetch ?? ((i, n) => globalThis.fetch(i, n));
    const method = (init.method ?? "GET").toUpperCase();
    const path = pathWithQuery(input);
    const baseHeaders = headersToRecord(init.headers);
    const alreadySigned = "x-signature" in baseHeaders;
    const signed = !alreadySigned && (isSignedRoute(method, path) || "x-tenant-api-key" in baseHeaders);
    const hasKey = "idempotency-key" in baseHeaders;
    const body = init.body;

    if (signed) {
      if (!options.apiKey || !options.apiSecret) {
        throw new AureaConfigurationError(
          `${method} ${path.split("?")[0]} needs your tenant's signature: create the client with apiKey and apiSecret, on your server (docs.aureahub.com › Authentication).`,
        );
      }
      if (body != null && typeof body !== "string" && !(body instanceof Uint8Array)) {
        throw new AureaConfigurationError("A signed request's body must be a string or bytes: the exact bytes sent are signed.");
      }
    }

    for (let attempt = 0; ; attempt++) {
      const headers = { ...baseHeaders };
      if (signed) {
        Object.assign(
          headers,
          await signRequest({
            method,
            path,
            body: body as string | Uint8Array | null | undefined,
            apiKey: options.apiKey!,
            apiSecret: options.apiSecret!,
            timestamp: now(),
          }),
        );
      }
      const timeout = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
      const canRetry = attempt < maxRetries;
      let response: Response;
      try {
        response = await doFetch(input, { ...init, method, headers, signal: anySignal([init.signal, timeout]) });
      } catch (error) {
        if (init.signal?.aborted) throw error;
        if (canRetry && (SAFE_METHODS.has(method) || hasKey)) {
          await sleep(backoffMs(attempt, signed));
          continue;
        }
        const timedOut = timeout?.aborted === true;
        throw new AureaConnectionError(
          `${method} ${path.split("?")[0]} got no answer (${timedOut ? `no answer within ${timeoutMs} ms` : (error as Error)?.message ?? "network error"}). ` +
            (SAFE_METHODS.has(method) || hasKey
              ? "Try again later."
              : "Whether it ran is not known: check before sending it again, or send an Idempotency-Key with it."),
          { cause: error, method, path },
        );
      }

      if (!canRetry) return response;
      let delay: number | null = null;
      if (response.status === 429) {
        const after = parseRetryAfter(response.headers.get("retry-after"));
        delay = after === null ? backoffMs(attempt, signed) : Math.max(after * 1000, signed ? 1000 : 0);
      } else if (response.status === 409 && hasKey && (await idempotencyInProgress(response))) {
        delay = backoffMs(attempt, signed);
      } else if (RETRY_STATUSES.has(response.status) && (SAFE_METHODS.has(method) || hasKey)) {
        const after = parseRetryAfter(response.headers.get("retry-after"));
        delay = after === null ? backoffMs(attempt, signed) : Math.max(after * 1000, signed ? 1000 : 0);
      }
      if (delay === null || delay > maxRetryDelayMs) return response;
      // Free the connection; not awaited (a cancelled stream settles when every reader of it is done).
      response.body?.cancel().catch(() => undefined);
      await sleep(delay);
    }
  };
}
