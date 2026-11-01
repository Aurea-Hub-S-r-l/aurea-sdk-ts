import { Configuration } from "./generated/runtime";
import type { Middleware } from "./generated/runtime";
import { AureaConfigurationError, AureaConnectionError, AureaError, apiErrorFromResponse } from "./errors";
import { Services } from "./services";
import { createTransport, type FetchLike } from "./transport";
import { pathWithQuery, takesNoAccessToken } from "./signing";

export const DEFAULT_BASE_URL = "https://api.aureahub.com";

export type AccessToken = string | (() => string | Promise<string>);

export interface AureaOptions {
  /** Your tenant API key: signs the routes that check the tenant signature (server only). */
  apiKey?: string;
  /** Your tenant API secret (server only: it never leaves your server). */
  apiSecret?: string;
  /** A signed-in user's access token, or a function that returns a fresh one (called before each call). */
  accessToken?: AccessToken;
  /** Default https://api.aureahub.com (test networks and the sandbox use the same URL). */
  baseUrl?: string;
  /** Retries where docs.aureahub.com says they are safe. Default 2; 0 turns them off. */
  maxRetries?: number;
  /** Per-attempt timeout in milliseconds. Default 60,000; 0 for none. */
  timeoutMs?: number;
  /** The longest wait before a retry, in milliseconds. Default 60,000. */
  maxRetryDelayMs?: number;
  /** A fetch implementation; default the runtime's global fetch. */
  fetch?: FetchLike;
  /** Headers sent with every call. */
  headers?: Record<string, string>;
  /**
   * The API secret is refused in a browser: anyone who can read the page could sign as your tenant. Set this only
   * for a trusted, non-public environment.
   */
  dangerouslyAllowSecretInBrowser?: boolean;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | null | undefined | Array<string | number | boolean>>;
  /** A JSON value (serialised once; the same string is signed and sent) or a string sent as is. */
  body?: unknown;
  headers?: Record<string, string>;
  /** Sent as `Idempotency-Key`; makes a retry of a money route safe. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

const isBrowser = () => typeof (globalThis as { document?: unknown }).document !== "undefined";

/**
 * The Aurea API client.
 *
 *   const aurea = new Aurea({ apiKey, apiSecret });                // your server: signed routes
 *   const { accessToken } = await aurea.auth.v1AuthLoginPost({ v1AuthLoginPostRequest: { username, password } });
 *   const user = aurea.withAccessToken(accessToken);               // the user's calls
 *   const wallets = await user.wallets.v1WalletsGet({ limit: 50 });
 *
 * Every generated API class is a property (aurea.wallets, aurea.transactions, aurea.auth…); `request()` calls any
 * route by its path. A non-2xx answer throws an AureaApiError subclass with `status` and `code`.
 */
export class Aurea extends Services {
  readonly baseUrl: string;
  readonly #options: AureaOptions;
  readonly #fetch: FetchLike;

