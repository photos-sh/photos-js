// Parameters and JSON results of the API. Results are returned as parsed, so
// fields the API adds later are kept even though they are not typed here.

/** A string union that still accepts values the API adds later. */
type Open<T extends string> = T | (string & {});

/**
 * An image to send: a `Blob`/`File`, bytes, a stream, or (in Node, Deno and
 * Bun) the path of a file. A string is always a path.
 */
export type ImageInput = Blob | ArrayBuffer | ArrayBufferView | ReadableStream<Uint8Array> | string;

/** Accepted by every method. */
export interface RequestOptions {
  /** Aborts the request (and any retry wait). */
  signal?: AbortSignal | undefined;
  /** Overrides the client's timeout for this call, in milliseconds. */
  timeout?: number | undefined;
}

export type Format = Open<"png" | "jpg" | "webp" | "avif">;
export type Marketplace = Open<
  "amazon" | "ebay" | "etsy" | "shopify" | "google" | "allegro" | "zalando"
>;

/**
 * The model that finds the subject in `removeBackground`. Each costs the same;
 * try another when one drops part of what you sell. Any other string is sent
 * as it is, so a model the API adds later works without a new release.
 *
 * - `atlas` (the API's default): everyday product photos, a product alone or
 *   with its box, on any backdrop.
 * - `lumen`: pale packaging on a light backdrop, such as a cream or wooden box
 *   beside a bottle, and close-ups where the product fills the photo. On
 *   those, `atlas` can keep the bottle and drop the box. It may keep a dark
 *   backdrop at the photo's edge, and can cut away part of an open frame or
 *   wire stand.
 * - `muse`: people, in portraits and as models wearing the product.
 */
export type BackgroundModel = Open<"atlas" | "lumen" | "muse">;

/** Options of every method that returns an image. */
export interface OutputOptions {
  /** Output format. Defaults to the photo's own; `removeBackground` defaults to PNG. */
  format?: Format | undefined;
  /** JPEG/WebP/AVIF quality, 1-100 (WebP 100 is lossless). */
  quality?: number | undefined;
}

/**
 * The options after `mask` stage the cutout in the same call. Give at most
 * one of `background`, `backgroundImage` and `blur`.
 */
export interface RemoveBackgroundOptions extends OutputOptions, RequestOptions {
  /** Composite onto a colour (`white`, `#rrggbb`). Omit for transparency. */
  background?: string | undefined;
  /** Crop to the subject. Not with `width` and `height` or `blur`. */
  crop?: boolean | undefined;
  /** Margin around the subject when cropping, in pixels. */
  padding?: number | undefined;
  /**
   * The model that finds the subject: `atlas` (the API's default) for
   * everyday product photos, `lumen` for pale packaging on a light backdrop
   * and close-ups, `muse` for people. See {@link BackgroundModel}. Sent only
   * when set. Works with `studio`.
   */
  model?: BackgroundModel | undefined;
  /**
   * For studio shots (a product on a plain, light backdrop, as in a light
   * tent): also keep what clearly stands out from the backdrop and touches the
   * product, such as the gift box, case or lid shown with a bottle, or a pale
   * box the model left half transparent. Shadows and the floor below the
   * product are left out. A photo without a plain light backdrop is cut out as
   * without it.
   */
  studio?: boolean | undefined;
  /** Return the greyscale alpha mask instead of the cutout. Takes no staging options. */
  mask?: boolean | undefined;
  /** Place the subject on a canvas this wide, in pixels. Needs `height`. */
  width?: number | undefined;
  /** The canvas's height. Needs `width`. */
  height?: number | undefined;
  /** How much of the canvas the subject may take, 0.05 to 1 (default 0.85). Needs a canvas. */
  fill?: number | undefined;
  /** Where the subject sits on the canvas (default `center`). */
  align?: Open<"center" | "top" | "bottom"> | undefined;
  /** `contact`: a soft shadow at the subject's base. `drop`: its silhouette, offset and blurred. */
  shadow?: Open<"none" | "contact" | "drop"> | undefined;
  /** A fading mirror image under the subject. Leave room below it (`fill` under 1). */
  reflection?: boolean | undefined;
  /** Keep the photo's own background behind the subject, blurred: 1 (slight) to 100. */
  blur?: number | undefined;
  /** An image to put behind the subject, scaled to cover (sent as the `background` part). */
  backgroundImage?: ImageInput | undefined;
}

