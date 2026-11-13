/** Base class of every error this library throws. */
export class PhotosError extends Error {
  override name = "PhotosError";
}

/** What an {@link ApiError} is built from. */
export interface ApiErrorDetails {
  status: number;
  code: string;
  message: string;
  retryAfter?: number | undefined;
  headers?: Headers | undefined;
  body?: string | undefined;
}

/**
 * The API answered with an error status. `code` is the API's own error code
 * (`bad_request`, `busy`, ...), or `"unknown"` when the body was not the
 * API's JSON error.
 */
export class ApiError extends PhotosError {
  override name = "ApiError";
  /** HTTP status. */
  readonly status: number;
  /** The API's error code, e.g. `unauthorized`, `bad_request`, `busy`. */
  readonly code: string;
  /** Seconds from the `Retry-After` header, when the response had one. */
  readonly retryAfter: number | undefined;
  /** Response headers. */
  readonly headers: Headers | undefined;
  /** The raw response body, as text. */
  readonly body: string | undefined;

  constructor(details: ApiErrorDetails) {
    super(details.message);
    this.status = details.status;
    this.code = details.code;
    this.retryAfter = details.retryAfter;
    this.headers = details.headers;
    this.body = details.body;
  }
}

/** 400 `bad_request`: a parameter or the image is wrong. */
export class BadRequestError extends ApiError {
  override name = "BadRequestError";
}
/** 401 `unauthorized`: missing or invalid API key. */
export class UnauthorizedError extends ApiError {
  override name = "UnauthorizedError";
}
/** 402 `payment_required`: out of credits. */
export class PaymentRequiredError extends ApiError {
  override name = "PaymentRequiredError";
}
/** 403 `account_suspended`. */
export class AccountSuspendedError extends ApiError {
  override name = "AccountSuspendedError";
}
/** 404 `not_found`: no such job or job item. */
export class NotFoundError extends ApiError {
  override name = "NotFoundError";
}
/** 413 `payload_too_large`. */
export class PayloadTooLargeError extends ApiError {
  override name = "PayloadTooLargeError";
}
/** 415 `unsupported_format`. */
export class UnsupportedFormatError extends ApiError {
  override name = "UnsupportedFormatError";
}
/** 422 `unprocessable`: e.g. an invalid recipe, or a size that cannot be met. */
export class UnprocessableError extends ApiError {
  override name = "UnprocessableError";
}
/** 503 `busy`: all workers are busy. Thrown once the retries are used up. */
export class BusyError extends ApiError {
  override name = "BusyError";
}
/** 503 `model_unavailable`: the server does not offer this tool. */
export class ModelUnavailableError extends ApiError {
  override name = "ModelUnavailableError";
}
/** 500 `internal`. */
export class InternalServerError extends ApiError {
  override name = "InternalServerError";
}

const BY_CODE: Record<string, new (details: ApiErrorDetails) => ApiError> = {
  bad_request: BadRequestError,
  unauthorized: UnauthorizedError,
  payment_required: PaymentRequiredError,
  account_suspended: AccountSuspendedError,
  not_found: NotFoundError,
  payload_too_large: PayloadTooLargeError,
  unsupported_format: UnsupportedFormatError,
  unprocessable: UnprocessableError,
  busy: BusyError,
  model_unavailable: ModelUnavailableError,
  internal: InternalServerError,
};

/** Seconds from a `Retry-After` value (a number of seconds or an HTTP date). */
function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

/** @internal Builds the error for a failed response. */
export function apiErrorFrom(status: number, headers: Headers, body: string): ApiError {
  let code = "unknown";
  let message = body.trim().slice(0, 200) || `HTTP ${status}`;
  try {
    const parsed: unknown = JSON.parse(body);
    const error = (parsed as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    if (error && typeof error === "object") {
      if (typeof error.code === "string") code = error.code;
      if (typeof error.message === "string") message = error.message;
    }
  } catch {
    // Not JSON: the start of the body is the message.
  }
  const ErrorClass = BY_CODE[code] ?? ApiError;
  return new ErrorClass({
    status,
    code,
    message,
    retryAfter: parseRetryAfter(headers.get("retry-after")),
    headers,
    body,
  });
}

/** The request never got a response: DNS, refused connection, broken socket. */
export class ConnectionError extends PhotosError {
  override name = "ConnectionError";
}

/** A request, or `jobs.wait`, ran out of time. */
export class TimeoutError extends PhotosError {
  override name = "TimeoutError";
}

/** A webhook delivery could not be verified. */
export class WebhookError extends PhotosError {
  override name = "WebhookError";
}
