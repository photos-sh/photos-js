import { apiErrorFrom, ConnectionError, PhotosError, TimeoutError } from "./errors.js";
import type { RawResponse } from "./results.js";
import { VERSION } from "./version.js";

export interface PhotosOptions {
  /** Your API key. Defaults to the environment variable `PHOTOS_API_KEY`. */
  apiKey?: string | undefined;
  /** Defaults to `PHOTOS_BASE_URL`, then `https://api.photos.sh`. */
  baseUrl?: string | undefined;
  /** Milliseconds allowed per request attempt. Default 120 000. */
  timeout?: number | undefined;
  /** Retries after a 503 `busy` or a failed connection. Default 2. */
  maxRetries?: number | undefined;
  /** The `fetch` to use. Defaults to the platform's. */
  fetch?: typeof fetch | undefined;
  /** @internal Replaces the wait between retries and polls (tests). */
  sleep?: ((ms: number, signal?: AbortSignal) => Promise<void>) | undefined;
}

/** @internal */
export interface Call {
  method: string;
  path: string;
  query?: string[][] | undefined;
  body?: FormData | string | undefined;
  contentType?: string | undefined;
  signal?: AbortSignal | undefined;
  timeout?: number | undefined;
  /** Retry when the connection fails before a response. Default true. */
  retryConnection?: boolean | undefined;
  /** Return a 503 as it is instead of retrying and throwing (`health`). */
  accept503?: boolean | undefined;
}

const DEFAULT_BASE_URL = "https://api.photos.sh";
const MAX_RETRY_WAIT = 30_000;

function env(name: string): string | undefined {
  const process = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process;
  return process?.env?.[name] || undefined;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("This operation was aborted", "AbortError");
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal as AbortSignal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** @internal Sends requests: authentication, timeout, retries, errors. */
export class Transport {
  readonly baseUrl: string;
  readonly timeout: number;
  readonly maxRetries: number;
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;

  constructor(options: PhotosOptions = {}) {
    const apiKey = options.apiKey ?? env("PHOTOS_API_KEY");
    if (!apiKey) {
      throw new PhotosError(
        "No API key: pass { apiKey } or set the environment variable PHOTOS_API_KEY",
      );
    }
    this.#apiKey = apiKey;
    const baseUrl = options.baseUrl ?? env("PHOTOS_BASE_URL") ?? DEFAULT_BASE_URL;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.timeout = options.timeout ?? 120_000;
    this.maxRetries = Math.max(0, options.maxRetries ?? 2);
    this.sleep = options.sleep ?? defaultSleep;
    if (options.fetch) {
      this.#fetch = options.fetch;
    } else if (typeof globalThis.fetch === "function") {
      this.#fetch = globalThis.fetch.bind(globalThis);
    } else {
      throw new PhotosError("This runtime has no fetch: pass one as { fetch }");
    }
  }

  async request(call: Call): Promise<RawResponse> {
    const search = new URLSearchParams(call.query ?? []).toString();
    const url = `${this.baseUrl}${call.path}${search ? `?${search}` : ""}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#apiKey}`,
      Accept: "application/json, image/*",
    };
    // Browsers do not let a page set User-Agent (and it would need CORS approval).
    if (typeof document === "undefined") headers["User-Agent"] = `photos-sh-js/${VERSION}`;
    if (call.contentType) headers["Content-Type"] = call.contentType;

    for (let attempt = 0; ; attempt++) {
      const canRetry = attempt < this.maxRetries;
      let response: RawResponse;
      try {
        response = await this.#attempt(url, call, headers);
      } catch (error) {
        const retry =
          canRetry &&
          call.retryConnection !== false &&
          error instanceof ConnectionError &&
          (error as { beforeResponse?: boolean }).beforeResponse === true;
        if (!retry) throw error;
        await this.sleep(Math.min(1000 * 2 ** attempt, MAX_RETRY_WAIT), call.signal);
        continue;
      }
      if (response.status < 400 || (response.status === 503 && call.accept503)) return response;
      const error = apiErrorFrom(
        response.status,
        response.headers,
        new TextDecoder().decode(response.bytes),
      );
      // Only a busy server is worth another try: a 503 with the API's `busy`,
      // or one that is not the API's error at all (a proxy in front of it).
      const transient =
        response.status === 503 && (error.code === "busy" || error.code === "unknown");
      if (!transient || !canRetry) throw error;
      const wait = error.retryAfter !== undefined ? error.retryAfter * 1000 : 1000 * 2 ** attempt;
      await this.sleep(Math.min(wait, MAX_RETRY_WAIT), call.signal);
    }
  }

  async #attempt(url: string, call: Call, headers: Record<string, string>): Promise<RawResponse> {
    const { signal } = call;
    if (signal?.aborted) throw abortReason(signal);
    const timeout = call.timeout ?? this.timeout;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeout);
    const onAbort = () => controller.abort(signal ? abortReason(signal) : undefined);
    signal?.addEventListener("abort", onAbort, { once: true });
    let beforeResponse = true;
    try {
      const init: RequestInit = { method: call.method, headers, signal: controller.signal };
      if (call.body !== undefined) init.body = call.body;
      const response = await this.#fetch(url, init);
      beforeResponse = false;
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { status: response.status, headers: response.headers, bytes };
    } catch (cause) {
      if (timedOut) {
        throw new TimeoutError(`Request timed out after ${timeout} ms`, { cause });
      }
      if (signal?.aborted) throw abortReason(signal);
      const reason = cause instanceof Error ? cause.message : String(cause);
      const detail = cause instanceof Error && cause.cause instanceof Error ? cause.cause : null;
      const error = new ConnectionError(
        `Could not reach ${new URL(url).origin}: ${detail ? detail.message || reason : reason}`,
        { cause },
      );
      Object.defineProperty(error, "beforeResponse", { value: beforeResponse });
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}