export interface ResizeOptions extends OutputOptions, RequestOptions {
  width?: number | undefined;
  height?: number | undefined;
  /** How to fit when both sides are given. `cover` and `fill` need both. */
  fit?: Open<"contain" | "cover" | "fill"> | undefined;
  /** Allow scaling up with `contain`. */
  enlarge?: boolean | undefined;
  /** Lower the quality until the file fits (sent as `max_bytes`). */
  maxBytes?: number | undefined;
  /** Flatten transparency onto this colour. */
  background?: string | undefined;
  /** Cut away an even border first: whatever matches the top-left pixel. */
  trim?: boolean | undefined;
  /** How far a pixel may differ from the border's colour, 0-255 (default 10). Needs `trim`. */
  trimTolerance?: number | undefined;
  /** Print resolution to write into a JPEG or PNG, 1-2400. No pixel changes. */
  dpi?: number | undefined;
}

export interface UpscaleOptions extends OutputOptions, RequestOptions {
  /** 1 to 4; the API's default is 4. */
  scale?: number | undefined;
}

/** An area as `[x, y, width, height]` or as an object, in pixels. */
export type Rect =
  | readonly [x: number, y: number, width: number, height: number]
  | { x: number; y: number; width: number; height: number };

export interface EraseOptions extends OutputOptions, RequestOptions {
  /** Areas to remove. Give these and/or `mask`. */
  rects?: readonly Rect[] | undefined;
  /** A mask image the size of the photo: white = remove. */
  mask?: ImageInput | undefined;
}

export interface RemoveTextOptions extends OutputOptions, RequestOptions {
  /** `background` (default) leaves text printed on the product; `all` removes it too. */
  region?: Open<"background" | "all"> | undefined;
  /** Only remove lines matching this case-insensitive regular expression. */
  matching?: string | undefined;
}

/** Give exactly one of `preset` and `recipe`. */
export interface RunOptions extends RequestOptions {
  /** Name of a built-in preset (see `presets()`). */
  preset?: string | undefined;
  /** Recipe TOML. */
  recipe?: string | undefined;
}

/** Without settings: automatic levels and white balance. With any, only what is given. */
export interface EnhanceOptions extends OutputOptions, RequestOptions {
  /** Automatic levels and white balance. On when no other setting is given. */
  auto?: boolean | undefined;
  /** Stretch the tones so the darkest pixels are black and the brightest white. */
  levels?: boolean | undefined;
  /** Take out a colour cast (sent as `white_balance`). */
  whiteBalance?: boolean | undefined;
  /** -100 to 100. */
  brightness?: number | undefined;
  /** -100 to 100. */
  contrast?: number | undefined;
  /** -100 (black and white) to 100. */
  saturation?: number | undefined;
  /** -100 (cooler, bluer) to 100 (warmer). */
  temperature?: number | undefined;
  /** 0 to 100. */
  sharpen?: number | undefined;
}

/** Give `aspect`, or `width` and `height`. */
export interface CropOptions extends OutputOptions, RequestOptions {
  /** The shape as width:height (`"4:5"`, `"16:9"`) or a number (`1.5`). */
  aspect?: string | number | undefined;
  /** Scale the crop to this width. Needs `height`. Without `aspect`, the two give the shape. */
  width?: number | undefined;
  height?: number | undefined;
  /** Crop tightly around the subject, instead of the largest crop of the shape. */
  zoom?: boolean | undefined;
  /** Room around the subject with `zoom`, as a fraction of its longest side (default 0.1). */
  padding?: number | undefined;
  /** What the crop is built around: the photo's subject (default), or the faces in it. */
  focus?: Open<"subject" | "face"> | undefined;
}

/** Give `text` or `watermark`, not both. */
export interface WatermarkOptions extends OutputOptions, RequestOptions {
  /** Up to 200 characters, in Latin, Greek or Cyrillic letters. */
  text?: string | undefined;
  /** The logo: an image, best a PNG with transparency (sent as the `watermark` part). */
  watermark?: ImageInput | undefined;
  /** The text's colour (`white`, `black`, `#rrggbb`; default white). */
  color?: string | undefined;
  /** Default `bottom-right`. */
  position?:
    | Open<
        | "top-left"
        | "top"
        | "top-right"
        | "left"
        | "center"
        | "right"
        | "bottom-left"
        | "bottom"
        | "bottom-right"
      >
    | undefined;
  /** The mark's width as a percentage of the photo's width, 1-100 (default 25). */
  scale?: number | undefined;
  /** 1-100 (default 50). */
  opacity?: number | undefined;
  /** Distance from the edges as a percentage of the photo's shorter side, 0-50 (default 3). */
  margin?: number | undefined;
  /** Repeat the mark across the whole photo. `position` is then unused. */
  tile?: boolean | undefined;
}

