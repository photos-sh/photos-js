import { apiErrorFrom, PhotosError } from "./errors.js";
import { coordinates, selectQuery, toPart, toQuery } from "./input.js";
import { Jobs } from "./jobs.js";
import {
  BlurFacesResult,
  CropResult,
  FixResult,
  IdPhotoResult,
  ImageResult,
  type RawResponse,
  RemoveBackgroundResult,
  RemoveTextResult,
  RestoreFacesResult,
  SelectResult,
  VectorizeResult,
} from "./results.js";
import { type PhotosOptions, Transport } from "./transport.js";
import type {
  Account,
  BarcodesResult,
  BlurFacesOptions,
  CaptionOptions,
  CaptionResult,
  CheckOptions,
  CheckResult,
  ColorizeOptions,
  CropOptions,
  DenoiseOptions,
  EnhanceOptions,
  EraseOptions,
  ExpandOptions,
  FacesResult,
  FindFacesOptions,
  FixOptions,
  HealthStatus,
  IdentifyOptions,
  IdentifyResult,
  IdPhotoDocument,
  IdPhotoOptions,
  ImageInput,
  LabelResult,
  MarketplaceProfile,
  PaletteOptions,
  PaletteResult,
  Preset,
  ReadBarcodesOptions,
  RemoveBackgroundOptions,
  RemoveTextOptions,
  RequestOptions,
  ResizeOptions,
  RestoreFacesOptions,
  RunOptions,
  SelectOptions,
  TextResult,
  UpscaleOptions,
  VectorizeOptions,
  WatermarkOptions,
  WebhookSecret,
} from "./types.js";
import { verifyWebhook } from "./webhooks.js";

function parse<T>(response: RawResponse): T {
  return JSON.parse(new TextDecoder().decode(response.bytes)) as T;
}

/** Extra multipart parts beside the image(s). */
interface Extras {
  mask?: ImageInput | undefined;
  background?: ImageInput | undefined;
  watermark?: ImageInput | undefined;
  recipe?: string | undefined;
}

/**
 * The Photos.sh API client.
 *
 * ```ts
 * const photos = new Photos({ apiKey: "..." });
 * const cutout = await photos.removeBackground("shoe.jpg");
 * await cutout.save("shoe.png");
 * ```
 */
export class Photos {
  /** Verifies a webhook delivery; the same as the exported `verifyWebhook`. */
  static readonly verifyWebhook = verifyWebhook;

  /** Batch jobs. */
  readonly jobs: Jobs;
  readonly #transport: Transport;

