import { PhotosError } from "./errors.js";
import { nodeFs } from "./input.js";
import type { Barcode } from "./types.js";

/** @internal A response read in full. */
export interface RawResponse {
  status: number;
  headers: Headers;
  bytes: Uint8Array;
}

function numberHeader(headers: Headers, name: string): number | undefined {
  const value = headers.get(name);
  if (value === null || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** `true` or `false`; `undefined` when the header is missing or says neither. */
function booleanHeader(headers: Headers, name: string): boolean | undefined {
  const value = headers.get(name)?.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

/** A comma-separated header as a list. Missing or empty gives an empty list. */
function listHeader(headers: Headers, name: string): string[] {
  return (headers.get(name) ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter((code) => code !== "");
}

/** A header's JSON value; `undefined` when the header is missing or is not JSON. */
function jsonHeader(headers: Headers, name: string): unknown {
  const value = headers.get(name);
  if (value === null) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function isBarcode(value: unknown): value is Barcode {
  if (typeof value !== "object" || value === null) return false;
  const { format, value: decoded, gs1 } = value as Record<string, unknown>;
  return (
    typeof format === "string" &&
    typeof decoded === "string" &&
    (gs1 === undefined || gs1 === null || typeof gs1 === "string")
  );
}

/** `X-Barcodes`: `null` when it is missing or not a JSON array of barcodes. */
function barcodesHeader(headers: Headers): Barcode[] | null {
  const value = jsonHeader(headers, "x-barcodes");
  return Array.isArray(value) && value.every(isBarcode) ? value : null;
}

/** `X-Text`: `null` when it is missing or not a JSON array of strings. */
function textHeader(headers: Headers): string[] | null {
  const value = jsonHeader(headers, "x-text");
  return Array.isArray(value) && value.every((line) => typeof line === "string") ? value : null;
}

/** An image the API returned. */
export class ImageResult {
  /** The encoded image. */
  readonly bytes: Uint8Array;
  /** e.g. `image/png`. */
  readonly contentType: string;
  /** Pixels, from `X-Image-Width` (0 if the header is missing). */
  readonly width: number;
  /** Pixels, from `X-Image-Height` (0 if the header is missing). */
  readonly height: number;
  /** From `X-Image-Quality`; only lossy formats have it. */
  readonly quality: number | undefined;
  /** The raw `Server-Timing` value: per-step durations. */
  readonly serverTiming: string | undefined;
  /**
   * The barcodes a recipe's `[barcodes]` step read (`X-Barcodes`), as
   * `readBarcodes` gives them; `[]` when it ran and found none. `null` when
   * the recipe has no such step (no header), and also when the header is not
   * a JSON array of barcodes: it is ignored rather than thrown on.
   */
  readonly barcodes: Barcode[] | null;
  /**
   * The lines of text a recipe's `[text]` step read, top to bottom
   * (`X-Text`); `[]` when it ran and found none. `null` when the recipe has
   * no such step (no header), and also when the header is not a JSON array
   * of strings: it is ignored rather than thrown on. (Not `text`, which
   * `VectorizeResult` has as a method.)
   */
  readonly textLines: string[] | null;
  /**
   * `true` when `textLines` leaves lines out because the header has a size limit
   * (`X-Text-Truncated`); `false` otherwise.
   */
  readonly textTruncated: boolean;
  /** All response headers. */
  readonly headers: Headers;

  /** @internal */
  constructor(response: Pick<RawResponse, "headers" | "bytes">) {
    const { headers, bytes } = response;
    this.bytes = bytes;
    this.headers = headers;
    this.contentType = headers.get("content-type") ?? "application/octet-stream";
    this.width = numberHeader(headers, "x-image-width") ?? 0;
    this.height = numberHeader(headers, "x-image-height") ?? 0;
    this.quality = numberHeader(headers, "x-image-quality");
    this.serverTiming = headers.get("server-timing") ?? undefined;
    this.barcodes = barcodesHeader(headers);
    this.textLines = textHeader(headers);
    this.textTruncated = booleanHeader(headers, "x-text-truncated") === true;
  }

  /** The image as a `Blob` with its content type. */
  blob(): Blob {
    return new Blob([this.bytes as BlobPart], { type: this.contentType });
  }

  /** Writes the image to a file (Node.js, Deno, Bun). */
  async save(path: string): Promise<void> {
    const fs = await nodeFs();
    await fs.writeFile(path, this.bytes);
  }
}

/** The result of `removeBackground`. */
export class RemoveBackgroundResult extends ImageResult {
  /**
   * `false` when no subject was found (under 3% of the photo): the photo is
   * then returned as it was. `undefined` when the API does not say (no
   * `X-Subject-Found` header), which is not the same as `false`.
   */
  readonly subjectFound: boolean | undefined;

  /** @internal */
  constructor(response: Pick<RawResponse, "headers" | "bytes">) {
    super(response);
    this.subjectFound = booleanHeader(response.headers, "x-subject-found");
  }
}

/** The result of `removeText`. */
export class RemoveTextResult extends ImageResult {
  /** Lines of text removed (`X-Text-Removed`). */
  readonly removed: number;
  /** Lines of text left in place (`X-Text-Kept`). */
  readonly kept: number;

  /** @internal */
  constructor(response: Pick<RawResponse, "headers" | "bytes">) {
    super(response);
    this.removed = numberHeader(response.headers, "x-text-removed") ?? 0;
    this.kept = numberHeader(response.headers, "x-text-kept") ?? 0;
  }
}

/** The result of `fix`. */
export class FixResult extends ImageResult {
  /** Whether the fixed image passes the marketplace's check (`X-Marketplace-Passed`). */
  readonly passed: boolean;
  /** Codes of the findings still present (`X-Marketplace-Findings`). */
  readonly findings: string[];

  /** @internal */
  constructor(response: Pick<RawResponse, "headers" | "bytes">) {
    super(response);
    this.passed = booleanHeader(response.headers, "x-marketplace-passed") === true;
    this.findings = listHeader(response.headers, "x-marketplace-findings");
  }
}

/** The result of `crop`. */
export class CropResult extends ImageResult {
  /**
   * `false` when no subject was found: the crop is then centred
   * (`X-Subject-Found`). `undefined` when the API does not say.
   */
  readonly subjectFound: boolean | undefined;

  /** @internal */
  constructor(response: Pick<RawResponse, "headers" | "bytes">) {
    super(response);
    this.subjectFound = booleanHeader(response.headers, "x-subject-found");
  }
}

/**
 * The result of `vectorize`: an SVG. `bytes` is the SVG's text, and `width`
 * and `height` are the size the image was traced at.
 */
export class VectorizeResult extends ImageResult {
  /** How many paths the SVG has (`X-Paths`; 0 if the header is missing). */
  readonly paths: number;

  /** @internal */
  constructor(response: Pick<RawResponse, "headers" | "bytes">) {
    super(response);
    this.paths = numberHeader(response.headers, "x-paths") ?? 0;
  }

  /** The SVG as text. */
  text(): string {
    return new TextDecoder().decode(this.bytes);
  }
}

/** The result of `blurFaces`. */
export class BlurFacesResult extends ImageResult {
  /** How many faces were found and hidden (`X-Faces`; 0 if the header is missing). */
  readonly faces: number;

  /** @internal */
  constructor(response: Pick<RawResponse, "headers" | "bytes">) {
    super(response);
    this.faces = numberHeader(response.headers, "x-faces") ?? 0;
  }
}

/** The result of `idPhoto`. */
export class IdPhotoResult extends ImageResult {
  /**
   * Whether `findings` is empty (`X-Id-Photo-Passed`). Not an approval of the
   * photo: expression, glasses, shadows, focus and likeness are not judged.
   */
  readonly passed: boolean;
  /** Codes of what the tool could see is wrong (`X-Id-Photo-Findings`), e.g. `head_tilted`. */
  readonly findings: string[];
  /** The head's height in the result, chin to crown, in millimetres (`X-Id-Photo-Head-Mm`). */
  readonly headMm: number | undefined;

  /** @internal */
  constructor(response: Pick<RawResponse, "headers" | "bytes">) {
    super(response);
    this.passed = booleanHeader(response.headers, "x-id-photo-passed") === true;
    this.findings = listHeader(response.headers, "x-id-photo-findings");
    this.headMm = numberHeader(response.headers, "x-id-photo-head-mm");
  }
}

/** The result of `select`. */
export class SelectResult extends ImageResult {
  /** How well the model thinks the mask fits the object, 0 to 1 (`X-Select-Score`). */
  readonly score: number | undefined;

  /** @internal */
  constructor(response: Pick<RawResponse, "headers" | "bytes">) {
    super(response);
    this.score = numberHeader(response.headers, "x-select-score");
  }
}

/** The result of `restoreFaces`. */
export class RestoreFacesResult extends ImageResult {
  /** How many faces were restored (`X-Faces`; 0 if the header is missing). */
  readonly faces: number;
  /** How many were left alone because they are large and detailed enough (`X-Faces-Skipped`). */
  readonly facesSkipped: number;

  /** @internal */
  constructor(response: Pick<RawResponse, "headers" | "bytes">) {
    super(response);
    this.faces = numberHeader(response.headers, "x-faces") ?? 0;
    this.facesSkipped = numberHeader(response.headers, "x-faces-skipped") ?? 0;
  }
}

/** The result of one finished job item: an image or JSON, per the operation. */
export class JobItemResult {
  /** The raw body. */
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly headers: Headers;

  /** @internal */
  constructor(response: Pick<RawResponse, "headers" | "bytes">) {
    this.bytes = response.bytes;
    this.headers = response.headers;
    this.contentType = response.headers.get("content-type") ?? "application/octet-stream";
  }

  get isImage(): boolean {
    return this.contentType.toLowerCase().startsWith("image/");
  }

  get isJson(): boolean {
    return /^application\/([\w.-]+\+)?json\b/i.test(this.contentType);
  }

  /** The body as an image result (edit operations, `fix`, `run`). */
  image(): ImageResult {
    if (!this.isImage) {
      throw new PhotosError(`This item's result is ${this.contentType}, not an image`);
    }
    return new ImageResult(this);
  }

  /**
   * The result of a `remove-background` item, with `subjectFound` (which is
   * `undefined` unless the API sent `X-Subject-Found`).
   */
  removeBackground(): RemoveBackgroundResult {
    return new RemoveBackgroundResult(this.image());
  }

  /**
   * The result of a `remove-text` item, with its `removed` and `kept` counts.
   * Throws a `PhotosError` when the result does not carry them: the item ran
   * another operation, or the engine is too old to keep them on job results.
   */
  removeText(): RemoveTextResult {
    this.#need("x-text-removed", "remove-text");
    return new RemoveTextResult(this);
  }

  /**
   * The result of a `fix` item, with its `passed` verdict and `findings`.
   * Throws a `PhotosError` when the result does not carry them: the item ran
   * another operation, or the engine is too old to keep them on job results.
   */
  fix(): FixResult {
    this.#need("x-marketplace-passed", "fix");
    return new FixResult(this);
  }

  /**
   * The result of a `crop` item, with `subjectFound`. Like the accessors
   * below, it throws a `PhotosError` when the result does not carry the
   * operation's header: the item ran another operation.
   */
  crop(): CropResult {
    this.#need("x-subject-found", "crop");
    return new CropResult(this);
  }

  /** The result of a `vectorize` item: the SVG, with `paths`. */
  vectorize(): VectorizeResult {
    this.#need("x-paths", "vectorize");
    return new VectorizeResult(this);
  }

  /** The result of a `blur-faces` item, with `faces`. */
  blurFaces(): BlurFacesResult {
    this.#need("x-faces", "blur-faces");
    return new BlurFacesResult(this);
  }

  /** The result of an `id-photo` item, with `passed`, `findings` and `headMm`. */
  idPhoto(): IdPhotoResult {
    this.#need("x-id-photo-passed", "id-photo");
    return new IdPhotoResult(this);
  }

  /** The result of a `select` item, with `score`. */
  select(): SelectResult {
    this.#need("x-select-score", "select");
    return new SelectResult(this);
  }

  /** The result of a `restore-faces` item, with `faces` and `facesSkipped`. */
  restoreFaces(): RestoreFacesResult {
    this.#need("x-faces-skipped", "restore-faces");
    return new RestoreFacesResult(this);
  }

  #need(header: string, operation: string): void {
    if (!this.isImage) {
      throw new PhotosError(`This item's result is ${this.contentType}, not an image`);
    }
    if (!this.headers.has(header)) {
      throw new PhotosError(
        `This item's result has no ${header} header: it is not the result of a ${operation} job, or the server does not keep that header on job results`,
      );
    }
  }

  /** The body as text. */
  text(): string {
    return new TextDecoder().decode(this.bytes);
  }

  /** The body as JSON (`check`, `ocr`, `barcodes`, `label`, `palette`, `faces`, `caption`). */
  json<T = unknown>(): T {
    if (!this.isJson) {
      throw new PhotosError(`This item's result is ${this.contentType}, not JSON`);
    }
    return JSON.parse(this.text()) as T;
  }
}