/** Give `aspect`, or pixels for the sides. */
export interface ExpandOptions extends OutputOptions, RequestOptions {
  /** The shape to reach, as width:height (`"1:1"`) or a number. Not with the sides. */
  aspect?: string | number | undefined;
  /** Pixels to add on the left. */
  left?: number | undefined;
  right?: number | undefined;
  top?: number | undefined;
  bottom?: number | undefined;
  /** `inpaint` (default: the new area continues the photo), or a colour (`white`, `#rrggbb`). */
  fill?: Open<"inpaint"> | undefined;
}

export interface VectorizeOptions extends RequestOptions {
  /** `mono` draws whatever is darker than mid grey as one black shape. Default `color`. */
  mode?: Open<"color" | "mono"> | undefined;
  /** Smooth curves (default), straight segments, or every pixel step (for pixel art). */
  curves?: Open<"spline" | "polygon" | "pixel"> | undefined;
  /** Bits kept per colour channel, 1-8 (default 8). Lower merges similar shades. */
  detail?: number | undefined;
  /** Areas smaller than this many pixels across are dropped, 0-100 (default 4). */
  speckle?: number | undefined;
}

export interface BlurFacesOptions extends OutputOptions, RequestOptions {
  /** Default `blur`. Only `fill` leaves nothing of the face. */
  mode?: Open<"blur" | "pixelate" | "fill"> | undefined;
  /** How strong the blur or how coarse the mosaic is, 1-100 (default 50). */
  strength?: number | undefined;
  /** How far past the face's box the hidden area reaches, as a fraction of the box: 0 to 1. */
  padding?: number | undefined;
  /** The colour for `mode: "fill"` (`black`, `white`, `#rrggbb`). */
  color?: string | undefined;
  /** How sure the model must be that something is a face, 0.1 to 1 (sent as `min_score`). */
  minScore?: number | undefined;
}

/** Give `document`, or `widthMm`, `heightMm`, `headMinMm` and `headMaxMm`. */
export interface IdPhotoOptions extends OutputOptions, RequestOptions {
  /** A built-in document (see `idPhotos()`), e.g. `us-passport`. Not with the sizes. */
  document?: string | undefined;
  /** The photo's width in millimetres (sent as `width_mm`, and so on). */
  widthMm?: number | undefined;
  heightMm?: number | undefined;
  /** The smallest allowed head, chin to crown. */
  headMinMm?: number | undefined;
  headMaxMm?: number | undefined;
  /** The eyes' smallest distance from the bottom edge. Needs `eyesMaxMm`. */
  eyesMinMm?: number | undefined;
  eyesMaxMm?: number | undefined;
  /** Pixels per inch of the result, 100-1200 (default 300). Also written into the file. */
  dpi?: number | undefined;
  /** `keep` (the default: the photo's own), `document` (the document's colour), or a colour. */
  background?: Open<"keep" | "document"> | undefined;
}

export interface DenoiseOptions extends OutputOptions, RequestOptions {
  /** How much of the cleaned result replaces the photo, 1-100 (default 100). */
  strength?: number | undefined;
}

export interface ColorizeOptions extends OutputOptions, RequestOptions {
  /** How colourful the result is, 1-100 (default 100); lower is paler. */
  strength?: number | undefined;
}

/** A point as `[x, y]` or as an object, in pixels. */
export type Point = readonly [x: number, y: number] | { x: number; y: number };

/** Give at least one of `points` and `box`. */
export interface SelectOptions extends OutputOptions, RequestOptions {
  /** Points on the object. More points add to the selection. */
  points?: readonly Point[] | undefined;
  /** Points that must stay outside the selection. */
  exclude?: readonly Point[] | undefined;
  /** A box around the object. */
  box?: Rect | undefined;
  /** Which of the model's answers: the surest (default), the smallest or the largest. */
  pick?: Open<"auto" | "smallest" | "largest"> | undefined;
  /** Return the greyscale mask instead of the cutout. */
  mask?: boolean | undefined;
  /** Crop to the object. */
  crop?: boolean | undefined;
  /** Margin around the object when cropping, in pixels. */
  padding?: number | undefined;
  /** Composite onto a colour (`white`, `#rrggbb`). Omit for transparency. */
  background?: string | undefined;
}