  /** @throws {PhotosError} when there is no API key. */
  constructor(options: PhotosOptions = {}) {
    this.#transport = new Transport(options);
    this.jobs = new Jobs(this.#transport);
  }

  /** The base URL requests go to, without a trailing slash. */
  get baseUrl(): string {
    return this.#transport.baseUrl;
  }

  // --- edit ------------------------------------------------------------------

  /**
   * Removes the background. PNG with transparency unless told otherwise. It
   * can stage the cutout in the same call: on a canvas, with a shadow or a
   * reflection, and with a colour, an image (`backgroundImage`) or the
   * photo's own blurred background behind it.
   */
  async removeBackground(
    image: ImageInput,
    options: RemoveBackgroundOptions = {},
  ): Promise<RemoveBackgroundResult> {
    const { backgroundImage, ...rest } = options;
    return new RemoveBackgroundResult(
      await this.#post("/v1/remove-background", [image], rest, toQuery(rest), {
        background: backgroundImage,
      }),
    );
  }

  /** Resizes, converts and compresses. */
  async resize(image: ImageInput, options: ResizeOptions = {}): Promise<ImageResult> {
    return new ImageResult(await this.#post("/v1/resize", [image], options));
  }

  /** AI upscale, up to 4x. */
  async upscale(image: ImageInput, options: UpscaleOptions = {}): Promise<ImageResult> {
    return new ImageResult(await this.#post("/v1/upscale", [image], options));
  }

  /** Removes objects by inpainting the areas given as `rects` and/or a `mask`. */
  async erase(image: ImageInput, options: EraseOptions): Promise<ImageResult> {
    const { rects, mask, ...rest } = options;
    const query = [...(rects ?? []).map((rect) => ["rect", coordinates(rect)]), ...toQuery(rest)];
    return new ImageResult(await this.#post("/v1/erase", [image], rest, query, { mask }));
  }

  /** Removes text, watermarks and captions. */
  async removeText(image: ImageInput, options: RemoveTextOptions = {}): Promise<RemoveTextResult> {
    return new RemoveTextResult(await this.#post("/v1/remove-text", [image], options));
  }

  /** Fixes light and colour: levels and white balance, or the settings given. */
  async enhance(image: ImageInput, options: EnhanceOptions = {}): Promise<ImageResult> {
    return new ImageResult(await this.#post("/v1/enhance", [image], options));
  }

  /** Crops to a shape around the subject, or around the faces. The background stays. */
  async crop(image: ImageInput, options: CropOptions): Promise<CropResult> {
    return new CropResult(await this.#post("/v1/crop", [image], options));
  }

  /** Adds `text` or a logo (`watermark`, an image) to the photo. */
  async watermark(image: ImageInput, options: WatermarkOptions): Promise<ImageResult> {
    const { watermark, ...rest } = options;
    return new ImageResult(
      await this.#post("/v1/watermark", [image], rest, toQuery(rest), { watermark }),
    );
  }

  /**
   * Adds room around the photo, to a shape or by pixels on each side. The new
   * area continues the photo's background, or is one colour (`fill`).
   */
  async expand(image: ImageInput, options: ExpandOptions): Promise<ImageResult> {
    return new ImageResult(await this.#post("/v1/expand", [image], options));
  }

  /** Traces a logo, icon or flat drawing into SVG. */
  async vectorize(image: ImageInput, options: VectorizeOptions = {}): Promise<VectorizeResult> {
    return new VectorizeResult(await this.#post("/v1/vectorize", [image], options));
  }

  /** Hides every face found: blurred, pixelated, or covered with a colour. */
  async blurFaces(image: ImageInput, options: BlurFacesOptions = {}): Promise<BlurFacesResult> {
    return new BlurFacesResult(await this.#post("/v1/blur-faces", [image], options));
  }

  /**
   * Frames a portrait for an identity document: a built-in `document`, or the
   * sizes given. The photo's own background is kept unless `background` says
   * otherwise. A photo with no face, or more than one, is an `UnprocessableError`.
   */
  async idPhoto(image: ImageInput, options: IdPhotoOptions): Promise<IdPhotoResult> {
    return new IdPhotoResult(await this.#post("/v1/id-photo", [image], options));
  }

  /** The documents `idPhoto` has built-in rules for. */
  async idPhotos(options: RequestOptions = {}): Promise<IdPhotoDocument[]> {
    return parse(await this.#get("/v1/id-photos", options));
  }

  /** Removes noise and JPEG artefacts. Photos up to 12 megapixels; slow without a GPU. */
  async denoise(image: ImageInput, options: DenoiseOptions = {}): Promise<ImageResult> {
    return new ImageResult(await this.#post("/v1/denoise", [image], options));
  }

  /** Colours a black-and-white photo. The colours are guesses. */
  async colorize(image: ImageInput, options: ColorizeOptions = {}): Promise<ImageResult> {
    return new ImageResult(await this.#post("/v1/colorize", [image], options));
  }

  /** Cuts out the object at the `points` given, or in a `box`; or returns its mask. */
  async select(image: ImageInput, options: SelectOptions): Promise<SelectResult> {
    return new SelectResult(await this.#post("/v1/select", [image], options, selectQuery(options)));
  }

  /**
   * Redraws the faces in an old or poor photo. The detail is invented: not
   * for photos where the face must be exactly the person's own.
   */
  async restoreFaces(
    image: ImageInput,
    options: RestoreFacesOptions = {},
  ): Promise<RestoreFacesResult> {
    return new RestoreFacesResult(await this.#post("/v1/restore-faces", [image], options));
  }

  /**
   * Applies a built-in preset (`{ preset }`) or a recipe (`{ recipe }`, TOML).
   * A recipe's `[barcodes]` and `[text]` steps read the photo: what they found
   * is in the result's `barcodes`, `textLines` and `textTruncated`.
   */
  async run(image: ImageInput, options: RunOptions): Promise<ImageResult> {
    const { recipe, ...rest } = options;
    return new ImageResult(await this.#post("/v1/run", [image], rest, toQuery(rest), { recipe }));
  }

  // --- check and fix ---------------------------------------------------------

  /** Makes a photo meet a marketplace's rules, and says whether it now passes. */
  async fix(image: ImageInput, options: FixOptions): Promise<FixResult> {
    return new FixResult(await this.#post("/v1/fix", [image], options));
  }

  /** Measures photo quality and, with `marketplace`, checks its rules. */
  async check(image: ImageInput, options: CheckOptions = {}): Promise<CheckResult> {
    return parse(await this.#post("/v1/check", [image], options));
  }

  /** The rules of every marketplace `check` and `fix` know. */
  async marketplaces(options: RequestOptions = {}): Promise<MarketplaceProfile[]> {
    return parse(await this.#get("/v1/marketplaces", options));
  }

  // --- read ------------------------------------------------------------------

  /** Reads barcodes. */
  async readBarcodes(
    image: ImageInput,
    options: ReadBarcodesOptions = {},
  ): Promise<BarcodesResult> {
    return parse(await this.#post("/v1/barcodes", [image], options));
  }

  /** Reads text (OCR). */
  async readText(image: ImageInput, options: RequestOptions = {}): Promise<TextResult> {
    return parse(await this.#post("/v1/ocr", [image], options));
  }

  /** Reads product details from 1 to 8 photos of one product's label. */
  async readLabel(
    images: ImageInput | readonly ImageInput[],
    options: RequestOptions = {},
  ): Promise<LabelResult> {
    return parse(await this.#post("/v1/label", several(images), options));
  }

  /**
   * Matches 1 to 8 photos of one product against one of your organisation's
   * catalogues (uploaded on the console's Catalogues page).
   *
   * Catalogue matching is turned on per organisation: until it is on for
   * yours and a catalogue is uploaded, the API answers `404`
   * (`NotFoundError`).
   */
  async identify(
    images: ImageInput | readonly ImageInput[],
    options: IdentifyOptions = {},
  ): Promise<IdentifyResult> {
    return parse(await this.#post("/v1/identify", several(images), options));
  }

  /** The main colours of an image, the most common first. */
  async palette(image: ImageInput, options: PaletteOptions = {}): Promise<PaletteResult> {
    return parse(await this.#post("/v1/palette", [image], options));
  }

  /** Where the faces are: a box and five landmarks each. It does not say whose they are. */
  async findFaces(image: ImageInput, options: FindFacesOptions = {}): Promise<FacesResult> {
    return parse(await this.#post("/v1/faces", [image], options));
  }

  /** Describes the photo in words. English only, and it can be wrong. */
  async caption(image: ImageInput, options: CaptionOptions = {}): Promise<CaptionResult> {
    return parse(await this.#post("/v1/caption", [image], options));
  }

  // --- account ---------------------------------------------------------------

  /** Your account: credits left and prices, or `unlimited`. */
  async account(options: RequestOptions = {}): Promise<Account> {
    return parse(await this.#get("/v1/account", options));
  }

  /** The built-in presets `run` takes. */
  async presets(options: RequestOptions = {}): Promise<Preset[]> {
    return parse(await this.#get("/v1/presets", options));
  }

  /**
   * A built-in preset's recipe, as TOML: a starting point for your own
   * `recipe`. An unknown name is a `NotFoundError`.
   */
  async preset(name: string, options: RequestOptions = {}): Promise<string> {
    const response = await this.#get(`/v1/presets/${encodeURIComponent(name)}`, options);
    return new TextDecoder().decode(response.bytes);
  }

  /** The key your webhooks are signed with. */
  async webhookSecret(options: RequestOptions = {}): Promise<WebhookSecret> {
    return parse(await this.#get("/v1/webhook-secret", options));
  }

  /**
   * Whether the service is ready: `ok`, or `loading`/`failed` (which the API
   * answers with a 503; that is not an error here).
   */
  async health(options: RequestOptions = {}): Promise<HealthStatus> {
    const response = await this.#transport.request({
      method: "GET",
      path: "/health",
      signal: options.signal,
      timeout: options.timeout,
      accept503: true,
    });
    const text = new TextDecoder().decode(response.bytes);
    try {
      const status = (JSON.parse(text) as { status?: unknown } | null)?.status;
      if (typeof status === "string") return status;
    } catch {
      // Not the health document: an error from something in between.
    }
    if (response.status >= 400) throw apiErrorFrom(response.status, response.headers, text);
    throw new PhotosError("Unexpected response from /health");
  }

  // --- requests --------------------------------------------------------------

  #get(path: string, options: RequestOptions): Promise<RawResponse> {
    return this.#transport.request({
      method: "GET",
      path,
      signal: options.signal,
      timeout: options.timeout,
    });
  }

  async #post(
    path: string,
    images: readonly ImageInput[],
    options: RequestOptions,
    query: string[][] = toQuery(options),
    extras: Extras = {},
  ): Promise<RawResponse> {
    if (images.length === 0) throw new PhotosError("At least one image is needed");
    const form = new FormData();
    for (const [n, image] of images.entries()) {
      const part = await toPart(image, images.length === 1 ? "image" : `image-${n + 1}`);
      form.append("image", part.blob, part.filename);
    }
    for (const name of ["mask", "background", "watermark"] as const) {
      const extra = extras[name];
      if (extra === undefined) continue;
      const part = await toPart(extra, name);
      form.append(name, part.blob, part.filename);
    }
    // As a file part: a text field would have its line ends rewritten to CRLF.
    if (extras.recipe !== undefined)
      form.append("recipe", new Blob([extras.recipe]), "recipe.toml");
    return this.#transport.request({
      method: "POST",
      path,
      query,
      body: form,
      signal: options.signal,
      timeout: options.timeout,
    });
  }
}

function several(images: ImageInput | readonly ImageInput[]): readonly ImageInput[] {
  return Array.isArray(images) ? (images as readonly ImageInput[]) : [images as ImageInput];
}
