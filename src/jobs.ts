import { PhotosError, TimeoutError } from "./errors.js";
import { selectQuery, toPart, toQuery } from "./input.js";
import { JobItemResult } from "./results.js";
import type { Transport } from "./transport.js";
import type {
  Job,
  JobCreateOptions,
  JobSummary,
  JobWaitOptions,
  RequestOptions,
  SelectOptions,
} from "./types.js";

function parse<T>(bytes: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

function jobPath(id: string): string {
  return `/v1/jobs/${encodeURIComponent(id)}`;
}

/** The params of a job as query pairs, as the operation's method would send them. */
function jobQuery(operation: string, params: Record<string, unknown> | undefined): string[][] {
  return operation === "select" ? selectQuery((params ?? {}) as SelectOptions) : toQuery(params);
}

/** Batch jobs: one operation on many photos, in the background. */
export class Jobs {
  readonly #transport: Transport;

  /** @internal */
  constructor(transport: Transport) {
    this.#transport = transport;
  }

  /**
   * Starts a job. With only `urls` the request is JSON; with `images` it is
   * multipart, and the items are the images in order, then the URLs.
   */
  async create(options: JobCreateOptions): Promise<Job> {
    const { operation, params, images = [], urls = [], recipe, webhookUrl } = options;
    if (images.length === 0 && urls.length === 0) {
      throw new PhotosError("A job needs at least one image or URL");
    }
    let body: FormData | string;
    let contentType: string | undefined;
    if (images.length === 0) {
      const json: Record<string, unknown> = { operation, inputs: urls };
      if (typeof params === "string") json.params = params;
      else if (params) {
        const pairs = jobQuery(operation, params);
        // An object cannot repeat a name (`select`'s `point`); a query string can.
        const repeats = new Set(pairs.map(([name]) => name)).size < pairs.length;
        json.params = repeats ? new URLSearchParams(pairs).toString() : Object.fromEntries(pairs);
      }
      if (recipe !== undefined) json.recipe = recipe;
      if (webhookUrl !== undefined) json.webhook_url = webhookUrl;
      body = JSON.stringify(json);
      contentType = "application/json";
    } else {
      const form = new FormData();
      form.append("operation", operation);
      const query =
        typeof params === "string"
          ? params
          : new URLSearchParams(jobQuery(operation, params)).toString();
      if (query) form.append("params", query);
      // As a file part: a text field would have its line ends rewritten to CRLF.
      if (recipe !== undefined) form.append("recipe", new Blob([recipe]), "recipe.toml");
      if (webhookUrl !== undefined) form.append("webhook_url", webhookUrl);
      for (const [n, image] of images.entries()) {
        const part = await toPart(image, `image-${n + 1}`);
        form.append("image", part.blob, part.filename);
      }
      for (const url of urls) form.append("url", url);
      body = form;
    }
    const response = await this.#transport.request({
      method: "POST",
      path: "/v1/jobs",
      body,
      contentType,
      signal: options.signal,
      timeout: options.timeout,
      // Creating a job twice would run it twice: retried only on 503.
      retryConnection: false,
    });
    return parse<Job>(response.bytes);
  }

  /** A job's status, progress and per-item results. */
  async get(id: string, options: RequestOptions = {}): Promise<Job> {
    const response = await this.#transport.request({
      method: "GET",
      path: jobPath(id),
      signal: options.signal,
      timeout: options.timeout,
    });
    return parse<Job>(response.bytes);
  }

  /** Your recent jobs, newest first (up to 100), without their items. */
  async list(options: RequestOptions = {}): Promise<JobSummary[]> {
    const response = await this.#transport.request({
      method: "GET",
      path: "/v1/jobs",
      signal: options.signal,
      timeout: options.timeout,
    });
    return parse<JobSummary[]>(response.bytes);
  }

  /** Cancels a job (if unfinished) and deletes it with its results. */
  async delete(id: string, options: RequestOptions = {}): Promise<void> {
    await this.#transport.request({
      method: "DELETE",
      path: jobPath(id),
      signal: options.signal,
      timeout: options.timeout,
    });
  }

  /** The result of one finished item (numbered from 0). */
  async result(id: string, item: number, options: RequestOptions = {}): Promise<JobItemResult> {
    const response = await this.#transport.request({
      method: "GET",
      path: `${jobPath(id)}/items/${item}`,
      signal: options.signal,
      timeout: options.timeout,
    });
    return new JobItemResult(response);
  }

  /**
   * Polls a job until it is `completed` (every item attempted: check
   * `counts.failed`). Throws a `TimeoutError` when `timeout` runs out; the
   * job itself carries on.
   */
  async wait(id: string, options: JobWaitOptions = {}): Promise<Job> {
    const pollInterval = options.pollInterval ?? 2000;
    const timeout = options.timeout ?? 600_000;
    const deadline = Date.now() + timeout;
    for (;;) {
      const job = await this.get(id, { signal: options.signal });
      if (job.status === "completed") return job;
      if (Date.now() + pollInterval > deadline) {
        throw new TimeoutError(`Job ${id} did not complete within ${timeout} ms`);
      }
      await this.#transport.sleep(pollInterval, options.signal);
    }
  }
}