export interface RestoreFacesOptions extends OutputOptions, RequestOptions {
  /** How much of the restored face replaces the original, 1-100 (default 100). */
  strength?: number | undefined;
  /** How sure the detector must be that something is a face, 0.1 to 1 (sent as `min_score`). */
  minScore?: number | undefined;
}

export interface FixOptions extends RequestOptions {
  marketplace: Marketplace;
}

export interface CheckOptions extends RequestOptions {
  /** Check against this marketplace's rules. */
  marketplace?: Marketplace | undefined;
  /** Also find the product, for framing and background checks. */
  subject?: boolean | undefined;
  /** Also read the text in the photo. */
  text?: boolean | undefined;
}

export interface ReadBarcodesOptions extends RequestOptions {
  /** Also read EAN-8, UPC-E, Code 128/39/93, QR, Data Matrix, PDF417 (sent as `all_formats`). */
  allFormats?: boolean | undefined;
  engine?: Open<"auto" | "zbar" | "rxing"> | undefined;
}

export interface IdentifyOptions extends RequestOptions {
  /** The catalogue's name; optional when your organisation has exactly one. */
  catalogue?: string | undefined;
  /** How many candidates to return (1-50, default 5). */
  top?: number | undefined;
}

export interface PaletteOptions extends RequestOptions {
  /** How many colours at most, 1-16 (default 5). */
  colors?: number | undefined;
}

export interface FindFacesOptions extends RequestOptions {
  /** How sure the model must be that something is a face, 0.1 to 1 (sent as `min_score`). */
  minScore?: number | undefined;
}

export interface CaptionOptions extends RequestOptions {
  /** One sentence (`short`, the default), two or three (`detailed`), or a paragraph. */
  detail?: Open<"short" | "detailed" | "paragraph"> | undefined;
}

// --- JSON results ------------------------------------------------------------

/** Per-step durations in milliseconds. */
export type Timings = Record<string, number>;

export interface Finding {
  /** Stable identifier, e.g. `blurry`, `too_small`, `background_not_white`. */
  code: string;
  /** `error` breaks a marketplace rule. */
  severity: Open<"info" | "warning" | "error">;
  message: string;
  /** What was measured or found. */
  detail?: string;
}

export interface Metrics {
  width: number;
  height: number;
  sharpness: number;
  noise: number | null;
  brightness: number;
  highlights_clipped: number;
  shadows_clipped: number;
  brightest: number;
  border: { mean: number[]; white: number; cast: number[] | null };
  subject: {
    x: number;
    y: number;
    width: number;
    height: number;
    fill: number;
    area: number;
    touches: Array<Open<"top" | "bottom" | "left" | "right">>;
    background_white: number;
  } | null;
}

export interface Verdict {
  marketplace: string;
  title?: string;
  /** No `error` rule broken and every `error` rule checked. */
  passed: boolean;
  findings: Finding[];
  not_checked: string[];
  /** Rules for the seller to check by eye. */
  notes?: string[];
  checked?: string;
  sources?: string[];
}

export interface CheckResult {
  metrics: Metrics;
  findings: Finding[];
  text?: Array<{ text: string; on_product: boolean | null }>;
  marketplace?: Verdict;
  ms?: Timings;
}

export interface Barcode {
  /** e.g. `EAN-13`, `UPC-A`, `ITF`, `QR`. */
  format: string;
  /** As decoded. */
  value: string;
  /** GS1-valid normalised digits (retail codes). */
  gs1?: string | null;
}

export interface BarcodesResult {
  barcodes: Barcode[];
  /** Preprocessing that found the codes, or `none`. */
  variant: string;
}

export interface TextLine {
  text: string;
  /** Mean character confidence, 0-1. */
  score: number;
  /** Corners in pixels, clockwise from top-left. */
  box: Array<[number, number]>;
}

export interface TextResult {
  lines: TextLine[];
  ms?: Timings;
}

