import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AccountSuspendedError,
  ApiError,
  BadRequestError,
  BusyError,
  ConnectionError,
  InternalServerError,
  ModelUnavailableError,
  NotFoundError,
  PayloadTooLargeError,
  PaymentRequiredError,
  Photos,
  PhotosError,
  TimeoutError,
  UnauthorizedError,
  UnprocessableError,
  UnsupportedFormatError,
} from "../src/index.js";
import { fixture, IMAGE, imageReply, startServer } from "./helpers.js";

function apiError(code: string, message = "nope") {
  return { error: { code, message } };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail("expected a rejection");
}

describe("API errors", () => {
  const cases: Array<[number, string, typeof ApiError]> = [
    [400, "bad_request", BadRequestError],
    [401, "unauthorized", UnauthorizedError],
    [402, "payment_required", PaymentRequiredError],
    [403, "account_suspended", AccountSuspendedError],
    [404, "not_found", NotFoundError],
    [413, "payload_too_large", PayloadTooLargeError],
    [415, "unsupported_format", UnsupportedFormatError],
    [422, "unprocessable", UnprocessableError],
    [500, "internal", InternalServerError],
    [503, "busy", BusyError],
    [503, "model_unavailable", ModelUnavailableError],
  ];
  for (const [status, code, ErrorClass] of cases) {
    it(`${status} ${code} is a ${ErrorClass.name}`, async (t) => {
      const { photos } = await fixture(
        t,
        () => ({ status, body: apiError(code, `message for ${code}`) }),
        { maxRetries: 0 },
      );
      const error = await rejection(photos.resize(IMAGE));
      assert.ok(error instanceof ErrorClass);
      assert.ok(error instanceof ApiError);
      assert.ok(error instanceof PhotosError);
      assert.equal(error.name, ErrorClass.name);
      assert.equal(error.status, status);
      assert.equal(error.code, code);
      assert.equal(error.message, `message for ${code}`);
      assert.equal(error.retryAfter, undefined);
    });
  }

  it("keeps a code this version does not know", async (t) => {
    const { photos } = await fixture(t, () => ({ status: 409, body: apiError("conflict") }));
    const error = await rejection(photos.account());
    assert.ok(error instanceof ApiError);
    assert.equal(error.constructor, ApiError);
    assert.equal(error.code, "conflict");
    assert.equal(error.status, 409);
  });

  it("turns a non-JSON body into an ApiError with the start of the body", async (t) => {
    const html = `<html>${"x".repeat(500)}</html>`;
    const { photos } = await fixture(t, () => ({ status: 502, body: html }));
    const error = await rejection(photos.account());
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 502);
    assert.equal(error.code, "unknown");
    assert.equal(error.message, html.slice(0, 200));
    assert.equal(error.body, html);
  });

  it("gives an empty error body a message", async (t) => {
    const { photos } = await fixture(t, () => ({ status: 404 }));
    const error = await rejection(photos.account());
    assert.ok(error instanceof ApiError);
    assert.equal(error.message, "HTTP 404");
  });

  it("does not retry statuses other than 503", async (t) => {
    for (const status of [400, 401, 402, 422, 500, 502]) {
      const { photos, server, sleeps } = await fixture(t, () => ({
        status,
        body: apiError("internal"),
      }));
      await assert.rejects(photos.resize(IMAGE), ApiError);
      assert.equal(server.requests.length, 1, `status ${status}`);
      assert.deepEqual(sleeps, []);
    }
  });
});