  constructor(options: AureaOptions = {}) {
    if (options.apiSecret && isBrowser() && !options.dangerouslyAllowSecretInBrowser) {
      throw new AureaConfigurationError(
        "The API secret is for your server only: anyone who can read this page could sign as your tenant. Call Aurea from your server, or use the user's access token here.",
      );
    }
    const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    const transport = createTransport({
      apiKey: options.apiKey,
      apiSecret: options.apiSecret,
      maxRetries: options.maxRetries,
      timeoutMs: options.timeoutMs,
      maxRetryDelayMs: options.maxRetryDelayMs,
      fetch: options.fetch,
    });
    const accessToken = options.accessToken;
    const readToken = async () => (accessToken === undefined ? "" : typeof accessToken === "function" ? await accessToken() : accessToken);
    // The OpenAPI document does not name the bearer token on every route that reads it: send it wherever the docs
    // say a user's call carries it (every route but those in takesNoAccessToken()).
    const bearer: Middleware = {
      async pre({ url, init }) {
        if (accessToken === undefined) return;
        const headers = new Headers(init.headers);
        if (headers.has("authorization") || takesNoAccessToken(init.method ?? "GET", url)) return;
        const token = await readToken();
        if (!token) return;
        headers.set("Authorization", `Bearer ${token}`);
        const record: Record<string, string> = {};
        headers.forEach((value, key) => (record[key] = value));
        return { url, init: { ...init, headers: record } };
      },
    };
    const errors: Middleware = {
      async post({ init, url, response }) {
        if (response.status >= 200 && response.status < 300) return response;
        throw await apiErrorFromResponse(response, { method: init.method, path: pathWithQuery(url).split("?")[0] });
      },
      async onError({ error, init, url }) {
        if (error instanceof AureaError) throw error;
        throw new AureaConnectionError(String((error as Error)?.message ?? error), {
          cause: error,
          method: init.method,
          path: pathWithQuery(url).split("?")[0],
        });
      },
    };
    const configuration = new Configuration({
      basePath: baseUrl,
      fetchApi: transport,
      middleware: [bearer, errors],
      headers: options.headers,
      accessToken: accessToken === undefined ? undefined : typeof accessToken === "function" ? () => accessToken() : accessToken,
      // The generated code asks for x-tenant-api-key on the operations whose security names the tenant signature;
      // the transport then signs them. No other key header is filled.
      apiKey: (name: string) => (name.toLowerCase() === "x-tenant-api-key" ? options.apiKey ?? "" : ""),
    });
    super(configuration);
    this.baseUrl = baseUrl;
    this.#options = options;
    this.#fetch = transport;
  }

  /** The same client, calling as a signed-in user. */
  withAccessToken(accessToken: AccessToken): Aurea {
    return new Aurea({ ...this.#options, accessToken });
  }

  /** The generated configuration, to build a generated API class yourself. */
  get config(): Configuration {
    return this.configuration;
  }

  /**
   * Calls any route by method and path (e.g. a route newer than this SDK). Signs the routes that check the tenant
   * signature, adds the access token when there is one, retries where it is safe, and throws the typed errors.
   * Answers the parsed JSON (null for an empty answer).
   */
  async request<T = unknown>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.requestRaw(method, path, options);
    const text = await response.text();
    if (!text) return null as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }

  /** As `request()`, answering the Response (2xx only: other statuses throw). */
  async requestRaw(method: string, path: string, options: RequestOptions = {}): Promise<Response> {
    const upper = method.toUpperCase();
    let url = this.baseUrl + (path.startsWith("/") ? path : `/${path}`);
    if (options.query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(options.query)) {
        if (value === undefined || value === null) continue;
        for (const v of Array.isArray(value) ? value : [value]) params.append(key, String(v));
      }
      const qs = params.toString();
      if (qs) url += (url.includes("?") ? "&" : "?") + qs;
    }
    const headers: Record<string, string> = { ...(this.#options.headers ?? {}), ...(options.headers ?? {}) };
    let body: string | undefined;
    if (options.body !== undefined) {
      body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
      if (!Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) headers["Content-Type"] = "application/json";
    }
    if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
    const token = this.#options.accessToken;
    if (token !== undefined && !Object.keys(headers).some((h) => h.toLowerCase() === "authorization") && !takesNoAccessToken(upper, path)) {
      const value = typeof token === "function" ? await token() : token;
      if (value) headers.Authorization = `Bearer ${value}`;
    }
    let response: Response;
    try {
      response = await this.#fetch(url, { method: upper, headers, body, signal: options.signal });
    } catch (error) {
      if (error instanceof AureaError) throw error;
      throw new AureaConnectionError(String((error as Error)?.message ?? error), { cause: error, method: upper, path });
    }
    if (response.status < 200 || response.status >= 300) {
      throw await apiErrorFromResponse(response, { method: upper, path: path.split("?")[0] });
    }
    return response;
  }
}