/** Product details read off a label. Fields are omitted when not found. */
export interface LabelDetails {
  headline?: string[];
  gtin?: string;
  gs1?: {
    gtin?: string;
    batch?: string;
    serial?: string;
    expiry?: string;
    best_before?: string;
    production?: string;
    packed?: string;
    net_weight_kg?: number;
    count?: number;
  };
  net_quantity?: {
    value?: number;
    unit?: Open<"ml" | "cl" | "dl" | "l" | "fl_oz" | "g" | "kg" | "oz" | "lb">;
    ml?: number;
    grams?: number;
    count?: number;
    text?: string;
  };
  alcohol?: { abv?: number; text?: string };
  age_years?: number;
  vintage?: number;
  bottled?: number;
  dates?: Array<{
    kind?: Open<"best_before" | "use_by" | "expiry" | "production" | "packed">;
    date?: string;
    text?: string;
  }>;
  lot?: string;
  serial?: string;
  model?: string;
  ingredients?: string;
  allergens?: string[];
  may_contain?: string[];
  nutrition?: {
    per?: string;
    energy_kj?: number;
    energy_kcal?: number;
    fat?: number;
    saturates?: number;
    carbohydrate?: number;
    sugars?: number;
    fibre?: number;
    protein?: number;
    salt?: number;
  };
  materials?: Array<{ name?: string; percent?: number }>;
  origin?: string;
  electrical?: {
    voltage?: string;
    frequency?: string;
    power_w?: number;
    battery_mah?: number;
  };
  claims?: string[];
}

export interface LabelResult {
  label: LabelDetails;
  barcodes: Array<Record<string, unknown>>;
  text: string[];
  ms?: Timings;
}

export interface IdentifyCandidate {
  product_id: string;
  title: string;
  score: number;
  /**
   * What agreed beyond the name: `barcode`, `barcode_text`, `sku`, `brand`,
   * and by the catalogue's kind `quantity`, `pack`, `spf` (food, cosmetics),
   * `strength`, `count` (pharmacy, household), `spec`, `model`
   * (electronics), `cask_number`, `age`, `age_weak`, `vintage`, `abv`,
   * `size` (wine and spirits).
   */
  evidence: string[];
}

/** A value read off a label, with its unit. */
export interface IdentifyMeasure {
  value: number;
  unit: string;
}

export interface IdentifyResult {
  catalogue: string;
  candidates: IdentifyCandidate[];
  /** Values read off the label; which ones depends on the catalogue's kind. */
  label: {
    ages?: number[];
    weak_ages?: number[];
    years?: number[];
    abvs?: number[];
    /** Centilitres. */
    sizes?: number[];
    /** Net quantities, in `g` or `ml`. */
    quantities?: IdentifyMeasure[];
    /** Units in a multipack: 6 for "6 x 330 ml". */
    packs?: number[];
    /** Sun protection factors. */
    spfs?: number[];
    /** Strengths of a medicine or supplement, in `mg`, `iu` or `percent`. */
    strengths?: IdentifyMeasure[];
    /** Tablets, capsules, washes, rolls, wipes, batteries and the like in the pack. */
    counts?: number[];
    /** Technical values, in `gb`, `mah`, `wh`, `w`, `v`, `a`, `hz` or `in`. */
    specs?: IdentifyMeasure[];
  };
  barcodes: string[];
  text?: string;
  ms?: Timings;
}

export interface PaletteColor {
  /** e.g. `#c81018`. */
  hex: string;
  rgb: [number, number, number];
  /** The fraction of the visible image this colour stands for, 0-1. */
  share: number;
}

export interface PaletteResult {
  width: number;
  height: number;
  /** The most common first. */
  colors: PaletteColor[];
}

export interface Face {
  /** Forehead to chin, in pixels. It can reach past the photo's edges. */
  box: { x: number; y: number; width: number; height: number };
  /** Each an `[x, y]` pair. Right and left are the person's own. */
  landmarks: {
    right_eye: [number, number];
    left_eye: [number, number];
    nose: [number, number];
    mouth_right: [number, number];
    mouth_left: [number, number];
  };
  /** How sure the model is, 0-1. */
  score: number;
  /** The tilt of the line through the eyes, in degrees: 0 for a level head. */
  roll: number;
}

export interface FacesResult {
  width: number;
  height: number;
  /** The surest first. */
  faces: Face[];
}

export interface CaptionResult {
  /** The description, in English. */
  caption: string;
  detail: Open<"short" | "detailed" | "paragraph">;
  width: number;
  height: number;
}

/** A document with built-in photo rules, as `idPhotos()` lists them. */
export interface IdPhotoDocument {
  /** What `idPhoto` takes as `document`, e.g. `us-passport`. */
  name: string;
  title: string;
  /** The date the rules were last compared with the sources. */
  checked: string;
  /** The official pages the rules were read from. */
  sources: string[];
  /** Rules the tool cannot check or make true. */
  notes: string[];
  width_mm: number;
  height_mm: number;
  head_min_mm: number;
  head_max_mm: number;
  /** The eyes' smallest and largest distance from the bottom edge. */
  eyes_from_bottom_mm?: [number, number];
  /** The background the rules ask for, as a colour. */
  background: string;
  /** What the authority says about photos changed by software, in its own words. */
  alteration?: string;
}