describe("retries", () => {
  it("retries a 503 twice, waiting Retry-After seconds, then throws", async (t) => {
    const { photos, server, sleeps } = await fixture(t, () => ({
      status: 503,
      headers: { "retry-after": "5" },
      body: apiError("busy", "all workers are busy; retry shortly"),
    }));
    const error = await rejection(photos.removeBackground(IMAGE));
    assert.ok(error instanceof BusyError);
    assert.equal(error.retryAfter, 5);
    assert.equal(server.requests.length, 3);
    assert.deepEqual(sleeps, [5000, 5000]);
    // Every attempt carries the whole image.
    for (const request of server.requests) {
      assert.deepEqual(new Uint8Array(request.parts[0]?.data ?? []), IMAGE);
    }
  });

  it("never retries a 503 model_unavailable", async (t) => {
    const { photos, server, sleeps } = await fixture(t, () => ({
      status: 503,
      headers: { "retry-after": "5" },
      body: apiError("model_unavailable"),
    }));
    await assert.rejects(photos.identify(IMAGE), ModelUnavailableError);
    assert.equal(server.requests.length, 1);
    assert.deepEqual(sleeps, []);
  });

  it("does not retry a 503 with another API error code", async (t) => {
    const { photos, server } = await fixture(t, () => ({
      status: 503,
      body: apiError("internal"),
    }));
    await assert.rejects(photos.account(), ApiError);
    assert.equal(server.requests.length, 1);
  });

  it("retries a 503 that is not the API's JSON error", async (t) => {
    const { photos, server, sleeps } = await fixture(t, (_request, n) =>
      n < 3
        ? { status: 503, body: "<html>Service Unavailable</html>" }
        : { body: { unlimited: true } },
    );
    assert.deepEqual(await photos.account(), { unlimited: true });
    assert.equal(server.requests.length, 3);
    assert.deepEqual(sleeps, [1000, 2000]);
  });

  it("waits 1 s then 2 s without Retry-After", async (t) => {
    const { photos, sleeps } = await fixture(t, () => ({ status: 503, body: apiError("busy") }));
    await assert.rejects(photos.account(), BusyError);
    assert.deepEqual(sleeps, [1000, 2000]);
  });

  it("caps Retry-After at 30 s", async (t) => {
    const { photos, sleeps } = await fixture(
      t,
      () => ({ status: 503, headers: { "retry-after": "120" }, body: apiError("busy") }),
      { maxRetries: 1 },
    );
    const error = await rejection(photos.account());
    assert.ok(error instanceof BusyError);
    assert.equal(error.retryAfter, 120);
    assert.deepEqual(sleeps, [30_000]);
  });

  it("returns the result when a retry succeeds", async (t) => {
    const { photos, server, sleeps } = await fixture(t, (_request, n) =>
      n === 1 ? { status: 503, body: apiError("busy") } : imageReply(),
    );
    const result = await photos.resize(IMAGE, { width: 10 });
    assert.equal(result.width, 640);
    assert.equal(server.requests.length, 2);
    assert.deepEqual(sleeps, [1000]);
  });

  it("maxRetries: 0 turns retries off", async (t) => {
    const { photos, server } = await fixture(t, () => ({ status: 503, body: apiError("busy") }), {
      maxRetries: 0,
    });
    await assert.rejects(photos.account(), BusyError);
    assert.equal(server.requests.length, 1);
  });

  it("really waits between retries by default", async (t) => {
    const server = await startServer((_request, n) =>
      n === 1
        ? { status: 503, headers: { "retry-after": "0.05" }, body: apiError("busy") }
        : { body: { unlimited: true } },
    );
    t.after(() => server.close());
    const photos = new Photos({ apiKey: "k", baseUrl: server.url });
    const started = Date.now();
    assert.deepEqual(await photos.account(), { unlimited: true });
    assert.ok(Date.now() - started >= 40);
  });
});

describe("connection failures and timeouts", () => {
  it("retries a dropped connection, then throws a ConnectionError", async (t) => {
    const { photos, server, sleeps } = await fixture(t, () => ({ destroy: true }));
    const error = await rejection(photos.account());
    assert.ok(error instanceof ConnectionError);
    assert.ok(error instanceof PhotosError);
    assert.ok(!(error instanceof ApiError));
    assert.ok(error.cause instanceof Error);
    assert.equal(server.requests.length, 3);
    assert.deepEqual(sleeps, [1000, 2000]);
  });

  it("throws a ConnectionError when nothing listens", async () => {
    const server = await startServer(() => ({}));
    await server.close();
    const sleeps: number[] = [];
    const photos = new Photos({
      apiKey: "k",
      baseUrl: server.url,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    const error = await rejection(photos.resize(IMAGE));
    assert.ok(error instanceof ConnectionError);
    assert.match(error.message, /Could not reach http:\/\/127\.0\.0\.1:\d+/);
    assert.deepEqual(sleeps, [1000, 2000]);
  });

  it("recovers when the connection works on a retry", async (t) => {
    const { photos, server } = await fixture(t, (_request, n) =>
      n === 1 ? { destroy: true } : { body: { unlimited: true } },
    );
    assert.deepEqual(await photos.account(), { unlimited: true });
    assert.equal(server.requests.length, 2);
  });

  it("throws a TimeoutError and does not retry", async (t) => {
    const { photos, server, sleeps } = await fixture(t, () => ({ delay: 500, body: {} }), {
      timeout: 40,
    });
    const error = await rejection(photos.account());
    assert.ok(error instanceof TimeoutError);
    assert.ok(error instanceof PhotosError);
    assert.match(error.message, /40 ms/);
    assert.equal(server.requests.length, 1);
    assert.deepEqual(sleeps, []);
  });

  it("takes a timeout per call", async (t) => {
    const { photos } = await fixture(t, () => ({ delay: 500, body: {} }));
    await assert.rejects(photos.account({ timeout: 40 }), TimeoutError);
  });
});

describe("AbortSignal", () => {
  it("does not send a request when already aborted", async (t) => {
    const { photos, server } = await fixture(t, () => ({ body: {} }));
    const error = await rejection(photos.account({ signal: AbortSignal.abort() }));
    assert.equal((error as Error).name, "AbortError");
    assert.equal(server.requests.length, 0);
  });

  it("aborts a request under way with the signal's reason", async (t) => {
    const { photos, server, sleeps } = await fixture(t, () => ({ delay: 500, body: {} }));
    const controller = new AbortController();
    const reason = new Error("changed my mind");
    setTimeout(() => controller.abort(reason), 30);
    const error = await rejection(photos.resize(IMAGE, { signal: controller.signal }));
    assert.equal(error, reason);
    assert.equal(server.requests.length, 1);
    assert.deepEqual(sleeps, []);
  });

  it("aborts the wait between retries", async (t) => {
    const server = await startServer(() => ({
      status: 503,
      headers: { "retry-after": "20" },
      body: apiError("busy"),
    }));
    t.after(() => server.close());
    const photos = new Photos({ apiKey: "k", baseUrl: server.url });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const error = await rejection(photos.account({ signal: controller.signal }));
    assert.equal((error as Error).name, "AbortError");
    assert.equal(server.requests.length, 1);
  });
});