/** Console keys get `credits` and `prices`; server keys are `unlimited`. */
export interface Account {
  account?: string;
  /** Key id, `browser` or `job`. */
  key?: string;
  /** Credits left. */
  credits?: number;
  /** Credits per image by operation. */
  prices?: Record<string, number>;
  unlimited?: boolean;
}

export interface Preset {
  name: string;
  description: string;
}

export interface MarketplaceProfile {
  name: string;
  title: string;
  /** The date the rules were last checked. */
  checked: string;
  sources: string[];
  notes?: string[];
  rules: Array<Record<string, unknown>>;
  /** What `fix` produces. */
  fix: Record<string, unknown>;
}

export type HealthStatus = Open<"ok" | "loading" | "failed">;

export interface WebhookSecret {
  /** Your signing key. */
  secret: string;
  /** `Photos-Signature`. */
  header: string;
  /** How the signature is made. */
  scheme: string;
}

// --- jobs --------------------------------------------------------------------

export type JobOperation = Open<
  | "run"
  | "remove-background"
  | "resize"
  | "upscale"
  | "ocr"
  | "barcodes"
  | "check"
  | "fix"
  | "remove-text"
  | "label"
  | "enhance"
  | "crop"
  | "palette"
  | "watermark"
  | "expand"
  | "vectorize"
  | "faces"
  | "blur-faces"
  | "id-photo"
  | "denoise"
  | "colorize"
  | "select"
  | "restore-faces"
  | "caption"
>;

/** `completed` means every item was attempted; see `counts` for failures. */
export type JobStatus = Open<"queued" | "running" | "completed">;

export interface JobCounts {
  total: number;
  done: number;
  failed: number;
  pending: number;
}

export interface JobItem {
  /** Upload file name or input URL. */
  input: string;
  /** The input URL, for inputs given as URLs. */
  url?: string;
  status: Open<"pending" | "done" | "failed">;
  /** Path of the result, when done. */
  result?: string;
  content_type?: string;
  bytes?: number;
  /**
   * Headers of the result, names in lower case: `x-image-*`, `server-timing`,
   * and what the operation adds: `x-text-*`, `x-marketplace-*`,
   * `x-subject-found`, `x-paths`, `x-faces`, `x-faces-skipped`,
   * `x-select-score`, `x-id-photo-*`.
   */
  headers?: Record<string, string>;
  error?: { code: string; message: string };
}

export interface Job {
  id: string;
  operation: JobOperation;
  /** The operation's parameters, as a query string. */
  params: string;
  status: JobStatus;
  /** Unix seconds. */
  created_at: number;
  finished_at?: number;
  counts: JobCounts;
  items: JobItem[];
  webhook?: {
    url: string;
    attempts: number;
    delivered: boolean;
    last_error?: string;
  };
}

/** A job as `jobs.list()` returns it: without items. */
export interface JobSummary {
  id: string;
  operation: JobOperation;
  status: JobStatus;
  created_at: number;
  finished_at: number | null;
  counts: JobCounts;
}

export interface JobCreateOptions extends RequestOptions {
  operation: JobOperation;
  /**
   * The operation's parameters, as the matching method takes them
   * (`{ width: 800, maxBytes: 200_000 }`), or a ready query string. An item
   * is one image, so a second image (`backgroundImage`, a `watermark` logo)
   * cannot be given.
   */
  params?: Record<string, unknown> | string | undefined;
  /** Images to upload. Items are numbered images first, then `urls`. */
  images?: readonly ImageInput[] | undefined;
  /** Image URLs for the API to fetch (public http(s) addresses). */
  urls?: readonly string[] | undefined;
  /** Recipe TOML, for the `run` operation. */
  recipe?: string | undefined;
  /** Receives a signed `job.completed` event (sent as `webhook_url`). */
  webhookUrl?: string | undefined;
}

export interface JobWaitOptions {
  /** Milliseconds between polls. Default 2000. */
  pollInterval?: number | undefined;
  /** Milliseconds to wait in all before a `TimeoutError`. Default 600 000. */
  timeout?: number | undefined;
  signal?: AbortSignal | undefined;
}

/** A verified webhook delivery. */
export interface WebhookEvent {
  type: Open<"job.completed">;
  job: Job;
}
